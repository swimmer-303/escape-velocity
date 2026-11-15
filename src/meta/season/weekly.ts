// Written with AI assistance (Claude Code). See README "Use of AI tools".
// Weekly challenges: 7 bigger goals a week, the same for everyone, picked from the ISO week number (weeks start
// on Monday). They are week-long totals (40 sols, 3 launches, 4 storms...), so they never repeat the rank
// module's small daily missions (see ../rank/daily.ts). Each one gives a big chunk of Season XP. Pure, no DOM.
// Titles pop up during play, also at a Moon base, where a turn is a "day", never a "sol": so titles say "days".

import type { MissionState, SolReport } from '../../sim/types';
import type { StarId } from '../../sim/campaign';
import type { PlayMode } from '../hooks';

/** What a challenge can count. `xp` is every bit of XP the game gives (`bonus`: it came from another mode). */
export type SeasonEvent =
  | { type: 'sol'; before: MissionState; after: MissionState; report: SolReport; mode: PlayMode }
  | { type: 'end'; mission: MissionState; won: boolean; mode: PlayMode; stars: StarId[] }
  | { type: 'campaign' }
  | { type: 'xp'; amount: number; reason: string; bonus: boolean };

export interface ChallengeDef {
  id: string;
  title: string;
  /** One line on how to do it. */
  detail: string;
  goal: number;
  /** Season XP when done. */
  xp: number;
  count(ev: SeasonEvent): number;
}

const sol = (ev: SeasonEvent) => (ev.type === 'sol' ? ev : null);
const end = (ev: SeasonEvent) => (ev.type === 'end' ? ev : null);
const built = (r: SolReport) => r.builtAll?.length ?? (r.built ? 1 : 0);

export const WEEKLY_CHALLENGES: readonly ChallengeDef[] = [
  { id: 'w-sols-40', title: 'Play 40 days at your base', detail: 'A Mars day is called a sol. Mars sols and Moon days both count.', goal: 40, xp: 400, count: (ev) => (sol(ev) ? 1 : 0) },
  { id: 'w-launch-3', title: 'Launch 3 rockets home', detail: 'Fill the tank with oxygen and fly your crew home.', goal: 3, xp: 450, count: (ev) => (end(ev)?.won ? 1 : 0) },
  {
    id: 'w-shelter-4',
    title: 'Shelter your crew from 4 solar storms',
    detail: 'When a real storm arrives, put power on the storm shelter.',
    goal: 4,
    xp: 400,
    count: (ev) => ((sol(ev)?.report.storm?.shelterCells ?? 0) > 0 ? 1 : 0),
  },
  { id: 'w-build-5', title: 'Build 5 upgrades', detail: 'Put power on the Workshop. Upgrades stay for the next crew.', goal: 5, xp: 400, count: (ev) => (sol(ev) ? built(sol(ev)!.report) : 0) },
  { id: 'w-stars-6', title: 'Earn 6 mission stars', detail: 'Stars: launch home, keep the dose low, build an upgrade.', goal: 6, xp: 400, count: (ev) => end(ev)?.stars.length ?? 0 },
  { id: 'w-moon-10', title: 'Play 10 days at a Moon base', detail: 'The lunar night is long and cold. Plan your power!', goal: 10, xp: 350, count: (ev) => (sol(ev)?.after.config.site === 'moon' ? 1 : 0) },
  { id: 'w-fuel-60', title: 'Send 60 cells to rocket FUEL', detail: 'Every cell on FUEL makes oxygen for the rocket home.', goal: 60, xp: 350, count: (ev) => (sol(ev) ? Math.max(0, sol(ev)!.report.alloc.fuel) : 0) },
  { id: 'w-food-15', title: 'Grow food on 15 days', detail: 'Greenhouse plants need power for their lights.', goal: 15, xp: 300, count: (ev) => (sol(ev) && sol(ev)!.report.alloc.greenhouse > 0 ? 1 : 0) },
  { id: 'w-storms-5', title: 'Ride out 5 real solar storms', detail: 'Every storm in the game is a real one from NASA records.', goal: 5, xp: 350, count: (ev) => (sol(ev)?.report.storm ? 1 : 0) },
  {
    id: 'w-medals-3',
    title: 'Win 3 flight medals',
    detail: 'Fly a landing or a launch, or practice in Flight school.',
    goal: 3,
    xp: 350,
    count: (ev) => (ev.type === 'xp' && /\bmedal\b/i.test(ev.reason) ? 1 : 0),
  },
  { id: 'w-xp-3000', title: 'Earn 3,000 XP', detail: 'Any way you like: missions, storms, medals, cards and every game mode.', goal: 3000, xp: 450, count: (ev) => (ev.type === 'xp' ? ev.amount : 0) },
  {
    id: 'w-bonus-600',
    title: 'Earn 600 XP in other modes',
    detail: 'Storm Cards, flight medals and the other ways to play all give bonus XP.',
    goal: 600,
    xp: 350,
    count: (ev) => (ev.type === 'xp' && ev.bonus ? ev.amount : 0),
  },
  { id: 'w-daily-2', title: 'Finish 2 daily challenges', detail: 'Everyone gets the same base and storms each day.', goal: 2, xp: 400, count: (ev) => (end(ev)?.mode === 'daily' ? 1 : 0) },
  { id: 'w-history-10', title: 'Play 10 days of the May 2024 storms', detail: 'Replay the real storms of May 2024.', goal: 10, xp: 350, count: (ev) => (sol(ev)?.mode === 'history' ? 1 : 0) },
  {
    id: 'w-commander',
    title: 'Win a mission on Commander',
    detail: 'Less power and tougher storms. You can do it!',
    goal: 1,
    xp: 500,
    count: (ev) => (end(ev)?.won && end(ev)!.mission.config.difficulty === 'commander' ? 1 : 0),
  },
  {
    id: 'w-safe-2',
    title: 'Launch twice with a low radiation dose',
    detail: 'Fly home with under half the radiation budget used.',
    goal: 2,
    xp: 500,
    count: (ev) => {
      const e = end(ev);
      return e && e.won && e.mission.dose < e.mission.doseBudget * 0.5 ? 1 : 0;
    },
  },
  { id: 'w-campaign', title: 'Finish a 3-crew campaign', detail: 'Three crews, one base, built better each time.', goal: 1, xp: 500, count: (ev) => (ev.type === 'campaign' ? 1 : 0) },
  {
    id: 'w-big-2',
    title: 'Shelter from 2 big storms',
    detail: 'Big storms are rare. Tip: the May 2024 storms have some!',
    goal: 2,
    xp: 450,
    count: (ev) => {
      const st = sol(ev)?.report.storm;
      return st && st.event.severity === 'major' && st.shelterCells > 0 ? 1 : 0;
    },
  },
  { id: 'w-battery-5', title: 'Save power in the battery on 5 days', detail: 'Build the battery bank, then store cells for later.', goal: 5, xp: 350, count: (ev) => (sol(ev) && sol(ev)!.report.alloc.battery > 0 ? 1 : 0) },
];

export const WEEKLY_COUNT = 7;

const BY_ID = new Map(WEEKLY_CHALLENGES.map((c) => [c.id, c]));
export function challengeById(id: string): ChallengeDef | undefined {
  return BY_ID.get(id);
}

// ------------------------------------------------------------------ ISO weeks (local time)
const DAY_MS = 86_400_000;

/** The ISO week of a local date, e.g. "2026-W46" (weeks start Monday; week 1 holds the year's first Thursday). */
export function isoWeekKey(d: Date): string {
  // Work at local noon in UTC terms so daylight-saving changes never shift the day.
  const day = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), 12));
  const dow = (day.getUTCDay() + 6) % 7; // Monday 0 ... Sunday 6
  day.setUTCDate(day.getUTCDate() - dow + 3); // the Thursday of this week
  const year = day.getUTCFullYear();
  const jan4 = new Date(Date.UTC(year, 0, 4, 12));
  const jan4dow = (jan4.getUTCDay() + 6) % 7;
  const week1Thu = jan4.getTime() + (3 - jan4dow) * DAY_MS;
  const week = 1 + Math.round((day.getTime() - week1Thu) / (7 * DAY_MS));
  return `${year}-W${String(week).padStart(2, '0')}`;
}

/** The moment the next week starts: next Monday at local midnight. */
export function nextWeekStart(d: Date): Date {
  const dow = (d.getDay() + 6) % 7;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + (7 - dow), 0, 0, 0, 0);
}

// ------------------------------------------------------------------ the pick
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** This week's 7 challenges. Same week, same challenges, for everyone, on any device. */
export function challengesForWeek(week: string): ChallengeDef[] {
  const r = rng(hash(`ev-season-weekly:${week}`));
  const pool = [...WEEKLY_CHALLENGES];
  // Fisher-Yates with the week's own random numbers.
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1)) % (i + 1);
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, WEEKLY_COUNT);
}
