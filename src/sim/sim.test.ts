// Written with AI assistance (Claude Code). See README "Use of AI tools".
import { describe, it, expect } from 'vitest';
import { createMission, getBriefing, runSol, checkAlloc, emptyAlloc, simulateWhatIf, earthWarningLateBy } from './sim';
import { balanced, builder, pureGreed, greedyBreathing, playOut, playCampaign } from './strategies';
import { testConfig, TEST_POOL } from './fixtures.test-util';
import { moduleCap } from './sim';
import { MODULE_IDS, type Allocation, type MissionState, type ModuleId } from './types';
import { freshBase, type BaseState } from './upgrades';
import { finishExpedition, newCampaign, missionConfigFor, serialize, deserialize, prefillFor } from './campaign';

/** A base with the monitor and battery built, so every module exists. */
function fullBase(): BaseState {
  const b = freshBase();
  b.levels.monitor = 1;
  b.levels.battery = 1;
  return b;
}

type Metrics = number[];

/** Everything a player could care about after a sol. Higher is always better. */
function metrics(state: MissionState, alloc: Allocation, storm: 'none' | 'major'): Metrics {
  const { next } = simulateWhatIf(state, alloc, storm);
  const built = Object.values(next.base.levels).reduce((a, b) => a + b, 0) * 1000 + Object.values(next.base.progress).reduce((a, b) => a + b, 0);
  return [next.air, next.food, next.fuel, -next.dose, -next.coldPenalty, -next.damage, -next.wear, next.monitorOnline ? 1 : 0, built, next.stored];
}

function worseSomewhere(a: Metrics, b: Metrics) {
  return b.some((v, i) => v < a[i] - 1e-9);
}

/** States visited by a reasonable player across many seeds. */
function sampleStates(difficulty: 'cadet' | 'commander', seeds = 25): MissionState[] {
  const out: MissionState[] = [];
  for (let i = 0; i < seeds; i++) {
    for (const exp of [1, 2, 3]) {
      let s = createMission(testConfig(`nfc-${i}`, difficulty, exp, fullBase(), 10));
      while (s.status === 'playing') {
        out.push(s);
        const { alloc, crate } = builder(s);
        s = runSol(s, alloc, crate).next;
      }
    }
  }
  return out;
}

describe('no free choices', () => {
  it('moving a useful power cell from one job to another always costs something', () => {
    let checked = 0;
    for (const difficulty of ['cadet', 'commander'] as const) {
      for (const state of sampleStates(difficulty)) {
        const base = builder(state).alloc;
        const baseMetrics = (['none', 'major'] as const).map((sc) => metrics(state, base, sc));
        for (const from of MODULE_IDS) {
          if (base[from] === 0) continue;
          // Is the cell in `from` doing anything? (e.g. a 2nd heater on a mild night is wasted.)
          const without = { ...base, [from]: base[from] - 1 };
          const useful = (['none', 'major'] as const).some((sc, k) => worseSomewhere(baseMetrics[k], metrics(state, without, sc)));
          if (!useful) continue;
          for (const to of MODULE_IDS) {
            if (to === from || base[to] >= moduleCap(state, to as ModuleId)) continue;
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
    const state = createMission(testConfig('useful', 'cadet', 1, fullBase()));
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
  it('a player who builds up the base wins every Cadet expedition', () => {
    const wins = [0, 0, 0];
    for (let i = 0; i < 60; i++) for (const r of playCampaign(`b-${i}`, 'cadet', TEST_POOL, builder).results) if (r.status === 'won') wins[r.n - 1]++;
    for (const w of wins) expect(w).toBeGreaterThanOrEqual(57);
  });
  it('a careful player wins the first Cadet expedition even without building', () => {
    let wins = 0;
    for (let i = 0; i < 60; i++) if (playOut(createMission(testConfig(`n-${i}`)), balanced).status === 'won') wins++;
    expect(wins).toBeGreaterThanOrEqual(57);
  });
  it('building for the next crew pays off: never building makes the last expedition harder', () => {
    let built = 0;
    let none = 0;
    for (let i = 0; i < 60; i++) {
      if (playCampaign(`g-${i}`, 'cadet', TEST_POOL, builder).results[2].status === 'won') built++;
      if (playCampaign(`g-${i}`, 'cadet', TEST_POOL, balanced).results[2].status === 'won') none++;
    }
    expect(built).toBeGreaterThan(none);
  });
  it('a careful builder usually survives Commander after the first expedition', () => {
    let wins = 0;
    for (let i = 0; i < 40; i++) if (playCampaign(`c-${i}`, 'commander', TEST_POOL, builder).results[2].status === 'won') wins++;
    expect(wins).toBeGreaterThanOrEqual(28);
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
      const s0 = createMission(testConfig(`m-${i}`, 'commander', 1, fullBase()));
      const stormSol = s0.plan.find((p) => p.storm?.fast && !p.blackout)?.sol;
      if (!stormSol) continue;
      // Walk to the sol before the storm with the monitor on.
      let s = s0;
      while (s.sol < stormSol) {
        const { alloc, crate } = builder(s);
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

describe('campaign', () => {
  it('the base and Workshop progress pass to the next crew, even after an early return home', () => {
    let c = newCampaign('camp', 'cadet');
    const end = playOut(createMission(missionConfigFor(c, 11, TEST_POOL)), pureGreed);
    expect(end.status).toBe('lost');
    c = finishExpedition(c, end);
    expect(c.expedition).toBe(2);
    expect(c.results[0].status).toBe('lost');
    const end2 = playOut(createMission(missionConfigFor(c, 11, TEST_POOL)), builder);
    c = finishExpedition(c, end2);
    expect(Object.values(c.base.levels).reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
    expect(c.prefillPct).toBe(prefillFor(c.base, 'cadet'));
    const m3 = createMission(missionConfigFor(c, 11, TEST_POOL));
    expect(m3.crew).toBeGreaterThan(4);
    expect(m3.fuel).toBe(c.prefillPct);
    expect(m3.base.levels).toEqual(c.base.levels);
  });

  it('each expedition meets real storms the earlier crews have not seen (while the pool lasts)', () => {
    const c = playCampaign('fresh', 'cadet', TEST_POOL, builder);
    expect(new Set(c.usedEventIds).size).toBe(c.usedEventIds.length);
  });

  it('saves and loads', () => {
    const c = playCampaign('save', 'cadet', TEST_POOL, builder);
    expect(deserialize(serialize(c))).toEqual(c);
    expect(deserialize('not json')).toBeNull();
  });

  it('building an upgrade changes the base for good', () => {
    let s = createMission(testConfig('build'));
    const startCells = getBriefing(s).cells;
    let guard = 0;
    while (s.base.levels.panel === 0 && guard++ < 10) {
      const b = getBriefing(s);
      const a = emptyAlloc();
      a.heaters = b.heaterNeed;
      a.air = 1;
      a.greenhouse = 2;
      a.build = Math.min(moduleCap(s, 'build'), b.cells - a.heaters - a.air - a.greenhouse);
      a.fuel = b.cells - a.heaters - a.air - a.greenhouse - a.build;
      s = runSol(s, a).next;
    }
    expect(s.base.levels.panel).toBe(1);
    expect(s.builtThisExpedition).toContain('panel');
    expect(getBriefing(s).cells).toBeGreaterThanOrEqual(startCells + 1 - s.coldPenalty - s.damage);
  });
});
