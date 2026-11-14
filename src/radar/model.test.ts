// Written with AI assistance (Claude Code). See README "Use of AI tools".
// The radar's simple model: constant-speed fronts, when they reach Earth's and Mars' distance, and honest windows.

import { describe, it, expect } from 'vitest';
import { heliocentric } from '../data/lighttime';
import type { DonkiCme, DonkiSnapshot } from '../data/donki-normalize';
import { AU_KM, R21_5_AU } from './geometry';
import { DAY_MS, buildRadar, calmForMars, countRadar, frontAU, hasCmeDirections, inFlight, snapshotWindow, speedBand, toRadarCme } from './model';
import recent from '../data/snapshots/donki-recent.json';

const T0 = '2026-11-09T21:40Z';
const cme = (over: Partial<DonkiCme> = {}): DonkiCme => ({
  id: 'test-CME',
  startTime: '2026-11-09T18:15Z',
  speed: 1000,
  sourceLocation: null,
  link: null,
  time21_5: T0,
  longitude: 0,
  latitude: 0,
  halfAngle: 30,
  enlil: null,
  ...over,
});
const snap = (cmes: DonkiCme[], over: Partial<DonkiSnapshot> = {}): DonkiSnapshot => ({
  fetchedAt: '2026-11-14T18:00:00.000Z',
  startDate: '2026-10-15',
  endDate: '2026-11-14',
  sourceUrl: 'test',
  flares: [],
  seps: [],
  cmes,
  gsts: [],
  included: ['FLR', 'SEP', 'CME'],
  ...over,
});

describe('constant-speed front', () => {
  it('starts at 21.5 solar radii at time21_5 and moves at the measured speed', () => {
    const c = toRadarCme(cme())!;
    expect(frontAU(c, c.t21Ms)).toBeCloseTo(R21_5_AU, 9);
    // 1,000 km/s for one day = 86.4 million km.
    expect(frontAU(c, c.t21Ms + DAY_MS) - R21_5_AU).toBeCloseTo(86_400_000 / AU_KM, 9);
  });

  it("finds when the front reaches Earth's distance, and that Earth is inside a cone aimed at it", () => {
    const c = toRadarCme(cme())!;
    const r = heliocentric('earth', c.earth.atMs).rAU;
    expect(frontAU(c, c.earth.atMs)).toBeCloseTo(r, 6);
    // About (0.99 - 0.10) AU at 1,000 km/s: roughly 1.5 days.
    expect((c.earth.atMs - c.t21Ms) / DAY_MS).toBeGreaterThan(1.4);
    expect((c.earth.atMs - c.t21Ms) / DAY_MS).toBeLessThan(1.65);
    expect(c.earth.inside).toBe(true);
    expect(c.earth.offsetDeg).toBeLessThan(8); // Earth moves a little and sits a few degrees off the Sun's equator
  });

  it('a CME aimed at Mars reaches it; the same CME aimed the other way misses', () => {
    // Mars was about 57 deg west of Earth on Nov 9-13, 2026.
    const toMars = toRadarCme(cme({ longitude: 57, halfAngle: 15 }))!;
    expect(toMars.mars.inside).toBe(true);
    expect(toMars.earth.inside).toBe(false);
    const away = toRadarCme(cme({ longitude: -57, halfAngle: 15 }))!;
    expect(away.mars.inside).toBe(false);
    expect(away.mars.offsetDeg).toBeGreaterThan(100);
  });

  it('a cone aimed far above the planets misses both', () => {
    const c = toRadarCme(cme({ latitude: 60, halfAngle: 20 }))!;
    expect(c.planeHalfWidth).toBeNull();
    expect(c.earth.inside).toBe(false);
    expect(c.mars.inside).toBe(false);
  });

  it('CMEs without a measured direction are listed, not drawn', () => {
    const data = buildRadar(snap([cme(), cme({ id: 'pos', longitude: null }), cme({ id: 'none', time21_5: null, speed: null, longitude: null, latitude: null, halfAngle: null })]));
    expect(data.cmes.map((c) => c.id)).toEqual(['test-CME']);
    expect(data.undirected.map((c) => c.id).sort()).toEqual(['none', 'pos']);
    expect(data.total).toBe(3);
  });
});

describe('windows and counts', () => {
  it("covers the snapshot's dates, ending when it was fetched", () => {
    const w = snapshotWindow(snap([]));
    expect(new Date(w.startMs).toISOString()).toBe('2026-10-15T00:00:00.000Z');
    expect(new Date(w.endMs).toISOString()).toBe('2026-11-14T18:00:00.000Z');
    const may = snapshotWindow(snap([], { startDate: '2024-05-01', endDate: '2024-05-31' }));
    expect(new Date(may.endMs).toISOString()).toBe('2024-06-01T00:00:00.000Z');
  });

  it('counts model and ENLIL arrivals separately, and knows a calm month', () => {
    const enlilMars = { runs: 1, completedAt: null, link: null, earth: null, mars: { time: '2026-11-13T12:00Z', glancing: true, minor: false } };
    const busy = countRadar(buildRadar(snap([cme({ longitude: 57, halfAngle: 15, enlil: enlilMars }), cme({ id: 'b', speed: 450 })])));
    expect(busy.modelMars).toBe(1);
    expect(busy.enlilMars).toBe(1);
    expect(busy.modelEarth).toBe(1);
    expect(busy.fastest?.speed).toBe(1000);
    expect(calmForMars(busy)).toBe(false);
    const calm = countRadar(buildRadar(snap([cme({ longitude: -60 })])));
    expect(calmForMars(calm)).toBe(true);
  });

  it('a front still on its way at the end of the window counts as "later"', () => {
    const late = countRadar(buildRadar(snap([cme({ startTime: '2026-11-14T10:00Z', time21_5: '2026-11-14T12:00Z', longitude: 57, halfAngle: 20, speed: 400 })])));
    expect(late.modelMars).toBe(0);
    expect(late.modelMarsLater).toBe(1);
    expect(calmForMars(late)).toBe(false);
  });

  it('only trusts an empty CME list when CMEs were actually fetched', () => {
    expect(hasCmeDirections(snap([]))).toBe(true);
    expect(hasCmeDirections(snap([], { included: ['FLR', 'SEP'] }))).toBe(false);
    // Older snapshots (no `included`): only if their CMEs carry the radar fields.
    const old = { ...snap([]), cmes: [{ id: 'x', startTime: null, speed: 500, sourceLocation: null, link: null }] };
    delete (old as Partial<DonkiSnapshot>).included;
    expect(hasCmeDirections(old)).toBe(false);
    expect(hasCmeDirections(null)).toBe(false);
  });

  it('in-flight CMEs are those between the Sun and the edge of the radar', () => {
    const data = buildRadar(snap([cme()]));
    const c = data.cmes[0];
    expect(inFlight(data, c.t21Ms, 1.75)).toHaveLength(1);
    expect(inFlight(data, c.t21Ms - DAY_MS, 1.75)).toHaveLength(0);
    expect(inFlight(data, c.t21Ms + 10 * DAY_MS, 1.75)).toHaveLength(0);
  });

  it('speed bands', () => {
    expect([300, 500, 999, 1000, 1999, 2678].map(speedBand)).toEqual(['slow', 'medium', 'medium', 'fast', 'fast', 'extreme']);
  });

  it('the stored snapshot: every CME is either on the radar or listed as having no direction', () => {
    const s = recent as unknown as DonkiSnapshot;
    const data = buildRadar(s);
    expect(data.cmes.length + data.undirected.length).toBe(s.cmes.length);
    expect(data.cmes.length).toBeGreaterThan(0);
    for (const c of data.cmes) {
      expect(c.mars.atMs).toBeGreaterThan(c.t21Ms);
      expect(c.earth.atMs).toBeLessThan(c.mars.atMs);
    }
  });
});
