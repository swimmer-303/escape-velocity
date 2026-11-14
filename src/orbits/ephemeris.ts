// Written with AI assistance (Claude Code). See README "Use of AI tools".
// Where Earth and Mars are (and how fast they move) on any date from 1800 to 2050.
//
// Source: JPL Solar System Dynamics, "Approximate Positions of the Planets" (E. M. Standish), Table 1:
// Keplerian elements and their rates with respect to the mean ecliptic and equinox of J2000, valid 1800 AD - 2050 AD.
// https://ssd.jpl.nasa.gov/planets/approx_pos.html
// JPL's stated errors over that span: Earth-Moon barycenter 20" in longitude, 8" in latitude, 6,000 km in distance;
// Mars 40", 2" and 25,000 km. Unlike src/data/lighttime.ts (flat orbits, for the message delay), this uses all six
// elements, so the orbits are tilted correctly in 3D. Our test compares it with JPL Horizons (DE441).
//
// Output is heliocentric, ecliptic J2000, in km and km/s.

import { AU_KM, DAY_S } from './constants';
import type { Vec3 } from './vec';

interface Elements {
  /** semi-major axis, au, and rate per Julian century */
  a: [number, number];
  /** eccentricity */
  e: [number, number];
  /** inclination, deg */
  I: [number, number];
  /** mean longitude, deg */
  L: [number, number];
  /** longitude of perihelion, deg */
  peri: [number, number];
  /** longitude of the ascending node, deg */
  node: [number, number];
}

/** Table 1, "EM Bary" (Earth-Moon barycenter: within ~4,700 km of Earth's center). */
const EARTH_EL: Elements = {
  a: [1.00000261, 0.00000562],
  e: [0.01671123, -0.00004392],
  I: [-0.00001531, -0.01294668],
  L: [100.46457166, 35999.37244981],
  peri: [102.93768193, 0.32327364],
  node: [0.0, 0.0],
};

/** Table 1, "Mars". */
const MARS_EL: Elements = {
  a: [1.52371034, 0.00001847],
  e: [0.0933941, 0.00007882],
  I: [1.84969142, -0.00813131],
  L: [-4.55343205, 19140.30268499],
  peri: [-23.94362959, 0.44441088],
  node: [49.55953891, -0.29257343],
};

export type Planet = 'earth' | 'mars';
const ELEMENTS: Record<Planet, Elements> = { earth: EARTH_EL, mars: MARS_EL };

export interface State {
  /** Position, km. */
  r: Vec3;
  /** Velocity, km/s. */
  v: Vec3;
}

const DEG = Math.PI / 180;
/** J2000.0 = 2000-01-01 12:00 TT. The 69 s between TT and UTC moves a planet about 2,000 km: well inside JPL's stated error, so we ignore it. */
export const J2000_MS = Date.UTC(2000, 0, 1, 12, 0, 0);
const CENTURY_DAYS = 36525;

/** Days since J2000 for a date. */
export const daysSinceJ2000 = (ms: number) => (ms - J2000_MS) / 86_400_000;
/** A date from days since J2000. */
export const msFromJ2000Days = (d: number) => J2000_MS + d * 86_400_000;

/** Kepler's equation E - e sin E = M, by Newton's method (converges in a few steps for e < 0.1). */
export function eccentricAnomaly(M: number, e: number): number {
  let E = M + e * Math.sin(M);
  for (let i = 0; i < 12; i++) {
    const dE = (M - (E - e * Math.sin(E))) / (1 - e * Math.cos(E));
    E += dE;
    if (Math.abs(dE) < 1e-13) break;
  }
  return E;
}

/** Heliocentric ecliptic J2000 position (km) and velocity (km/s) of Earth (Earth-Moon barycenter) or Mars. */
export function planetState(planet: Planet, daysJ2000: number): State {
  const el = ELEMENTS[planet];
  const T = daysJ2000 / CENTURY_DAYS;
  const at = (x: [number, number]) => x[0] + x[1] * T;
  const a = at(el.a) * AU_KM;
  const e = at(el.e);
  const I = at(el.I) * DEG;
  const L = at(el.L);
  const peri = at(el.peri);
  const node = at(el.node) * DEG;
  const w = peri * DEG - node;
  // Mean anomaly, wrapped to -180..180 degrees as JPL's recipe says.
  let Mdeg = (L - peri) % 360;
  if (Mdeg > 180) Mdeg -= 360;
  if (Mdeg < -180) Mdeg += 360;
  const E = eccentricAnomaly(Mdeg * DEG, e);
  const cosE = Math.cos(E);
  const sinE = Math.sin(E);
  const b = Math.sqrt(1 - e * e);
  // In the orbit's own plane, x toward perihelion.
  const xp = a * (cosE - e);
  const yp = a * b * sinE;
  // Velocity: the time derivative of the same model. The mean motion is the fitted rate of the mean anomaly
  // (L dot minus perihelion dot), so positions and velocities agree with each other exactly.
  const n = ((el.L[1] - el.peri[1]) * DEG) / (CENTURY_DAYS * DAY_S); // rad/s
  const Edot = n / (1 - e * cosE);
  const vxp = -a * sinE * Edot;
  const vyp = a * b * cosE * Edot;
  // Rotate to the ecliptic: Rz(-node) Rx(-I) Rz(-w), exactly as on JPL's page.
  const cw = Math.cos(w);
  const sw = Math.sin(w);
  const cO = Math.cos(node);
  const sO = Math.sin(node);
  const cI = Math.cos(I);
  const sI = Math.sin(I);
  const m11 = cw * cO - sw * sO * cI;
  const m12 = -sw * cO - cw * sO * cI;
  const m21 = cw * sO + sw * cO * cI;
  const m22 = -sw * sO + cw * cO * cI;
  const m31 = sw * sI;
  const m32 = cw * sI;
  return {
    r: [m11 * xp + m12 * yp, m21 * xp + m22 * yp, m31 * xp + m32 * yp],
    v: [m11 * vxp + m12 * vyp, m21 * vxp + m22 * vyp, m31 * vxp + m32 * vyp],
  };
}

/** Sidereal orbit period from the rate of the mean longitude, days (Earth 365.26, Mars 686.98). */
export function orbitPeriodDays(planet: Planet): number {
  return (360 / ELEMENTS[planet].L[1]) * CENTURY_DAYS;
}

/** Heliocentric ecliptic longitude of a position, degrees 0..360. */
export function longitudeDeg(r: Vec3): number {
  const d = Math.atan2(r[1], r[0]) / DEG;
  return d < 0 ? d + 360 : d;
}
