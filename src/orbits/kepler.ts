// Written with AI assistance (Claude Code). See README "Use of AI tools".
// Two-body motion with universal variables and Stumpff functions
// (H. D. Curtis, Orbital Mechanics for Engineering Students, Algorithms 3.3 and 3.4).
// Used to draw the transfer orbit and, in the tests, to fly a Lambert solution forward and check it lands on target.

import { add, dot, norm, scale, type Vec3 } from './vec';

/** Stumpff function S(z), with a series near z = 0 so it never loses precision. */
export function stumpffS(z: number): number {
  if (Math.abs(z) < 1e-3) return 1 / 6 - z / 120 + (z * z) / 5040 - (z * z * z) / 362880;
  if (z > 0) {
    const s = Math.sqrt(z);
    return (s - Math.sin(s)) / (s * s * s);
  }
  const s = Math.sqrt(-z);
  return (Math.sinh(s) - s) / (s * s * s);
}

/** Stumpff function C(z). */
export function stumpffC(z: number): number {
  if (Math.abs(z) < 1e-3) return 1 / 2 - z / 24 + (z * z) / 720 - (z * z * z) / 40320;
  if (z > 0) return (1 - Math.cos(Math.sqrt(z))) / z;
  return (Math.cosh(Math.sqrt(-z)) - 1) / -z;
}

/**
 * Where a body is after `dt` seconds, starting at r0 (km) with velocity v0 (km/s), around a body with GM `mu`.
 * Solves the universal Kepler equation for chi by Newton's method, then applies the Lagrange f and g coefficients.
 */
export function propagate(r0: Vec3, v0: Vec3, dt: number, mu: number): { r: Vec3; v: Vec3 } {
  if (dt === 0) return { r: [...r0] as Vec3, v: [...v0] as Vec3 };
  const sqmu = Math.sqrt(mu);
  const r0n = norm(r0);
  const vr0 = dot(r0, v0) / r0n;
  const alpha = 2 / r0n - dot(v0, v0) / mu; // 1/a
  // F(chi) = sqrt(mu) * (t(chi) - dt). F increases with chi (dF/dchi = r > 0), so we can bracket the root and
  // fall back to bisection whenever a Newton step would leave the bracket: this never diverges.
  const F = (chi: number) => {
    const z = alpha * chi * chi;
    return ((r0n * vr0) / sqmu) * chi * chi * stumpffC(z) + (1 - alpha * r0n) * chi * chi * chi * stumpffS(z) + r0n * chi - sqmu * dt;
  };
  const dF = (chi: number) => {
    const z = alpha * chi * chi;
    return ((r0n * vr0) / sqmu) * chi * (1 - z * stumpffS(z)) + (1 - alpha * r0n) * chi * chi * stumpffC(z) + r0n;
  };
  const dir = dt > 0 ? 1 : -1;
  let lo = 0;
  let hi = dir * Math.max(1e-6, sqmu * Math.abs(alpha) * Math.abs(dt), Math.abs(sqmu * dt) / r0n);
  for (let i = 0; i < 200; i++) {
    const v = F(hi);
    if (Number.isNaN(v) || Math.sign(v) === dir || !Number.isFinite(v)) break;
    lo = hi;
    hi *= 2;
  }
  if (lo > hi) [lo, hi] = [hi, lo];
  let chi = sqmu * Math.abs(alpha) * dt;
  if (!(chi > lo && chi < hi)) chi = (lo + hi) / 2;
  for (let i = 0; i < 200; i++) {
    const f = F(chi);
    // An overflow means chi is far beyond the root, on the side we are heading.
    if (!Number.isFinite(f)) {
      if (dir > 0) hi = chi;
      else lo = chi;
      chi = (lo + hi) / 2;
      continue;
    }
    if (f > 0) hi = chi;
    else lo = chi;
    let next = chi - f / dF(chi);
    if (!(next > lo && next < hi)) next = (lo + hi) / 2;
    if (Math.abs(next - chi) <= 1e-13 * Math.max(1, Math.abs(chi)) || hi - lo <= 1e-13 * Math.max(1, Math.abs(chi))) {
      chi = next;
      break;
    }
    chi = next;
  }
  const z = alpha * chi * chi;
  const C = stumpffC(z);
  const S = stumpffS(z);
  const f = 1 - ((chi * chi) / r0n) * C;
  const g = dt - ((chi * chi * chi) / sqmu) * S;
  const r = add(scale(r0, f), scale(v0, g));
  const rn = norm(r);
  const fdot = (sqmu / (rn * r0n)) * (z * S - 1) * chi;
  const gdot = 1 - ((chi * chi) / rn) * C;
  return { r, v: add(scale(r0, fdot), scale(v0, gdot)) };
}

/** Specific orbital energy, km^2/s^2 (negative for a closed orbit). */
export const energy = (r: Vec3, v: Vec3, mu: number) => dot(v, v) / 2 - mu / norm(r);
