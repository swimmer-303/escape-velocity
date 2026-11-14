// Written with AI assistance (Claude Code). See README "Use of AI tools".
// The trip planner's physics against published NASA/JPL numbers.
//
// Sources:
//  [H]  JPL Horizons (DE441), queried 2026-11-14: heliocentric ecliptic-J2000 state vectors of Mars (499) and the
//       Earth-Moon barycenter (3). https://ssd.jpl.nasa.gov/api/horizons.api
//  [B]  L. M. Burke, R. D. Falck, M. L. McGuire, "Interplanetary Mission Design Handbook: Earth-to-Mars Mission
//       Opportunities 2026 to 2045", NASA/TM-2010-216764 (2010), Tables 2-4 and 13. https://ntrs.nasa.gov/citations/20100037210
//  [G]  L. E. George, L. D. Kos, "Interplanetary Mission Design Handbook: Earth-to-Mars Mission Opportunities and
//       Mars-to-Earth Return Opportunities 2009-2024", NASA/TM-1998-208533 (1998), Tables 4, 9 and 11.
//       https://ntrs.nasa.gov/citations/19980210557
//  [F]  NASA Mars Fact Sheet: escape velocity 5.03 km/s, synodic period 779.94 days.

import { describe, it, expect } from 'vitest';
import { planetState, daysSinceJ2000, orbitPeriodDays, longitudeDeg } from './ephemeris';
import { trip, refine, porkchop, gridMin, windowMinima, bestTrips, entrySpeed, escapeSpeed, surfaceSpeed, cellDepart, cellTof } from './transfer';
import { MARS } from './constants';
import { norm, sub, type Vec3 } from './vec';

const day = (iso: string) => daysSinceJ2000(Date.parse(`${iso}T00:00:00Z`));
const JD0 = 2451545.0;

describe('ephemeris vs. JPL Horizons [H]', () => {
  // [JD (TDB), x, y, z (km), vx, vy, vz (km/s)]
  const MARS_H: number[][] = [
    [2461358.5, -6.854726227038102e7, 2.304624765425132e8, 6.510418151751354e6, -2.23067423634229e1, -4.849166871209153, 4.453309925432525e-1],
    [2462045.5, -6.862800245333475e7, 2.304291209452342e8, 6.512435600940198e6, -2.23054338285992e1, -4.854385394528031, 4.451095515040502e-1],
    [2462836.5, -2.22292480476662e8, 1.123528614441741e8, 7.804041834690489e6, -1.002401769375782e1, -1.95541536198684e1, -1.641006739754909e-1],
    [2463629.5, -2.271276620588464e8, -8.403203931341918e7, 3.804962446052946e6, 9.308756514798254, -2.065286548913264e1, -6.609861668565502e-1],
  ];
  const EMB_H: number[][] = [
    [2461358.5, 9.265680659105083e7, 1.154456337887208e8, -7.701186145290732e3, -2.371562554820401e1, 1.853322694066141e1, -1.038195301519274e-3],
    [2462045.5, 1.483339493482592e8, 2.070148575220027e7, -2.265003060271032e3, -4.602248615830149, 2.93922959172453e1, -1.907709294426851e-3],
    [2462836.5, 5.432759189556893e7, 1.371601969172913e8, -9.915760659009218e3, -2.818052183303084e1, 1.085756335196933e1, -6.006592503724484e-4],
    [2463629.5, -9.857660192884547e7, 1.095852529898725e8, -7.257858205012977e3, -2.263260822997507e1, -2.003463233281452e1, 1.625399976346031e-3],
  ];
  // JPL's nominal errors for these elements (1800-2050): Mars 25,000 km, EM barycenter 6,000 km in distance, plus
  // 40" and 20" in longitude (about 44,000 km and 14,500 km). We allow those sums, and 5 m/s in velocity.
  const check = (planet: 'mars' | 'earth', rows: number[][], maxKm: number) => {
    for (const [jd, ...x] of rows) {
      const s = planetState(planet, jd - JD0);
      expect(norm(sub(s.r, x.slice(0, 3) as Vec3))).toBeLessThan(maxKm);
      expect(norm(sub(s.v, x.slice(3) as Vec3))).toBeLessThan(0.005);
      expect(Math.abs(s.r[2] - x[2])).toBeLessThan(5000); // the 3D tilt is right: Mars sits millions of km above/below the ecliptic
    }
  };
  it('Mars, 2026-2033 (worst seen: 57,000 km, 0.02% of its distance from the Sun)', () => check('mars', MARS_H, 70_000));
  it('Earth-Moon barycenter, 2026-2033 (worst seen: 7,000 km)', () => check('earth', EMB_H, 20_500));

  it('sidereal periods and the synodic period match the NASA fact sheets [F]', () => {
    const e = orbitPeriodDays('earth');
    const m = orbitPeriodDays('mars');
    expect(e).toBeCloseTo(365.256, 2);
    expect(m).toBeCloseTo(686.98, 1);
    expect(1 / (1 / e - 1 / m)).toBeCloseTo(MARS.synodicDays, 0);
  });
});

describe('Earth to Mars: C3 at NASA handbook minima [B]', () => {
  // [departure, arrival, published C3 km^2/s^2, transfer type]. Tolerance 0.5%: MIDAS uses a full JPL ephemeris and
  // rounds dates to the day; we use JPL's approximate elements.
  const MINIMA: Array<[string, string, number, 'I' | 'II']> = [
    ['2026-11-14', '2027-08-09', 11.11, 'I'],
    ['2026-10-31', '2027-08-19', 9.144, 'II'],
    ['2028-12-10', '2029-07-20', 9.048, 'I'],
    ['2028-12-02', '2029-10-16', 8.928, 'II'],
    ['2031-01-28', '2031-08-06', 9.0, 'I'],
    ['2031-02-23', '2032-01-09', 8.237, 'II'],
    // [B] Table 13 (data from JPL Publication 82-43, Sergeyevsky et al. 1983), the handbook's own check case.
    ['2005-08-10', '2006-02-22', 15.883, 'I'],
    ['2005-09-02', '2006-10-08', 15.445, 'II'],
  ];

  it('C3 at the published dates is within 0.5% (all eight within 0.07% when written)', () => {
    for (const [dep, arr, c3, type] of MINIMA) {
      const t = trip('earth', 'mars', day(dep), day(arr) - day(dep))!;
      expect(t.type).toBe(type);
      expect(Math.abs(t.c3 - c3) / c3).toBeLessThan(0.005);
    }
  });

  it('searching for the minimum finds the same C3 within 0.5% and the same dates within 3 days', () => {
    // 2026 Type I is left out: next to the 180-degree ridge we find a lower point (C3 10.48 on Nov 12, 2026) than the
    // handbook lists, so its minimum is checked only at the published dates above.
    for (const [dep, arr, c3, type] of MINIMA.filter((m) => !(m[0].startsWith('2026') && m[3] === 'I'))) {
      const t = refine('earth', 'mars', day(dep), day(arr) - day(dep), 'c3', { type })!;
      expect(Math.abs(t.c3 - c3) / c3).toBeLessThan(0.005);
      expect(Math.abs(t.depart - day(dep))).toBeLessThan(3);
      expect(Math.abs(t.depart + t.tof - day(arr))).toBeLessThan(3);
    }
  });

  it('a 2026 porkchop grid has its lowest C3 inside the 8-16 km^2/s^2 band NASA plans around, near Oct 31, 2026', () => {
    const p = porkchop({ from: 'earth', to: 'mars', departStart: day('2026-09-01'), departStep: 2, departCount: 80, tofStart: 120, tofStep: 4, tofCount: 80 });
    const best = gridMin(p.c3, p)!;
    expect(best.value).toBeGreaterThan(8);
    expect(best.value).toBeLessThan(9.144 * 1.01);
    expect(Math.abs(cellDepart(p, best.i) - day('2026-10-31'))).toBeLessThanOrEqual(6);
  }, 30_000);
});

describe('Mars to Earth: returns from NASA/TM-1998-208533 [G]', () => {
  // [leave Mars, reach Earth, v-inf at Mars, v-inf at Earth, Earth entry speed], all km/s.
  // Fast (154-180 day) crew returns, where a half-day of date rounding moves v-inf by about 1%: tolerances 2% and 1%.
  const RETURNS: Array<[string, string, number, number, number]> = [
    ['2011-10-16', '2012-04-13', 4.161, 9.36, 14.5],
    ['2016-01-07', '2016-07-05', 2.989, 7.342, 13.285],
    ['2016-01-24', '2016-06-26', 3.688, 8.91, 14.212],
    ['2016-02-09', '2016-08-07', 3.688, 4.431, 11.926],
  ];
  it('departure and arrival v-infinity within 2%, entry speed within 1%', () => {
    for (const [dep, arr, vd, va, ve] of RETURNS) {
      const t = trip('mars', 'earth', day(dep), day(arr) - day(dep))!;
      expect(Math.abs(t.vinfDepart - vd) / vd).toBeLessThan(0.02);
      expect(Math.abs(t.vinfArrive - va) / va).toBeLessThan(0.02);
      expect(Math.abs(t.entrySpeed - ve) / ve).toBeLessThan(0.01);
    }
  });

  it('entry speed formula reproduces Table 4 exactly from its own v-infinity values', () => {
    // [G] Table 4: Earth arrival excess velocity -> entry speed.
    for (const [vinf, entry] of [
      [9.35, 14.49],
      [9.31, 14.47],
      [7.34, 13.29],
      [4.01, 11.78],
      [3.5, 11.61],
      [5.28, 12.27],
    ]) {
      expect(entrySpeed(vinf, 'earth')).toBeCloseTo(entry, 1);
    }
  });

  it('leaving Mars from the ground: escape speed 5.03 km/s [F] plus the push toward Earth', () => {
    expect(escapeSpeed('mars')).toBeCloseTo(5.03, 2);
    expect(surfaceSpeed(0, 'mars')).toBeCloseTo(5.03, 2);
    expect(surfaceSpeed(2.6, 'mars')).toBeCloseTo(Math.hypot(2.6, escapeSpeed('mars')), 12);
  });
});

describe('Mars to Earth: launch windows repeat about every 26 months', () => {
  it('cheapest-trip dates 2018-2048 are spaced 700 to 920 days apart, averaging the synodic period within 0.3%', () => {
    const trips = bestTrips('mars', 'earth', day('2017-06-01'), day('2048-06-01'));
    expect(trips.length).toBe(15);
    const gaps = trips.slice(1).map((t, k) => t.depart - trips[k].depart);
    for (const g of gaps) {
      expect(g).toBeGreaterThan(700);
      expect(g).toBeLessThan(920);
    }
    const mean = (trips[trips.length - 1].depart - trips[0].depart) / gaps.length;
    expect(Math.abs(mean - MARS.synodicDays) / MARS.synodicDays).toBeLessThan(0.003); // 778 days when written
    // In months: about 26 (25.6), the gap the game uses between crews.
    expect(mean / 30.4375).toBeGreaterThan(25);
    expect(mean / 30.4375).toBeLessThan(26.5);
    // The cheapest trips leave when Mars is ahead of Earth (by 40 to 140 degrees around the Sun).
    for (const t of trips) {
      let lead = longitudeDeg(t.start.r) - longitudeDeg(planetState('earth', t.depart).r);
      lead = ((lead + 540) % 360) - 180;
      expect(lead).toBeGreaterThan(30);
      expect(lead).toBeLessThan(150);
      // ...and need a modest push: total speed change (Mars orbit to Earth orbit) under 6.5 km/s.
      expect(t.dvTotal).toBeLessThan(6.5);
      expect(t.dvTotal).toBeGreaterThan(5);
    }
  }, 60_000);

  it('the window minima of a porkchop grid agree with the polished best trips', () => {
    const p = porkchop({ from: 'mars', to: 'earth', departStart: day('2027-06-01'), departStep: 5, departCount: 300, tofStart: 80, tofStep: 5, tofCount: 69 });
    const mins = windowMinima(p);
    const trips = bestTrips('mars', 'earth', day('2027-06-01'), day('2031-08-01'));
    expect(mins.length).toBe(2);
    expect(trips.length).toBe(2);
    mins.forEach((m, k) => {
      expect(Math.abs(cellDepart(p, m.i) - trips[k].depart)).toBeLessThan(10);
      expect(Math.abs(cellTof(p, m.j) - trips[k].tof)).toBeLessThan(10);
      expect(m.value).toBeGreaterThanOrEqual(trips[k].dvTotal - 1e-3);
      expect(m.value - trips[k].dvTotal).toBeLessThan(0.05);
    });
  }, 60_000);
});
