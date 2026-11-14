// Written with AI assistance (Claude Code). See README "Use of AI tools".
// Scripted players used by balance tests (and handy for an "autopilot" demo).

import { RATES } from './constants';
import { emptyAlloc, getBriefing, runSol, setProject, moduleCap, airPerCell, foodPerGreenhouseCell, fuelPctPerCell, windowSol, createMission, isMoon, isNight } from './sim';
import { nextCost, type UpgradeId } from './upgrades';
import { finishExpedition, missionConfigFor, newCampaign, campaignDone, type Campaign } from './campaign';
import type { Allocation, CrateId, MissionState, ModuleId, SpaceWeatherEvent } from './types';
import type { Difficulty, Site } from './constants';

export interface Move {
  alloc: Allocation;
  crate?: CrateId;
  project?: UpgradeId | null;
}
export type Strategy = (state: MissionState) => Move;

function filler(state: MissionState, cells: number) {
  const alloc = emptyAlloc();
  let left = cells;
  const give = (id: ModuleId, n: number) => {
    const k = Math.max(0, Math.min(n, left, moduleCap(state, id) - alloc[id]));
    alloc[id] += k;
    left -= k;
  };
  const rest = (order: ModuleId[]) => {
    for (const id of order) give(id, left);
  };
  return { alloc, give, rest, left: () => left };
}

/** Moon only: lunar-night turns from today to the end of the window (0 on Mars). */
export function nightsAhead(state: MissionState): number {
  if (!isMoon(state)) return 0;
  let n = 0;
  for (let sol = state.sol; sol <= windowSol(state); sol++) if (isNight(state, sol)) n++;
  return n;
}

/** Moon only: extra days of air and food to stock before (and through) the lunar night. */
function nightStock(state: MissionState, lookahead: number): number {
  const b = getBriefing(state);
  if (b.night) return b.nightLeft ?? 0;
  return b.nightIn != null && b.nightIn <= lookahead ? nightsAhead(state) : 0;
}

/** Cover heat, shelter-on-warning, and ~2 days of food and air. Shared by the "sensible" strategies. */
function essentials(state: MissionState, f: ReturnType<typeof filler>, opts: { foodDays: number; airDays: number; shelter: boolean }) {
  const b = getBriefing(state);
  f.give('heaters', b.heaterNeed);
  if (opts.shelter && b.warning) f.give('shelter', 2);
  // Stock up when orbiters spot a dust storm coming (or during one).
  const dust = b.dustTomorrow || b.weather !== 'clear' ? 1.5 : 0;
  // On the Moon, stock up for the lunar night a few days ahead: the panels make nothing then.
  const night = isMoon(state) ? nightStock(state, 5) : 0;
  const foodNeed = (opts.foodDays + dust + night + 1) * state.crew - state.food;
  f.give('greenhouse', Math.ceil(Math.max(0, foodNeed) / foodPerGreenhouseCell(state)));
  const airFromGh = f.alloc.greenhouse * RATES.airPerGreenhouseCell;
  const airNeed = (opts.airDays + dust + night + 1) * state.crew - state.air - airFromGh;
  f.give('air', Math.ceil(Math.max(0, airNeed) / airPerCell(state)));
  return b;
}

/** A thoughtful kid who never builds: heats, keeps ~2 days of air and food, shelters when warned. */
export const balanced: Strategy = (state) => {
  const b = getBriefing(state);
  const f = filler(state, b.cells);
  essentials(state, f, { foodDays: 2, airDays: 1.5, shelter: true });
  if (b.hasMonitor && b.outlook !== 'quiet' && f.left() >= 2) f.give('monitor', 1);
  f.rest(['fuel', 'greenhouse', 'air', 'heaters', 'shelter']);
  return { alloc: f.alloc, crate: state.food < 3 * state.crew ? 'food' : 'panel' };
};

const BUILD_ORDER: UpgradeId[] = ['monitor', 'panel', 'panel', 'berm', 'moxie2', 'battery', 'panel', 'reactor', 'panel', 'dome2'];
/** On the Moon, Earth's warnings are never late (no monitor needed), and the battery and reactor get you through the night. */
const MOON_BUILD_ORDER: UpgradeId[] = ['battery', 'panel', 'panel', 'berm', 'moxie2', 'panel', 'reactor', 'panel', 'dome2'];

function nextProject(state: MissionState): UpgradeId | null {
  for (const id of isMoon(state) ? MOON_BUILD_ORDER : BUILD_ORDER) if (nextCost(id, state.base.levels) !== null) return id;
  return null;
}

/** Plans for the next generation: invests spare power in the base while staying on track to launch. */
export const builder: Strategy = (state) => {
  const project = nextProject(state);
  const s = project !== state.base.project ? setProject(state, project) : state;
  const b = getBriefing(s);
  const f = filler(s, b.cells);
  essentials(s, f, { foodDays: 2, airDays: 1.5, shelter: true });
  if (b.hasMonitor && b.outlook !== 'quiet' && f.left() >= 2) f.give('monitor', 1);
  if (b.hasBattery && b.dustTomorrow && f.left() >= 3) f.give('battery', 2);
  // Moon: charge the battery for the lunar night in the last few days before it.
  if (b.hasBattery && b.nightIn != null && b.nightIn <= 3 && f.left() >= 2) f.give('battery', 2);
  // How many fuel cells per sol do we need from here to launch in time? (Lunar nights make almost no power.)
  const solsLeft = windowSol(s) - s.sol + 1 - nightsAhead(s);
  const fuelCellsNeeded = (100 - s.fuel) / fuelPctPerCell(s);
  const mustFuel = Math.ceil(fuelCellsNeeded / Math.max(1, solsLeft - 3));
  const spare = f.left() - mustFuel;
  if (spare > 0) f.give('build', spare);
  f.rest(['fuel', 'greenhouse', 'air', 'heaters', 'shelter', 'build']);
  const crate: CrateId = s.food < 3 * s.crew ? 'food' : 'panel';
  return { alloc: f.alloc, crate, project };
};

/** Same as balanced but never uses the monitor or shelter. */
export const ignoresRadiation: Strategy = (state) => {
  const b = getBriefing(state);
  const f = filler(state, b.cells);
  essentials(state, f, { foodDays: 2.5, airDays: 2, shelter: false });
  f.rest(['fuel', 'greenhouse', 'air', 'heaters']);
  return { alloc: f.alloc, crate: 'panel' };
};

/** Pure greed: every cell into rocket fuel, then whatever is left over. */
export const pureGreed: Strategy = (state) => {
  const b = getBriefing(state);
  const f = filler(state, b.cells);
  f.rest(['fuel', 'air', 'greenhouse', 'heaters', 'shelter', 'monitor', 'build', 'battery']);
  return { alloc: f.alloc, crate: 'panel' };
};

/** Greedy but keeps the crew breathing: air to break even, everything else into fuel. */
export const greedyBreathing: Strategy = (state) => {
  const b = getBriefing(state);
  const f = filler(state, b.cells);
  f.give('air', Math.ceil(state.crew / airPerCell(state)) + (state.air < 1.5 * state.crew ? 1 : 0));
  f.rest(['fuel', 'greenhouse', 'heaters', 'shelter', 'monitor', 'build', 'battery']);
  return { alloc: f.alloc, crate: 'panel' };
};

/** A first-timer: spreads cells evenly, shelters only when warned. */
export const evenSplit: Strategy = (state) => {
  const b = getBriefing(state);
  const f = filler(state, b.cells);
  f.give('heaters', b.heaterNeed);
  if (b.warning) f.give('shelter', 2);
  const order: ModuleId[] = ['air', 'greenhouse', 'fuel', 'greenhouse'];
  let i = 0;
  while (f.left() > 0 && i < 40) f.give(order[i++ % order.length], 1);
  f.rest(['fuel', 'greenhouse', 'air', 'build']);
  return { alloc: f.alloc, crate: 'food' };
};

export function playOut(state: MissionState, strategy: Strategy, maxSols = 60): MissionState {
  let s = state;
  let guard = 0;
  while (s.status === 'playing' && guard++ < maxSols) {
    const { alloc, crate, project } = strategy(s);
    if (project !== undefined && project !== s.base.project) s = setProject(s, project);
    s = runSol(s, alloc, crate).next;
  }
  return s;
}

/** Play a whole campaign (all expeditions) with one strategy. */
export function playCampaign(seed: string, difficulty: Difficulty, pool: SpaceWeatherEvent[], strategy: Strategy, lightTimeMin = 11, site: Site = 'mars'): Campaign {
  let c = newCampaign(seed, difficulty, site);
  while (!campaignDone(c)) {
    const end = playOut(createMission(missionConfigFor(c, lightTimeMin, pool)), strategy);
    c = finishExpedition(c, end);
  }
  return c;
}
