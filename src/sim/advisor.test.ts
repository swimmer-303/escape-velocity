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
});
