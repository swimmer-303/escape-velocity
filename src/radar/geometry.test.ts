// Written with AI assistance (Claude Code). See README "Use of AI tools".
// The radar's geometry: real planet positions (checked against JPL Horizons) and DONKI's Stonyhurst
// CME directions turned into directions in the solar system.

import { describe, it, expect } from 'vitest';
import { heliocentric } from '../data/lighttime';
import { angleBetween, planeHalfWidth, stonyhurstToEcliptic, wrap180, R21_5_AU, SOLAR_EQUATOR_TILT } from './geometry';
import { buildRadar } from './model';
import type { DonkiSnapshot } from '../data/donki-normalize';
import recent from '../data/snapshots/donki-recent.json';
import may from '../data/snapshots/donki-may2024.json';

const NOV14 = Date.UTC(2026, 10, 14);
const MAY20 = Date.UTC(2024, 4, 20);

describe('planet positions (JPL approximate elements)', () => {
  // JPL Horizons, heliocentric ecliptic J2000 vectors at 00:00 TDB (fetched 2026-11-14 with the Horizons API:
  // COMMAND=399/499, CENTER=500@10, REF_PLANE=ECLIPTIC). Longitude = atan2(Y, X); distance in AU.
  const horizons = [
    { planet: 'earth', ms: NOV14, lon: 51.25, r: 0.9895 },
    { planet: 'mars', ms: NOV14, lon: 106.56, r: 1.6078 },
    { planet: 'earth', ms: MAY20, lon: 239.14, r: 1.0119 },
    { planet: 'mars', ms: MAY20, lon: 343.51, r: 1.3825 },
  ] as const;
  for (const ref of horizons) {
    it(`${ref.planet} on ${new Date(ref.ms).toISOString().slice(0, 10)} matches JPL Horizons`, () => {
      const p = heliocentric(ref.planet, ref.ms);
      expect(Math.abs(wrap180(p.lonDeg - ref.lon))).toBeLessThan(0.5);
      expect(Math.abs(p.rAU - ref.r)).toBeLessThan(0.01);
    });
  }
});

describe('Stonyhurst (DONKI) to heliocentric ecliptic', () => {
  const earth = heliocentric('earth', NOV14).lonDeg;
  const conv = (lon: number, lat = 0) => stonyhurstToEcliptic(lon, lat, earth, NOV14);

  it('longitude 0 points at Earth', () => {
    const d = conv(0);
    expect(Math.abs(wrap180(d.lonDeg - earth))).toBeLessThan(0.5);
    // Earth sits a few degrees off the Sun's equator (never more than the 7.25-degree tilt).
    expect(Math.abs(d.latDeg)).toBeLessThanOrEqual(SOLAR_EQUATOR_TILT + 0.01);
  });

  it('west is ahead of Earth in its orbit, east is behind, 180 is the far side', () => {
    expect(wrap180(conv(90).lonDeg - earth)).toBeCloseTo(90, 0);
    expect(wrap180(conv(-90).lonDeg - earth)).toBeCloseTo(-90, 0);
    expect(Math.abs(wrap180(conv(180).lonDeg - earth))).toBeGreaterThan(179);
    expect(wrap180(conv(43).lonDeg - earth)).toBeCloseTo(43, 0);
  });

  it('keeps the CME latitude (north stays north)', () => {
    expect(conv(0, 30).latDeg).toBeGreaterThan(20);
    expect(conv(0, -30).latDeg).toBeLessThan(-20);
  });

  it('a CME aimed at Mars on Nov 14, 2026 is about 55 degrees west', () => {
    // Horizons: Mars 106.56 deg, Earth 51.25 deg, so Mars is 55.3 deg ahead of Earth (west, in DONKI terms).
    const d = conv(55.3);
    expect(Math.abs(wrap180(d.lonDeg - heliocentric('mars', NOV14).lonDeg))).toBeLessThan(1);
    // Latitude 0 means the Sun's equator, which is tilted to the planets' plane: here about 3.7 degrees off it.
    expect(Math.abs(d.latDeg)).toBeLessThan(SOLAR_EQUATOR_TILT);
    expect(angleBetween(d.lonDeg, d.latDeg, heliocentric('mars', NOV14).lonDeg, 0)).toBeLessThan(SOLAR_EQUATOR_TILT);
  });

  it('May 20, 2024: the 2,678 km/s far-side CME (W172) points away from Earth and misses Mars', () => {
    const snap = may as unknown as DonkiSnapshot;
    const c = buildRadar(snap).cmes.find((x) => x.id === '2024-05-20T05:36:00-CME-001')!;
    expect(c.speed).toBe(2678);
    expect(c.stonyLon).toBe(172);
    const earthMay = heliocentric('earth', c.t21Ms).lonDeg;
    expect(Math.abs(wrap180(c.axisLon - earthMay))).toBeGreaterThan(165);
    // Mars was about 104 deg west of Earth, so 67 deg from the cone's center: outside its 45-deg half-angle.
    expect(c.mars.inside).toBe(false);
    expect(c.mars.offsetDeg).toBeGreaterThan(c.halfAngle);
    // NASA's ENLIL runs for it predicted no Mars arrival either.
    expect(c.enlil?.runs).toBeGreaterThan(0);
    expect(c.enlil?.mars).toBeNull();
  });

  // The strongest check on the sign of the conversion: NASA's own ENLIL model predicted arrivals at Mars for
  // some CMEs. If our conversion is right, those CMEs point near Mars. If west and east were swapped, they wouldn't.
  it("agrees with NASA's ENLIL model about which CMEs head for Mars (both snapshots)", () => {
    for (const raw of [recent, may]) {
      const snap = raw as unknown as DonkiSnapshot;
      const data = buildRadar(snap);
      const marsBound = data.cmes.filter((c) => c.enlil?.mars);
      expect(marsBound.length).toBeGreaterThan(3);
      const near = marsBound.filter((c) => c.mars.offsetDeg <= c.halfAngle + 30);
      expect(near.length / marsBound.length).toBeGreaterThanOrEqual(0.8);
      // Same CMEs with west and east swapped: almost none would point near Mars.
      const swapped = marsBound.filter((c) => {
        const earthLon = heliocentric('earth', c.t21Ms).lonDeg;
        const d = stonyhurstToEcliptic(-c.stonyLon, c.stonyLat, earthLon, c.t21Ms);
        return angleBetween(d.lonDeg, d.latDeg, heliocentric('mars', c.mars.atMs).lonDeg, 0) <= c.halfAngle + 30;
      });
      expect(swapped.length / marsBound.length).toBeLessThan(0.2);
      // And every CME our model sends into Mars is one NASA's ENLIL model also sent there (when ENLIL ran).
      const modelHits = data.cmes.filter((c) => c.mars.inside && c.enlil);
      expect(modelHits.length).toBeGreaterThan(0);
      expect(modelHits.filter((c) => c.enlil!.mars).length / modelHits.length).toBeGreaterThanOrEqual(0.8);
    }
  });
});

describe('cone crossing the planets plane', () => {
  it('a cone centered in the plane crosses it at its full half-angle', () => {
    expect(planeHalfWidth(0, 30)).toBeCloseTo(30, 6);
  });
  it('a tilted cone crosses it narrower, or not at all', () => {
    expect(planeHalfWidth(30, 45)).toBeCloseTo((Math.acos(Math.cos(Math.PI / 4) / Math.cos(Math.PI / 6)) * 180) / Math.PI, 6);
    expect(planeHalfWidth(40, 30)).toBeNull();
    expect(planeHalfWidth(-40, 30)).toBeNull();
  });
  it('21.5 solar radii is about 0.1 AU', () => {
    expect(R21_5_AU).toBeCloseTo(0.09998, 4);
  });
});
