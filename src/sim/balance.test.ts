// Written with AI assistance (Claude Code). See README "Use of AI tools".
// Balance report: run with `npm run balance` to see how scripted players do across a whole campaign.
import { describe, it, expect } from 'vitest';
import { createMission } from './sim';
import { balanced, builder, evenSplit, ignoresRadiation, pureGreed, greedyBreathing, playOut, playCampaign, type Strategy } from './strategies';
import { TEST_POOL } from './fixtures.test-util';
import { totalStars } from './campaign';
import { freshBase } from './upgrades';
import type { Difficulty, Landing, Site } from './constants';
import { may2024Pool } from '../data/donki';

function campaignStats(strategy: Strategy, difficulty: Difficulty, n = 100, site: Site = 'mars', landing: Landing = 'gale') {
  const wins = [0, 0, 0];
  const sols: number[][] = [[], [], []];
  const reasons: Record<string, number> = {};
  let stars = 0;
  const levels: Record<string, number> = {};
  for (let i = 0; i < n; i++) {
    const c = playCampaign(`seed-${i}`, difficulty, TEST_POOL, strategy, 11, site, landing);
    stars += totalStars(c);
    for (const r of c.results) {
      if (r.status === 'won') {
        wins[r.n - 1]++;
        sols[r.n - 1].push(r.sols);
      } else reasons[`E${r.n}:${r.loseReason}`] = (reasons[`E${r.n}:${r.loseReason}`] ?? 0) + 1;
    }
    for (const [k, v] of Object.entries(c.base.levels)) levels[k] = (levels[k] ?? 0) + v / n;
  }
  const med = (a: number[]) => (a.length ? a.sort((x, y) => x - y)[Math.floor(a.length / 2)] : null);
  return {
    winPct: wins.map((w) => Math.round((w / n) * 100)),
    medSols: sols.map(med),
    avgStars: +(stars / n).toFixed(1),
    reasons,
    endBase: Object.fromEntries(Object.entries(levels).map(([k, v]) => [k, +v.toFixed(1)])),
  };
}

describe('balance', () => {
  for (const d of ['cadet', 'commander'] as Difficulty[]) {
    it(`${d}: campaign report`, () => {
      const table = {
        builder: campaignStats(builder, d),
        balancedNoBuild: campaignStats(balanced, d),
        evenSplit: campaignStats(evenSplit, d),
        ignoresRadiation: campaignStats(ignoresRadiation, d),
        greedyBreathing: campaignStats(greedyBreathing, d),
        pureGreed: campaignStats(pureGreed, d),
      };
      for (const [k, v] of Object.entries(table)) console.log(d.padEnd(9), k.padEnd(17), JSON.stringify(v));
      expect(table.builder.winPct[0]).toBeGreaterThan(0);
    });
  }

  for (const d of ['cadet', 'commander'] as Difficulty[]) {
    it(`moon ${d}: campaign and quick-mission report`, () => {
      const table = {
        builder: campaignStats(builder, d, 100, 'moon'),
        balancedNoBuild: campaignStats(balanced, d, 100, 'moon'),
        evenSplit: campaignStats(evenSplit, d, 100, 'moon'),
        ignoresRadiation: campaignStats(ignoresRadiation, d, 100, 'moon'),
        greedyBreathing: campaignStats(greedyBreathing, d, 100, 'moon'),
        pureGreed: campaignStats(pureGreed, d, 100, 'moon'),
      };
      for (const [k, v] of Object.entries(table)) console.log(`moon ${d}`.padEnd(15), k.padEnd(17), JSON.stringify(v));
      const quick = (strategy: Strategy) => {
        const turns: number[] = [];
        let wins = 0;
        for (let i = 0; i < 100; i++) {
          const end = playOut(
            createMission({ seed: `q-${i}`, difficulty: d, site: 'moon', lightTimeMin: 1.3 / 60, eventPool: TEST_POOL, expedition: 1, base: freshBase(), prefillPct: 0 }),
            strategy,
          );
          if (end.status === 'won') {
            wins++;
            turns.push(end.log.length);
          }
        }
        return { wins, medDays: turns.length ? turns.sort((a, b) => a - b)[Math.floor(turns.length / 2)] : null };
      };
      console.log(`moon ${d} quick mission /100`, { builder: quick(builder), balanced: quick(balanced), greedyBreathing: quick(greedyBreathing), pureGreed: quick(pureGreed) });
      expect(table.builder.winPct[0]).toBeGreaterThan(0);
    });
  }

  for (const d of ['cadet', 'commander'] as Difficulty[]) {
    it(`arcadia (ice landing site) ${d}: campaign and quick-mission report`, () => {
      const table = {
        builder: campaignStats(builder, d, 100, 'mars', 'arcadia'),
        balancedNoBuild: campaignStats(balanced, d, 100, 'mars', 'arcadia'),
        evenSplit: campaignStats(evenSplit, d, 100, 'mars', 'arcadia'),
        ignoresRadiation: campaignStats(ignoresRadiation, d, 100, 'mars', 'arcadia'),
        greedyBreathing: campaignStats(greedyBreathing, d, 100, 'mars', 'arcadia'),
        pureGreed: campaignStats(pureGreed, d, 100, 'mars', 'arcadia'),
      };
      for (const [k, v] of Object.entries(table)) console.log(`arcadia ${d}`.padEnd(18), k.padEnd(17), JSON.stringify(v));
      const quick = (strategy: Strategy) => {
        let wins = 0;
        for (let i = 0; i < 100; i++) {
          const end = playOut(
            createMission({ seed: `q-${i}`, difficulty: d, landing: 'arcadia', lightTimeMin: 11, eventPool: TEST_POOL, expedition: 1, base: freshBase(), prefillPct: 0 }),
            strategy,
          );
          if (end.status === 'won') wins++;
        }
        return wins;
      };
      console.log(`arcadia ${d} quick mission wins /100`, { builder: quick(builder), balanced: quick(balanced), greedyBreathing: quick(greedyBreathing), pureGreed: quick(pureGreed) });
      expect(table.builder.winPct[0]).toBeGreaterThan(0);
    });
  }

  it('may2024 history: report', () => {
    const pool = may2024Pool();
    const run = (strategy: Strategy) => {
      let wins = 0;
      for (let i = 0; i < 100; i++) {
        const end = playOut(
          createMission({ seed: `h-${i}`, difficulty: 'cadet', lightTimeMin: 11, eventPool: pool, scenario: 'may2024', expedition: 1, base: freshBase(), prefillPct: 0 }),
          strategy,
        );
        if (end.status === 'won') wins++;
      }
      return wins;
    };
    const e3 = (strategy: Strategy) => {
      let wins = 0;
      for (let i = 0; i < 100; i++) {
        const end = playOut(createMission({ seed: `e3-${i}`, difficulty: 'cadet', lightTimeMin: 11, eventPool: TEST_POOL, expedition: 3, base: freshBase(), prefillPct: 0 }), strategy);
        if (end.status === 'won') wins++;
      }
      return wins;
    };
    console.log('E3 from an empty base, wins /100', { builder: e3(builder), balanced: e3(balanced) });
    const e2 = (strategy: Strategy) => {
      let wins = 0;
      for (let i = 0; i < 100; i++) {
        const end = playOut(createMission({ seed: `e2-${i}`, difficulty: 'cadet', lightTimeMin: 11, eventPool: TEST_POOL, expedition: 2, base: freshBase(), prefillPct: 14 }), strategy);
        if (end.status === 'won') wins++;
      }
      return wins;
    };
    console.log('E2 from an empty base, wins /100', { builder: e2(builder), balanced: e2(balanced) });
    console.log('history wins /100', { builder: run(builder), balanced: run(balanced), evenSplit: run(evenSplit) });
    expect(pool.length).toBeGreaterThan(2);
  });
});
