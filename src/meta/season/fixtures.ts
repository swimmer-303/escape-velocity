// Written with AI assistance (Claude Code). See README "Use of AI tools".
// Test fixtures for Season 1: space-weather feeds (live and archive), and fake game events. The flare records
// are shaped like real DONKI records; their dates are set relative to "now" so the 3-day window can be tested.

import type { DonkiSnapshot, SpaceWeatherFeed } from '../../data/donki';
import type { GameEventMap } from '../hooks';
import type { MissionState, SolReport } from '../../sim/types';

const HOUR = 3_600_000;

export function snapshotWith(now: Date, items: { flares?: Array<{ cls: string; hoursAgo: number; id?: string }>; cmes?: Array<{ speed: number; hoursAgo: number; id?: string }> }): DonkiSnapshot {
  const at = (h: number) => new Date(now.getTime() - h * HOUR).toISOString().slice(0, 16) + 'Z';
  return {
    fetchedAt: now.toISOString(),
    startDate: '2026-10-15',
    endDate: '2026-11-14',
    sourceUrl: 'https://ccmc.gsfc.nasa.gov/DONKI/WS/get',
    flares: (items.flares ?? []).map((f, i) => ({
      id: f.id ?? `${at(f.hoursAgo)}:00-FLR-00${i + 1}`,
      classType: f.cls,
      beginTime: at(f.hoursAgo + 0.2),
      peakTime: at(f.hoursAgo),
      sourceLocation: 'S15W20',
      activeRegionNum: 14600,
      link: `https://ccmc.gsfc.nasa.gov/DONKI/view/FLR/${50000 + i}/-1`,
    })),
    seps: [],
    cmes: (items.cmes ?? []).map((c, i) => ({
      id: c.id ?? `${at(c.hoursAgo)}:00-CME-00${i + 1}`,
      startTime: at(c.hoursAgo),
      speed: c.speed,
      sourceLocation: null,
      link: `https://ccmc.gsfc.nasa.gov/DONKI/view/CME/${60000 + i}/-1`,
    })),
    gsts: [],
    included: ['FLR', 'SEP', 'CME', 'GST'],
  };
}

export function liveFeed(snap: DonkiSnapshot): SpaceWeatherFeed {
  return { status: 'live', snapshot: snap, fetchedAt: snap.fetchedAt, via: 'proxy' };
}
export function archiveFeed(snap: DonkiSnapshot): SpaceWeatherFeed {
  return { status: 'archive', snapshot: snap, fetchedAt: snap.fetchedAt, via: 'snapshot', error: 'offline' };
}
export const NO_FEED: SpaceWeatherFeed = { status: 'none', snapshot: null, fetchedAt: null, via: null, error: 'offline' };

// ------------------------------------------------------------------ fake game events
function mission(over: Partial<{ site: 'mars' | 'moon'; difficulty: string; dose: number; doseBudget: number; status: 'playing' | 'won' | 'lost'; sols: number }> = {}): MissionState {
  return {
    config: { site: over.site ?? 'mars', difficulty: over.difficulty ?? 'cadet' },
    dose: over.dose ?? 10,
    doseBudget: over.doseBudget ?? 100,
    status: over.status ?? 'playing',
    log: Array.from({ length: over.sols ?? 10 }, () => ({})),
  } as unknown as MissionState;
}

export function solEvent(opts: { mode?: GameEventMap['sol']['mode']; demo?: boolean; shelter?: number; storm?: boolean; severity?: 'minor' | 'moderate' | 'major'; built?: number; fuel?: number; site?: 'mars' | 'moon' } = {}): GameEventMap['sol'] {
  const storm =
    opts.storm || opts.shelter
      ? {
          event: { id: 'x', kind: 'flare', classType: 'M1.0', severity: opts.severity ?? 'moderate', time: '2026-11-05T18:33:00Z', origin: 'archive' },
          fast: false,
          warnedBy: null,
          shelterCells: opts.shelter ?? 0,
          doseUnsheltered: 10,
          doseTaken: opts.shelter ? 1 : 10,
        }
      : undefined;
  const report = {
    sol: 3,
    alloc: { air: 2, fuel: opts.fuel ?? 2, greenhouse: 1, heaters: 1, shelter: opts.shelter ?? 0, workshop: 0, battery: 0 },
    weather: 'clear',
    coldSnap: false,
    storm,
    builtAll: Array.from({ length: opts.built ?? 0 }, () => 'radmon'),
  } as unknown as SolReport;
  const m = mission({ site: opts.site });
  return { before: m, after: m, report, mode: opts.mode ?? 'quick', demo: !!opts.demo };
}

export function endEvent(opts: { won?: boolean; stars?: number; mode?: GameEventMap['mission-end']['mode']; demo?: boolean; difficulty?: string; dose?: number } = {}): GameEventMap['mission-end'] {
  const stars = (['launched', 'safe', 'builder'] as const).slice(0, opts.stars ?? 0);
  return {
    mission: mission({ status: opts.won === false ? 'lost' : 'won', difficulty: opts.difficulty, dose: opts.dose }),
    won: opts.won !== false,
    mode: opts.mode ?? 'quick',
    stars: stars as unknown as GameEventMap['mission-end']['stars'],
    demo: !!opts.demo,
  };
}
