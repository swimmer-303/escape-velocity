// Written with AI assistance (Claude Code). See README "Use of AI tools".
// Arcadia Planitia ground for the Mars diorama (the ice landing site). The heights are real: NASA Mars Trek's
// "MGS MOLA and Mars Express HRSC, DEM" (blended, 200 m/pixel), the same product as Gale Crater, snapshotted by
// `node scripts/fetch-terrain.mjs --site=arcadia` into src/data/snapshots/arcadia-terrain.json, centered on the
// middle of Arcadia Planitia (46.66 N, 192.00 E).
//
// It is fitted into the diorama exactly like Gale Crater (gale.ts), at the same scale, so the two can be compared:
// 1 scene unit = 1 km horizontally, heights exaggerated x1.5, the base pad flat, real heights fading in from
// REAL_FROM to REAL_FULL units, north = +z and east = -x. Arcadia really is that flat: the whole 240 km snapshot
// varies by only a few hundred meters (Gale Crater: over 5 km, with Mount Sharp).
//
// The frost patches are made up for the look (where they fall is not data). They stand for the thin winter
// frost that NASA's Viking 2 lander photographed on another northern plain, Utopia Planitia, in 1979.

import { MathUtils } from 'three';
import arcadiaData from '../data/snapshots/arcadia-terrain.json';
import { GALE_EXAGGERATION, GALE_UNITS_PER_KM } from './gale-info';

interface TerrainSnapshot {
  center: { elevationM: number };
  size: { cols: number; rows: number };
  spacingKm: { northSouth: number; eastWest: number };
  heights: number[];
}

const DATA = arcadiaData as TerrainSnapshot;

/** Same scale as Gale Crater, so the two landscapes can be compared fairly. */
export const ARCADIA_UNITS_PER_KM = GALE_UNITS_PER_KM;
export const ARCADIA_EXAGGERATION = GALE_EXAGGERATION;
const REAL_FROM = 24;
const REAL_FULL = 44;

const { cols, rows } = DATA.size;
const H = DATA.heights;
const H0 = DATA.center.elevationM;

/** Real elevation (meters, relative to the base site) at a scene position, bilinear between samples. */
export function arcadiaRelativeMeters(x: number, z: number): number {
  const eastKm = -x / ARCADIA_UNITS_PER_KM;
  const northKm = z / ARCADIA_UNITS_PER_KM;
  const c = MathUtils.clamp(eastKm / DATA.spacingKm.eastWest + (cols - 1) / 2, 0, cols - 1);
  const r = MathUtils.clamp((rows - 1) / 2 - northKm / DATA.spacingKm.northSouth, 0, rows - 1);
  const c0 = Math.min(cols - 2, Math.floor(c));
  const r0 = Math.min(rows - 2, Math.floor(r));
  const fc = c - c0;
  const fr = r - r0;
  const at = (rr: number, cc: number) => H[rr * cols + cc];
  const top = at(r0, c0) * (1 - fc) + at(r0, c0 + 1) * fc;
  const bottom = at(r0 + 1, c0) * (1 - fc) + at(r0 + 1, c0 + 1) * fc;
  return top * (1 - fr) + bottom * fr - H0;
}

/** Made-up, very gentle ripples just outside the base pad (smaller than Gale's: these are smooth plains). */
function ripples(x: number, z: number): number {
  return Math.sin(x * 0.17) * Math.cos(z * 0.13) * 0.22 + Math.sin(x * 0.41 + z * 0.29) * 0.08;
}

/** Ground height at Arcadia at a scene position. Exactly 0 on the base pad (within 11 units). */
export function arcadiaHeight(x: number, z: number): number {
  const r = Math.hypot(x, z);
  const real = MathUtils.smoothstep(r, REAL_FROM, REAL_FULL);
  let h = ripples(x, z) * MathUtils.smoothstep(r, 11, 16) * (1 - real);
  if (real > 0) h += real * (arcadiaRelativeMeters(x, z) / 1000) * ARCADIA_UNITS_PER_KM * ARCADIA_EXAGGERATION;
  return h;
}

/** How frosty the ground looks here, 0..1 (made-up patches for the look; none on the base pad). */
export function frostAmount(x: number, z: number): number {
  const r = Math.hypot(x, z);
  if (r < 12) return 0;
  const n = Math.sin(x * 0.23 + 1.7) * Math.cos(z * 0.19 - 0.4) + 0.6 * Math.sin(x * 0.07 - z * 0.11 + 2.1);
  return MathUtils.clamp((n - 0.35) * 1.6, 0, 1) * MathUtils.smoothstep(r, 12, 18);
}
