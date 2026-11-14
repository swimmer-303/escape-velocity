// Written with AI assistance (Claude Code). See README "Use of AI tools".
// The Lambert solver against textbook answers, plus physics it must obey for any input.

import { describe, it, expect } from 'vitest';
import { lambert, transferAngleDeg } from './lambert';
import { propagate, energy, stumpffC, stumpffS } from './kepler';
import { cross, norm, sub, type Vec3 } from './vec';

const MU_EARTH_CURTIS = 398_600; // the value Curtis uses
const MU_EARTH = 398_600.4418;

function expectVec(got: Vec3, want: number[], tol: number) {
  for (let k = 0; k < 3; k++) expect(Math.abs(got[k] - want[k])).toBeLessThan(tol);
}

describe('Lambert solver: textbook cases', () => {
  it('Curtis, Orbital Mechanics for Engineering Students, Example 5.2', () => {
    // r1 = (5000, 10000, 2100) km, r2 = (-14600, 2500, 7000) km, 1 hour, prograde.
    // Book answer: v1 = (-5.9925, 1.9254, 3.2456) km/s, v2 = (-3.3125, -4.1966, -0.38529) km/s.
    const s = lambert([5000, 10000, 2100], [-14600, 2500, 7000], 3600, MU_EARTH_CURTIS)!;
    expectVec(s.v1, [-5.9925, 1.9254, 3.2456], 1e-4);
    expectVec(s.v2, [-3.3125, -4.1966, -0.38529], 1e-4);
  });

  it('Vallado, Fundamentals of Astrodynamics and Applications, Example 7-5 (as used in the poliastro docs)', () => {
    // r1 = (15945.34, 0, 0) km, r2 = (12214.83399, 10249.46731, 0) km, 76 minutes.
    // Expected v1 = (2.058925, 2.915956, 0), v2 = (-3.451569, 0.910301, 0) km/s (rounded in the source: 2e-5 tolerance).
    const s = lambert([15945.34, 0, 0], [12214.83399, 10249.46731, 0], 76 * 60, MU_EARTH)!;
    expectVec(s.v1, [2.058925, 2.915956, 0], 2e-5);
    expectVec(s.v2, [-3.451569, 0.910301, 0], 2e-5);
  });

  it('a 3D zero-revolution case from the poliastro documentation (Izzo vs. reference to 1e-8)', () => {
    const s = lambert([22592.145603, -1599.915239, -19783.950506], [1922.067697, 4054.157051, -8925.727465], 10 * 3600, MU_EARTH)!;
    expectVec(s.v1, [2.000652697, 0.387688615, -2.66694776], 1e-8);
    expectVec(s.v2, [-3.79246619, -1.77707641, 6.856814395], 1e-8);
  });
});

describe('Lambert solver: physics checks', () => {
  // A spread of geometries: short and long ways round, near-parabolic, hyperbolic, different planes.
  const cases: Array<{ r1: Vec3; r2: Vec3; tof: number }> = [];
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  for (let n = 0; n < 60; n++) {
    const r1: Vec3 = [7000 + 30000 * Math.abs(rnd()), 20000 * rnd(), 8000 * rnd()];
    const r2: Vec3 = [30000 * rnd(), 7000 + 30000 * Math.abs(rnd()), 8000 * rnd()];
    cases.push({ r1, r2, tof: 600 + 80000 * Math.abs(rnd()) });
  }

  it('flying the answer forward lands on the target at the right time (universal-variable propagation)', () => {
    for (const { r1, r2, tof } of cases) {
      const s = lambert(r1, r2, tof, MU_EARTH);
      expect(s).not.toBeNull();
      const end = propagate(r1, s!.v1, tof, MU_EARTH);
      expect(norm(sub(end.r, r2)) / norm(r2)).toBeLessThan(1e-8);
      expect(norm(sub(end.v, s!.v2))).toBeLessThan(1e-7);
    }
  });

  it('energy and angular momentum are the same at both ends, and the path is prograde', () => {
    for (const { r1, r2, tof } of cases) {
      const s = lambert(r1, r2, tof, MU_EARTH)!;
      const e1 = energy(r1, s.v1, MU_EARTH);
      const e2 = energy(r2, s.v2, MU_EARTH);
      expect(Math.abs(e1 - e2)).toBeLessThan(1e-9 * Math.max(1, Math.abs(e1)));
      const h1 = cross(r1, s.v1);
      const h2 = cross(r2, s.v2);
      expect(norm(sub(h1, h2)) / norm(h1)).toBeLessThan(1e-10);
      expect(h1[2]).toBeGreaterThan(0); // counterclockwise seen from +z
    }
  });

  it('retrograde is the mirror path', () => {
    const r1: Vec3 = [10000, 0, 0];
    const r2: Vec3 = [0, 12000, 0];
    const pro = lambert(r1, r2, 7200, MU_EARTH)!;
    const retro = lambert(r1, r2, 7200, MU_EARTH, false)!;
    expect(cross(r1, pro.v1)[2]).toBeGreaterThan(0);
    expect(cross(r1, retro.v1)[2]).toBeLessThan(0);
    expect(transferAngleDeg(r1, r2)).toBeCloseTo(90, 9);
    expect(transferAngleDeg(r2, r1)).toBeCloseTo(270, 9);
  });

  it('refuses impossible input instead of returning nonsense', () => {
    expect(lambert([7000, 0, 0], [-9000, 0, 0], 3600, MU_EARTH)).toBeNull(); // exactly 180 degrees: no unique plane
    expect(lambert([7000, 0, 0], [0, 7000, 0], 0, MU_EARTH)).toBeNull();
    expect(lambert([7000, 0, 0], [7000, 0, 0], 3600, MU_EARTH)).toBeNull();
  });

  it('Stumpff functions match their series at zero and stay continuous across it', () => {
    expect(stumpffS(0)).toBeCloseTo(1 / 6, 12);
    expect(stumpffC(0)).toBeCloseTo(1 / 2, 12);
    for (const z of [1e-3, -1e-3]) {
      expect(Math.abs(stumpffS(z * 0.999) - stumpffS(z * 1.001))).toBeLessThan(1e-7);
      expect(Math.abs(stumpffC(z * 0.999) - stumpffC(z * 1.001))).toBeLessThan(1e-7);
    }
    expect(stumpffC(Math.PI ** 2)).toBeCloseTo(2 / Math.PI ** 2, 12); // (1 - cos pi) / pi^2
  });
});
