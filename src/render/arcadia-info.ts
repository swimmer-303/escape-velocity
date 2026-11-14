// Written with AI assistance (Claude Code). See README "Use of AI tools".
// What the Science Log says about the Arcadia Planitia terrain. Kept free of imports (like gale-info.ts) so the
// log does not pull three.js or the elevation grids into the first download. diorama.test.ts checks these numbers
// against the snapshots, so they cannot drift from the data.

/** Relief across the whole Arcadia snapshot, meters: range.max - range.min in src/data/snapshots/arcadia-terrain.json. */
export const ARCADIA_RELIEF_M = 426;
/** The same for Gale Crater (gale-terrain.json): crater floor to Mount Sharp's upper slopes. */
export const GALE_RELIEF_M = 5511;
/** The base site's elevation, meters (center.elevationM in arcadia-terrain.json). */
export const ARCADIA_ELEVATION_M = -4008;
/** Curiosity's landing site, meters (center.elevationM in gale-terrain.json). */
export const GALE_ELEVATION_M = -4501;
