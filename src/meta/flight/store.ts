// Written with AI assistance (Claude Code). See README "Use of AI tools".
// Best flight medals, per mini-game and world, kept in this browser (localStorage 'ev-flight-v1').

import { MEDAL_RANK, MEDAL_XP, type FlightSite, type Medal } from './physics';

export type FlightGame = 'landing' | 'launch';
export const STORE_KEY = 'ev-flight-v1';

export interface BestRecord {
  medal: Medal;
  /** 0..1, to tell a better flight with the same medal. */
  score: number;
}
type Store = { v: 1; best: Partial<Record<string, BestRecord>> };

const keyOf = (game: FlightGame, site: FlightSite) => `${game}-${site}`;
const isMedal = (m: unknown): m is Medal => m === 'gold' || m === 'silver' || m === 'bronze';

function read(): Store {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_KEY) ?? 'null');
    if (raw && raw.v === 1 && raw.best && typeof raw.best === 'object') {
      const best: Store['best'] = {};
      for (const [k, r] of Object.entries(raw.best as Record<string, unknown>)) {
        const rec = r as Partial<BestRecord> | null;
        if (rec && isMedal(rec.medal)) best[k] = { medal: rec.medal, score: typeof rec.score === 'number' ? rec.score : 0 };
      }
      return { v: 1, best };
    }
  } catch {
    /* blocked or broken storage: start fresh */
  }
  return { v: 1, best: {} };
}

function write(s: Store) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(s));
  } catch {
    /* storage full or blocked: the medal just isn't remembered */
  }
}

export function bestFor(game: FlightGame, site: FlightSite): BestRecord | null {
  return read().best[keyOf(game, site)] ?? null;
}

export function medalBetter(a: Medal, b: Medal | null | undefined): boolean {
  return !b || MEDAL_RANK[a] > MEDAL_RANK[b];
}

/** Remember a finished flight. Returns the best before it, and whether this one beat it. */
export function recordFlight(game: FlightGame, site: FlightSite, medal: Medal, score: number): { prev: BestRecord | null; newBest: boolean } {
  const s = read();
  const k = keyOf(game, site);
  const prev = s.best[k] ?? null;
  const newBest = !prev || MEDAL_RANK[medal] > MEDAL_RANK[prev.medal] || (medal === prev.medal && score > prev.score + 1e-9);
  if (newBest) {
    s.best[k] = { medal, score };
    write(s);
  }
  return { prev, newBest };
}

/** XP for moving up from one medal (or none) to a better one; 0 if it is not better. */
export function upgradeXp(medal: Medal, from: Medal | null | undefined): number {
  if (!medalBetter(medal, from)) return 0;
  return MEDAL_XP[medal] - (from ? MEDAL_XP[from] : 0);
}

export const MEDAL_NAME: Record<Medal, string> = { gold: 'Gold', silver: 'Silver', bronze: 'Bronze' };
