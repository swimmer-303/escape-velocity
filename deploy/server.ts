// Written with AI assistance (Claude Code). See README "Use of AI tools".
// Tiny Node server for the droplet: serves /api/spaceweather (handler in api/spaceweather.ts)
// with a 1-hour in-memory cache so players never hit NASA rate limits.
// Caddy serves the static game and reverse-proxies /api/* to this process.

import { createServer } from 'node:http';
import { GET } from '../api/spaceweather';

const PORT = Number(process.env.PORT ?? 3001);
const HOST = process.env.HOST ?? '127.0.0.1';
const TTL_MS = 60 * 60 * 1000;
const cache = new Map<string, { at: number; status: number; body: string }>();

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
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
