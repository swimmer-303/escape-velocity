// Written with AI assistance (Claude Code). See README "Use of AI tools".
// The Space weather radar's simple model (pure, no DOM): real DONKI CMEs flying out through the real solar system.
//
// Simple model: constant speed. Each CME is a cone from the Sun along its analyzed direction (DONKI's most
// accurate analysis: longitude, latitude, half-angle). Its front was at 21.5 solar radii at time21_5 and keeps
// DONKI's measured speed after that. Real CMEs speed up or slow down in the solar wind, so every "reached" time
// here is an ESTIMATE. NASA's own physics-based model runs (WSA-ENLIL, listed in NASA's DONKI database) are
// shown next to it whenever DONKI lists one.
// Earth and Mars are at their real positions from JPL's approximate orbital elements (src/data/lighttime.ts).

import type { DonkiCme, DonkiEnlil, DonkiSnapshot } from '../data/donki-normalize';
import { heliocentric, type Planet } from '../data/lighttime';
import { AU_KM, R21_5_AU, angleBetween, planeHalfWidth, stonyhurstToEcliptic } from './geometry';

export const DAY_MS = 86_400_000;

export interface ModelReach {
  /** When the CME's front reached this planet's distance from the Sun (estimate, ms since 1970). */
  atMs: number;
  /** Angle between the cone's center line and the planet at that moment, degrees. */
  offsetDeg: number;
  /** True if the planet was inside the cone when the front reached its distance (estimate). */
  inside: boolean;
}

export interface RadarCme {
  id: string;
  link: string | null;
  /** DONKI startTime (first seen), ms. */
  startMs: number;
  /** DONKI time21_5, ms: the model starts here. */
  t21Ms: number;
  /** km/s, from DONKI's most accurate analysis. */
  speed: number;
  /** DONKI's Stonyhurst direction, degrees (+ = west of Earth). */
  stonyLon: number;
  stonyLat: number;
  halfAngle: number;
  /** Center line in heliocentric ecliptic coordinates, degrees. */
  axisLon: number;
  axisLat: number;
  /** Half-width where the cone crosses the planets' plane (degrees), or null if it passes above or below it. */
  planeHalfWidth: number | null;
  earth: ModelReach;
  mars: ModelReach;
  enlil: DonkiEnlil | null;
}

export interface UndirectedCme {
  id: string;
  startMs: number;
  speed: number | null;
  link: string | null;
}

export interface RadarData {
  /** The data window: the first and last moment the CME list covers. */
  startMs: number;
  endMs: number;
  /** CMEs with a measured direction, in launch order. */
  cmes: RadarCme[];
  /** CMEs DONKI lists without a direction (e.g. measured only in the plane of the sky). Not drawn. */
  undirected: UndirectedCme[];
  total: number;
}

const parse = (t: string | null | undefined) => {
  const ms = t ? Date.parse(t) : NaN;
  return Number.isFinite(ms) ? ms : null;
};

/** Distance of a CME's front from the Sun at time `ms`, AU (simple model: constant speed). Negative = not launched yet. */
export function frontAU(c: Pick<RadarCme, 't21Ms' | 'speed'>, ms: number): number {
  return R21_5_AU + (c.speed * (ms - c.t21Ms)) / 1000 / AU_KM;
}

/** When the front was (or will be) `rAU` from the Sun. */
export function timeAtAU(c: Pick<RadarCme, 't21Ms' | 'speed'>, rAU: number): number {
  return c.t21Ms + (((rAU - R21_5_AU) * AU_KM) / c.speed) * 1000;
}

/** When the front reached the planet's (changing) distance, and whether the planet sat inside the cone then. */
export function reach(c: Pick<RadarCme, 't21Ms' | 'speed' | 'axisLon' | 'axisLat' | 'halfAngle'>, planet: Planet): ModelReach {
  let at = timeAtAU(c, heliocentric(planet, c.t21Ms).rAU);
  for (let i = 0; i < 3; i++) at = timeAtAU(c, heliocentric(planet, at).rAU);
  const offsetDeg = angleBetween(c.axisLon, c.axisLat, heliocentric(planet, at).lonDeg, 0);
  return { atMs: at, offsetDeg, inside: offsetDeg <= c.halfAngle };
}

/** One normalized DONKI CME on the radar, or null if DONKI gives it no usable direction, speed or time. */
export function toRadarCme(c: DonkiCme): RadarCme | null {
  const startMs = parse(c.startTime);
  const t21Ms = parse(c.time21_5);
  const { speed, longitude, latitude, halfAngle } = c;
  if (startMs == null || t21Ms == null || speed == null || !(speed > 0) || longitude == null || latitude == null || halfAngle == null || !(halfAngle > 0)) return null;
  // Earth's position when the CME passed 21.5 solar radii: the moment DONKI's direction refers to.
  const earthLon = heliocentric('earth', t21Ms).lonDeg;
  const axis = stonyhurstToEcliptic(longitude, latitude, earthLon, t21Ms);
  const base = { t21Ms, speed, axisLon: axis.lonDeg, axisLat: axis.latDeg, halfAngle };
  return {
    id: c.id,
    link: c.link,
    startMs,
    t21Ms,
    speed,
    stonyLon: longitude,
    stonyLat: latitude,
    halfAngle,
    axisLon: axis.lonDeg,
    axisLat: axis.latDeg,
    planeHalfWidth: planeHalfWidth(axis.latDeg, halfAngle),
    earth: reach(base, 'earth'),
    mars: reach(base, 'mars'),
    enlil: c.enlil ?? null,
  };
}

/** The data window a snapshot covers: its start date to the end of its end date, or when it was fetched if sooner. */
export function snapshotWindow(snap: Pick<DonkiSnapshot, 'startDate' | 'endDate' | 'fetchedAt'>): { startMs: number; endMs: number } {
  const startMs = Date.parse(`${snap.startDate}T00:00:00Z`);
  const endOfDay = Date.parse(`${snap.endDate}T00:00:00Z`) + DAY_MS;
  const fetched = Date.parse(snap.fetchedAt);
  const endMs = Number.isFinite(fetched) && fetched > startMs ? Math.min(endOfDay, fetched) : endOfDay;
  return { startMs, endMs };
}

/** True when this snapshot really asked DONKI for CMEs with directions (so an empty list means "none"). */
export function hasCmeDirections(snap: DonkiSnapshot | null | undefined): snap is DonkiSnapshot {
  if (!snap) return false;
  if (snap.included) return snap.included.includes('CME');
  // Older snapshots don't say what they fetched: trust them only if their CMEs carry the radar fields.
  return snap.cmes.length > 0 && snap.cmes.every((c) => 'time21_5' in c);
}

export function buildRadar(snap: DonkiSnapshot): RadarData {
  const { startMs, endMs } = snapshotWindow(snap);
  const cmes: RadarCme[] = [];
  const undirected: UndirectedCme[] = [];
  for (const c of snap.cmes) {
    const r = toRadarCme(c);
    if (r) cmes.push(r);
    else {
      const s = parse(c.startTime);
      if (s != null) undirected.push({ id: c.id, startMs: s, speed: c.speed, link: c.link });
    }
  }
  cmes.sort((a, b) => a.startMs - b.startMs);
  undirected.sort((a, b) => a.startMs - b.startMs);
  return { startMs, endMs, cmes, undirected, total: snap.cmes.length };
}

/** CMEs whose front is between the Sun and `maxAU` at time `ms`. */
export function inFlight(data: RadarData, ms: number, maxAU: number): RadarCme[] {
  return data.cmes.filter((c) => {
    const r = frontAU(c, ms);
    return r > 0 && r <= maxAU;
  });
}

export interface RadarCounts {
  total: number;
  directed: number;
  /** Our simple model: front reached the planet's distance with the planet inside the cone, within the window. */
  modelEarth: number;
  modelMars: number;
  /** Same, but the front gets there after the window ends (still on its way). */
  modelMarsLater: number;
  modelEarthLater: number;
  /** NASA's ENLIL model predicted an arrival. */
  enlilEarth: number;
  enlilMars: number;
  fastest: RadarCme | null;
}

export function countRadar(data: RadarData): RadarCounts {
  const cs = data.cmes;
  const hit = (p: 'earth' | 'mars', later: boolean) => cs.filter((c) => c[p].inside && (later ? c[p].atMs > data.endMs : c[p].atMs <= data.endMs)).length;
  let fastest: RadarCme | null = null;
  for (const c of cs) if (!fastest || c.speed > fastest.speed) fastest = c;
  return {
    total: data.total,
    directed: cs.length,
    modelEarth: hit('earth', false),
    modelMars: hit('mars', false),
    modelEarthLater: hit('earth', true),
    modelMarsLater: hit('mars', true),
    enlilEarth: cs.filter((c) => c.enlil?.earth).length,
    enlilMars: cs.filter((c) => c.enlil?.mars).length,
    fastest,
  };
}

/** True when nothing in this window was headed for Mars, by our model or by NASA's. */
export function calmForMars(n: RadarCounts): boolean {
  return n.modelMars + n.modelMarsLater + n.enlilMars === 0;
}

/** Speed groups for the radar's legend (km/s). */
export const SPEED_BANDS = [
  { id: 'slow', min: 0, label: 'Slow', range: 'under 500 km/s' },
  { id: 'medium', min: 500, label: 'Medium', range: '500 to 999 km/s' },
  { id: 'fast', min: 1000, label: 'Fast', range: '1,000 to 1,999 km/s' },
  { id: 'extreme', min: 2000, label: 'Extreme', range: '2,000 km/s or more' },
] as const;
export type SpeedBand = (typeof SPEED_BANDS)[number]['id'];

export function speedBand(kms: number): SpeedBand {
  let band: SpeedBand = 'slow';
  for (const b of SPEED_BANDS) if (kms >= b.min) band = b.id;
  return band;
}
