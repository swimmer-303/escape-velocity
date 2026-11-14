// Written with AI assistance (Claude Code). See README "Use of AI tools".
// Tiny Node server for the droplet: serves /api/spaceweather (handler in api/spaceweather.ts)
// with a 1-hour in-memory cache so players never hit NASA rate limits, and /api/sun (api/sun.ts):
// NASA SDO's newest picture of the Sun, cached for 10 minutes.
// Caddy serves the static game and reverse-proxies /api/* to this process.

import { createServer, type ServerResponse } from 'node:http';
import { GET } from '../api/spaceweather';
import { fetchSunImage, type SunImage } from '../api/sun';

const PORT = Number(process.env.PORT ?? 3001);
const HOST = process.env.HOST ?? '127.0.0.1';
const TTL_MS = 60 * 60 * 1000;
const cache = new Map<string, { at: number; status: number; body: string }>();

// ---- /api/sun: one shared copy of SDO's picture, refreshed at most every 10 minutes.
const SUN_TTL_MS = 10 * 60 * 1000;
const SUN_RETRY_MS = 60 * 1000;
let sun: { at: number; img: SunImage } | null = null;
let sunLoading: Promise<SunImage> | null = null;
let sunFailedAt = 0;

async function serveSun(res: ServerResponse, headOnly: boolean) {
  let state = 'HIT';
  const fresh = sun && Date.now() - sun.at < SUN_TTL_MS;
  if (!fresh && Date.now() - sunFailedAt > SUN_RETRY_MS) {
    try {
      sunLoading ??= fetchSunImage().finally(() => (sunLoading = null));
      const img = await sunLoading;
      if (!sun || sun.img !== img) sun = { at: Date.now(), img };
      state = 'MISS';
    } catch (e) {
      sunFailedAt = Date.now();
      if (!sun) {
        res.writeHead(502, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify({ error: 'SDO unavailable', details: String(e) }));
        return;
      }
    }
  }
  if (!sun) {
    res.writeHead(502, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end('{"error":"SDO unavailable"}');
    return;
  }
  // NASA is down: serve the last good picture (it still carries its real times).
  if (state === 'HIT' && !fresh) state = 'STALE';
  const { img } = sun;
  const headers: Record<string, string | number> = {
    'content-type': img.contentType,
    'content-length': img.body.byteLength,
    'cache-control': state === 'STALE' ? 'public, max-age=60' : 'public, max-age=300',
    'x-cache': state,
    'x-sun-fetched-at': img.fetchedAt,
    'x-sun-source': img.sourceUrl,
  };
  if (img.lastModified) headers['last-modified'] = img.lastModified;
  if (img.takenAt) headers['x-sun-taken-at'] = img.takenAt;
  res.writeHead(200, headers).end(headOnly ? undefined : img.body);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  if (url.pathname === '/api/sun' && (req.method === 'GET' || req.method === 'HEAD')) {
    await serveSun(res, req.method === 'HEAD');
    return;
  }
  if (req.method !== 'GET' || url.pathname !== '/api/spaceweather') {
    res.writeHead(404, { 'content-type': 'application/json' }).end('{"error":"not found"}');
    return;
  }
  const days = String(Math.max(1, Math.min(60, Number(url.searchParams.get('days')) || 30)));
  const hit = cache.get(days);
  if (hit && Date.now() - hit.at < TTL_MS) {
    res.writeHead(hit.status, { 'content-type': 'application/json', 'cache-control': 'public, max-age=300', 'x-cache': 'HIT' }).end(hit.body);
    return;
  }
  try {
    const response = await GET(new Request(`http://local/api/spaceweather?days=${days}`));
    const body = await response.text();
    if (response.ok) cache.set(days, { at: Date.now(), status: response.status, body });
    else if (hit) {
      // NASA is down: serve the last good copy rather than nothing (it still carries its real fetchedAt time).
      res.writeHead(200, { 'content-type': 'application/json', 'x-cache': 'STALE' }).end(hit.body);
      return;
    }
    res.writeHead(response.status, { 'content-type': 'application/json', 'cache-control': response.ok ? 'public, max-age=300' : 'no-store', 'x-cache': 'MISS' }).end(body);
  } catch (e) {
    res.writeHead(502, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'proxy failed', details: String(e) }));
  }
});

server.listen(PORT, HOST, () => console.log(`spaceweather proxy on http://${HOST}:${PORT}`));
