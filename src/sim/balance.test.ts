// Written with AI assistance (Claude Code). See README "Use of AI tools".
import { describe, it, expect } from 'vitest';
import { createMission } from './sim';
import { balanced, cautious, evenSplit, ignoresRadiation, pureGreed, greedyBreathing, turtle, playOut, type Strategy } from './strategies';
import { testConfig } from './fixtures.test-util';
import type { Difficulty } from './constants';

function stats(strategy: Strategy, difficulty: Difficulty, n = 200) {
  let wins = 0;
  const sols: number[] = [];
  const reasons: Record<string, number> = {};
  let doseSum = 0;
  for (let i = 0; i < n; i++) {
    const end = playOut(createMission(testConfig(`seed-${i}`, difficulty)), strategy);
    if (end.status === 'won') {
      wins++;
      sols.push(end.sol - 1);
    } else reasons[end.loseReason ?? '?'] = (reasons[end.loseReason ?? '?'] ?? 0) + 1;
    doseSum += end.dose;
  }
  sols.sort((a, b) => a - b);
  return {
    winRate: wins / n,
    medianSols: sols[Math.floor(sols.length / 2)] ?? null,
    minSols: sols[0] ?? null,
    maxSols: sols[sols.length - 1] ?? null,
    avgDose: +(doseSum / n).toFixed(1),
    reasons,
  };
}

import { may2024Pool } from '../data/donki';

describe('balance', () => {
  it('may2024 history: report', () => {
    const pool = may2024Pool();
    console.log('history pool', pool.map((e) => `${e.time.slice(0, 10)} ${e.classType ?? e.kind} ${e.severity}`));
    const run = (strategy: Strategy) => {
      let wins = 0;
      const doses: number[] = [];
      for (let i = 0; i < 100; i++) {
        const end = playOut(createMission({ seed: `h-${i}`, difficulty: 'cadet', lightTimeMin: 11, eventPool: pool, scenario: 'may2024' }), strategy);
        if (end.status === 'won') wins++;
        doses.push(end.dose);
      }
      return { wins, avgDose: +(doses.reduce((a, b) => a + b, 0) / doses.length).toFixed(1) };
    };
    console.log('history', { balanced: run(balanced), ignoresRadiation: run(ignoresRadiation), evenSplit: run(evenSplit) });
    expect(pool.length).toBeGreaterThan(2);
  });

  for (const d of ['cadet', 'commander'] as Difficulty[]) {
    it(`${d}: report`, () => {
      const table = {
        balanced: stats(balanced, d),
        cautious: stats(cautious, d),
        evenSplit: stats(evenSplit, d),
        ignoresRadiation: stats(ignoresRadiation, d),
        greedyBreathing: stats(greedyBreathing, d),
        pureGreed: stats(pureGreed, d),
        turtle: stats(turtle, d),
      };
      console.log(d, JSON.stringify(table, null, 1));
      expect(table.balanced.winRate).toBeGreaterThan(0);
    });
  }
});
