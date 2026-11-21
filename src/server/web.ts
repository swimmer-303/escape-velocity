// Written with AI assistance (Claude Code). See README "Use of AI tools".
// Small helpers shared by the API handlers (rooms, class boards, daily challenge). They use the web's
// standard Request and Response, so the same handlers run on Cloudflare (deploy/worker.ts) and in the
// Node server the tests use (deploy/server.ts).

export const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };

export function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

export class BodyError extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(code);
  }
}

/** The answer for a BodyError (too big, or not JSON). */
export function bodyErrorResponse(e: BodyError): Response {
  return json(e.status, { error: e.code, message: e.status === 413 ? 'That request is too big.' : 'That request was not valid JSON.' });
}

/** Read a small JSON object body (at most `max` bytes). Throws BodyError. */
export async function readJson(req: Request, max: number): Promise<Record<string, unknown>> {
  const declared = Number(req.headers.get('content-length') ?? 0);
  if (declared > max) {
    await req.body?.cancel().catch(() => undefined);
    throw new BodyError(413, 'too-big');
  }
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (req.body) {
    const reader = req.body.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > max) {
          await reader.cancel().catch(() => undefined);
          throw new BodyError(413, 'too-big');
        }
        chunks.push(value);
      }
    } catch (e) {
      if (e instanceof BodyError) throw e;
      throw new BodyError(400, 'bad-body');
    }
  }
  const all = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    all.set(c, at);
    at += c.byteLength;
  }
  const text = new TextDecoder().decode(all).trim();
  if (!text) return {};
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    throw new BodyError(400, 'bad-json');
  }
  if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
  throw new BodyError(400, 'bad-json');
}
