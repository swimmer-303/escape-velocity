// Written with AI assistance (Claude Code). See README "Use of AI tools".
// NASA's Subsurface Water Ice Mapping (SWIM) values at the game's two Mars landing sites, from the snapshot
// written by scripts/fetch-swim.mjs. Small (a few kB), so the Science Log and the mission chooser can use it.

import swim from './snapshots/swim-ice.json';

export type SwimProduct = 'c0_1' | 'c1_5' | 'c5';
export type SwimSite = 'arcadia' | 'gale';

export interface SwimValue {
  /** The map pixel holding the site's coordinates. */
  center: number | null;
  /** Over a box of +-windowDeg degrees around the site (no-data pixels skipped). */
  mean: number | null;
  min: number | null;
  max: number | null;
  pixels: number;
}

interface SwimSnapshot {
  source: string;
  sourceUrls: string[];
  paper: { citation: string; doi: string; abstractUrl: string };
  scale: string;
  fetchedAt: string;
  products: Array<{ id: SwimProduct; title: string; depth: string; url: string; lastModified: string | null }>;
  windowDeg: number;
  sites: Record<SwimSite, { name: string; lat: number; lon: number; sourceUrl: string; values: Record<SwimProduct, SwimValue> }>;
  profile: { product: SwimProduct; lonE: number; windowDeg: number; points: Array<SwimValue & { lat: number }> };
}

export const SWIM = swim as SwimSnapshot;

/** The SWIM 2.0 products page (where the maps can be downloaded). */
export const SWIM_PRODUCTS_URL = 'https://swim.psi.edu/SWIM2Products.php';
/** The SWIM overview, which defines "ice consistency". */
export const SWIM_ABOUT_URL = 'https://swim.psi.edu/about.php?section=overview';

/** The map's own value at a site (the pixel holding its coordinates). */
export function swimAt(site: SwimSite, product: SwimProduct = 'c0_1'): number | null {
  return SWIM.sites[site]?.values[product]?.center ?? null;
}

/** "+0.55", "-0.01", or "no data". Two decimals: the maps are coarse, so more would be false precision. */
export function fmtIce(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return 'no data';
  const r = Math.round(v * 100) / 100;
  return `${r > 0 ? '+' : r < 0 ? '-' : ''}${Math.abs(r).toFixed(2)}`;
}

/** The north-south profile along the Arcadia site's longitude: first and last points (box means). */
export function swimProfileEnds() {
  const pts = SWIM.profile.points.filter((p) => p.mean !== null);
  return { south: pts[0], north: pts[pts.length - 1], lonE: SWIM.profile.lonE };
}
