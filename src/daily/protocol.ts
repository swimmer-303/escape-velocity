// Written with AI assistance (Claude Code). See README "Use of AI tools".
// Daily challenge: what the browser and the server agree on.
// One challenge per day for everyone, keyed by the US Eastern date (our Space Apps event is in
// Charlotte, NC). The server freezes the pool of real NASA DONKI events at the day's first request,
// so every player meets exactly the same storms. Scores are never taken from the browser: it sends
// its moves, and the server replays the mission with the frozen pool and scores it itself.
// Imported by the game (src/ui/daily) and by our server (src/daily/http.ts).

import type { Site } from '../sim/constants';
import type { CrateId, SpaceWeatherEvent } from '../sim/types';
import type { UpgradeId } from '../sim/upgrades';
import { LIMITS as ROOM_LIMITS, NAME_PROBLEM, checkNameFormat, type NameProblem } from '../room/protocol';

/** The day changes at midnight in Charlotte, NC. */
export const DAILY_TZ = 'America/New_York';

export const DAILY_LIMITS = {
  /** Most players on one day's board (a better score pushes the last one off). */
  maxEntriesPerDay: 500,
  /** Days of boards (and frozen pools) the server keeps, today included. */
  keepDays: 14,
  /** Largest request body the server reads, bytes. */
  maxBody: 4096,
  /** A Cadet mission lasts at most 21 turns; anything far longer is not a real game. */
  maxMoves: 40,
  topDefault: 20,
  topMax: 50,
  /** Nicknames: the same rule as Mission Control names. */
  nicknameMax: ROOM_LIMITS.nameMax,
} as const;

/** Shown for a player who sends a score without a nickname. */
export const ANONYMOUS = 'Anonymous astronaut';

/** Said in the game wherever the site is picked. */
export const SITE_RULE = 'Mars on most days, the Moon on Sundays.';

/** Everything a player needs to play today's challenge. The same for everyone all day. */
export interface DailyConfig {
  /** YYYY-MM-DD, US Eastern. */
  date: string;
  seed: string;
  site: Site;
  difficulty: 'cadet';
  /** One-way Earth light time used for the comm-delay text, minutes. */
  lightTimeMin: number;
  /** The real space-weather events, frozen at the day's first request. */
  eventPool: SpaceWeatherEvent[];
  /** Fetched from NASA DONKI that day (live), or the bundled snapshot (archive). */
  poolSource: 'live' | 'archive';
  poolFetchedAt: string | null;
  /** The days of NASA data in the pool's current window. */
  poolStart: string | null;
  poolEnd: string | null;
}

/**
 * One turn as the player played it: `a` is the allocation in MODULE_IDS order
 * (air, fuel, greenhouse, heaters, shelter, monitor, build, battery), `c` the cargo crate (cargo day only)
 * and `p` the Workshop project at the moment the turn ran.
 */
export interface DailyMove {
  a: number[];
  c?: CrateId;
  p?: UpgradeId | null;
}

/** What the board ranks. Computed by the server from a replay, never sent by the browser. */
export interface DailyScore {
  won: boolean;
  /** Turns played (sols on Mars, days on the Moon). */
  sols: number;
  /** Crew dose, mSv, rounded to 0.1. */
  dose: number;
  stars: number;
  /** Fuel tank %, rounded down (ranks crews that came home early). */
  fuel: number;
}

export interface DailyEntryView extends DailyScore {
  rank: number;
  nickname: string;
}

export interface DailyTop {
  date: string;
  total: number;
  top: DailyEntryView[];
  /** The asking player's own entry, if they have one today. */
  you: DailyEntryView | null;
}

export interface DailySubmitRequest {
  playerId: string;
  /** Empty or missing: "Anonymous astronaut". */
  nickname?: string | null;
  moves: DailyMove[];
}

export interface DailySubmitResponse {
  ok: true;
  date: string;
  /** False when the player already had a better (or equal) score today: the board keeps their best. */
  improved: boolean;
  /** The score of the game just sent. */
  score: DailyScore;
  /** The player's best entry today, with its rank. */
  you: DailyEntryView;
  total: number;
}

// ---------------------------------------------------------------- dates

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Today's date in Charlotte, NC, as YYYY-MM-DD. */
export function easternDate(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: DAILY_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** Is this a real calendar date written as YYYY-MM-DD? */
export function isDateKey(s: unknown): s is string {
  if (typeof s !== 'string') return false;
  const m = DATE_RE.exec(s);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

/** Noon UTC on that calendar day (safe for weekday and day arithmetic). */
function noon(date: string): Date {
  return new Date(`${date}T12:00:00Z`);
}

export function addDays(date: string, n: number): string {
  return new Date(noon(date).getTime() + n * 86_400_000).toISOString().slice(0, 10);
}

/** Mars on most days, the Moon on Sundays. */
export function siteForDate(date: string): Site {
  return noon(date).getUTCDay() === 0 ? 'moon' : 'mars';
}

/** Everyone plays the same Mars (or Moon) all day: the date is the seed. */
export function seedForDate(date: string): string {
  return date;
}

/** "Nov 15". */
export function prettyDate(date: string): string {
  return noon(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

// ---------------------------------------------------------------- ranking

/**
 * Board order (negative = `a` ranks higher): crews that launched first, then the fewest turns to launch,
 * then the lowest dose, then the most stars. Crews that came home early rank by how full their tank was,
 * then how long they lasted. Equal scores keep the order they were sent in.
 */
export function compareScores(a: DailyScore, b: DailyScore): number {
  if (a.won !== b.won) return a.won ? -1 : 1;
  if (a.won) {
    if (a.sols !== b.sols) return a.sols - b.sols;
  } else {
    if (a.fuel !== b.fuel) return b.fuel - a.fuel;
    if (a.sols !== b.sols) return b.sols - a.sols;
  }
  if (a.dose !== b.dose) return a.dose - b.dose;
  return b.stars - a.stars;
}

// ---------------------------------------------------------------- nicknames

export type NicknameCheck = { ok: true; nickname: string | null } | { ok: false; problem: NameProblem; message: string };

/** Format check (the server also runs the Mission Control blocklist). Empty means "Anonymous astronaut". */
export function checkNicknameFormat(raw: unknown): NicknameCheck {
  if (raw === null || raw === undefined) return { ok: true, nickname: null };
  if (typeof raw !== 'string') return { ok: false, problem: 'letters', message: NAME_PROBLEM.letters };
  if (!raw.trim()) return { ok: true, nickname: null };
  const f = checkNameFormat(raw);
  return f.ok ? { ok: true, nickname: f.name } : { ok: false, problem: f.problem, message: NAME_PROBLEM[f.problem] };
}

/** A random id for this browser's player (kept in localStorage; it identifies no one). */
export const PLAYER_ID_RE = /^[A-Za-z0-9_-]{12,64}$/;
