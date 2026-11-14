// Written with AI assistance (Claude Code). See README "Use of AI tools".
import { describe, it, expect } from 'vitest';
import { createMission, getBriefing, runSol, checkAlloc, emptyAlloc, simulateWhatIf, earthWarningLateBy } from './sim';
import { balanced, pureGreed, greedyBreathing, playOut } from './strategies';
import { testConfig } from './fixtures.test-util';
import { MODULE_CAP } from './constants';
import { MODULE_IDS, type Allocation, type MissionState, type ModuleId } from './types';

type Metrics = number[];

/** Everything a player could care about after a sol. Higher is always better. */
function metrics(state: MissionState, alloc: Allocation, storm: 'none' | 'major'): Metrics {
  const { next } = simulateWhatIf(state, alloc, storm);
  return [next.air, next.food, next.fuel, -next.dose, -next.coldPenalty, -next.damage, -next.wear, next.monitorOnline ? 1 : 0];
}

function worseSomewhere(a: Metrics, b: Metrics) {
  return b.some((v, i) => v < a[i] - 1e-9);
}

/** States visited by a reasonable player across many seeds. */
function sampleStates(difficulty: 'cadet' | 'commander', seeds = 25): MissionState[] {
  const out: MissionState[] = [];
  for (let i = 0; i < seeds; i++) {
    let s = createMission(testConfig(`nfc-${i}`, difficulty));
    while (s.status === 'playing') {
      out.push(s);
      const { alloc, crate } = balanced(s);
      s = runSol(s, alloc, crate).next;
    }
  }
  return out;
}

describe('no free choices', () => {
  it('moving a useful power cell from one job to another always costs something', () => {
    let checked = 0;
    for (const difficulty of ['cadet', 'commander'] as const) {
      for (const state of sampleStates(difficulty)) {
        const base = balanced(state).alloc;
        const baseMetrics = (['none', 'major'] as const).map((sc) => metrics(state, base, sc));
        for (const from of MODULE_IDS) {
          if (base[from] === 0) continue;
          // Is the cell in `from` doing anything? (e.g. a 2nd heater on a mild night is wasted.)
          const without = { ...base, [from]: base[from] - 1 };
          const useful = (['none', 'major'] as const).some((sc, k) => worseSomewhere(baseMetrics[k], metrics(state, without, sc)));
          if (!useful) continue;
          for (const to of MODULE_IDS) {
            if (to === from || base[to] >= MODULE_CAP[to as ModuleId]) continue;
            const moved = { ...base, [from]: base[from] - 1, [to]: base[to] + 1 };
            const costs = (['none', 'major'] as const).some((sc, k) => worseSomewhere(baseMetrics[k], metrics(state, moved, sc)));
            expect(costs, `sol ${state.sol}: moving a cell ${from} -> ${to} should cost something`).toBe(true);
            checked++;
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(1000);
  });

  it('every module does something useful when given a cell', () => {
    const state = createMission(testConfig('useful'));
    const base = emptyAlloc();
    const baseMetrics = (['none', 'major'] as const).map((sc) => metrics(state, base, sc));
    for (const id of MODULE_IDS) {
      const plus = { ...base, [id]: 1 };
      const better = (['none', 'major'] as const).some((sc, k) =>
        metrics(state, plus, sc).some((v, i) => v > baseMetrics[k][i] + 1e-9),
      );
      expect(better, `${id} should help with at least one thing`).toBe(true);
    }
  });
});

describe('strategies', () => {
  it('a balanced strategy wins on Cadet', () => {
    let wins = 0;
    for (let i = 0; i < 100; i++) if (playOut(createMission(testConfig(`b-${i}`)), balanced).status === 'won') wins++;
    expect(wins).toBeGreaterThanOrEqual(95);
  });
  it('a balanced strategy usually wins on Commander', () => {
    let wins = 0;
    for (let i = 0; i < 100; i++) if (playOut(createMission(testConfig(`c-${i}`, 'commander')), balanced).status === 'won') wins++;
    expect(wins).toBeGreaterThanOrEqual(85);
  });
  it('pure greed always loses', () => {
    for (const d of ['cadet', 'commander'] as const)
      for (let i = 0; i < 100; i++) {
        expect(playOut(createMission(testConfig(`g-${i}`, d)), pureGreed).status).toBe('lost');
        expect(playOut(createMission(testConfig(`g-${i}`, d)), greedyBreathing).status).toBe('lost');
      }
  });
});

describe('rules', () => {
  it('is deterministic for a seed', () => {
    const a = playOut(createMission(testConfig('same')), balanced);
    const b = playOut(createMission(testConfig('same')), balanced);
    expect(a.log).toEqual(b.log);
  });

  it('requires every power cell to be placed', () => {
    const s = createMission(testConfig('place'));
    const b = getBriefing(s);
    const a = emptyAlloc();
    a.fuel = b.cells - 1;
    expect(checkAlloc(s, a).ok).toBe(false);
    a.air = 1;
    expect(checkAlloc(s, a).ok).toBe(true);
  });

  it('a monitor powered today warns about tomorrow even for fast storms', () => {
    for (let i = 0; i < 50; i++) {
      const s0 = createMission(testConfig(`m-${i}`, 'commander'));
      const stormSol = s0.plan.find((p) => p.storm?.fast && !p.blackout)?.sol;
      if (!stormSol) continue;
      // Walk to the sol before the storm with the monitor on.
      let s = s0;
      while (s.sol < stormSol) {
        const { alloc, crate } = balanced(s);
        if (alloc.monitor === 0) {
          const from = (['fuel', 'greenhouse', 'air'] as ModuleId[]).find((m) => alloc[m] > 0)!;
          alloc[from]--;
          alloc.monitor = 1;
        }
        s = runSol(s, alloc, crate).next;
        if (s.status !== 'playing') break;
      }
      if (s.status !== 'playing') continue;
      expect(getBriefing(s).warning?.source).toBe('monitor');
      return;
    }
    throw new Error('no seed produced a fast storm');
  });

  it('without a monitor, fast storms are not announced in time', () => {
    for (let i = 0; i < 50; i++) {
      const s0 = createMission(testConfig(`f-${i}`));
      const stormSol = s0.plan.find((p) => p.storm?.fast)?.sol;
      if (!stormSol) continue;
      let s = s0;
      while (s.sol < stormSol && s.status === 'playing') {
        const b = getBriefing(s);
        const a = emptyAlloc();
        a.heaters = b.heaterNeed;
        a.air = 1;
        a.greenhouse = 2;
        a.fuel = b.cells - a.heaters - a.air - a.greenhouse;
        s = runSol(s, a).next;
      }
      if (s.status !== 'playing') continue;
      expect(getBriefing(s).warning).toBeNull();
      expect(earthWarningLateBy(12)).toBeGreaterThan(0);
      return;
    }
    throw new Error('no seed produced a fast storm');
  });

  it('shelter blocks most of a storm', () => {
    const s = createMission(testConfig('shelter'));
    const b = getBriefing(s);
    const open = emptyAlloc();
    open.heaters = 1;
    open.fuel = b.cells - 1;
    const shut = { ...open, fuel: open.fuel - 2, shelter: 2 };
    const doseOpen = simulateWhatIf(s, open, 'major').next.dose;
    const doseShut = simulateWhatIf(s, shut, 'major').next.dose;
    expect(doseShut).toBeLessThan(doseOpen - 5);
    expect(simulateWhatIf(s, shut, 'major').next.fuel).toBeLessThan(simulateWhatIf(s, open, 'major').next.fuel);
  });

  it('skipping heaters costs power tomorrow and wears equipment', () => {
    const s = createMission(testConfig('heat'));
    const b = getBriefing(s);
    const a = emptyAlloc();
    a.fuel = b.cells - 2;
    a.air = 2;
    const next = runSol(s, a).next;
    expect(next.coldPenalty).toBe(b.heaterNeed);
    expect(getBriefing(next).cells).toBeLessThan(getBriefing({ ...next, coldPenalty: 0 }).cells);
  });
});
