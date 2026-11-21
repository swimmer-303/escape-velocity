// Written with AI assistance (Claude Code). See README "Use of AI tools".
// Everything behind /api, in one place, for both hosts: Cloudflare (deploy/worker.ts, one Durable
// Object runs this) and the Node server the tests use (deploy/server.ts).
//   /api/spaceweather  NASA DONKI (api/spaceweather.ts), cached for an hour so players never hit NASA rate limits
//   /api/sun           NASA SDO's newest picture of the Sun (api/sun.ts), cached for 10 minutes
//   /api/rooms         Mission Control rooms for class team play (src/room/http.ts)
//   /api/class         the teacher dashboard's class boards (src/class/http.ts), deleted 7 days after the last result
//   /api/daily         the daily challenge and its boards (src/daily/http.ts)
// The host decides where things are saved (the save slots) and passes in each visitor's address.
// Server-only: the game in the browser never imports this file.

import { GET as fetchSpaceWeather } from '../../api/spaceweather';
import { fetchSunImage, type SunImage } from '../../api/sun';
import { buildEventPool, RECENT_SNAPSHOT, type DonkiSnapshot, type SpaceWeatherFeed } from '../data/donki';
import { earthMarsLightTime } from '../data/lighttime';
import { RoomStore, type RoomEvents, type RoomSaver } from '../room/store';
import { createRoomsHandler } from '../room/http';
import { ClassStore } from '../class/store';
import { createClassHandler } from '../class/http';
import { DailyStore } from '../daily/store';
import { createDailyHandler } from '../daily/http';
import type { SaveSlot } from './slot';

const SPACE_WEATHER_TTL_MS = 60 * 60 * 1000;
const SUN_TTL_MS = 10 * 60 * 1000;
const SUN_RETRY_MS = 60 * 1000;

/** Real storms for a new room or day: our cached NASA DONKI data, or the bundled archive snapshot. */
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

export interface ApiOptions {
  /** Where class boards are saved (null = memory only). */
  classSlot: SaveSlot | null;
  /** Where the daily boards are saved. */
  dailySlot: SaveSlot;
  /** Where rooms are saved between restarts (none = memory only). */
  roomSaver?: RoomSaver;
  /** Where new rooms get real storms (default: the cached NASA DONKI proxy). Tests pass an offline source. */
  fetchSnapshot?: () => Promise<DonkiSnapshot | null>;
  /** Wait this long to bundle quick room changes into one live message, ms. */
  coalesceMs?: number;
  /** The clock for the daily challenge (tests move it across midnight). */
  now?: () => number;
}

export interface Api {
  /** Answer one /api request. `ip` is the visitor's address (for rate limits only; never stored). */
  handle(req: Request, ip: string): Promise<Response>;
  /** Fetch NASA's space weather now, so the first Mission Control room gets live storms right away. */
  warm(): void;
  /** Save everything waiting to be saved. */
  flush(): void;
  /** Stop the timers, save, and end every room (the Node server shutting down). */
  close(): void;
  rooms: RoomStore;
  classes: ClassStore;
  daily: DailyStore;
}

type Cached = { status: number; body: string; state: 'HIT' | 'MISS' | 'STALE' };

const notFound = () => new Response('{"error":"not found"}', { status: 404, headers: { 'content-type': 'application/json' } });

export function createApi(opts: ApiOptions): Api {
  // ---- /api/spaceweather: NASA DONKI, cached for an hour (shared with Mission Control rooms and the daily challenge).
  const weather = new Map<string, { at: number; status: number; body: string }>();
  const weatherLoading = new Map<string, Promise<{ status: number; body: string }>>();

  async function spaceWeather(days: string): Promise<Cached> {
    const hit = weather.get(days);
    if (hit && Date.now() - hit.at < SPACE_WEATHER_TTL_MS) return { status: hit.status, body: hit.body, state: 'HIT' };
    let fetching = weatherLoading.get(days);
    if (!fetching) {
      fetching = fetchSpaceWeather(new Request(`http://local/api/spaceweather?days=${days}`))
        .then(async (response) => {
          const body = await response.text();
          if (response.ok) weather.set(days, { at: Date.now(), status: response.status, body });
          return { status: response.status, body };
        })
        .finally(() => weatherLoading.delete(days));
      weatherLoading.set(days, fetching);
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
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<null>((r) => (timer = setTimeout(() => r(null), 4000)));
    const res = await Promise.race([spaceWeather('30').catch(() => null), timeout]);
    clearTimeout(timer);
    if (!res || res.status !== 200) return null;
    const snap = JSON.parse(res.body) as DonkiSnapshot;
    return snap && Array.isArray(snap.flares) ? snap : null;
  }

  async function serveSpaceWeather(url: URL): Promise<Response> {
    const days = String(Math.max(1, Math.min(60, Number(url.searchParams.get('days')) || 30)));
    try {
      const r = await spaceWeather(days);
      const cacheable = r.status === 200 && r.state !== 'STALE';
      return new Response(r.body, {
        status: r.status,
        headers: { 'content-type': 'application/json', 'cache-control': cacheable ? 'public, max-age=300' : r.status === 200 ? 'public, max-age=60' : 'no-store', 'x-cache': r.state },
      });
    } catch (e) {
      return new Response(JSON.stringify({ error: 'proxy failed', details: String(e) }), { status: 502, headers: { 'content-type': 'application/json' } });
    }
  }

  // ---- /api/sun: one shared copy of SDO's picture, refreshed at most every 10 minutes.
  let sun: { at: number; img: SunImage } | null = null;
  let sunLoading: Promise<SunImage> | null = null;
  let sunFailedAt = 0;

  async function serveSun(headOnly: boolean): Promise<Response> {
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
        if (!sun) return new Response(JSON.stringify({ error: 'SDO unavailable', details: String(e) }), { status: 502, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
      }
    }
    if (!sun) return new Response('{"error":"SDO unavailable"}', { status: 502, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
    // NASA is down: serve the last good picture (it still carries its real times).
    if (state === 'HIT' && !fresh) state = 'STALE';
    const { img } = sun;
    const headers: Record<string, string> = {
      'content-type': img.contentType,
      'content-length': String(img.body.byteLength),
      'cache-control': state === 'STALE' ? 'public, max-age=60' : 'public, max-age=300',
      'x-cache': state,
      'x-sun-fetched-at': img.fetchedAt,
      'x-sun-source': img.sourceUrl,
    };
    if (img.lastModified) headers['last-modified'] = img.lastModified;
    if (img.takenAt) headers['x-sun-taken-at'] = img.takenAt;
    return new Response(headOnly ? null : (img.body as Uint8Array<ArrayBuffer>), { status: 200, headers });
  }

  // ---- rooms, class boards, the daily challenge.
  const fetchSnapshot = opts.fetchSnapshot ?? cachedSnapshot;
  const rooms = new RoomStore({
    events: () => roomEvents(fetchSnapshot),
    lightTimeMin: () => earthMarsLightTime().oneWayMinutes,
    coalesceMs: opts.coalesceMs,
    saver: opts.roomSaver,
  }).start();
  const classes = new ClassStore({ slot: opts.classSlot }).load().start();
  // The daily challenge freezes the same real storms a new room would get.
  const daily = new DailyStore({ slot: opts.dailySlot, events: () => roomEvents(fetchSnapshot), now: opts.now });
  const handlers = [createRoomsHandler(rooms), createClassHandler(classes), createDailyHandler(daily)];

  return {
    rooms,
    classes,
    daily,
    async handle(req, ip) {
      const url = new URL(req.url);
      try {
        if (url.pathname === '/api/sun' && (req.method === 'GET' || req.method === 'HEAD')) return await serveSun(req.method === 'HEAD');
        if (url.pathname === '/api/spaceweather' && req.method === 'GET') return await serveSpaceWeather(url);
        for (const handle of handlers) {
          const res = await handle(req, url, ip);
          if (res) return res;
        }
        return notFound();
      } catch (e) {
        console.error('api:', e);
        return new Response('{"error":"server"}', { status: 500, headers: { 'content-type': 'application/json' } });
      }
    },
    warm() {
      void spaceWeather('30').catch(() => undefined);
    },
    flush() {
      rooms.saveNow();
      classes.flush();
      daily.flushSync();
    },
    close() {
      rooms.stop();
      classes.stop();
      daily.close();
    },
  };
}
