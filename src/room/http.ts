// Written with AI assistance (Claude Code). See README "Use of AI tools".
// The Mission Control HTTP API, run by the droplet's Node server (deploy/server.ts).
// JSON over POST for every move, and one Server-Sent Events stream per screen for live updates.
//
//   POST /api/rooms                      {difficulty?, mode?}            -> {code, teacherToken}
//   GET  /api/rooms/:code                                                 -> {code, phase, players, full, ...} (no names)
//   POST /api/rooms/:code/join           {name} or {token}               -> {playerId, token, name, rejoined}
//   POST /api/rooms/:code/action         {token, type, ...}              -> {ok, v}
//   POST /api/rooms/:code/teacher        {teacherToken, type, ...}       -> {ok, v}
//   GET  /api/rooms/:code/events?token=  (or ?teacher=)                  -> text/event-stream
//
// Server-only (Node): the game in the browser imports ./protocol, never this file.

import type { IncomingMessage, ServerResponse } from 'node:http';
import { LIMITS } from './protocol';
import type { RoomStore } from './store';
import type { Fail } from './room';

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };

function send(res: ServerResponse, status: number, body: unknown) {
  if (res.headersSent) return;
  res.writeHead(status, JSON_HEADERS).end(JSON.stringify(body));
}

function sendFail(res: ServerResponse, f: Fail) {
  send(res, f.status, { error: f.error, message: f.message });
}

/** The visitor's address. Behind Caddy every request comes from 127.0.0.1, so trust X-Forwarded-For only then. */
export function clientIp(req: IncomingMessage): string {
  const addr = req.socket.remoteAddress ?? '';
  const local = addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
  const fwd = req.headers['x-forwarded-for'];
  if (local && typeof fwd === 'string' && fwd.trim()) return fwd.split(',')[0].trim();
  return addr || 'unknown';
}

class BodyError extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(code);
  }
}

/** Read a small JSON object body (at most LIMITS.maxBody bytes). */
export function readJson(req: IncomingMessage, max: number = LIMITS.maxBody): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length'] ?? 0);
    if (declared > max) {
      reject(new BodyError(413, 'too-big'));
      req.resume();
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    let done = false;
    req.on('data', (c: Buffer) => {
      if (done) return;
      size += c.length;
      if (size > max) {
        done = true;
        reject(new BodyError(413, 'too-big'));
        req.resume();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (done) return;
      done = true;
      const text = Buffer.concat(chunks).toString('utf8').trim();
      if (!text) return resolve({});
      try {
        const v = JSON.parse(text) as unknown;
        if (v && typeof v === 'object' && !Array.isArray(v)) resolve(v as Record<string, unknown>);
        else reject(new BodyError(400, 'bad-json'));
      } catch {
        reject(new BodyError(400, 'bad-json'));
      }
    });
    req.on('error', () => {
      if (!done) reject(new BodyError(400, 'bad-body'));
      done = true;
    });
  });
}

const ROUTE = /^\/api\/rooms(?:\/([^/]+)(?:\/(join|action|teacher|events))?)?\/?$/;

/**
 * Handles /api/rooms requests. Resolves true if it answered the request, false if the path
 * is not a rooms route (so the caller can try its other routes).
 */
export function createRoomsHandler(store: RoomStore) {
  return async function handleRooms(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
    const m = ROUTE.exec(url.pathname);
    if (!m) return false;
    const [, code, sub] = m;
    const method = req.method ?? 'GET';
    try {
      // GET /api/rooms/:code/events: the live stream.
      if (sub === 'events') {
        if (method !== 'GET') send(res, 405, { error: 'method', message: 'Use GET.' });
        else openEvents(store, req, res, code, url);
        return true;
      }
      if (!code) {
        if (method !== 'POST') {
          send(res, 405, { error: 'method', message: 'Use POST to make a room.' });
          return true;
        }
        const body = await readJson(req);
        const r = await store.create(clientIp(req), body);
        if (!r.ok) sendFail(res, r);
        else send(res, 201, r.value);
        return true;
      }
      if (!sub) {
        if (method !== 'GET' && method !== 'HEAD') {
          send(res, 405, { error: 'method', message: 'Use GET.' });
          return true;
        }
        const r = store.info(code);
        if (!r.ok) sendFail(res, r);
        else send(res, 200, r.value);
        return true;
      }
      if (method !== 'POST') {
        send(res, 405, { error: 'method', message: 'Use POST.' });
        return true;
      }
      const body = await readJson(req);
      const r = sub === 'join' ? store.join(code, clientIp(req), body) : sub === 'action' ? store.action(code, body) : store.teacher(code, body);
      if (!r.ok) sendFail(res, r);
      else send(res, 200, { ok: true, ...r.value });
      return true;
    } catch (e) {
      if (e instanceof BodyError) send(res, e.status, { error: e.code, message: e.status === 413 ? 'That request is too big.' : 'That request was not valid JSON.' });
      else {
        console.error('rooms:', e);
        send(res, 500, { error: 'server', message: 'Something went wrong on our side. Try again.' });
      }
      return true;
    }
  };
}

function openEvents(store: RoomStore, req: IncomingMessage, res: ServerResponse, code: string, url: URL) {
  const sink = {
    write: (chunk: string) => res.write(chunk),
    end: () => res.end(),
    backlog: () => res.writableLength,
  };
  // Headers first: the store writes the first state as soon as the stream is accepted.
  const room = store.get(code);
  if (!room) return send(res, 404, { error: 'no-room', message: "We can't find that room. Check the code on the board." });
  const auth = { token: url.searchParams.get('token'), teacher: url.searchParams.get('teacher') };
  // Check before sending stream headers, so a bad token gets a plain error (the browser then stops retrying).
  const known = (auth.teacher && auth.teacher === room.teacherToken) || room.players.some((p) => p.token === auth.token);
  if (!known) return send(res, 403, { error: 'not-a-player', message: 'You are not in this room. Join again with your name.' });
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    // no-transform: Caddy (and other proxies) must not compress or buffer the stream.
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });
  res.flushHeaders();
  req.socket.setNoDelay(true);
  req.socket.setKeepAlive(true);
  const r = store.subscribe(code, auth, sink);
  if (!r.ok) {
    res.end(`event: closed\ndata: ${JSON.stringify({ reason: r.error })}\n\n`);
    return;
  }
  const close = r.value;
  res.on('close', close);
  req.on('close', close);
}
