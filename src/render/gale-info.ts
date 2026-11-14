// Written with AI assistance (Claude Code). See README "Use of AI tools".
// What the Science Log says about the Gale Crater terrain. Kept free of imports so the log does
// not pull three.js or the elevation grid into the first download. diorama.test.ts checks these
// labels against the snapshot, so they cannot drift from the data.

/** Vertical exaggeration of the real terrain, relative to its horizontal scale. */
export const GALE_EXAGGERATION = 1.5;
/** Scene units per kilometer of real Mars, horizontally (the base buildings are not to scale). */
export const GALE_UNITS_PER_KM = 1;
/** Must match `product` in src/data/snapshots/gale-terrain.json. */
export const GALE_PRODUCT = 'MGS MOLA and Mars Express HRSC, DEM (blended, 200 m/pixel)';
/** Must match `productInfoUrl` in src/data/snapshots/gale-terrain.json. */
export const GALE_PRODUCT_URL = 'https://astrogeology.usgs.gov/search/map/mars_mgs_mola_mex_hrsc_blended_dem_global_200m';
