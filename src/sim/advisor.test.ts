// Written with AI assistance (Claude Code). See README "Use of AI tools".
import { describe, it, expect } from 'vitest';
import { advise } from './advisor';
import { createMission, checkAlloc, runSol, getBriefing } from './sim';
import { testConfig } from './fixtures.test-util';
import { freshBase } from './upgrades';
import { totalCells } from './sim';

describe('Suggest a plan', () => {
  for (const site of ['mars', 'moon'] as const) {
    it(`${site}: always legal, uses every cell, and following it wins most Cadet quick missions`, () => {
      let wins = 0;
      const n = 60;
      for (let i = 0; i < n; i++) {
        let s = createMission(testConfig(`adv-${site}-${i}`, 'cadet', 1, freshBase(), 0, site));
        while (s.status === 'playing') {
          const { alloc, reasons } = advise(s);
          const check = checkAlloc(s, alloc);
          expect(check.ok, `${site} sol ${s.sol}: ${check.problems.join(' ')}`).toBe(true);
          expect(totalCells(alloc)).toBe(getBriefing(s).cells);
          expect(reasons.length).toBeGreaterThan(0);
          s = runSol(s, alloc, 'food').next;
        }
        if (s.status === 'won') wins++;
      }
      expect(wins).toBeGreaterThanOrEqual(n * 0.8);
    }, 60000);
  }

  it('on Commander, following it wins most first crews: it shelters "just in case" when fast storms could beat Earth\'s warning', () => {
    let wins = 0;
    const n = 40;
    for (let i = 0; i < n; i++) {
      let s = createMission(testConfig(`adv-cmd-${i}`, 'commander', 1, freshBase(), 0, 'mars'));
      while (s.status === 'playing') {
        const { alloc } = advise(s);
        expect(checkAlloc(s, alloc).ok).toBe(true);
        s = runSol(s, alloc, 'food').next;
      }
      if (s.status === 'won') wins++;
    }
    // Before this rule, following the advice on Commander lost about 97% of first crews to radiation.
    expect(wins).toBeGreaterThanOrEqual(n * 0.6);
  }, 60000);

  it('on Arcadia Commander (smaller solar array, more cold snaps), following it still wins a fair share of first crews', () => {
    let wins = 0;
    const n = 40;
    for (let i = 0; i < n; i++) {
      let s = createMission(testConfig(`adv-arc-cmd-${i}`, 'commander', 1, freshBase(), 0, undefined, 'arcadia'));
      while (s.status === 'playing') {
        const { alloc } = advise(s);
        expect(checkAlloc(s, alloc).ok).toBe(true);
        s = runSol(s, alloc, 'food').next;
      }
      if (s.status === 'won') wins++;
    }
    // Before the ice-site shelter check, the Gale rule never found room to shelter on Arcadia's 6-cell array, and
    // following the advice lost about 99% of first crews to radiation. Hard but fair: most, not all, get home.
    expect(wins).toBeGreaterThanOrEqual(n * 0.5);
    expect(wins).toBeLessThan(n);
  }, 60000);
});
