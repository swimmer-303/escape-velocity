// Written with AI assistance (Claude Code). See README "Use of AI tools".
import { describe, it, expect } from 'vitest';
import { Heightfield } from './terrain';
import { buildField, placeTargets, siteHeight } from './world';
import { dailyTargets } from './targets';
import { sampleKind } from './samples';
import { slopeAt } from './physics';
import { moonCraters } from '../../render/moon';
import { MOON_SCALE } from './sites';

describe('heightfield', () => {
  it('matches the grid at its corners and is exact on a tilted plane', () => {
    const plane = (x: number, z: number) => 0.2 * x - 0.1 * z + 3;
    const f = new Heightfield(plane, 100, 20);
    expect(f.height(f.coord(3), f.coord(7))).toBeCloseTo(plane(f.coord(3), f.coord(7)), 5);
    for (const [x, z] of [[1.3, -7.7], [44.4, 12.1], [-99, 99], [0, 0]]) expect(f.height(x, z)).toBeCloseTo(plane(x, z), 4);
    const n = f.normal(0, 0);
    expect(n.y).toBeGreaterThan(0.9);
    expect(n.x).toBeLessThan(0);
  });

  it('is continuous across the triangle diagonal and cell edges', () => {
    const f = new Heightfield((x, z) => Math.sin(x * 0.3) * 4 + Math.cos(z * 0.2) * 3, 50, 10);
    for (let x = -49; x < 49; x += 0.37) {
      const a = f.height(x, 12.5);
      const b = f.height(x + 1e-4, 12.5 + 1e-4);
      expect(Math.abs(a - b)).toBeLessThan(0.01);
    }
  });

  it('builds upward-facing triangles for the mesh', () => {
    const f = new Heightfield(() => 0, 10, 4);
    const idx = f.triangleIndex();
    expect(idx.length).toBe(4 * 4 * 6);
    const p = (i: number) => [f.coord(i % 5), f.coord(Math.floor(i / 5))];
    for (let k = 0; k < idx.length; k += 3) {
      const [ax, az] = p(idx[k]);
      const [bx, bz] = p(idx[k + 1]);
      const [cx, cz] = p(idx[k + 2]);
      // y of (b - a) x (c - a) must be positive (the face points up).
      const ny = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
      expect(ny).toBeGreaterThan(0);
    }
  });
});

describe('the real ground', () => {
  it('is flat on the charging pad at every site', () => {
    for (const site of ['gale', 'arcadia', 'moon'] as const) {
      const h = siteHeight(site);
      expect(Math.abs(h(0, 0))).toBeLessThan(1e-9);
      expect(Math.abs(h(8, -6))).toBeLessThan(1e-6);
    }
  });

  it('shows Gale Crater\'s real relief, and Arcadia\'s real flatness', () => {
    const gale = buildField('gale');
    const arcadia = buildField('arcadia');
    const range = (f: Heightfield) => [Math.min(...f.h), Math.max(...f.h)];
    const [gLo, gHi] = range(gale);
    const [aLo, aHi] = range(arcadia);
    expect(gHi - gLo).toBeGreaterThan(50); // Mount Sharp and the crater wall
    expect(aHi - aLo).toBeLessThan(gHi - gLo); // Arcadia: real plains, plus made-up bumps under a meter
    expect(aHi - aLo).toBeLessThan(6);
  });

  it('settles targets onto gentle ground, and Moon crater samples into craters', () => {
    for (const site of ['gale', 'arcadia'] as const) {
      const field = buildField(site);
      const placed = placeTargets(dailyTargets(site, '2026-11-14'), site, field);
      for (const t of placed) {
        expect(slopeAt(field, t.x, t.z).steep).toBeLessThan(0.45);
        expect(t.y).toBeCloseTo(field.height(t.x, t.z), 6);
      }
    }
    const moon = buildField('moon');
    const craters = moonCraters().map((c) => ({ x: c.x * MOON_SCALE, z: c.z * MOON_SCALE, r: c.r * MOON_SCALE }));
    let checked = 0;
    for (let d = 0; d < 60 && checked < 4; d++) {
      const date = new Date(Date.parse('2026-11-01T12:00:00Z') + d * 86_400_000).toISOString().slice(0, 10);
      const placed = placeTargets(dailyTargets('moon', date), 'moon', moon);
      for (const t of placed) {
        if (sampleKind(t.kind)?.place.kind !== 'crater') continue;
        const inside = craters.some((c) => Math.hypot(c.x - t.x, c.z - t.z) < c.r * 0.8);
        expect(inside).toBe(true);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });
});
