// Written with AI assistance (Claude Code). See README "Use of AI tools".
// The daily challenge HTTP API, run by the droplet's Node server (deploy/server.ts).
//
//   GET  /api/daily                                     -> DailyConfig (today; the first call of the day freezes the pool)
//   GET  /api/daily/:date/top?limit=20&player=<id>      -> {date, total, top: [{rank, nickname, sols, dose, stars, won, fuel}], you}
//   POST /api/daily/:date/submit  {playerId, nickname, moves}  -> {ok, improved, score, you, total}   (the server replays the moves)
//
// Server-only (Node): the game in the browser imports ./protocol, never this file.

import type { IncomingMessage, ServerResponse } from 'node:http';
import { clientIp, readJson } from '../room/http';
import { DAILY_LIMITS } from './protocol';
import type { DailyStore } from './store';

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };
const ROUTE = /^\/api\/daily(?:\/([^/]+)\/(top|submit))?\/?$/;

function send(res: ServerResponse, status: number, body: unknown) {
  if (res.headersSent) return;
  res.writeHead(status, JSON_HEADERS).end(JSON.stringify(body));
}

const TOO_FAST = { error: 'rate-limited', message: 'Too many tries. Wait a minute and try again.' };

/**
 * Handles /api/daily requests. Resolves true if it answered the request, false if the path
 * is not a daily route (so the caller can try its other routes).
 */
export function createDailyHandler(store: DailyStore) {
  return async function handleDaily(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
    const m = ROUTE.exec(url.pathname);
    if (!m) return false;
    const [, date, sub] = m;
    const method = req.method ?? 'GET';
    const ip = clientIp(req);
    try {
      if (sub === 'submit') {
        if (method !== 'POST') {
          send(res, 405, { error: 'method', message: 'Use POST.' });
          return true;
        }
        const body = await readJson(req, DAILY_LIMITS.maxBody);
        const r = store.submit(date, ip, body);
        if (!r.ok) send(res, r.status, { error: r.error, message: r.message });
        else send(res, 200, r.value);
        return true;
      }
      if (method !== 'GET' && method !== 'HEAD') {
        send(res, 405, { error: 'method', message: 'Use GET.' });
        return true;
      }
      if (!store.allowRead(ip)) {
        send(res, 429, TOO_FAST);
        return true;
      }
      if (sub === 'top') {
        const limit = Number(url.searchParams.get('limit') ?? DAILY_LIMITS.topDefault);
        const r = store.top(date, limit, url.searchParams.get('player'));
        if (!r.ok) send(res, r.status, { error: r.error, message: r.message });
        else send(res, 200, r.value);
        return true;
      }
      send(res, 200, await store.config());
      return true;
    } catch (e) {
      const err = e as { status?: unknown; code?: unknown };
      if (typeof err?.status === 'number' && typeof err.code === 'string') {
        send(res, err.status, { error: err.code, message: err.status === 413 ? 'That request is too big.' : 'That request was not valid JSON.' });
      } else {
        console.error('daily:', e);
        send(res, 500, { error: 'server', message: 'Something went wrong on our side. Try again.' });
      }
      return true;
    }
  };
}
