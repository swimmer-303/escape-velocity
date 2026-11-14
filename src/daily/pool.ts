// Written with AI assistance (Claude Code). See README "Use of AI tools".
// Daily challenge: what gets frozen for a day. The server calls dailyConfigFor() once, at the day's
// first request, with the real DONKI events its proxy has right then (live) or the bundled snapshot
// (archive), and keeps the answer all day (src/daily/store.ts). If the game can't reach our server,
// it builds the same kind of day from the bundled snapshot and labels it ARCHIVE.

import { REAL } from '../sim/constants';
import type { SpaceWeatherEvent } from '../sim/types';
import { buildEventPool, RECENT_SNAPSHOT } from '../data/donki';
import { earthMarsLightTime } from '../data/lighttime';
import { seedForDate, siteForDate, type DailyConfig } from './protocol';

/** Real events for one day plus where they came from (the same shape Mission Control rooms use). */
export interface DayEvents {
  pool: SpaceWeatherEvent[];
  data: { status: 'live' | 'archive'; fetchedAt: string | null; startDate: string | null; endDate: string | null };
}

/** One-way light time for the day: Earth to Mars at noon in Charlotte, or about 1.3 seconds to the Moon. */
export function lightTimeFor(date: string): number {
  if (siteForDate(date) === 'moon') return REAL.moonLightSec / 60;
  return earthMarsLightTime(new Date(`${date}T17:00:00Z`)).oneWayMinutes;
}

export function dailyConfigFor(date: string, events: DayEvents, lightTimeMin = lightTimeFor(date)): DailyConfig {
  return {
    date,
    seed: seedForDate(date),
    site: siteForDate(date),
    difficulty: 'cadet',
    lightTimeMin,
    eventPool: events.pool,
    poolSource: events.data.status,
    poolFetchedAt: events.data.fetchedAt,
    poolStart: events.data.startDate,
    poolEnd: events.data.endDate,
  };
}

/** The bundled NASA DONKI snapshot (plus the May 2024 archive), honestly labeled ARCHIVE. */
export function archiveEvents(): DayEvents {
  const snap = RECENT_SNAPSHOT;
  return {
    pool: buildEventPool({ status: snap ? 'archive' : 'none', snapshot: snap, fetchedAt: snap?.fetchedAt ?? null, via: 'snapshot' }),
    data: { status: 'archive', fetchedAt: snap?.fetchedAt ?? null, startDate: snap?.startDate ?? null, endDate: snap?.endDate ?? null },
  };
}

/** Today's challenge without our server: the seed is the date, the storms come from the bundled snapshot. */
export function offlineDailyConfig(date: string): DailyConfig {
  return dailyConfigFor(date, archiveEvents());
}
