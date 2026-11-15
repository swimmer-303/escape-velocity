// Written with AI assistance (Claude Code). See README "Use of AI tools".
// Rival Race save data in localStorage under 'ev-race-v1', and the league rules (pure). Every read and write is
// wrapped: blocked or full storage only means progress is not kept, and damaged data falls back field by field.

import { isCallsign, randomCallsign, type Callsign } from './callsign';
import { LEAGUES, leagueAt } from './rivals';

export const STORAGE_KEY = 'ev-race-v1';

export interface RaceSave {
  v: 1;
  /** Index into LEAGUES. */
  league: number;
  /** Top-2 finishes in the current league. */
  progress: number;
  /** Races finished. Nobody is ever moved down a league. */
  races: number;
  /** 1st places, all leagues. */
  trophies: number;
  /** League points: 3 for 1st, 2 for 2nd, 1 for 3rd. */
  points: number;
  /** Friend challenges beaten. */
  friendsBeaten: number;
  callsign: Callsign;
  /** The last finished mission that can be shared as a challenge link (its code). */
  lastCode: string | null;
}

export function freshSave(random: () => number = Math.random): RaceSave {
  return { v: 1, league: 0, progress: 0, races: 0, trophies: 0, points: 0, friendsBeaten: 0, callsign: randomCallsign(random), lastCode: null };
}

const MAX = 1e6;
function count(x: unknown, max = MAX): number {
  return typeof x === 'number' && Number.isFinite(x) && x >= 0 ? Math.min(max, Math.floor(x)) : 0;
}

/** Turn anything (a parsed save, garbage, null) into a valid save. */
export function sanitize(raw: unknown): RaceSave {
  const s = freshSave();
  if (!raw || typeof raw !== 'object') return s;
  const r = raw as Partial<RaceSave>;
  s.league = count(r.league, LEAGUES.length - 1);
  const need = leagueAt(s.league).promote;
  s.progress = need > 0 ? Math.min(need - 1, count(r.progress)) : count(r.progress);
  s.races = count(r.races);
  s.trophies = Math.min(s.races, count(r.trophies));
  s.points = count(r.points);
  s.friendsBeaten = count(r.friendsBeaten);
  if (isCallsign(r.callsign)) s.callsign = { adj: r.callsign.adj, noun: r.callsign.noun, num: r.callsign.num };
  s.lastCode = typeof r.lastCode === 'string' && r.lastCode.length <= 400 && /^[a-z0-9.\-]+$/.test(r.lastCode) ? r.lastCode : null;
  return s;
}

export function loadSave(): RaceSave {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      const fresh = freshSave();
      writeSave(fresh);
      return fresh;
    }
    return sanitize(JSON.parse(raw));
  } catch {
    return freshSave();
  }
}

export function writeSave(s: RaceSave): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    /* storage full or blocked: races still work for this visit */
  }
}

// ------------------------------------------------------------------ league rules
export interface LeagueOutcome {
  /** A top-2 finish (counts toward moving up). */
  good: boolean;
  trophy: boolean;
  points: number;
  promoted: boolean;
  /** League index after this race. */
  league: number;
}

export const PLACE_POINTS = [3, 2, 1, 0] as const;

/** Record one finished race (place 1..4). Returns the new save (the input is not changed) and what happened. */
export function applyPlace(save: RaceSave, place: number): { save: RaceSave; outcome: LeagueOutcome } {
  const s: RaceSave = { ...save, callsign: { ...save.callsign } };
  const p = Math.max(1, Math.min(4, Math.floor(place)));
  const good = p <= 2;
  const points = PLACE_POINTS[p - 1];
  s.races += 1;
  s.points += points;
  if (p === 1) s.trophies += 1;
  let promoted = false;
  const need = leagueAt(s.league).promote;
  if (good && need > 0) {
    s.progress += 1;
    if (s.progress >= need) {
      s.league = Math.min(LEAGUES.length - 1, s.league + 1);
      s.progress = 0;
      promoted = true;
    }
  } else if (good) {
    s.progress += 1;
  }
  return { save: s, outcome: { good, trophy: p === 1, points, promoted, league: s.league } };
}

/** "2 more top-2 finishes to Gold" for the lobby tile and the podium. */
export function progressLine(s: RaceSave): string {
  const lg = leagueAt(s.league);
  if (lg.promote <= 0) return `${s.trophies} ${s.trophies === 1 ? 'trophy' : 'trophies'} · top league`;
  const left = lg.promote - s.progress;
  const next = leagueAt(s.league + 1).name;
  return `${left} more top-2 ${left === 1 ? 'finish' : 'finishes'} to ${next}`;
}
