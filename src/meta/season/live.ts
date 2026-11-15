// Written with AI assistance (Claude Code). See README "Use of AI tools".
// Live Sun Events, from real NASA DONKI data. Pure, no DOM (the feed watcher at the bottom reuses the game's own
// load: no extra network request).
//
// Honesty rules:
// - A LIVE event only turns on when the feed is LIVE (fetched from NASA just now, never the stored snapshot) and
//   it holds a real M- or X-class flare, or a CME faster than 1,000 km/s, from the last 3 days.
// - Otherwise (offline, the stored ARCHIVE snapshot, or a quiet Sun) we never claim live. Instead there is an
//   ARCHIVE event about a real past storm, clearly labeled ARCHIVE.
//
// The archive event: on May 10, 2024 the first G5 ("severe") geomagnetic storm in over two decades hit Earth.
// NASA calls it the Gannon storm, named in memory of space weather physicist Jennifer Gannon.
// Source: NASA, "What NASA Is Learning From the Biggest Geomagnetic Storm in 20 Years" (May 9, 2025),
// https://science.nasa.gov/science-research/heliophysics/what-nasa-is-learning-from-the-biggest-geomagnetic-storm-in-20-years
// DONKI lists that storm with a Kp index of 9 (the top of the scale): see GANNON_GST_ID in donki-may2024.json.

import type { SolReport } from '../../sim/types';
import { latestSpaceWeather, MAY2024_SNAPSHOT, RECENT_SNAPSHOT, type DonkiSnapshot, type SpaceWeatherFeed } from '../../data/donki';
import type { SeasonEvent } from './weekly';

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
/** A live event lasts this long after the eruption (and only eruptions this recent count). */
export const LIVE_WINDOW_MS = 3 * DAY_MS;
/** A CME at least this fast counts as a big one. */
export const FAST_CME_KMS = 1000;

export interface LiveSunEvent {
  type: 'live';
  /** DONKI activity id. */
  id: string;
  kind: 'flare' | 'cme';
  /** "X1.2" or "M3.5" for flares; null for a CME. */
  classType: string | null;
  /** CME speed, km/s (null for flares). */
  speedKms: number | null;
  /** ISO time of the flare's peak (or start) or the CME's start. */
  time: string;
  /** When the event ends: 3 days after the eruption. */
  endsAt: string;
  /** The DONKI record, when the data has one. */
  link: string | null;
  /** "M3.5 flare" or "1,450 km/s CME". */
  headline: string;
}

export interface ArchiveSunEvent {
  type: 'archive';
  id: 'gannon-2024';
  headline: string;
  /** ISO time of the storm's start at Earth, from DONKI. */
  time: string;
  /** The DONKI geomagnetic storm record, when the stored data has it. */
  link: string | null;
  kp: number | null;
}

export type SunEvent = LiveSunEvent | ArchiveSunEvent;

function flareLetter(cls: string | null | undefined): 'X' | 'M' | null {
  const l = (cls ?? '').trim().charAt(0).toUpperCase();
  return l === 'X' || l === 'M' ? l : null;
}
/** X10 > X1.2 > M9.9 > M1.0. */
function flareScore(cls: string): number {
  const m = /^([XM])(\d+(?:\.\d+)?)/i.exec(cls.trim());
  if (!m) return 0;
  return (m[1].toUpperCase() === 'X' ? 10 : 1) * Number(m[2]);
}

function toIso(t: string): string | null {
  const ms = Date.parse(t);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

/**
 * The biggest real eruption in a LIVE feed from the last 3 days, or null. Never looks at anything but a feed
 * whose status is 'live': the stored snapshot can hold recent-looking flares, but it is not live.
 */
export function detectLiveEvent(feed: SpaceWeatherFeed | null, now: Date): LiveSunEvent | null {
  if (!feed || feed.status !== 'live' || !feed.snapshot) return null;
  const snap = feed.snapshot;
  const t0 = now.getTime() - LIVE_WINDOW_MS;
  // A few minutes of slack for clocks that run a little behind NASA's.
  const t1 = now.getTime() + 10 * 60_000;
  const recent = (iso: string | null) => {
    if (!iso) return false;
    const ms = Date.parse(iso);
    return ms >= t0 && ms <= t1;
  };
  let best: LiveSunEvent | null = null;
  let bestScore = 0;
  for (const f of snap.flares ?? []) {
    const letter = flareLetter(f.classType);
    const time = toIso(f.peakTime ?? f.beginTime ?? '');
    if (!letter || !f.classType || !recent(time)) continue;
    const score = 100 + flareScore(f.classType); // any M or X flare beats any CME
    if (score > bestScore) {
      bestScore = score;
      best = liveEvent(f.id, 'flare', f.classType.trim(), null, time!, f.link);
    }
  }
  for (const c of snap.cmes ?? []) {
    const time = toIso(c.startTime ?? '');
    if (!c.speed || c.speed < FAST_CME_KMS || !recent(time)) continue;
    const score = c.speed / 1000; // under 100: only wins when there is no big flare
    if (score > bestScore) {
      bestScore = score;
      best = liveEvent(c.id, 'cme', null, c.speed, time!, c.link);
    }
  }
  return best;
}

function liveEvent(id: string, kind: 'flare' | 'cme', classType: string | null, speedKms: number | null, time: string, link: string | null): LiveSunEvent {
  const endsAt = new Date(Date.parse(time) + LIVE_WINDOW_MS).toISOString();
  const headline = kind === 'flare' ? `${classType} flare` : `${Math.round(speedKms ?? 0).toLocaleString('en-US')} km/s CME`;
  return { type: 'live', id, kind, classType, speedKms, time, endsAt, link: safeLink(link), headline };
}

/** Only ever link to NASA's own DONKI pages. */
export function safeLink(link: string | null | undefined): string | null {
  if (!link) return null;
  try {
    const u = new URL(link);
    return u.protocol === 'https:' && (u.hostname === 'ccmc.gsfc.nasa.gov' || u.hostname === 'kauai.ccmc.gsfc.nasa.gov') ? u.toString() : null;
  } catch {
    return null;
  }
}

/** The Gannon storm in the stored May 2024 DONKI data: the strongest geomagnetic storm that month (Kp 9). */
export function gannonFromSnapshot(snap: DonkiSnapshot | null = MAY2024_SNAPSHOT): ArchiveSunEvent {
  const gst = (snap?.gsts ?? []).filter((g) => g.startTime?.startsWith('2024-05-10')).sort((a, b) => (b.maxKp ?? 0) - (a.maxKp ?? 0))[0];
  return {
    type: 'archive',
    id: 'gannon-2024',
    headline: 'The May 2024 Gannon storm',
    time: (gst?.startTime && toIso(gst.startTime)) || '2024-05-10T15:00:00.000Z',
    link: safeLink(gst?.link),
    kp: gst?.maxKp ?? null,
  };
}

/** The event on right now: a LIVE one from the real Sun if there is one, else the ARCHIVE event. */
export function currentSunEvent(feed: SpaceWeatherFeed | null, now: Date): SunEvent {
  return detectLiveEvent(feed, now) ?? gannonFromSnapshot();
}

// ------------------------------------------------------------------ the 3 event challenges
export interface EventChallengeDef {
  id: string;
  title: string;
  goal: number;
  xp: number;
  count(ev: SeasonEvent): number;
}

const sol = (ev: SeasonEvent) => (ev.type === 'sol' ? ev : null);
const sheltered = (r: SolReport) => (r.storm?.shelterCells ?? 0) > 0;
const isHistory = (ev: SeasonEvent) => (ev.type === 'sol' || ev.type === 'end') && ev.mode === 'history';

export const EVENT_XP = 150;

export function eventChallenges(e: SunEvent): EventChallengeDef[] {
  if (e.type === 'live') {
    return [
      { id: 'live-sols', title: 'Play 5 days at your base while the real Sun is busy', goal: 5, xp: EVENT_XP, count: (ev) => (sol(ev) ? 1 : 0) },
      { id: 'live-shelter', title: 'Shelter your crew from a solar storm', goal: 1, xp: EVENT_XP, count: (ev) => (sol(ev) && sheltered(sol(ev)!.report) ? 1 : 0) },
      {
        id: 'live-launch',
        title: 'Launch a rocket home',
        goal: 1,
        xp: EVENT_XP,
        count: (ev) => (ev.type === 'end' && ev.won ? 1 : 0),
      },
    ];
  }
  return [
    { id: 'gannon-sols', title: 'Play 5 days of the May 2024 storms', goal: 5, xp: EVENT_XP, count: (ev) => (sol(ev) && isHistory(ev) ? 1 : 0) },
    {
      id: 'gannon-shelter',
      title: 'Shelter your crew during the May 2024 storms',
      goal: 1,
      xp: EVENT_XP,
      count: (ev) => (sol(ev) && isHistory(ev) && sheltered(sol(ev)!.report) ? 1 : 0),
    },
    { id: 'gannon-finish', title: 'Finish the May 2024 storms mission', goal: 1, xp: EVENT_XP, count: (ev) => (ev.type === 'end' && isHistory(ev) ? 1 : 0) },
  ];
}

/** The patch an event gives when all 3 of its challenges are done. */
export interface EventPatch {
  /** 'live:<DONKI id>' or 'archive:gannon-2024'. */
  id: string;
  /** Short text on the patch: "M3.5", "CME" or "G5". */
  mark: string;
  /** "Nov 5, 2026" */
  date: string;
  kind: 'flare' | 'cme' | 'gannon';
}

export function patchForEvent(e: SunEvent): EventPatch {
  const date = new Date(e.time).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  if (e.type === 'archive') return { id: 'archive:gannon-2024', mark: 'G5', date, kind: 'gannon' };
  const cls = /^([XM]\d{1,2}(?:\.\d)?)/i.exec(e.classType ?? '')?.[1]?.toUpperCase();
  return { id: `live:${e.id}`, mark: e.kind === 'flare' ? (cls ?? 'FLARE') : 'CME', date, kind: e.kind };
}

// ------------------------------------------------------------------ the game's feed
let feed: SpaceWeatherFeed | null = null;
let watching: Promise<SpaceWeatherFeed> | null = null;
const listeners: Array<() => void> = [];

/** Pick up the game's own space-weather load (no new request). Calls `onChange` when it arrives. */
export function watchFeed(onChange?: () => void): void {
  if (onChange && !listeners.includes(onChange)) listeners.push(onChange);
  const p = latestSpaceWeather();
  if (!p || p === watching) return;
  watching = p;
  p.then(
    (f) => {
      if (watching !== p) return;
      feed = f;
      for (const fn of [...listeners]) {
        try {
          fn();
        } catch (e) {
          console.error('[season] feed listener failed', e);
        }
      }
    },
    () => {
      /* the loader never rejects; stay safe anyway (no live event) */
    },
  );
}

/** The feed as far as we know it. Before it arrives: the stored snapshot, labeled ARCHIVE (never live). */
export function knownFeed(): SpaceWeatherFeed {
  if (feed) return feed;
  const snap = RECENT_SNAPSHOT;
  return { status: snap ? 'archive' : 'none', snapshot: snap, fetchedAt: snap?.fetchedAt ?? null, via: snap ? 'snapshot' : null };
}

/** Tests: use this feed (null: back to "not loaded yet"). */
export function setFeedForTests(f: SpaceWeatherFeed | null): void {
  feed = f;
  watching = null;
}
