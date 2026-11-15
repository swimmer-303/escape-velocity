// Written with AI assistance (Claude Code). See README "Use of AI tools".
// What Rover Expeditions remembers in this browser (localStorage 'ev-rover-v1'): the Sample Museum, which of today's
// targets were already banked, personal bests, and the site of the player's last game. Every read is checked field by
// field, so broken or old data never breaks the game: it just starts fresh.

import { isRoverSite, SITES, type RoverSite } from './sites';
import { sampleKind } from './samples';

export const STORE_KEY = 'ev-rover-v1';

export interface MuseumEntry {
  /** How many of this kind have been banked, ever. */
  count: number;
  /** The date (YYYY-MM-DD) it was first banked. */
  first: string;
}

export interface SiteBest {
  /** Most samples banked in one trip. */
  haul: number;
  /** Longest drive in one trip, game meters. */
  distance: number;
}

export interface RoverStore {
  v: 1;
  /** The site of the player's last real game (from the 'sol' event), to preselect it. */
  lastGameSite: RoverSite | null;
  /** The site of the last rover drive. */
  lastRoverSite: RoverSite | null;
  museum: Record<string, MuseumEntry>;
  /** Targets already banked today: they stay collected until tomorrow's new set. */
  today: { date: string; got: Record<RoverSite, string[]> };
  best: Record<RoverSite, SiteBest>;
  trips: number;
  totalSamples: number;
  /** The last date the player drove (for the lobby tile's NEW badge). */
  lastPlayed: string;
}

const emptyGot = (): Record<RoverSite, string[]> => ({ gale: [], arcadia: [], moon: [] });
const emptyBest = (): Record<RoverSite, SiteBest> => ({ gale: { haul: 0, distance: 0 }, arcadia: { haul: 0, distance: 0 }, moon: { haul: 0, distance: 0 } });

export function freshStore(): RoverStore {
  return { v: 1, lastGameSite: null, lastRoverSite: null, museum: {}, today: { date: '', got: emptyGot() }, best: emptyBest(), trips: 0, totalSamples: 0, lastPlayed: '' };
}

const count = (n: unknown): number => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.floor(n) : 0);
const meters = (n: unknown): number => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.min(n, 1e6) : 0);
const str = (s: unknown, max = 40): string => (typeof s === 'string' ? s.slice(0, max) : '');
const obj = (o: unknown): Record<string, unknown> | null => (o && typeof o === 'object' && !Array.isArray(o) ? (o as Record<string, unknown>) : null);

/** Check stored data field by field; anything odd is dropped. */
export function sanitize(raw: unknown): RoverStore {
  const s = freshStore();
  const r = obj(raw);
  if (!r || r.v !== 1) return s;
  if (isRoverSite(r.lastGameSite)) s.lastGameSite = r.lastGameSite;
  if (isRoverSite(r.lastRoverSite)) s.lastRoverSite = r.lastRoverSite;
  const museum = obj(r.museum);
  if (museum) {
    for (const [id, e] of Object.entries(museum)) {
      const entry = obj(e);
      if (!sampleKind(id) || !entry) continue;
      const n = count(entry.count);
      if (n > 0) s.museum[id] = { count: n, first: str(entry.first, 10) };
    }
  }
  const today = obj(r.today);
  if (today) {
    s.today.date = str(today.date, 10);
    const got = obj(today.got);
    if (got) {
      for (const site of SITES) {
        const list = got[site];
        if (Array.isArray(list)) s.today.got[site] = [...new Set(list.filter((x): x is string => typeof x === 'string' && x.length < 60))].slice(0, 20);
      }
    }
  }
  const best = obj(r.best);
  if (best) {
    for (const site of SITES) {
      const b = obj(best[site]);
      if (b) s.best[site] = { haul: count(b.haul), distance: meters(b.distance) };
    }
  }
  s.trips = count(r.trips);
  s.totalSamples = count(r.totalSamples);
  s.lastPlayed = str(r.lastPlayed, 10);
  return s;
}

export function loadStore(): RoverStore {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    return raw ? sanitize(JSON.parse(raw)) : freshStore();
  } catch {
    /* blocked or broken storage: start fresh */
    return freshStore();
  }
}

export function saveStore(s: RoverStore): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(s));
  } catch {
    /* storage full or blocked: the progress just isn't remembered */
  }
}

/** Today's banked target ids at a site (empty if the stored day is not today). */
export function gotToday(s: RoverStore, site: RoverSite, date: string): Set<string> {
  return new Set(s.today.date === date ? s.today.got[site] : []);
}

/** Start a new day's list if the date changed. */
export function rollDay(s: RoverStore, date: string): void {
  if (s.today.date !== date) s.today = { date, got: emptyGot() };
}

/** Remember the site of the player's last game (Mars Gale, Mars Arcadia, or the Moon). */
export function rememberGameSite(site: RoverSite): void {
  const s = loadStore();
  if (s.lastGameSite === site) return;
  s.lastGameSite = site;
  saveStore(s);
}

/** Which site to preselect: the last game's site if known, else the last drive's, else Gale Crater. */
export function defaultSite(s: RoverStore = loadStore()): RoverSite {
  return s.lastGameSite ?? s.lastRoverSite ?? 'gale';
}
