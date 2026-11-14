// Written with AI assistance (Claude Code). See README "Use of AI tools".
// Storm Cards: which real storms exist to be collected right now. That is the same pool the game deals from:
// the feed the game already loaded (live from NASA, or the stored snapshot labeled ARCHIVE), the May 2024
// archive, and the May 2024 replay storms. No extra network request: we reuse the game's own load.

import type { SpaceWeatherEvent } from '../../sim/types';
import { buildEventPool, latestSpaceWeather, may2024Pool, RECENT_SNAPSHOT, type SpaceWeatherFeed } from '../../data/donki';
import { factsFromEvent, type CardFacts } from './rarity';
import type { Collection } from './store';

let feed: SpaceWeatherFeed | null = null;
let watching: Promise<SpaceWeatherFeed> | null = null;
const listeners: Array<() => void> = [];

/** Pick up the game's feed once it has started loading (no new request). Calls back when it arrives. */
export function watchFeed(onChange?: () => void): void {
  if (onChange && !listeners.includes(onChange)) listeners.push(onChange);
  const p = latestSpaceWeather();
  if (!p || p === watching) return;
  watching = p;
  p.then(
    (f) => {
      if (watching !== p) return;
      feed = f;
      for (const fn of listeners) {
        try {
          fn();
        } catch (e) {
          console.error('[cards] feed listener failed', e);
        }
      }
    },
    () => {
      /* the loader never rejects, but stay safe: the snapshot is used */
    },
  );
}

/** For tests: use this feed (null = the stored snapshot). */
export function setFeedForTests(f: SpaceWeatherFeed | null): void {
  feed = f;
  watching = null;
}

export function currentFeed(): SpaceWeatherFeed {
  if (feed && feed.snapshot) return feed;
  const snap = RECENT_SNAPSHOT;
  return { status: snap ? 'archive' : 'none', snapshot: snap, fetchedAt: snap?.fetchedAt ?? null, via: snap ? 'snapshot' : null };
}

/** The May 2024 replay storms: a fixed set a player can complete by playing "May 2024 storms". */
let may2024Cache: CardFacts[] | null = null;
export function may2024Set(): CardFacts[] {
  return (may2024Cache ??= may2024Pool().map(factsFromEvent));
}
export function may2024Ids(): Set<string> {
  return new Set(may2024Set().map((c) => c.id));
}

/** Every storm in the current pool, one per id (the plain record wins over the replay copy). */
export function poolFacts(): CardFacts[] {
  const byId = new Map<string, CardFacts>();
  const add = (e: SpaceWeatherEvent | CardFacts, facts: CardFacts) => {
    if (!byId.has(e.id)) byId.set(e.id, facts);
  };
  for (const e of buildEventPool(currentFeed())) add(e, factsFromEvent(e));
  for (const f of may2024Set()) add(f, f);
  return [...byId.values()];
}

export interface Possible {
  /** Every card there is to find right now: the current pool plus anything already collected. */
  all: CardFacts[];
  /** Pool storms not collected yet. */
  missing: CardFacts[];
}

export function possibleCards(col: Collection): Possible {
  const missing = poolFacts().filter((f) => !col.cards[f.id]);
  return { all: [...Object.values(col.cards), ...missing], missing };
}

export interface FromTheSun {
  /** Live storms the player has never met, newer than their newest card. Oldest first. */
  events: CardFacts[];
  /** All of them happened in the last 7 days. */
  thisWeek: boolean;
}

/**
 * "New from the real Sun": only from a LIVE feed (never from the archive). Storms in today's live NASA data
 * that are newer than anything in the player's collection.
 */
export function newFromTheSun(col: Collection, now = new Date()): FromTheSun | null {
  const f = currentFeed();
  if (f.status !== 'live' || !f.snapshot) return null;
  const newest = Object.values(col.cards).reduce((m, c) => Math.max(m, Date.parse(c.time) || 0), 0);
  const events = buildEventPool(f)
    .filter((e) => e.origin === 'live' && !col.cards[e.id] && Date.parse(e.time) > newest && Date.parse(e.time) <= now.getTime())
    .map(factsFromEvent)
    .sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
  if (!events.length) return null;
  const weekAgo = now.getTime() - 7 * 86_400_000;
  return { events, thisWeek: events.every((e) => Date.parse(e.time) >= weekAgo) };
}
