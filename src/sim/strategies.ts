// Written with AI assistance (Claude Code). See README "Use of AI tools".
// Scripted players used by balance tests (and handy for an "autopilot" demo).

import { MODULE_CAP, RATES } from './constants';
import { emptyAlloc, getBriefing, runSol } from './sim';
import type { Allocation, CrateId, MissionState, ModuleId } from './types';

export type Strategy = (state: MissionState) => { alloc: Allocation; crate?: CrateId };

function filler(cells: number) {
  const alloc = emptyAlloc();
  let left = cells;
  const give = (id: ModuleId, n: number) => {
    const k = Math.max(0, Math.min(n, left, MODULE_CAP[id] - alloc[id]));
    alloc[id] += k;
    left -= k;
  };
  const rest = (order: ModuleId[]) => {
    for (const id of order) give(id, left);
  };
  return { alloc, give, rest, left: () => left };
}

/** A thoughtful kid: heats, keeps ~2 days of air and food, runs the monitor when Earth says the Sun is active, shelters when warned. */
export const balanced: Strategy = (state) => {
  const b = getBriefing(state);
  const f = filler(b.cells);
  f.give('heaters', b.heaterNeed);
  if (b.warning) f.give('shelter', 2);
  const foodTarget = 2;
  const gh = Math.ceil(Math.max(0, foodTarget + RATES.foodUsePerSol - state.food) / RATES.foodPerGreenhouseCell);
  f.give('greenhouse', gh);
  const airFromGh = f.alloc.greenhouse * RATES.airPerGreenhouseCell;
  const airTarget = 1.5;
  const air = Math.ceil(Math.max(0, airTarget + RATES.airUsePerSol - state.air - airFromGh));
  f.give('air', air);
  if (b.outlook !== 'quiet' && f.left() >= 2) f.give('monitor', 1);
  f.rest(['fuel', 'greenhouse', 'air', 'heaters', 'shelter']);
  const crate: CrateId = state.food < 3 ? 'food' : 'panel';
  return { alloc: f.alloc, crate };
};

/** Over-cautious: monitor every sol, half-shelter whenever the Sun is active. */
export const cautious: Strategy = (state) => {
  const b = getBriefing(state);
  const f = filler(b.cells);
  f.give('heaters', b.heaterNeed);
  if (b.warning) f.give('shelter', 2);
  else if (b.outlook === 'active') f.give('shelter', 1);
  const gh = Math.ceil(Math.max(0, 2.5 + 1 - state.food) / RATES.foodPerGreenhouseCell);
  f.give('greenhouse', gh);
  const air = Math.ceil(Math.max(0, 2 + 1 - state.air - f.alloc.greenhouse * RATES.airPerGreenhouseCell));
  f.give('air', air);
  f.give('monitor', 1);
  f.rest(['fuel', 'greenhouse', 'air', 'heaters', 'shelter']);
  return { alloc: f.alloc, crate: state.food < 3 ? 'food' : 'panel' };
};

/** Same as balanced but never uses the monitor or shelter. */
export const ignoresRadiation: Strategy = (state) => {
  const b = getBriefing(state);
  const f = filler(b.cells);
  f.give('heaters', b.heaterNeed);
  const gh = Math.ceil(Math.max(0, 2.5 + 1 - state.food) / RATES.foodPerGreenhouseCell);
  f.give('greenhouse', gh);
  const air = Math.ceil(Math.max(0, 2 + 1 - state.air - f.alloc.greenhouse * RATES.airPerGreenhouseCell));
  f.give('air', air);
  f.rest(['fuel', 'greenhouse', 'air', 'heaters']);
  return { alloc: f.alloc, crate: 'panel' };
};

/** Pure greed: every cell into rocket fuel, then whatever is left over. */
export const pureGreed: Strategy = (state) => {
  const b = getBriefing(state);
  const f = filler(b.cells);
  f.rest(['fuel', 'air', 'greenhouse', 'heaters', 'shelter', 'monitor']);
  return { alloc: f.alloc, crate: 'panel' };
};

/** Greedy but keeps the crew breathing: air to break even, everything else into fuel. */
export const greedyBreathing: Strategy = (state) => {
  const b = getBriefing(state);
  const f = filler(b.cells);
  f.give('air', state.air < 1.5 ? 2 : 1);
  f.rest(['fuel', 'greenhouse', 'heaters', 'shelter', 'monitor']);
  return { alloc: f.alloc, crate: 'panel' };
};

/** A first-timer: spreads cells evenly, shelters only when warned. */
export const evenSplit: Strategy = (state) => {
  const b = getBriefing(state);
  const f = filler(b.cells);
  f.give('heaters', b.heaterNeed);
  if (b.warning) f.give('shelter', 2);
  const order: ModuleId[] = ['air', 'greenhouse', 'fuel'];
  let i = 0;
  while (f.left() > 0 && i < 30) f.give(order[i++ % 3], 1);
  f.rest(['fuel', 'greenhouse', 'air']);
  return { alloc: f.alloc, crate: 'food' };
};

/** Never makes fuel: plays it totally safe. */
export const turtle: Strategy = (state) => {
  const b = getBriefing(state);
  const f = filler(b.cells);
  f.give('heaters', b.heaterNeed);
  f.give('shelter', 2);
  f.give('monitor', 1);
  f.rest(['greenhouse', 'air', 'heaters', 'shelter']);
  return { alloc: f.alloc, crate: 'food' };
};

export function playOut(state: MissionState, strategy: Strategy, maxSols = 60): MissionState {
  let s = state;
  let guard = 0;
  while (s.status === 'playing' && guard++ < maxSols) {
    const { alloc, crate } = strategy(s);
    s = runSol(s, alloc, crate).next;
  }
  return s;
}
