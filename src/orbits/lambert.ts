// Written with AI assistance (Claude Code). See README "Use of AI tools".
// Lambert's problem: which orbit carries you from point r1 to point r2 in exactly `tof` seconds?
//
// Method: D. Izzo, "Revisiting Lambert's problem", Celestial Mechanics and Dynamical Astronomy 121, 1-15 (2015),
// https://doi.org/10.1007/s10569-014-9587-y. Single revolution (zero full laps) only, which is all a
// Mars-Earth porkchop needs. The time-of-flight equation is written in Lancaster-Blanchard form in the variable x,
// solved with Householder's third-order method from Izzo's initial guess (with the corrected guess for
// T1 < T < T0 noted by the poliastro project). Near x = 1 (almost parabolic) it switches to Battin's
// hypergeometric series so the equation never divides by zero.

import { cross, dot, norm, scale, add, type Vec3 } from './vec';

export interface LambertResult {
  /** Velocity needed at r1, km/s. */
  v1: Vec3;
  /** Velocity on arrival at r2, km/s. */
  v2: Vec3;
  /** Householder iterations used. */
  iterations: number;
}

/**
 * Solves Lambert's problem for one revolution or less.
 * @param r1 start position, km
 * @param r2 end position, km
 * @param tof time of flight, s (> 0)
 * @param mu GM of the central body, km^3/s^2
 * @param prograde travel the same way as the planets (counterclockwise seen from ecliptic north)
 * @returns the velocities, or null if the geometry is degenerate or the solver fails to converge
 */
export function lambert(r1: Vec3, r2: Vec3, tof: number, mu: number, prograde = true): LambertResult | null {
  if (!(tof > 0) || !(mu > 0)) return null;
  const r1n = norm(r1);
  const r2n = norm(r2);
  const cvec: Vec3 = [r2[0] - r1[0], r2[1] - r1[1], r2[2] - r1[2]];
  const c = norm(cvec);
  if (!(r1n > 0 && r2n > 0 && c > 0)) return null;
  const s = (r1n + r2n + c) / 2;
  const ir1 = scale(r1, 1 / r1n);
  const ir2 = scale(r2, 1 / r2n);
  const hvec = cross(ir1, ir2);
  const hn = norm(hvec);
  // Exactly 0 or 180 degrees apart: the plane of the orbit is undefined.
  if (hn < 1e-12) return null;
  const ih = scale(hvec, 1 / hn);
  let lam = Math.sqrt(Math.max(0, 1 - c / s));
  let it1: Vec3;
  let it2: Vec3;
  if (ih[2] < 0) {
    // Seen from the north, the short way round is clockwise: the prograde path is the long way (over 180 degrees).
    lam = -lam;
    it1 = cross(ir1, ih);
    it2 = cross(ir2, ih);
  } else {
    it1 = cross(ih, ir1);
    it2 = cross(ih, ir2);
  }
  if (!prograde) {
    lam = -lam;
    it1 = scale(it1, -1);
    it2 = scale(it2, -1);
  }
  const T = Math.sqrt((2 * mu) / (s * s * s)) * tof;
  const sol = findX(lam, T);
  if (!sol) return null;
  const { x, iterations } = sol;
  const y = Math.sqrt(1 - lam * lam * (1 - x * x));

  // Reconstruct the velocities (Izzo 2015, Algorithm 1).
  const gamma = Math.sqrt((mu * s) / 2);
  const rho = (r1n - r2n) / c;
  const sigma = Math.sqrt(Math.max(0, 1 - rho * rho));
  const vr1 = (gamma * (lam * y - x - rho * (lam * y + x))) / r1n;
  const vr2 = (-gamma * (lam * y - x + rho * (lam * y + x))) / r2n;
  const vt = gamma * sigma * (y + lam * x);
  const vt1 = vt / r1n;
  const vt2 = vt / r2n;
  const v1 = add(scale(ir1, vr1), scale(it1, vt1));
  const v2 = add(scale(ir2, vr2), scale(it2, vt2));
  if (!Number.isFinite(v1[0] + v1[1] + v1[2] + v2[0] + v2[1] + v2[2])) return null;
  return { v1, v2, iterations };
}

/** Battin's hypergeometric function 2F1(3, 1; 5/2; z), as a series (|z| is small where we use it). */
function hyp2f1b(z: number): number {
  if (z >= 1) return Infinity;
  let res = 1;
  let term = 1;
  for (let i = 0; i < 200; i++) {
    term = (((term * (3 + i) * (1 + i)) / (2.5 + i)) * z) / (i + 1);
    const next = res + term;
    if (next === res) return res;
    res = next;
  }
  return res;
}

const computeY = (x: number, lam: number) => Math.sqrt(1 - lam * lam * (1 - x * x));

/** psi: the auxiliary angle of the Lancaster-Blanchard time equation (elliptic or hyperbolic branch). */
function computePsi(x: number, y: number, lam: number): number {
  if (x >= -1 && x < 1) return Math.acos(Math.max(-1, Math.min(1, x * y + lam * (1 - x * x))));
  if (x > 1) return Math.asinh((y - x * lam) * Math.sqrt(x * x - 1));
  return 0;
}

/** Non-dimensional time of flight at x, minus the target T0. */
function tofEquation(x: number, y: number, T0: number, lam: number): number {
  let T: number;
  if (x > Math.sqrt(0.6) && x < Math.sqrt(1.4)) {
    // Near-parabolic: Battin's series form.
    const eta = y - lam * x;
    const S1 = (1 - lam - x * eta) * 0.5;
    const Q = (4 / 3) * hyp2f1b(S1);
    T = (eta * eta * eta * Q + 4 * lam * eta) * 0.5;
  } else {
    const psi = computePsi(x, y, lam);
    T = (psi / Math.sqrt(Math.abs(1 - x * x)) - x + lam * y) / (1 - x * x);
  }
  return T - T0;
}

// Derivatives of the time equation with respect to x (Izzo 2015, eq. 22). l3 = lambda^3, l5 = lambda^5.
const dT1 = (x: number, y: number, T: number, l3: number) => (3 * T * x - 2 + (2 * l3 * x) / y) / (1 - x * x);
const dT2 = (x: number, y: number, T: number, d1: number, lam: number, l3: number) => (3 * T + 5 * x * d1 + (2 * (1 - lam * lam) * l3) / (y * y * y)) / (1 - x * x);
const dT3 = (x: number, y: number, d1: number, d2: number, lam: number, l5: number) => (7 * x * d2 + 8 * d1 - (6 * (1 - lam * lam) * l5 * x) / (y * y * y * y * y)) / (1 - x * x);

/** Finds x for the zero-revolution solution: Izzo's initial guess, then Householder iterations. */
function findX(lam: number, T: number): { x: number; iterations: number } | null {
  const l3 = lam * lam * lam;
  const l5 = l3 * lam * lam;
  const T00 = Math.acos(lam) + lam * Math.sqrt(1 - lam * lam); // T at x = 0 (zero revolutions)
  const T1 = (2 / 3) * (1 - l3); // T at x = 1 (parabolic)
  let x0: number;
  if (T >= T00) x0 = Math.pow(T00 / T, 2 / 3) - 1;
  else if (T <= T1) x0 = ((2.5 * T1) / T) * ((T1 - T) / (1 - l5)) + 1;
  else x0 = Math.exp((Math.log(2) * Math.log(T / T00)) / Math.log(T1 / T00)) - 1;

  let x = x0;
  for (let i = 1; i <= 35; i++) {
    const y = computeY(x, lam);
    const f = tofEquation(x, y, T, lam);
    const Tx = f + T;
    const d1 = dT1(x, y, Tx, l3);
    const d2 = dT2(x, y, Tx, d1, lam, l3);
    const d3 = dT3(x, y, d1, d2, lam, l5);
    const next = x - f * ((d1 * d1 - (f * d2) / 2) / (d1 * (d1 * d1 - f * d2) + (d3 * f * f) / 6));
    if (!Number.isFinite(next)) return null;
    if (Math.abs(next - x) < 1e-11) return { x: next, iterations: i };
    x = next;
  }
  return null;
}

/** Angular momentum per unit mass, km^2/s (the same at both ends of any two-body orbit). */
export const angularMomentum = (r: Vec3, v: Vec3) => cross(r, v);
/** Angle travelled around the Sun from r1 to r2 along a prograde path, degrees 0..360 (Type I below 180, Type II above). */
export function transferAngleDeg(r1: Vec3, r2: Vec3): number {
  const cosT = dot(r1, r2) / (norm(r1) * norm(r2));
  const ang = (Math.acos(Math.max(-1, Math.min(1, cosT))) * 180) / Math.PI;
  return cross(r1, r2)[2] >= 0 ? ang : 360 - ang;
}
