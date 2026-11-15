// Written with AI assistance (Claude Code). See README "Use of AI tools".
// Season save data, in localStorage under 'ev-season-v1'. Every read and write is wrapped: blocked or full
// storage only means progress is not kept, and damaged data falls back to safe defaults field by field.
// Nothing here can identify a child: the callsign is only ever words from our own lists.

import { MAX_TIER } from './season';
import { isValidCallsign, rollCallsign, type Callsign } from './callsign';
import { BANNERS, DEFAULT_CARD, FRAMES, PATCHES, TITLES } from './rewards';
import { challengeById } from './weekly';
import type { EventPatch } from './live';

export const STORAGE_KEY = 'ev-season-v1';
/** How many events' progress we keep. */
export const MAX_EVENTS = 12;

export interface SeasonStats {
  sols: number;
  missions: number;
  launches: number;
  /** Real solar storms the crew lived through. */
  storms: number;
  /** The highest Astronaut level seen, and its rank title (from level-up events). */
  bestLevel: number;
  bestRank: string | null;
}

export interface WeeklyState {
  /** ISO week, "2026-W46". */
  week: string;
  ids: string[];
  progress: number[];
}

export interface EventState {
  /** 'live:<DONKI id>' or 'archive:gannon-2024'. */
  id: string;
  progress: number[];
  /** The patch was given. */
  rewarded: boolean;
}

export interface CardChoice {
  callsign: Callsign;
  title: string;
  banner: string;
  frame: string;
  patch: string;
}

export interface SeasonState {
  v: 1;
  season: 's1';
  /** Season XP. */
  xp: number;
  /** Tiers whose rewards were claimed. */
  claimed: number[];
  /** The highest tier the "tier reached" pop-up has announced. */
  announced: number;
  weekly: WeeklyState | null;
  /** Welcome-back gifts: how many were opened, and the last day one was (local "YYYY-MM-DD"). */
  login: { last: string | null; count: number };
  /** Progress on Sun events (the newest few), one entry per event. */
  events: EventState[];
  /** Patches from Sun events, kept forever. */
  eventPatches: EventPatch[];
  card: CardChoice;
  stats: SeasonStats;
}

export function emptyStats(): SeasonStats {
  return { sols: 0, missions: 0, launches: 0, storms: 0, bestLevel: 1, bestRank: null };
}

export function freshState(rand: () => number = Math.random): SeasonState {
  return {
    v: 1,
    season: 's1',
    xp: 0,
    claimed: [],
    announced: 1,
    weekly: null,
    login: { last: null, count: 0 },
    events: [],
    eventPatches: [],
    card: { callsign: rollCallsign(rand), ...DEFAULT_CARD },
    stats: emptyStats(),
  };
}

const MAX_XP = 1e9;
function count(x: unknown, max = MAX_XP): number {
  return typeof x === 'number' && Number.isFinite(x) && x >= 0 ? Math.min(max, Math.floor(x)) : 0;
}
export const isDay = (x: unknown): x is string => typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x);
const isWeek = (x: unknown): x is string => typeof x === 'string' && /^\d{4}-W\d{2}$/.test(x);
const obj = (x: unknown): Record<string, unknown> => (x && typeof x === 'object' && !Array.isArray(x) ? (x as Record<string, unknown>) : {});

function sanitizeWeekly(x: unknown): WeeklyState | null {
  const w = obj(x);
  if (!isWeek(w.week) || !Array.isArray(w.ids) || !w.ids.length || w.ids.length > 10) return null;
  if (!w.ids.every((id) => typeof id === 'string' && challengeById(id))) return null;
  const ids = w.ids as string[];
  const progress = Array.isArray(w.progress) ? w.progress : [];
  return { week: w.week, ids: [...ids], progress: ids.map((id, i) => Math.min(challengeById(id)!.goal, count(progress[i]))) };
}

function sanitizeEvent(x: unknown): EventState | null {
  const e = obj(x);
  if (typeof e.id !== 'string' || !/^(live:|archive:)[\w:.\-]{1,80}$/.test(e.id)) return null;
  const progress = (Array.isArray(e.progress) ? e.progress : []).slice(0, 3).map((p) => count(p, 1000));
  while (progress.length < 3) progress.push(0);
  return { id: e.id, progress, rewarded: e.rewarded === true };
}

function sanitizePatch(x: unknown): EventPatch | null {
  const p = obj(x);
  if (typeof p.id !== 'string' || !/^(live:|archive:)[\w:.\-]{1,80}$/.test(p.id)) return null;
  if (p.kind !== 'flare' && p.kind !== 'cme' && p.kind !== 'gannon') return null;
  if (typeof p.mark !== 'string' || !/^([XM]\d{1,2}(\.\d)?|CME|G5|FLARE)$/.test(p.mark)) return null;
  if (typeof p.date !== 'string' || !/^[A-Z][a-z]{2} \d{1,2}, \d{4}$/.test(p.date)) return null;
  return { id: p.id, kind: p.kind, mark: p.mark, date: p.date };
}

function pickId(x: unknown, list: readonly { id: string }[], fallback: string): string {
  return typeof x === 'string' && list.some((i) => i.id === x) ? x : fallback;
}

/** Turn anything (a parsed save, garbage, null) into a valid state. */
export function sanitize(raw: unknown, rand: () => number = Math.random): SeasonState {
  const s = freshState(rand);
  const r = obj(raw);
  if (!Object.keys(r).length) return s;
  s.xp = count(r.xp);
  s.claimed = [...new Set((Array.isArray(r.claimed) ? r.claimed : []).filter((t): t is number => Number.isInteger(t) && t >= 1 && t <= MAX_TIER))].sort((a, b) => a - b);
  s.announced = Math.max(1, count(r.announced, MAX_TIER));
  s.weekly = sanitizeWeekly(r.weekly);
  const login = obj(r.login);
  s.login = { last: isDay(login.last) ? login.last : null, count: count(login.count, 100000) };
  const evSeen = new Set<string>();
  s.events = (Array.isArray(r.events) ? r.events : [])
    .map(sanitizeEvent)
    .filter((e): e is EventState => !!e && !evSeen.has(e.id) && !!evSeen.add(e.id))
    .slice(-MAX_EVENTS);
  const seen = new Set<string>();
  s.eventPatches = (Array.isArray(r.eventPatches) ? r.eventPatches : [])
    .map(sanitizePatch)
    .filter((p): p is EventPatch => !!p && !seen.has(p.id) && !!seen.add(p.id))
    .slice(0, 200);
  const card = obj(r.card);
  if (isValidCallsign(card.callsign)) s.card.callsign = { ...card.callsign };
  s.card.title = pickId(card.title, TITLES, DEFAULT_CARD.title);
  s.card.banner = pickId(card.banner, BANNERS, DEFAULT_CARD.banner);
  s.card.frame = pickId(card.frame, FRAMES, DEFAULT_CARD.frame);
  // A patch is one of ours, or an event patch this player earned.
  s.card.patch = pickId(card.patch, [...PATCHES, ...s.eventPatches], DEFAULT_CARD.patch);
  const st = obj(r.stats);
  for (const k of ['sols', 'missions', 'launches', 'storms'] as const) s.stats[k] = count(st[k]);
  s.stats.bestLevel = Math.max(1, count(st.bestLevel, 50));
  s.stats.bestRank = typeof st.bestRank === 'string' && /^[A-Za-z ]{1,24}$/.test(st.bestRank) ? st.bestRank : null;
  return s;
}

export function loadState(): SeasonState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? sanitize(JSON.parse(raw)) : freshState();
  } catch {
    return freshState();
  }
}

export function saveState(s: SeasonState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    /* storage full or blocked: the season still works for this visit */
  }
}
