// Written with AI assistance (Claude Code). See README "Use of AI tools".
// The Mission Control HTTP API (src/server/api.ts routes /api/rooms here).
// JSON over POST for every move, and one Server-Sent Events stream per screen for live updates.
//
//   POST /api/rooms                      {difficulty?, mode?}            -> {code, teacherToken}
//   GET  /api/rooms/:code                                                 -> {code, phase, players, full, ...} (no names)
//   POST /api/rooms/:code/join           {name} or {token}               -> {playerId, token, name, rejoined}
//   POST /api/rooms/:code/action         {token, type, ...}              -> {ok, v}
//   POST /api/rooms/:code/teacher        {teacherToken, type, ...}       -> {ok, v}
//   GET  /api/rooms/:code/events?token=  (or ?teacher=)                  -> text/event-stream
//
// Server-only: the game in the browser imports ./protocol, never this file.

import { BodyError, bodyErrorResponse, json, readJson } from '../server/web';
import { LIMITS } from './protocol';
import type { RoomStore, Sink } from './store';
import type { Fail } from './room';

const fail = (f: Fail) => json(f.status, { error: f.error, message: f.message });

const ROUTE = /^\/api\/rooms(?:\/([^/]+)(?:\/(join|action|teacher|events))?)?\/?$/;

const SSE_HEADERS = {
  'content-type': 'text/event-stream; charset=utf-8',
  // no-transform: proxies (and Cloudflare) must not compress or buffer the stream.
  'cache-control': 'no-cache, no-transform',
  'x-accel-buffering': 'no',
};

/**
 * Handles /api/rooms requests. Resolves null if the path is not a rooms route
 * (so the caller can try its other routes). `ip` is the visitor's address, for rate limits.
 */
export function createRoomsHandler(store: RoomStore) {
  return async function handleRooms(req: Request, url: URL, ip: string): Promise<Response | null> {
    const m = ROUTE.exec(url.pathname);
    if (!m) return null;
    const [, code, sub] = m;
    const method = req.method;
    try {
      // GET /api/rooms/:code/events: the live stream.
      if (sub === 'events') {
        if (method !== 'GET') return json(405, { error: 'method', message: 'Use GET.' });
        return openEvents(store, code, url);
      }
      if (!code) {
        if (method !== 'POST') return json(405, { error: 'method', message: 'Use POST to make a room.' });
        const body = await readJson(req, LIMITS.maxBody);
        const r = await store.create(ip, body);
        return r.ok ? json(201, r.value) : fail(r);
      }
      if (!sub) {
        if (method !== 'GET' && method !== 'HEAD') return json(405, { error: 'method', message: 'Use GET.' });
        const r = store.info(code);
        return r.ok ? json(200, r.value) : fail(r);
      }
      if (method !== 'POST') return json(405, { error: 'method', message: 'Use POST.' });
      const body = await readJson(req, LIMITS.maxBody);
      const r = sub === 'join' ? store.join(code, ip, body) : sub === 'action' ? store.action(code, body) : store.teacher(code, body);
      return r.ok ? json(200, { ok: true, ...r.value }) : fail(r);
    } catch (e) {
      if (e instanceof BodyError) return bodyErrorResponse(e);
      console.error('rooms:', e);
      return json(500, { error: 'server', message: 'Something went wrong on our side. Try again.' });
    }
  };
}

function openEvents(store: RoomStore, code: string, url: URL): Response {
  const room = store.get(code);
  if (!room) return json(404, { error: 'no-room', message: "We can't find that room. Check the code on the board." });
  const auth = { token: url.searchParams.get('token'), teacher: url.searchParams.get('teacher') };
  // Check before starting the stream, so a bad token gets a plain error (the browser then stops retrying).
  const known = (auth.teacher && auth.teacher === room.teacherToken) || room.players.some((p) => p.token === auth.token);
  if (!known) return json(403, { error: 'not-a-player', message: 'You are not in this room. Join again with your name.' });

  const encoder = new TextEncoder();
  let ctrl!: ReadableStreamDefaultController<Uint8Array>;
  let ended = false;
  let close: (() => void) | null = null;
  // highWaterMark 0 and byte sizes: desiredSize is minus the bytes still waiting to be sent.
  const body = new ReadableStream<Uint8Array>(
    {
      start(c) {
        ctrl = c;
      },
      // The screen went away (tab closed, network dropped).
      cancel() {
        ended = true;
        close?.();
      },
    },
    { highWaterMark: 0, size: (chunk) => chunk?.byteLength ?? 0 },
  );
  const sink: Sink = {
    write(chunk: string) {
      if (ended) throw new Error('stream closed');
      ctrl.enqueue(encoder.encode(chunk));
    },
    end() {
      if (ended) return;
      ended = true;
      try {
        ctrl.close();
      } catch {
        /* already closed */
      }
    },
    backlog: () => Math.max(0, -(ctrl.desiredSize ?? 0)),
  };
  const r = store.subscribe(code, auth, sink);
  if (!r.ok) {
    sink.write(`event: closed\ndata: ${JSON.stringify({ reason: r.error })}\n\n`);
    sink.end();
  } else close = r.value;
  return new Response(body, { status: 200, headers: SSE_HEADERS });
}
