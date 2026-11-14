// Written with AI assistance (Claude Code). See README "Use of AI tools".
// Real Gale Crater ground for the Mars diorama. The heights come from NASA Mars Trek's
// "MGS MOLA and Mars Express HRSC, DEM" (blended, 200 m/pixel), snapshotted by
// scripts/fetch-terrain.mjs into src/data/snapshots/gale-terrain.json. The base sits on
// Curiosity's landing site (Bradbury Landing), so Mount Sharp rises to the south-east and the
// crater wall to the north and west, where they really are.
//
// How the real landscape is fitted into a toy-sized diorama (and said so in the Science Log):
// - Horizontal: 1 scene unit = 1 km of Mars. The buildings are not to scale (a habitat is a few
//   units wide), so the landscape is compressed hundreds of times compared with the base.
// - Vertical: heights are exaggerated (x1.5, GALE_EXAGGERATION in gale-info.ts) relative to that horizontal scale.
// - The ground within REAL_FROM units of the base is the old made-up pad (flat for the buildings);
//   real heights fade in between REAL_FROM and REAL_FULL, so the orbiting camera never sits
//   inside Mount Sharp. Only height differences from the landing site are used.
// - Orientation: north is +z and east is -x. Seen from above that is the real map turned 180 degrees
//   (not mirrored), which puts Mount Sharp straight ahead in the opening camera view.

import { MathUtils } from 'three';
import galeData from '../data/snapshots/gale-terrain.json';
import { GALE_EXAGGERATION, GALE_UNITS_PER_KM } from './gale-info';

interface GaleSnapshot {
  center: { elevationM: number };
  size: { cols: number; rows: number };
  spacingKm: { northSouth: number; eastWest: number };
  heights: number[];
}

const DATA = galeData as GaleSnapshot;

/** Scene units per kilometer of real Mars, horizontally. */
export const UNITS_PER_KM = GALE_UNITS_PER_KM;
/** Vertical exaggeration relative to the horizontal scale. */
export const EXAGGERATION = GALE_EXAGGERATION;
/** Real heights start fading in here (scene units from the base)... */
export const REAL_FROM = 24;
/** ...and are fully real from here out. */
export const REAL_FULL = 44;
/** Radius of the ground disc, in scene units: the snapshot reaches +-120 km from the base. */
export const GROUND_RADIUS = 118;

const { cols, rows } = DATA.size;
const H = DATA.heights;
const H0 = DATA.center.elevationM;

/** Real elevation (meters, relative to the landing site) at a scene position, bilinear between samples. */
export function galeRelativeMeters(x: number, z: number): number {
  const eastKm = -x / UNITS_PER_KM;
  const northKm = z / UNITS_PER_KM;
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

/** Made-up gentle bumps just outside the base pad (the original diorama ground). */
function bumps(x: number, z: number): number {
  return Math.sin(x * 0.21) * Math.cos(z * 0.17) * 0.6 + Math.sin(x * 0.53 + z * 0.31) * 0.25 + Math.cos(z * 0.6 - x * 0.2) * 0.15;
}

/** Ground height on Mars at a scene position. Exactly 0 on the base pad (within 11 units). */
export function marsHeight(x: number, z: number): number {
  const r = Math.hypot(x, z);
  const real = MathUtils.smoothstep(r, REAL_FROM, REAL_FULL);
  let h = bumps(x, z) * MathUtils.smoothstep(r, 11, 16) * (1 - real);
  if (real > 0) h += real * (galeRelativeMeters(x, z) / 1000) * UNITS_PER_KM * EXAGGERATION;
  return h;
}
