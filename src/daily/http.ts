// Written with AI assistance (Claude Code). See README "Use of AI tools".
// The daily challenge HTTP API (src/server/api.ts routes /api/daily here).
//
//   GET  /api/daily                                     -> DailyConfig (today; the first call of the day freezes the pool)
//   GET  /api/daily/:date/top?limit=20&player=<id>      -> {date, total, top: [{rank, nickname, sols, dose, stars, won, fuel}], you}
//   POST /api/daily/:date/submit  {playerId, nickname, moves}  -> {ok, improved, score, you, total}   (the server replays the moves)
//
// Server-only: the game in the browser imports ./protocol, never this file.

import { BodyError, bodyErrorResponse, json, readJson } from '../server/web';
import { DAILY_LIMITS } from './protocol';
import type { DailyStore } from './store';

const ROUTE = /^\/api\/daily(?:\/([^/]+)\/(top|submit))?\/?$/;

const TOO_FAST = { error: 'rate-limited', message: 'Too many tries. Wait a minute and try again.' };

/**
 * Handles /api/daily requests. Resolves null if the path is not a daily route
 * (so the caller can try its other routes). `ip` is the visitor's address, for rate limits.
 */
export function createDailyHandler(store: DailyStore) {
  return async function handleDaily(req: Request, url: URL, ip: string): Promise<Response | null> {
    const m = ROUTE.exec(url.pathname);
    if (!m) return null;
    const [, date, sub] = m;
    const method = req.method;
    try {
      if (sub === 'submit') {
        if (method !== 'POST') return json(405, { error: 'method', message: 'Use POST.' });
        const body = await readJson(req, DAILY_LIMITS.maxBody);
        const r = store.submit(date, ip, body);
        return r.ok ? json(200, r.value) : json(r.status, { error: r.error, message: r.message });
      }
      if (method !== 'GET' && method !== 'HEAD') return json(405, { error: 'method', message: 'Use GET.' });
      if (!store.allowRead(ip)) return json(429, TOO_FAST);
      if (sub === 'top') {
        const limit = Number(url.searchParams.get('limit') ?? DAILY_LIMITS.topDefault);
        const r = store.top(date, limit, url.searchParams.get('player'));
        return r.ok ? json(200, r.value) : json(r.status, { error: r.error, message: r.message });
      }
      return json(200, await store.config());
    } catch (e) {
      if (e instanceof BodyError) return bodyErrorResponse(e);
      console.error('daily:', e);
      return json(500, { error: 'server', message: 'Something went wrong on our side. Try again.' });
    }
  };
}
