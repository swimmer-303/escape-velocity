// Written with AI assistance (Claude Code). See README "Use of AI tools".
// The SWIM snapshot is real map data with its sources, and the game's claims about it hold.
import { describe, it, expect } from 'vitest';
import { SWIM, fmtIce, swimAt, swimProfileEnds } from './swim';
import { ARCADIA } from '../sim/constants';
import { factFor, FACTS } from './science';

describe('SWIM ice map snapshot', () => {
  it('records where it came from and when', () => {
    expect(SWIM.sourceUrls.some((u) => u.startsWith('https://swim.psi.edu/'))).toBe(true);
    expect(SWIM.products.map((p) => p.id)).toEqual(['c0_1', 'c1_5', 'c5']);
    for (const p of SWIM.products) expect(p.url).toMatch(/^https:\/\/swim\.psi\.edu\/output\/SWIM2\/.+\.tif$/);
    expect(Number.isNaN(Date.parse(SWIM.fetchedAt))).toBe(false);
    expect(SWIM.paper.doi).toBe('https://doi.org/10.1038/s41550-020-01290-z');
  });

  it('is sampled at the same Arcadia coordinates the game uses', () => {
    expect(SWIM.sites.arcadia.lat).toBe(ARCADIA.lat);
    expect(SWIM.sites.arcadia.lon).toBe(ARCADIA.lonE);
    expect(SWIM.sites.gale.lat).toBeCloseTo(ARCADIA.galeLat, 1);
  });

  it('holds ice-consistency values between -1 and +1', () => {
    for (const site of Object.values(SWIM.sites))
      for (const v of Object.values(site.values))
        for (const x of [v.center, v.mean, v.min, v.max]) if (x !== null) expect(Math.abs(x)).toBeLessThanOrEqual(1);
  });

  it('supports what the game says: likely shallow ice at Arcadia, none to speak of at Gale, more ice farther north', () => {
    expect(swimAt('arcadia', 'c0_1')!).toBeGreaterThan(0.3);
    expect(SWIM.sites.arcadia.values.c0_1.mean!).toBeGreaterThan(0.3);
    expect(Math.abs(swimAt('gale', 'c0_1')!)).toBeLessThan(0.1);
    const { south, north } = swimProfileEnds();
    expect(north.lat).toBeGreaterThan(south.lat);
    expect(north.mean!).toBeGreaterThan(south.mean! + 0.5);
  });

  it('formats values for kids', () => {
    expect(fmtIce(0.547)).toBe('+0.55');
    expect(fmtIce(-0.011)).toBe('-0.01');
    expect(fmtIce(0)).toBe('0.00');
    expect(fmtIce(-0.001)).toBe('0.00');
    expect(fmtIce(null)).toBe('no data');
  });
});

describe('Real Science cards for the landing site', () => {
  it('has 3 Arcadia cards, each with a source link, shown only at Arcadia', () => {
    const own = FACTS.filter((f) => f.landing === 'arcadia');
    expect(own.length).toBe(3);
    for (const f of own) {
      expect(f.site).toBe('mars');
      expect(f.url).toMatch(/^https:\/\//);
    }
    for (const topic of ['greenhouse', 'cold', 'o2'] as const)
      for (let seed = 0; seed < 40; seed++) {
        expect(factFor(topic, seed).landing).toBeUndefined();
        expect(factFor(topic, seed, 'mars', 'gale').landing).toBeUndefined();
        expect(factFor(topic, seed, 'moon', 'arcadia').landing).toBeUndefined();
      }
    // At Arcadia, its own cards come up often.
    for (const topic of ['greenhouse', 'cold', 'o2'] as const) {
      const seen = new Set<string>();
      for (let seed = 0; seed < 40; seed++) {
        const f = factFor(topic, seed, 'mars', 'arcadia');
        if (f.landing === 'arcadia') seen.add(f.title);
      }
      expect(seen.size).toBe(1);
    }
  });
});
