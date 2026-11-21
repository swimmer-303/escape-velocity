// Written with AI assistance (Claude Code). See README "Use of AI tools".
// The API (src/server/api.ts) on a Node http server, for the integration tests (src/*/http.test.ts),
// which run it in-process on a random port. The live site runs the same API on Cloudflare
// (deploy/worker.ts); to run the whole site locally, use `npm run dev:cf`.
// Here class boards and daily boards are saved as files in `stateDir`, and rooms stay in memory.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApi } from '../src/server/api';
import { fileSlot } from '../src/server/file-slot';
import { memorySlot } from '../src/server/slot';
import { CLASS_FILE, type ClassStore } from '../src/class/store';
import { DAILY_FILE, type DailyStore } from '../src/daily/store';
import type { RoomStore } from '../src/room/store';
import type { DonkiSnapshot } from '../src/data/donki';

export interface ApiServerOptions {
  /** Where new rooms get real storms (default: the cached NASA DONKI proxy). Tests pass an offline source. */
  fetchSnapshot?: () => Promise<DonkiSnapshot | null>;
  /** Wait this long to bundle quick room changes into one live message, ms. */
  coalesceMs?: number;
  /** Folder for classes.json and daily.json. Default: class boards in memory, daily.json in a temp folder. */
  stateDir?: string;
  /** The clock for the daily challenge (tests move it across midnight). */
  now?: () => number;
}

/** The visitor's address. Behind a local proxy every request comes from 127.0.0.1, so trust X-Forwarded-For only then. */
export function clientIp(req: IncomingMessage): string {
  const addr = req.socket.remoteAddress ?? '';
  const local = addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
  const fwd = req.headers['x-forwarded-for'];
  if (local && typeof fwd === 'string' && fwd.trim()) return fwd.split(',')[0].trim();
  return addr || 'unknown';
}

const HOP_BY_HOP = new Set(['connection', 'keep-alive', 'transfer-encoding', 'upgrade', 'host']);

/** A Node request as a web Request. */
function toRequest(req: IncomingMessage): Request {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (v === undefined || HOP_BY_HOP.has(k)) continue;
    headers.set(k, Array.isArray(v) ? v.join(', ') : v);
  }
  const method = req.method ?? 'GET';
  const body = method === 'GET' || method === 'HEAD' ? undefined : bodyOf(req);
  return new Request(url, { method, headers, body, duplex: 'half' } as RequestInit);
}

/** A Node request body as a web stream. If the handler stops reading (too big), the rest is drained,
 *  so a kept-alive connection is ready for the next request. */
function bodyOf(req: IncomingMessage): ReadableStream<Uint8Array> {
  let done = false;
  return new ReadableStream<Uint8Array>({
    start(c) {
      req.on('data', (chunk: Buffer) => {
        if (!done) c.enqueue(new Uint8Array(chunk));
      });
      req.on('end', () => {
        if (done) return;
        done = true;
        c.close();
      });
      req.on('error', (e) => {
        if (done) return;
        done = true;
        c.error(e);
      });
    },
    cancel() {
      done = true;
      req.resume();
    },
  });
}

/** Send a web Response through a Node response, streaming its body (live room updates stay open). */
async function send(req: IncomingMessage, res: ServerResponse, r: Response) {
  const headers: Record<string, string> = {};
  r.headers.forEach((v, k) => (headers[k] = v));
  res.writeHead(r.status, headers);
  if (!r.body || req.method === 'HEAD') {
    await r.body?.cancel().catch(() => undefined);
    res.end();
    return;
  }
  if ((r.headers.get('content-type') ?? '').startsWith('text/event-stream')) {
    res.flushHeaders();
    req.socket.setNoDelay(true);
    req.socket.setKeepAlive(true);
  }
  const reader = r.body.getReader();
  // The browser went away: cancel the stream (a live room stream then leaves the room).
  res.on('close', () => void reader.cancel().catch(() => undefined));
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!res.write(value)) await new Promise<void>((ok) => (res.once('drain', ok), res.once('close', ok)));
    }
  } catch {
    /* the stream was cancelled */
  }
  res.end();
}

export function createApiServer(opts: ApiServerOptions = {}): { server: Server; rooms: RoomStore; classes: ClassStore; daily: DailyStore } {
  const dir = opts.stateDir;
  const api = createApi({
    classSlot: dir ? fileSlot(dir, CLASS_FILE) : null,
    dailySlot: dir ? fileSlot(dir, DAILY_FILE) : process.env.VITEST ? fileSlot(join(tmpdir(), `ev-daily-test-${process.pid}`), DAILY_FILE) : memorySlot(),
    fetchSnapshot: opts.fetchSnapshot,
    coalesceMs: opts.coalesceMs,
    now: opts.now,
  });
  const server = createServer(async (req, res) => {
    try {
      await send(req, res, await api.handle(toRequest(req), clientIp(req)));
    } catch (e) {
      console.error('server:', e);
      if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json' });
      res.end();
    }
  });
  server.on('close', () => api.close());
  return { server, rooms: api.rooms, classes: api.classes, daily: api.daily };
}
