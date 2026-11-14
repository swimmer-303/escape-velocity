// Written with AI assistance (Claude Code). See README "Use of AI tools".
// Astronaut rank save data, in localStorage under 'ev-rank-v1'. Every read and write is wrapped: a blocked or
// full storage only means progress is not kept, and damaged data falls back to safe defaults field by field.

import { levelFor } from './curve';
import { missionById } from './daily';

export const STORAGE_KEY = 'ev-rank-v1';

export interface RankStats {
  sols: number;
  /** Solar storms that reached the base. */
  storms: number;
  /** Storms the crew rode out in the shelter. */
  sheltered: number;
  missions: number;
  launches: number;
  upgrades: number;
  campaigns: number;
  dailyDone: number;
}

export interface DailyState {
  /** Local calendar day, "YYYY-MM-DD". */
  date: string;
  ids: string[];
  progress: number[];
  /** The all-three bonus was paid. */
  bonus: boolean;
}

export interface RankState {
  v: 1;
  /** Lifetime XP. */
  xp: number;
  /** The highest level whose level-up card has been shown. */
  celebrated: number;
  stats: RankStats;
  daily: DailyState | null;
  /** Days in a row with at least one sol played. Never nags: a missed day just starts a new count. */
  streak: { last: string | null; count: number; best: number };
}

export function emptyStats(): RankStats {
  return { sols: 0, storms: 0, sheltered: 0, missions: 0, launches: 0, upgrades: 0, campaigns: 0, dailyDone: 0 };
}

export function freshState(): RankState {
  return { v: 1, xp: 0, celebrated: 1, stats: emptyStats(), daily: null, streak: { last: null, count: 0, best: 0 } };
}

const MAX_XP = 1e9;
function count(x: unknown, max = MAX_XP): number {
  return typeof x === 'number' && Number.isFinite(x) && x >= 0 ? Math.min(max, Math.floor(x)) : 0;
}
const isDay = (x: unknown): x is string => typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x);

function sanitizeDaily(x: unknown): DailyState | null {
  if (!x || typeof x !== 'object') return null;
  const d = x as Partial<DailyState>;
  if (!isDay(d.date) || !Array.isArray(d.ids) || d.ids.length !== 3) return null;
  if (!d.ids.every((id) => typeof id === 'string' && missionById(id))) return null;
  const progress = Array.isArray(d.progress) ? d.progress : [];
  return {
    date: d.date,
    ids: [...d.ids],
    progress: d.ids.map((id, i) => Math.min(missionById(id)!.goal, count(progress[i]))),
    bonus: d.bonus === true,
  };
}

/** Turn anything (a parsed save, garbage, null) into a valid state. */
export function sanitize(raw: unknown): RankState {
  const s = freshState();
  if (!raw || typeof raw !== 'object') return s;
  const r = raw as Partial<RankState>;
  s.xp = count(r.xp);
  // Never past the real level (that would hide a future level-up card). Missing means "nothing waiting".
  const level = levelFor(s.xp);
  s.celebrated = typeof r.celebrated === 'number' ? Math.min(level, Math.max(1, count(r.celebrated, 50))) : level;
  const st = (r.stats && typeof r.stats === 'object' ? r.stats : {}) as Partial<RankStats>;
  for (const k of Object.keys(s.stats) as Array<keyof RankStats>) s.stats[k] = count(st[k]);
  s.daily = sanitizeDaily(r.daily);
  const k = (r.streak && typeof r.streak === 'object' ? r.streak : {}) as Partial<RankState['streak']>;
  s.streak = { last: isDay(k.last) ? k.last : null, count: count(k.count, 100000), best: count(k.best, 100000) };
  s.streak.best = Math.max(s.streak.best, s.streak.count);
  return s;
}

export function loadState(): RankState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? sanitize(JSON.parse(raw)) : freshState();
  } catch {
    return freshState();
  }
}

export function saveState(s: RankState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    /* storage full or blocked: the rank still works for this visit */
  }
}
