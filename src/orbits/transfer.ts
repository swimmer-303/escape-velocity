// Written with AI assistance (Claude Code). See README "Use of AI tools".
// Planet-to-planet trips: one Lambert arc between the real positions of Earth and Mars, with "patched conics" at
// each end (the standard first step in interplanetary mission design, as in NASA's mission design handbooks).
//
//   v-infinity  = the ship's speed relative to the planet, far from the planet's gravity
//   C3          = v-infinity squared (the "launch energy" mission designers quote), km^2/s^2
//   burn from a parking orbit = sqrt(vinf^2 + 2 mu / r) - sqrt(mu / r)   (one burn at the low point)
//   speed from the surface    = sqrt(vinf^2 + v_escape^2)                 (ideal: no air, no gravity losses, no help from spin)
//   entry speed at arrival    = sqrt(vinf^2 + 2 mu / r_entry)              (what a heat shield has to stop)

import { lambert, transferAngleDeg } from './lambert';
import { planetState, type Planet, type State } from './ephemeris';
import { MU_SUN, MARS, EARTH, PARKING, DAY_S } from './constants';
import { norm, sub, type Vec3 } from './vec';

interface Body {
  mu: number;
  radiusKm: number;
  parkAltKm: number;
  entryAltKm: number;
}

/** Entry interface on Mars (only used for Earth-to-Mars trips, never shown in the game): 125 km, a common choice. */
const BODIES: Record<Planet, Body> = {
  earth: { mu: EARTH.mu, radiusKm: EARTH.radiusKm, parkAltKm: PARKING.earthAltKm, entryAltKm: PARKING.earthEntryAltKm },
  mars: { mu: MARS.mu, radiusKm: MARS.radiusKm, parkAltKm: PARKING.marsAltKm, entryAltKm: 125 },
};

/** Escape velocity at a planet's surface, km/s (Mars 5.03, Earth 11.18). */
export const escapeSpeed = (p: Planet) => Math.sqrt((2 * BODIES[p].mu) / BODIES[p].radiusKm);

/** Burn to go from a circular orbit at `altKm` to a hyperbola with excess speed `vinf`, km/s. */
export function burnFromCircular(vinf: number, p: Planet, altKm = BODIES[p].parkAltKm): number {
  const { mu, radiusKm } = BODIES[p];
  const r = radiusKm + altKm;
  return Math.sqrt(vinf * vinf + (2 * mu) / r) - Math.sqrt(mu / r);
}

/** Ideal speed at the surface that leaves the planet with excess speed `vinf`, km/s. */
export const surfaceSpeed = (vinf: number, p: Planet) => Math.hypot(vinf, escapeSpeed(p));

/** Speed at the top of the atmosphere for an arrival with excess speed `vinf`, km/s. */
export function entrySpeed(vinf: number, p: Planet): number {
  const { mu, radiusKm, entryAltKm } = BODIES[p];
  return Math.sqrt(vinf * vinf + (2 * mu) / (radiusKm + entryAltKm));
}

export interface Trip {
  from: Planet;
  to: Planet;
  /** Departure, days since J2000. */
  depart: number;
  /** Time of flight, days. */
  tof: number;
  /** Excess speeds, km/s. */
  vinfDepart: number;
  vinfArrive: number;
  /** Departure C3, km^2/s^2. */
  c3: number;
  /** Burn to leave a low circular orbit at the start planet, km/s. */
  dvDepart: number;
  /** Burn to slow into a low circular orbit at the end planet, km/s. */
  dvArrive: number;
  /** dvDepart + dvArrive, km/s: the porkchop's color. */
  dvTotal: number;
  /** Ideal speed from the start planet's surface, km/s. */
  surfaceSpeed: number;
  /** Speed hitting the end planet's atmosphere, km/s (if the ship skips the braking burn). */
  entrySpeed: number;
  /** Angle travelled around the Sun, degrees. */
  sweepDeg: number;
  /** Type I goes less than halfway round the Sun, Type II more. */
  type: 'I' | 'II';
  /** Heliocentric states at the two ends: planets and ship. */
  start: State;
  end: State;
  shipV1: Vec3;
  shipV2: Vec3;
}

/** One trip, or null when Lambert has no answer (exactly 0 or 180 degrees, or no convergence). */
export function trip(from: Planet, to: Planet, depart: number, tof: number, states?: { start: State; end: State }): Trip | null {
  const start = states?.start ?? planetState(from, depart);
  const end = states?.end ?? planetState(to, depart + tof);
  const sol = lambert(start.r, end.r, tof * DAY_S, MU_SUN, true);
  if (!sol) return null;
  const vinfDepart = norm(sub(sol.v1, start.v));
  const vinfArrive = norm(sub(sol.v2, end.v));
  const dvDepart = burnFromCircular(vinfDepart, from);
  const dvArrive = burnFromCircular(vinfArrive, to);
  const sweepDeg = transferAngleDeg(start.r, end.r);
  return {
    from,
    to,
    depart,
    tof,
    vinfDepart,
    vinfArrive,
    c3: vinfDepart * vinfDepart,
    dvDepart,
    dvArrive,
    dvTotal: dvDepart + dvArrive,
    surfaceSpeed: surfaceSpeed(vinfDepart, from),
    entrySpeed: entrySpeed(vinfArrive, to),
    sweepDeg,
    type: sweepDeg < 180 ? 'I' : 'II',
    start,
    end,
    shipV1: sol.v1,
    shipV2: sol.v2,
  };
}

export type Metric = 'dvTotal' | 'c3' | 'vinfArrive' | 'vinfDepart';

export interface PorkchopSpec {
  from: Planet;
  to: Planet;
  /** First departure, days since J2000. */
  departStart: number;
  /** Departure step, days (a whole number keeps planet states shareable). */
  departStep: number;
  departCount: number;
  tofStart: number;
  tofStep: number;
  tofCount: number;
}

export interface Porkchop extends PorkchopSpec {
  /** Total delta-v, km/s, row-major by trip length: index = tofIndex * departCount + departIndex. NaN = no solution. */
  dvTotal: Float32Array;
  c3: Float32Array;
  vinfArrive: Float32Array;
  /** 1 for Type I, 2 for Type II, 0 for none. */
  type: Uint8Array;
}

/** An empty grid (every cell NaN) to fill with `fillColumns`, a few columns at a time if you like. */
export function emptyPorkchop(spec: PorkchopSpec): Porkchop {
  const n = spec.departCount * spec.tofCount;
  return { ...spec, dvTotal: new Float32Array(n).fill(NaN), c3: new Float32Array(n).fill(NaN), vinfArrive: new Float32Array(n).fill(NaN), type: new Uint8Array(n) };
}

/** Planet states are shared between cells: keyed by the date in hundredths of a day. */
const stateCache = new Map<number, State>();
function cachedState(p: Planet, d: number): State {
  const key = Math.round(d * 100) * 2 + (p === 'mars' ? 1 : 0);
  let s = stateCache.get(key);
  if (!s) {
    if (stateCache.size > 50_000) stateCache.clear();
    stateCache.set(key, (s = planetState(p, d)));
  }
  return s;
}

/** Computes departure columns i0 (inclusive) to i1 (exclusive) of a grid. */
export function fillColumns(p: Porkchop, i0: number, i1: number): void {
  const { from, to, departStart, departStep, departCount, tofStart, tofStep, tofCount } = p;
  for (let i = Math.max(0, i0); i < Math.min(departCount, i1); i++) {
    const dep = departStart + i * departStep;
    const start = cachedState(from, dep);
    for (let j = 0; j < tofCount; j++) {
      const tof = tofStart + j * tofStep;
      const t = trip(from, to, dep, tof, { start, end: cachedState(to, dep + tof) });
      if (!t) continue;
      const k = j * departCount + i;
      p.dvTotal[k] = t.dvTotal;
      p.c3[k] = t.c3;
      p.vinfArrive[k] = t.vinfArrive;
      p.type[k] = t.type === 'I' ? 1 : 2;
    }
  }
}

/** Fills a whole porkchop grid at once. */
export function porkchop(spec: PorkchopSpec): Porkchop {
  const p = emptyPorkchop(spec);
  fillColumns(p, 0, spec.departCount);
  return p;
}

export interface Cell {
  i: number;
  j: number;
  value: number;
}

/** The lowest cell of a grid, optionally only among departures i0..i1 (inclusive). */
export function gridMin(values: Float32Array, p: PorkchopSpec, i0 = 0, i1 = p.departCount - 1, filter?: (k: number) => boolean): Cell | null {
  let best: Cell | null = null;
  for (let j = 0; j < p.tofCount; j++) {
    for (let i = Math.max(0, i0); i <= Math.min(p.departCount - 1, i1); i++) {
      const k = j * p.departCount + i;
      const v = values[k];
      if (Number.isNaN(v) || (filter && !filter(k))) continue;
      if (!best || v < best.value) best = { i, j, value: v };
    }
  }
  return best;
}

/**
 * The cheapest trip of each launch window: for every departure date take the best trip length, then keep the local
 * minima of that curve that sit at least `minGapDays` apart.
 */
export function windowMinima(p: Porkchop, minGapDays = 300): Cell[] {
  const best: Array<Cell | null> = [];
  for (let i = 0; i < p.departCount; i++) best.push(gridMin(p.dvTotal, p, i, i));
  const gap = Math.round(minGapDays / p.departStep);
  const out: Cell[] = [];
  for (let i = 0; i < p.departCount; i++) {
    const c = best[i];
    if (!c) continue;
    let isMin = true;
    for (let d = -gap; d <= gap && isMin; d++) {
      const o = best[i + d];
      if (d !== 0 && o && o.value < c.value) isMin = false;
    }
    // A minimum at the very edge of the grid may just be the slope of a window outside it.
    if (isMin && i > 0 && i < p.departCount - 1) out.push(c);
  }
  return out;
}

/**
 * Polishes a trip by pattern search on (departure, time of flight) in continuous days: starts from a grid cell and
 * halves the step down to `tolDays`. Optionally keeps the trip Type I or Type II.
 */
export function refine(from: Planet, to: Planet, depart: number, tof: number, metric: Metric, opts: { step?: number; tolDays?: number; type?: 'I' | 'II' } = {}): Trip | null {
  const score = (t: Trip | null) => (!t || (opts.type && t.type !== opts.type) ? Infinity : t[metric]);
  let best = trip(from, to, depart, tof);
  let bestScore = score(best);
  if (!best || !Number.isFinite(bestScore)) return null;
  let step = opts.step ?? 4;
  const tol = opts.tolDays ?? 0.01;
  while (step >= tol) {
    let moved = false;
    for (const [dd, dt] of [
      [step, 0],
      [-step, 0],
      [0, step],
      [0, -step],
      [step, -step],
      [-step, step],
    ]) {
      const t = trip(from, to, best!.depart + dd, best!.tof + dt);
      const s = score(t);
      if (s < bestScore) {
        best = t;
        bestScore = s;
        moved = true;
      }
    }
    if (!moved) step /= 2;
  }
  return best;
}

/**
 * The cheapest trip (lowest total speed change) of every launch window whose best departure falls between two
 * dates. A coarse grid finds each window, then `refine` polishes it to a hundredth of a day.
 */
export function bestTrips(from: Planet, to: Planet, startDay: number, endDay: number): Trip[] {
  const margin = 200; // so a window near either end is still seen as a dip, not a slope
  const grid = porkchop({
    from,
    to,
    departStart: Math.floor(startDay - margin),
    departStep: 5,
    departCount: Math.ceil((endDay - startDay + 2 * margin) / 5) + 1,
    tofStart: 100,
    tofStep: 10,
    tofCount: 36,
  });
  const out: Trip[] = [];
  for (const w of windowMinima(grid)) {
    const t = refine(from, to, cellDepart(grid, w.i), cellTof(grid, w.j), 'dvTotal');
    if (t && t.depart >= startDay && t.depart <= endDay) out.push(t);
  }
  return out;
}

/** Departure index and trip-length index of a grid cell -> calendar values. */
export const cellDepart = (p: PorkchopSpec, i: number) => p.departStart + i * p.departStep;
export const cellTof = (p: PorkchopSpec, j: number) => p.tofStart + j * p.tofStep;
