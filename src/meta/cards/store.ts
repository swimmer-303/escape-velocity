// Written with AI assistance (Claude Code). See README "Use of AI tools".
// Storm Cards: the player's collection, kept in this browser (localStorage 'ev-cards-v1').
// Each card keeps a copy of its real event's data, so it still works after the event leaves the live 30-day feed.
// Storage can be blocked, full or corrupted: every access is guarded, and bad data falls back to an empty collection.

import type { SpaceWeatherEvent } from '../../sim/types';
import { factsFromEvent, type CardFacts } from './rarity';

export const STORAGE_KEY = 'ev-cards-v1';

export interface StoredCard extends CardFacts {
  /** How many times a crew met this storm. */
  count: number;
  /** How many of those times the crew was safe in a powered shelter (it blocked almost all of the dose). */
  shieldedCount: number;
  /** When the crew first met it (ISO, the player's clock). */
  collectedAt: string;
  lastMetAt: string;
  /** Not looked at in the Storm Cards screen yet. */
  fresh: boolean;
  /** Where the crews met it. */
  sites: Array<'mars' | 'moon'>;
}

export interface Collection {
  cards: Record<string, StoredCard>;
  /** The May 2024 set bonus has been given. */
  setBonus: boolean;
}

export function emptyCollection(): Collection {
  return { cards: {}, setBonus: false };
}

const KINDS = new Set(['flare', 'sep', 'cme']);
const SEVERITIES = new Set(['minor', 'moderate', 'major']);
const str = (x: unknown): x is string => typeof x === 'string' && x.length > 0;
const num = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

/** Keep only well-formed cards; anything odd is dropped rather than shown with made-up values. */
function cleanCard(id: string, raw: unknown): StoredCard | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (!str(r.id) || r.id !== id || !KINDS.has(r.kind as string) || !str(r.time) || Number.isNaN(Date.parse(r.time))) return null;
  const c: StoredCard = {
    id: r.id,
    kind: r.kind as StoredCard['kind'],
    time: r.time,
    severity: SEVERITIES.has(r.severity as string) ? (r.severity as StoredCard['severity']) : 'moderate',
    origin: r.origin === 'live' ? 'live' : 'archive',
    count: num(r.count) && r.count >= 1 ? Math.floor(r.count) : 1,
    shieldedCount: num(r.shieldedCount) && r.shieldedCount >= 0 ? Math.floor(r.shieldedCount) : 0,
    collectedAt: str(r.collectedAt) ? r.collectedAt : r.time,
    lastMetAt: str(r.lastMetAt) ? r.lastMetAt : str(r.collectedAt) ? r.collectedAt : r.time,
    fresh: r.fresh === true,
    sites: Array.isArray(r.sites) ? (r.sites.filter((s) => s === 'mars' || s === 'moon') as StoredCard['sites']) : [],
  };
  c.shieldedCount = Math.min(c.shieldedCount, c.count);
  if (str(r.classType)) c.classType = r.classType;
  if (num(r.region)) c.region = r.region;
  if (str(r.location)) c.location = r.location;
  if (str(r.link) && /^https:\/\//.test(r.link)) c.link = r.link;
  if (num(r.speedKms)) c.speedKms = r.speedKms;
  if (r.linkedSep === true) c.linkedSep = true;
  if (str(r.note)) c.note = r.note;
  return c;
}

export function parseCollection(text: string | null): Collection {
  if (!text) return emptyCollection();
  try {
    const raw = JSON.parse(text) as unknown;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return emptyCollection();
    const r = raw as Record<string, unknown>;
    const out = emptyCollection();
    if (r.cards && typeof r.cards === 'object' && !Array.isArray(r.cards)) {
      for (const [id, v] of Object.entries(r.cards as Record<string, unknown>)) {
        const c = cleanCard(id, v);
        if (c) out.cards[id] = c;
      }
    }
    out.setBonus = r.setBonus === true;
    return out;
  } catch {
    return emptyCollection();
  }
}

export function loadCollection(): Collection {
  try {
    return parseCollection(localStorage.getItem(STORAGE_KEY));
  } catch {
    return emptyCollection();
  }
}

export function saveCollection(c: Collection): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ v: 1, ...c }));
  } catch {
    /* storage full or blocked: the cards still work for this visit */
  }
}

/** True for a real event a card can be made from (not the simulator's "what if" storm). */
export function isCollectable(e: SpaceWeatherEvent | null | undefined): e is SpaceWeatherEvent {
  return !!e && str(e.id) && e.id !== 'what-if' && KINDS.has(e.kind) && str(e.time) && !Number.isNaN(Date.parse(e.time));
}

/**
 * The crew met a real storm: add its card, or count it again.
 * Returns the card and whether it is new, or null when the event can't be a card.
 */
export function addMeeting(
  col: Collection,
  e: SpaceWeatherEvent,
  meet: { shielded: boolean; site?: 'mars' | 'moon'; at?: Date },
): { card: StoredCard; isNew: boolean } | null {
  if (!isCollectable(e)) return null;
  const at = (meet.at ?? new Date()).toISOString();
  const site = meet.site ?? 'mars';
  const had = col.cards[e.id];
  if (had) {
    had.count += 1;
    if (meet.shielded) had.shieldedCount += 1;
    had.lastMetAt = at;
    if (!had.sites.includes(site)) had.sites.push(site);
    // Fill in anything the first copy lacked (never overwrite real data with nothing).
    const f = factsFromEvent(e);
    if (f.origin === 'live') had.origin = 'live';
    for (const k of ['classType', 'region', 'location', 'link', 'speedKms', 'note'] as const) {
      if (had[k] == null && f[k] != null) (had as unknown as Record<string, unknown>)[k] = f[k];
    }
    if (f.linkedSep) had.linkedSep = true;
    return { card: had, isNew: false };
  }
  const card: StoredCard = {
    ...factsFromEvent(e),
    count: 1,
    shieldedCount: meet.shielded ? 1 : 0,
    collectedAt: at,
    lastMetAt: at,
    fresh: true,
    sites: [site],
  };
  col.cards[e.id] = card;
  return { card, isNew: true };
}

/** Cards the player has not looked at yet, then marks them all as seen. */
export function takeFresh(col: Collection): Set<string> {
  const ids = new Set<string>();
  for (const c of Object.values(col.cards)) {
    if (c.fresh) ids.add(c.id);
    c.fresh = false;
  }
  return ids;
}
