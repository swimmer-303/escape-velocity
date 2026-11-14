// Written with AI assistance (Claude Code). See README "Use of AI tools".
// Daily missions: three small goals a day, each tied to something the game teaches (sharing power, sheltering
// from real solar storms, building for the next crew...). The same date always gives the same three missions,
// one easy, one medium and one stretch goal. Pure functions, no DOM.

import type { MissionState, SolReport } from '../../sim/types';
import type { StarId } from '../../sim/campaign';
import type { PlayMode } from '../hooks';

/** What a mission can count. */
export type TrackEvent =
  | { type: 'sol'; before: MissionState; after: MissionState; report: SolReport; mode: PlayMode }
  | { type: 'end'; mission: MissionState; won: boolean; mode: PlayMode; stars: StarId[] }
  | { type: 'campaign' }
  | { type: 'level'; level: number };

export type MissionSlot = 'easy' | 'medium' | 'hard';

export interface DailyMissionDef {
  id: string;
  slot: MissionSlot;
  /** Short, for the title screen. */
  title: string;
  /** Why it matters / how to do it, for the missions dialog. */
  detail: string;
  goal: number;
  xp: number;
  /** How much this event moves the mission along (0 = not at all). */
  count(ev: TrackEvent): number;
}

const sol = (ev: TrackEvent) => (ev.type === 'sol' ? ev : null);
const end = (ev: TrackEvent) => (ev.type === 'end' ? ev : null);
const isMoon = (m: MissionState) => m.config.site === 'moon';
const builtCount = (r: SolReport) => r.builtAll?.length ?? (r.built ? 1 : 0);

export const DAILY_MISSIONS: readonly DailyMissionDef[] = [
  // ---------------------------------------------------------------- easy
  {
    id: 'play-sols',
    slot: 'easy',
    title: 'Play 5 sols',
    detail: 'Every sol (a Mars day) you share out the power cells. Moon days count too.',
    goal: 5,
    xp: 50,
    count: (ev) => (sol(ev) ? 1 : 0),
  },
  {
    id: 'greenhouse',
    slot: 'easy',
    title: 'Grow food on 3 sols',
    detail: 'Put power on the greenhouse. Plants need light to grow, and at a space base that light comes from power cells.',
    goal: 3,
    xp: 50,
    count: (ev) => (sol(ev) && sol(ev)!.report.alloc.greenhouse > 0 ? 1 : 0),
  },
  {
    id: 'fuel-cells',
    slot: 'easy',
    title: 'Send 10 cells to rocket FUEL',
    detail: 'The O2 plant makes oxygen. The rocket home burns lots of it, so the tank fills one cell at a time.',
    goal: 10,
    xp: 50,
    count: (ev) => (sol(ev) ? Math.max(0, sol(ev)!.report.alloc.fuel) : 0),
  },
  {
    id: 'crate',
    slot: 'easy',
    title: 'Open a supply crate',
    detail: 'Partway through each mission a supply rocket from Earth drops a crate. Pick what your base needs most.',
    goal: 1,
    xp: 50,
    count: (ev) => (sol(ev)?.report.crate ? 1 : 0),
  },
  {
    id: 'finish',
    slot: 'easy',
    title: 'Finish a mission',
    detail: 'Fly home or come home early: every crew teaches the next one something.',
    goal: 1,
    xp: 60,
    count: (ev) => (end(ev) ? 1 : 0),
  },
  // ---------------------------------------------------------------- medium
  {
    id: 'shelter',
    slot: 'medium',
    title: 'Shelter your crew from a solar storm',
    detail: 'When a real NASA solar storm arrives, put power on the storm shelter. Astronauts on the space station hide in its best-shielded spot too.',
    goal: 1,
    xp: 75,
    count: (ev) => ((sol(ev)?.report.storm?.shelterCells ?? 0) > 0 ? 1 : 0),
  },
  {
    id: 'build',
    slot: 'medium',
    title: 'Build any upgrade',
    detail: 'Put power on the Workshop until a project is finished. Upgrades stay for the next crew.',
    goal: 1,
    xp: 75,
    count: (ev) => (sol(ev) ? builtCount(sol(ev)!.report) : 0),
  },
  {
    id: 'cold-night',
    slot: 'medium',
    title: 'Keep the base warm on a cold night',
    detail: 'On a cold night the heaters need an extra cell. Give them every cell they need.',
    goal: 1,
    xp: 75,
    count: (ev) => {
      const s = sol(ev);
      return s && s.report.coldSnap && s.report.heaterShortfall === 0 ? 1 : 0;
    },
  },
  {
    id: 'dust',
    slot: 'medium',
    title: 'Get through a dusty sol',
    detail: 'Dust in the Mars sky dims the solar panels, so you get fewer power cells. Plan ahead when orbiters warn you.',
    goal: 1,
    xp: 75,
    count: (ev) => (sol(ev) && sol(ev)!.report.weather !== 'clear' ? 1 : 0),
  },
  {
    id: 'launch',
    slot: 'medium',
    title: 'Launch a rocket home',
    detail: 'Fill the tank with oxygen and fly your crew home.',
    goal: 1,
    xp: 100,
    count: (ev) => (end(ev)?.won ? 1 : 0),
  },
  {
    id: 'moon',
    slot: 'medium',
    title: 'Play 3 days at a Moon base',
    detail: 'Earth is only about 1.3 light-seconds from the Moon, so warnings arrive fast. But the lunar night is long and cold.',
    goal: 3,
    xp: 75,
    count: (ev) => (sol(ev) && isMoon(sol(ev)!.after) ? 1 : 0),
  },
  {
    id: 'daily-challenge',
    slot: 'medium',
    title: "Finish today's daily challenge",
    detail: 'Everyone gets the same base and the same storms today. How well can you do?',
    goal: 1,
    xp: 100,
    count: (ev) => (end(ev)?.mode === 'daily' ? 1 : 0),
  },
  {
    id: 'history',
    slot: 'medium',
    title: 'Play 3 sols of the May 2024 storms',
    detail: 'In May 2024 the Sun sent out its biggest storms in about 20 years. Replay the real NASA data.',
    goal: 3,
    xp: 75,
    count: (ev) => (sol(ev)?.mode === 'history' ? 1 : 0),
  },
  {
    id: 'sols-15',
    slot: 'medium',
    title: 'Play 15 sols',
    detail: 'A long shift at the base. Moon days count too.',
    goal: 15,
    xp: 75,
    count: (ev) => (sol(ev) ? 1 : 0),
  },
  {
    id: 'level-up',
    slot: 'medium',
    title: 'Reach a new level',
    detail: 'Earn XP by playing sols, sheltering from storms, building and flying home.',
    goal: 1,
    xp: 75,
    count: (ev) => (ev.type === 'level' ? 1 : 0),
  },
  // ---------------------------------------------------------------- hard (a stretch goal)
  {
    id: 'safe-launch',
    slot: 'hard',
    title: 'Launch with under half your radiation budget used',
    detail: 'Shelter early, and your crew flies home with a low radiation dose.',
    goal: 1,
    xp: 150,
    count: (ev) => {
      const e = end(ev);
      return e && e.won && e.mission.dose < e.mission.doseBudget * 0.5 ? 1 : 0;
    },
  },
  {
    id: 'fast-fill',
    slot: 'hard',
    title: 'Fill the rocket in 12 sols or fewer',
    detail: 'Send lots of cells to FUEL, but keep enough air and food for the crew!',
    goal: 1,
    xp: 150,
    count: (ev) => {
      const e = end(ev);
      return e && e.won && e.mission.log.length <= 12 ? 1 : 0;
    },
  },
  {
    id: 'three-stars',
    slot: 'hard',
    title: 'Earn all 3 stars on one mission',
    detail: 'Launch, keep the crew safe from radiation, and build an upgrade, all in one mission.',
    goal: 1,
    xp: 150,
    count: (ev) => ((end(ev)?.stars.length ?? 0) >= 3 ? 1 : 0),
  },
  {
    id: 'commander',
    slot: 'hard',
    title: 'Win a mission on Commander',
    detail: 'Commander is the hard setting: less power and tougher storms.',
    goal: 1,
    xp: 150,
    count: (ev) => {
      const e = end(ev);
      return e && e.won && e.mission.config.difficulty === 'commander' ? 1 : 0;
    },
  },
  {
    id: 'big-storm',
    slot: 'hard',
    title: 'Shelter your crew from a big storm',
    detail: 'Big storms are rare. Tip: the May 2024 storms had several!',
    goal: 1,
    xp: 125,
    count: (ev) => {
      const st = sol(ev)?.report.storm;
      return st && st.event.severity === 'major' && st.shelterCells > 0 ? 1 : 0;
    },
  },
  {
    id: 'builder-2',
    slot: 'hard',
    title: 'Build 2 upgrades',
    detail: 'Keep the Workshop busy. Every upgrade makes life easier for the crews who come after you.',
    goal: 2,
    xp: 125,
    count: (ev) => (sol(ev) ? builtCount(sol(ev)!.report) : 0),
  },
  {
    id: 'monitor',
    slot: 'hard',
    title: 'Get a storm warning from your own monitor',
    detail: 'Solar particles can reach Mars faster than a warning from Earth. Build the radiation monitor and give it power.',
    goal: 1,
    xp: 125,
    count: (ev) => (sol(ev)?.report.storm?.warnedBy === 'monitor' ? 1 : 0),
  },
  {
    id: 'battery',
    slot: 'hard',
    title: 'Save power in the battery',
    detail: 'Build the battery bank, then store a cell for tomorrow. Great before a dust storm or the lunar night.',
    goal: 1,
    xp: 125,
    count: (ev) => (sol(ev) && sol(ev)!.report.alloc.battery > 0 ? 1 : 0),
  },
];

const BY_ID = new Map(DAILY_MISSIONS.map((m) => [m.id, m]));
export function missionById(id: string): DailyMissionDef | undefined {
  return BY_ID.get(id);
}

/** Bonus for finishing all three in a day. */
export const ALL_DONE_BONUS = 100;

// ------------------------------------------------------------------ dates
const pad = (n: number) => String(n).padStart(2, '0');

/** The local calendar day, e.g. "2026-11-14". */
export function dayKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** The local calendar day before `key`. */
export function previousDay(key: string): string {
  const [y, m, d] = key.split('-').map(Number);
  return dayKey(new Date(y, m - 1, d - 1));
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

/** Today's three missions (easy, medium, stretch). Same date, same missions, for everyone. */
export function missionsForDay(key: string): DailyMissionDef[] {
  const r = rng(hash(`ev-daily:${key}`));
  const pick = (slot: MissionSlot, not: DailyMissionDef[]) => {
    const pool = DAILY_MISSIONS.filter((m) => m.slot === slot && !not.some((n) => n.id === m.id));
    return pool[Math.floor(r() * pool.length) % pool.length];
  };
  const out: DailyMissionDef[] = [];
  out.push(pick('easy', out));
  out.push(pick('medium', out));
  out.push(pick('hard', out));
  return out;
}
