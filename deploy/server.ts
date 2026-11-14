// Written with AI assistance (Claude Code). See README "Use of AI tools".
// Tiny Node server for the droplet: serves /api/spaceweather (handler in api/spaceweather.ts)
// with a 1-hour in-memory cache so players never hit NASA rate limits, /api/sun (api/sun.ts):
// NASA SDO's newest picture of the Sun, cached for 10 minutes, /api/rooms (src/room/http.ts):
// Mission Control rooms for class team play (kept in memory only), /api/class (src/class/http.ts): the teacher
// dashboard's class boards (STATE_DIR/classes.json, deleted 7 days after the last result), and /api/daily
// (src/daily/http.ts): the daily challenge and its boards (STATE_DIR/daily.json).
// Caddy serves the static game and reverse-proxies /api/* to this process.

import { createServer, type Server, type ServerResponse } from 'node:http';
import { GET } from '../api/spaceweather';
import { fetchSunImage, type SunImage } from '../api/sun';
import { buildEventPool, RECENT_SNAPSHOT, type DonkiSnapshot, type SpaceWeatherFeed } from '../src/data/donki';
import { earthMarsLightTime } from '../src/data/lighttime';
import { RoomStore, type RoomEvents } from '../src/room/store';
import { createRoomsHandler } from '../src/room/http';
import { ClassStore } from '../src/class/store';
import { createClassHandler } from '../src/class/http';
import { DailyStore } from '../src/daily/store';
import { createDailyHandler } from '../src/daily/http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PORT = Number(process.env.PORT ?? 3001);
const HOST = process.env.HOST ?? '127.0.0.1';
/** Where the server keeps files between restarts (systemd's StateDirectory). */
const STATE_DIR = process.env.STATE_DIR ?? '/var/lib/escape-velocity';
const TTL_MS = 60 * 60 * 1000;
const cache = new Map<string, { at: number; status: number; body: string }>();
const loading = new Map<string, Promise<{ status: number; body: string }>>();

// ---- /api/spaceweather: NASA DONKI, cached for an hour (shared with Mission Control rooms).
async function spaceWeather(days: string): Promise<{ status: number; body: string; state: 'HIT' | 'MISS' | 'STALE' }> {
  const hit = cache.get(days);
  if (hit && Date.now() - hit.at < TTL_MS) return { status: hit.status, body: hit.body, state: 'HIT' };
  let fetching = loading.get(days);
  if (!fetching) {
    fetching = GET(new Request(`http://local/api/spaceweather?days=${days}`))
      .then(async (response) => {
        const body = await response.text();
        if (response.ok) cache.set(days, { at: Date.now(), status: response.status, body });
        return { status: response.status, body };
      })
      .finally(() => loading.delete(days));
    loading.set(days, fetching);
  }
  try {
    const fresh = await fetching;
    // NASA is down: serve the last good copy rather than nothing (it still carries its real fetchedAt time).
    if (fresh.status !== 200 && hit) return { status: 200, body: hit.body, state: 'STALE' };
    return { ...fresh, state: 'MISS' };
  } catch (e) {
    if (hit) return { status: 200, body: hit.body, state: 'STALE' };
    throw e;
  }
}

/** The DONKI snapshot our proxy has (fresh, or stale if NASA is down). Gives up after a few seconds. */
async function cachedSnapshot(): Promise<DonkiSnapshot | null> {
  const timeout = new Promise<null>((r) => setTimeout(() => r(null), 4000).unref());
  const res = await Promise.race([spaceWeather('30').catch(() => null), timeout]);
  if (!res || res.status !== 200) return null;
  const snap = JSON.parse(res.body) as DonkiSnapshot;
  return snap && Array.isArray(snap.flares) ? snap : null;
}

/** Real storms for a new room: our cached NASA DONKI data, or the bundled archive snapshot. */
export async function roomEvents(fetchSnapshot: () => Promise<DonkiSnapshot | null>): Promise<RoomEvents> {
  const live = await fetchSnapshot().catch(() => null);
  const feed: SpaceWeatherFeed = live
    ? { status: 'live', snapshot: live, fetchedAt: live.fetchedAt, via: 'proxy' }
    : { status: RECENT_SNAPSHOT ? 'archive' : 'none', snapshot: RECENT_SNAPSHOT, fetchedAt: RECENT_SNAPSHOT?.fetchedAt ?? null, via: 'snapshot' };
  return {
    pool: buildEventPool(feed),
    data: {
      status: feed.status === 'live' ? 'live' : 'archive',
      fetchedAt: feed.fetchedAt,
      startDate: feed.snapshot?.startDate ?? null,
      endDate: feed.snapshot?.endDate ?? null,
    },
  };
}

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

export interface ApiServerOptions {
  /** Where new rooms get real storms (default: the cached NASA DONKI proxy). Tests pass an offline source. */
  fetchSnapshot?: () => Promise<DonkiSnapshot | null>;
  /** Wait this long to bundle quick room changes into one live message, ms. */
  coalesceMs?: number;
  /** Where class boards and daily.json are saved (null = class boards in memory only). Default: STATE_DIR (memory/temp under tests). */
  stateDir?: string | null;
  /** The clock for the daily challenge (tests move it across midnight). */
  now?: () => number;
}

export function createApiServer(opts: ApiServerOptions = {}): { server: Server; rooms: RoomStore; classes: ClassStore; daily: DailyStore } {
  const fetchSnapshot = opts.fetchSnapshot ?? cachedSnapshot;
  const rooms = new RoomStore({
    events: () => roomEvents(fetchSnapshot),
    lightTimeMin: () => earthMarsLightTime().oneWayMinutes,
    coalesceMs: opts.coalesceMs,
  }).start();
  const handleRooms = createRoomsHandler(rooms);
  const classes = new ClassStore({ dir: opts.stateDir !== undefined ? opts.stateDir : process.env.VITEST ? null : STATE_DIR }).load().start();
  const handleClass = createClassHandler(classes);
  // The daily challenge freezes the same real storms a new room would get. It always needs a folder:
  // tests that don't pass one get a private temp folder.
  const dailyDir = opts.stateDir ?? (process.env.VITEST ? join(tmpdir(), `ev-daily-test-${process.pid}`) : STATE_DIR);
  const daily = new DailyStore({ dir: dailyDir, events: () => roomEvents(fetchSnapshot), now: opts.now });
  const handleDaily = createDailyHandler(daily);

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    if (url.pathname === '/api/sun' && (req.method === 'GET' || req.method === 'HEAD')) {
      await serveSun(res, req.method === 'HEAD');
      return;
    }
    if (url.pathname.startsWith('/api/rooms') && (await handleRooms(req, res, url))) return;
    if (url.pathname.startsWith('/api/class') && (await handleClass(req, res, url))) return;
    if (url.pathname.startsWith('/api/daily') && (await handleDaily(req, res, url))) return;
    if (req.method !== 'GET' || url.pathname !== '/api/spaceweather') {
      res.writeHead(404, { 'content-type': 'application/json' }).end('{"error":"not found"}');
      return;
    }
    const days = String(Math.max(1, Math.min(60, Number(url.searchParams.get('days')) || 30)));
    try {
      const r = await spaceWeather(days);
      const cacheable = r.status === 200 && r.state !== 'STALE';
      res
        .writeHead(r.status, { 'content-type': 'application/json', 'cache-control': cacheable ? 'public, max-age=300' : r.status === 200 ? 'public, max-age=60' : 'no-store', 'x-cache': r.state })
        .end(r.body);
    } catch (e) {
      res.writeHead(502, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'proxy failed', details: String(e) }));
    }
  });
  server.on('close', () => {
    rooms.stop();
    classes.stop();
    daily.close();
  });
  return { server, rooms, classes, daily };
}

// Run as a program (not when a test imports this file).
if (!process.env.VITEST) {
  const { server, classes, daily } = createApiServer();
  server.listen(PORT, HOST, () => console.log(`Escape Velocity API on http://${HOST}:${PORT}`));
  process.once('exit', () => daily.flushSync());
  // systemd stops us on every deploy: save the class boards and the daily boards first (the exit waits one tick for other handlers).
  for (const sig of ['SIGTERM', 'SIGINT'] as const) {
    process.on(sig, () => {
      // One handler saves everything, then exits: class boards and the daily challenge.
      classes.stop();
      daily.flushSync();
      setImmediate(() => process.exit(0));
    });
  }
  // Warm the NASA cache so the first Mission Control room gets live storms right away.
  void spaceWeather('30').catch(() => undefined);
}
