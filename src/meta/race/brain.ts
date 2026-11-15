// Written with AI assistance (Claude Code). See README "Use of AI tools".
// How an AI rival commander plays one sol. Every rival is one of the game's scripted players (the "Suggest a plan"
// advisor, the balanced player, the builder) or a racer built from the same rules, plus a "slip": now and then a
// rival puts a cell or two somewhere slow instead of into fuel. Lower leagues slip more, so their rivals are slower.
// Everything here is deterministic: the same race seed, rival and sol always give the same plan.

import { advise } from '../../sim/advisor';
import { balanced, builder, nightStock, type Move } from '../../sim/strategies';
import { airPerCell, foodPerGreenhouseCell, getBriefing, greenhouseAirPerCell, isMoon, moduleCap, runSol, setProject, emptyAlloc } from '../../sim/sim';
import { makeRng } from '../../sim/rng';
import type { Allocation, MissionState, ModuleId } from '../../sim/types';

/**
 * - careful:   the "Suggest a plan" advisor (big safety stock, a little building). Slow and safe.
 * - steady:    the balanced player (heats, keeps about 2 days of air and food, shelters when warned).
 * - builder:   invests spare power in the base for future crews. Slowest, almost never goes home.
 * - racer:     smaller safety stock, shelters when warned, everything else into fuel. Fast.
 * - daredevil: tiny safety stock and never uses the storm shelter. Fastest, but a big storm can send the crew home.
 */
export type Style = 'careful' | 'steady' | 'builder' | 'racer' | 'daredevil';

export interface Brain {
  style: Style;
  /** Chance (0..1) each sol of moving one or two fuel cells somewhere slower. */
  slip: number;
  /** Daredevil only: days of food and air they keep in store (default 0.8). Less is faster, and riskier. */
  stock?: number;
  /** Daredevil only: chance (0..1) each sol of skipping the heaters to rush the rocket. Cold batteries make less power. */
  gamble?: number;
}

function fill(state: MissionState, cells: number) {
  const alloc = emptyAlloc();
  let left = cells;
  const give = (id: ModuleId, n: number) => {
    const k = Math.max(0, Math.min(n, left, moduleCap(state, id) - alloc[id]));
    alloc[id] += k;
    left -= k;
  };
  return { alloc, give, left: () => left };
}

/** Heat, (maybe) shelter, keep `foodDays`/`airDays` of stock, then everything into fuel. */
function stockThenFuel(state: MissionState, opts: { foodDays: number; airDays: number; shelter: boolean; dust?: boolean; skipHeat?: boolean }): Move {
  const b = getBriefing(state);
  const f = fill(state, b.cells);
  if (opts.skipHeat) f.give('fuel', moduleCap(state, 'fuel'));
  f.give('heaters', b.heaterNeed);
  if (opts.shelter && b.warning) f.give('shelter', 2);
  const dust = opts.dust !== false && (b.dustTomorrow || b.weather !== 'clear') ? 1 : 0;
  const night = isMoon(state) ? nightStock(state, 5) : 0;
  const foodNeed = (opts.foodDays + dust + night + 1) * state.crew - state.food;
  f.give('greenhouse', Math.ceil(Math.max(0, foodNeed) / foodPerGreenhouseCell(state)));
  const airNeed = (opts.airDays + dust + night + 1) * state.crew - state.air - f.alloc.greenhouse * greenhouseAirPerCell(state);
  f.give('air', Math.ceil(Math.max(0, airNeed) / airPerCell(state)));
  if (opts.shelter && b.hasMonitor && b.outlook !== 'quiet' && f.left() >= 3) f.give('monitor', 1);
  if (isMoon(state) && b.hasBattery && b.nightIn != null && b.nightIn <= 3 && f.left() >= 2) f.give('battery', 2);
  for (const id of ['fuel', 'greenhouse', 'air', 'heaters', 'shelter'] as ModuleId[]) f.give(id, f.left());
  return { alloc: f.alloc, crate: state.food < 2.5 * state.crew ? 'food' : 'panel' };
}

function baseMove(state: MissionState, brain: Brain, rng: () => number): Move {
  switch (brain.style) {
    case 'careful':
      return { alloc: advise(state).alloc, crate: state.food < 3 * state.crew ? 'food' : 'panel' };
    case 'steady':
      return balanced(state);
    case 'builder':
      return builder(state);
    case 'racer':
      return stockThenFuel(state, { foodDays: 1.2, airDays: 1, shelter: true });
    case 'daredevil':
      return stockThenFuel(state, {
        foodDays: brain.stock ?? 0.8,
        airDays: (brain.stock ?? 0.8) * 0.75,
        shelter: false,
        dust: brain.stock === undefined || brain.stock >= 0.5,
        skipHeat: !!brain.gamble && rng() < brain.gamble,
      });
  }
}

/** Move up to `n` fuel cells to food or air (a slower but harmless choice), if there is room. */
function slipCells(state: MissionState, alloc: Allocation, n: number, toAir: boolean): Allocation {
  const out = { ...alloc };
  const order: ModuleId[] = toAir ? ['air', 'greenhouse'] : ['greenhouse', 'air'];
  let moved = 0;
  for (const id of order) {
    while (moved < n && out.fuel > 0 && out[id] < moduleCap(state, id)) {
      out.fuel--;
      out[id]++;
      moved++;
    }
  }
  return out;
}

/** The plan a rival makes for today. Pure: same inputs, same plan. */
export function rivalMove(state: MissionState, brain: Brain, key: string): Move {
  const rng = makeRng(`${key}|sol${state.sol}`);
  const move = baseMove(state, brain, rng);
  if (brain.slip <= 0 || rng() >= brain.slip) return move;
  return { ...move, alloc: slipCells(state, move.alloc, rng() < 0.5 ? 1 : 2, rng() < 0.5) };
}

/** Play one sol for a rival. Returns the same state if their mission is already over. */
export function stepRival(state: MissionState, brain: Brain, key: string): MissionState {
  if (state.status !== 'playing') return state;
  const move = rivalMove(state, brain, key);
  let s = state;
  if (move.project !== undefined && move.project !== s.base.project) s = setProject(s, move.project);
  try {
    return runSol(s, move.alloc, move.crate).next;
  } catch {
    // A plan the sim rejects (should never happen): fall back to the balanced player so the race goes on.
    const safe = balanced(s);
    return runSol(s, safe.alloc, safe.crate).next;
  }
}

/** Play a rival to the end of their mission (after the player has finished). */
export function finishRival(state: MissionState, brain: Brain, key: string, maxSols = 80): MissionState {
  let s = state;
  for (let i = 0; i < maxSols && s.status === 'playing'; i++) s = stepRival(s, brain, key);
  return s;
}
