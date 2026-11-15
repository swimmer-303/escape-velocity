// Written with AI assistance (Claude Code). See README "Use of AI tools".
// Today's science targets: 5 to 8 per site, seeded by the date (Eastern time, like the daily challenge), so everyone
// gets the same set all day and there is a new set tomorrow. Pure functions, no DOM and no three.js: the lobby tile
// counts them, and the drive (./world.ts) settles each one onto the ground nearby.
//
// Arcadia's ice targets follow real data: src/data/snapshots/swim-ice.json holds SWIM 2.0's ice consistency for the
// top meter of ground (product c0_1) along a north-south line through our site. It rises toward the north
// (0.31 at 44 N, 0.52 at 46 N, 0.64 at 48 N), so an ice target is kept with a chance that grows with that value.
// How strongly it leans north is a game choice (CI_FLOOR below); the direction comes from the data.

import swim from '../../data/snapshots/swim-ice.json';
import { easternDate } from '../../daily/protocol';
import { hashString, seeded } from './rng';
import { MARS_SHRINK, type RoverSite } from './sites';
import { kindsAt, RARITIES, sampleKind, type Rarity, type SampleKind } from './samples';

export interface TargetPlan {
  /** Unique for the day and site, e.g. "2026-11-14:gale:3". */
  id: string;
  site: RoverSite;
  kind: string;
  /** Suggested spot, game meters (north is +z, east is -x). The drive nudges it onto drivable ground. */
  x: number;
  z: number;
}

/** Today's date key (YYYY-MM-DD, Eastern time, the same clock as the daily challenge). */
export function todayKey(now: Date = new Date()): string {
  try {
    return easternDate(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

const seedFor = (site: RoverSite, date: string) => seeded(hashString(`rover|${date}|${site}`));

/** How many targets a site has on a date: 5 to 8. */
export function targetCount(site: RoverSite, date: string): number {
  return 5 + Math.floor(seedFor(site, date)() * 4);
}

// ---------------------------------------------------------------- SWIM (Arcadia)
interface SwimPoint {
  lat: number;
  mean: number;
}
const SWIM_PROFILE: SwimPoint[] = ((swim as { profile?: { points?: SwimPoint[] } }).profile?.points ?? [])
  .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.mean))
  .sort((a, b) => a.lat - b.lat);
/** The Arcadia site's latitude (center of the plain, in swim-ice.json and arcadia-terrain.json). */
const ARCADIA_LAT = (swim as { sites?: { arcadia?: { lat?: number } } }).sites?.arcadia?.lat ?? 46.66;
/** Kilometers per degree of latitude on the Mars 2000 sphere (radius 3,396.19 km, as in the terrain snapshots). */
const KM_PER_DEG = (2 * Math.PI * 3396.19) / 360;
/** Below this ice consistency an ice target is never kept; the strongest value on the map is always kept. */
const CI_FLOOR = 0.3;

/** Real latitude of a spot on the Arcadia map (north is +z; 1 game meter = MARS_SHRINK real meters). */
export function arcadiaLatitude(z: number): number {
  return ARCADIA_LAT + (z * MARS_SHRINK) / 1000 / KM_PER_DEG;
}

/** SWIM ice consistency (top 1 m, mean of the profile's boxes) at a latitude, linear between the profile points. */
export function swimIceAt(lat: number): number {
  const p = SWIM_PROFILE;
  if (!p.length) return 0;
  if (lat <= p[0].lat) return p[0].mean;
  for (let i = 1; i < p.length; i++) {
    if (lat <= p[i].lat) {
      const t = (lat - p[i - 1].lat) / (p[i].lat - p[i - 1].lat);
      return p[i - 1].mean + (p[i].mean - p[i - 1].mean) * t;
    }
  }
  return p[p.length - 1].mean;
}

/** The chance (0..1) an ice target is kept at this spot: higher where SWIM shows stronger signs of ice. */
export function iceKeepChance(z: number, maxZ = 700): number {
  const top = Math.max(swimIceAt(arcadiaLatitude(maxZ)), swimIceAt(arcadiaLatitude(-maxZ)));
  const ci = swimIceAt(arcadiaLatitude(z));
  return Math.max(0, Math.min(1, (ci - CI_FLOOR) / Math.max(1e-6, top - CI_FLOOR)));
}

// ---------------------------------------------------------------- the plan
function rollRarity(r: number, legendaryLeft: boolean): Rarity {
  if (r < 0.07 && legendaryLeft) return 'legendary';
  if (r < 0.22) return 'rare';
  if (r < 0.5) return 'uncommon';
  return 'common';
}

function pickKind(site: RoverSite, rarity: Rarity, r: number): SampleKind {
  const all = kindsAt(site);
  // Fall back to the next commoner rarity if a site has none of this one.
  for (let i = RARITIES.indexOf(rarity); i >= 0; i--) {
    const list = all.filter((k) => k.rarity === RARITIES[i]);
    if (list.length) return list[Math.min(list.length - 1, Math.floor(r * list.length))];
  }
  return all[0];
}

/** A compass bearing (radians, 0 = north, east = +90 degrees) and distance to a map spot (north +z, east -x). */
export function spotAt(bearing: number, dist: number): { x: number; z: number } {
  return { x: -Math.sin(bearing) * dist, z: Math.cos(bearing) * dist };
}

/** Today's targets at a site. The same date and site always give the same list. */
export function dailyTargets(site: RoverSite, date: string): TargetPlan[] {
  const rng = seedFor(site, date);
  const count = 5 + Math.floor(rng() * 4);
  const out: TargetPlan[] = [];
  let legendary = false;
  for (let i = 0; i < count; i++) {
    const rarity = rollRarity(rng(), !legendary);
    const kind = pickKind(site, rarity, rng());
    if (kind.rarity === 'legendary') legendary = true;
    let best: { x: number; z: number } | null = null;
    for (let tries = 0; tries < 40; tries++) {
      const dist = kind.dist[0] + rng() * (kind.dist[1] - kind.dist[0]);
      const bearing = kind.place.kind === 'sector' ? kind.place.angle + (rng() * 2 - 1) * kind.place.spread : rng() * Math.PI * 2;
      const spot = spotAt(bearing, dist);
      const keep = kind.place.kind === 'ice' ? rng() < iceKeepChance(spot.z) : true;
      const apart = out.every((t) => Math.hypot(t.x - spot.x, t.z - spot.z) > 90);
      if (!best) best = spot;
      if (keep && apart) {
        best = spot;
        break;
      }
    }
    out.push({ id: `${date}:${site}:${i}`, site, kind: kind.id, x: Math.round(best!.x), z: Math.round(best!.z) });
  }
  return out;
}

/** The rarity of a planned target (common if its kind is unknown). */
export function targetRarity(t: TargetPlan): Rarity {
  return sampleKind(t.kind)?.rarity ?? 'common';
}
