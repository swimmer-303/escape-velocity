// Written with AI assistance (Claude Code). See README "Use of AI tools".
// The class board (teacher dashboard) HTTP API, run by the droplet's Node server (deploy/server.ts).
//
//   POST /api/class                      {code}                                -> 201 {code, key, expiresAt}
//   POST /api/class/:code/join           {playerId, nickname?}                 -> {ok, num, name, nameProblem?}
//   POST /api/class/:code/report         {playerId, rid, nickname?, ...result}  -> {ok, num, name, nameProblem?}
//   GET  /api/class/:code?key=&since=                                          -> the dashboard (or {unchanged, v})
//   POST /api/class/:code/teacher        {key, action: 'remove', num} | {key, action: 'clear'}
//
// Server-only (Node): the game in the browser imports ./protocol, never this file.

import type { IncomingMessage, ServerResponse } from 'node:http';
import { clientIp, readJson } from '../room/http';
import type { Fail } from '../room/room';
import { CLASS_LIMITS } from './protocol';
import type { ClassStore } from './store';

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };

function send(res: ServerResponse, status: number, body: unknown) {
  if (res.headersSent) return;
  res.writeHead(status, JSON_HEADERS).end(JSON.stringify(body));
}

const sendFail = (res: ServerResponse, f: Fail) => send(res, f.status, { error: f.error, message: f.message });

const ROUTE = /^\/api\/class(?:\/([^/]+)(?:\/(report|join|teacher))?)?\/?$/;

/**
 * Handles /api/class requests. Resolves true if it answered the request, false if the path
 * is not a class route (so the caller can try its other routes).
 */
export function createClassHandler(store: ClassStore) {
  return async function handleClass(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
    const m = ROUTE.exec(url.pathname);
    if (!m) return false;
    const [, code, sub] = m;
    const method = req.method ?? 'GET';
    try {
      if (!code) {
        if (method !== 'POST') {
          send(res, 405, { error: 'method', message: 'Use POST to register a class.' });
          return true;
        }
        const r = store.register(clientIp(req), await readJson(req, CLASS_LIMITS.maxBody));
        if (!r.ok) sendFail(res, r);
        else send(res, 201, r.value);
        return true;
      }
      if (!sub) {
        if (method !== 'GET') {
          send(res, 405, { error: 'method', message: 'Use GET.' });
          return true;
        }
        const since = Number(url.searchParams.get('since'));
        const r = store.view(code, clientIp(req), url.searchParams.get('key'), Number.isInteger(since) && since > 0 ? since : undefined);
        if (!r.ok) sendFail(res, r);
        else send(res, 200, r.value);
        return true;
      }
      if (method !== 'POST') {
        send(res, 405, { error: 'method', message: 'Use POST.' });
        return true;
      }
      const body = await readJson(req, CLASS_LIMITS.maxBody);
      const r = sub === 'report' ? store.report(code, clientIp(req), body) : sub === 'join' ? store.join(code, clientIp(req), body) : store.teacher(code, clientIp(req), body);
      if (!r.ok) sendFail(res, r);
      else send(res, 200, r.value);
      return true;
    } catch (e) {
      const status = (e as { status?: unknown })?.status;
      if (status === 413) send(res, 413, { error: 'too-big', message: 'That request is too big.' });
      else if (status === 400) send(res, 400, { error: 'bad-json', message: 'That request was not valid JSON.' });
      else {
        console.error('class board:', e);
        send(res, 500, { error: 'server', message: 'Something went wrong on our side. Try again.' });
      }
      return true;
    }
  };
}
