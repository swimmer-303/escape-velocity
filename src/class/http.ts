// Written with AI assistance (Claude Code). See README "Use of AI tools".
// The class board (teacher dashboard) HTTP API (src/server/api.ts routes /api/class here).
//
//   POST /api/class                      {code}                                -> 201 {code, key, expiresAt}
//   POST /api/class/:code/join           {playerId, nickname?}                 -> {ok, num, name, nameProblem?}
//   POST /api/class/:code/report         {playerId, rid, nickname?, ...result}  -> {ok, num, name, nameProblem?}
//   GET  /api/class/:code?key=&since=                                          -> the dashboard (or {unchanged, v})
//   POST /api/class/:code/teacher        {key, action: 'remove', num} | {key, action: 'clear'}
//
// Server-only: the game in the browser imports ./protocol, never this file.

import { BodyError, bodyErrorResponse, json, readJson } from '../server/web';
import type { Fail } from '../room/room';
import { CLASS_LIMITS } from './protocol';
import type { ClassStore } from './store';

const fail = (f: Fail) => json(f.status, { error: f.error, message: f.message });

const ROUTE = /^\/api\/class(?:\/([^/]+)(?:\/(report|join|teacher))?)?\/?$/;

/**
 * Handles /api/class requests. Resolves null if the path is not a class route
 * (so the caller can try its other routes). `ip` is the visitor's address, for rate limits.
 */
export function createClassHandler(store: ClassStore) {
  return async function handleClass(req: Request, url: URL, ip: string): Promise<Response | null> {
    const m = ROUTE.exec(url.pathname);
    if (!m) return null;
    const [, code, sub] = m;
    const method = req.method;
    try {
      if (!code) {
        if (method !== 'POST') return json(405, { error: 'method', message: 'Use POST to register a class.' });
        const r = store.register(ip, await readJson(req, CLASS_LIMITS.maxBody));
        return r.ok ? json(201, r.value) : fail(r);
      }
      if (!sub) {
        if (method !== 'GET') return json(405, { error: 'method', message: 'Use GET.' });
        const since = Number(url.searchParams.get('since'));
        const r = store.view(code, ip, url.searchParams.get('key'), Number.isInteger(since) && since > 0 ? since : undefined);
        return r.ok ? json(200, r.value) : fail(r);
      }
      if (method !== 'POST') return json(405, { error: 'method', message: 'Use POST.' });
      const body = await readJson(req, CLASS_LIMITS.maxBody);
      const r = sub === 'report' ? store.report(code, ip, body) : sub === 'join' ? store.join(code, ip, body) : store.teacher(code, ip, body);
      return r.ok ? json(200, r.value) : fail(r);
    } catch (e) {
      if (e instanceof BodyError) return bodyErrorResponse(e);
      console.error('class board:', e);
      return json(500, { error: 'server', message: 'Something went wrong on our side. Try again.' });
    }
  };
}
