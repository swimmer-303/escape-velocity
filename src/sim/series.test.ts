// Written with AI assistance (Claude Code). See README "Use of AI tools".
import { describe, it, expect } from 'vitest';
import { createMission, emptyAlloc } from './sim';
import { builder, playOut, playCampaign, pureGreed } from './strategies';
import { testConfig, TEST_POOL } from './fixtures.test-util';
import { isMissionSeries, missionSeries, runsOf, seriesSols, seriesTakeaway, solSpan, fuelSpeedup, type MissionSeries } from './series';
import { deserialize, finishExpedition, newCampaign, resultFor, serialize } from './campaign';
import type { MissionState, Snapshot, SolReport } from './types';

const r2 = (x: number) => Math.round(x * 100) / 100;

/** A made-up sol log: just enough of each report for the chart. Values are "end of sol"; index 0 is landing. */
function fakeMission(points: { fuel: number[]; air?: number[]; food?: number[]; dose?: number[] }, extras: Record<number, Partial<SolReport>> = {}) {
  const n = points.fuel.length - 1;
  const snap = (k: number): Snapshot => ({
    fuel: points.fuel[k],
    air: points.air?.[k] ?? 3,
    food: points.food?.[k] ?? 4,
    dose: points.dose?.[k] ?? 0.67 * k,
  });
  const log: SolReport[] = [];
  for (let k = 1; k <= n; k++) {
    log.push({
      sol: k,
      alloc: emptyAlloc(),
      cells: 7,
      weather: 'clear',
      coldSnap: false,
      baseDose: 0.67,
      airMade: 0,
      foodMade: 0,
      fuelMade: 0,
      heaterShortfall: 0,
      newDamage: false,
      blackout: false,
      cleaning: false,
      stored: 0,
      before: snap(k - 1),
      after: snap(k),
      ...extras[k],
    });
  }
  return { log, doseBudget: 27 } satisfies Pick<MissionState, 'log' | 'doseBudget'>;
}

const storm = (shelterCells: number, doseTaken: number, doseUnsheltered = 8): Partial<SolReport> => ({
  storm: { event: TEST_POOL[0], fast: false, warnedBy: 'earth', shelterCells, doseUnsheltered, doseTaken },
});

describe('mission series', () => {
  it('copies the HUD numbers at landing and after every sol, plus the events', () => {
    const end = playOut(createMission(testConfig('series-1', 'cadet', 2, undefined, 14)), builder);
    const s = missionSeries(end);
    const n = end.log.length;
    expect(seriesSols(s)).toBe(n);
    for (const key of ['fuel', 'air', 'food', 'dose'] as const) {
      expect(s[key]).toHaveLength(n + 1);
      expect(s[key][0]).toBe(r2(end.log[0].before[key]));
      end.log.forEach((r, i) => expect(s[key][i + 1]).toBe(r2(r.after[key])));
    }
    expect(s.fuel[0]).toBe(14);
    expect(s.doseBudget).toBe(end.doseBudget);
    expect(s.storms.map((t) => t.sol)).toEqual(end.log.filter((r) => r.storm).map((r) => r.sol));
    expect(s.dust).toEqual(end.log.filter((r) => r.weather !== 'clear').map((r) => r.sol));
    expect(s.built.map((b) => b.id)).toEqual(end.builtThisExpedition);
    expect(s.cold).toEqual(end.log.filter((r) => r.heaterShortfall > 0).map((r) => r.sol));
    expect(isMissionSeries(s)).toBe(true);
  });

  it('records skipped heaters', () => {
    const end = playOut(createMission(testConfig('series-greed')), pureGreed);
    const s = missionSeries(end);
    expect(s.cold.length).toBeGreaterThan(0);
    expect(s.cold).toEqual(end.log.filter((r) => r.heaterShortfall > 0).map((r) => r.sol));
  });

  it('says how well the shelter covered each storm', () => {
    const m = fakeMission({ fuel: [0, 5, 10, 15, 20] }, { 1: storm(2, 0.8), 2: storm(1, 4), 3: storm(0, 8), 4: storm(1, 0.8) /* berm: 1 cell blocks 90% */ });
    expect(missionSeries(m).storms.map((t) => t.shelter)).toEqual(['full', 'part', 'none', 'full']);
    expect(missionSeries(m).storms.map((t) => t.dose)).toEqual([0.8, 4, 8, 0.8]);
  });

  it('handles an empty log', () => {
    const s = missionSeries({ log: [], doseBudget: 27 });
    expect(seriesSols(s)).toBe(0);
    expect(seriesTakeaway(s, { status: 'playing' })).toMatch(/did not finish a sol/);
  });

  it('groups back-to-back sols', () => {
    expect(runsOf([9, 4, 5, 6])).toEqual([
      [4, 6],
      [9, 9],
    ]);
    expect(solSpan([4, 6])).toBe('sols 4 to 6');
    expect(solSpan([9, 9])).toBe('sol 9');
  });
});

describe('takeaway', () => {
  const won = { status: 'won' as const };

  it('credits an upgrade that made the tank fill faster', () => {
    const m = fakeMission({ fuel: [0, 4, 8, 12, 22, 32, 42, 100] }, { 3: { built: 'moxie2' } });
    expect(fuelSpeedup(missionSeries(m))?.id).toBe('moxie2');
    expect(seriesTakeaway(missionSeries(m), won)).toBe('Your fuel climbed faster after you built the Big O2 plant on sol 3.');
  });

  it('does not credit an upgrade that cannot make fuel, or one that did not speed it up', () => {
    const monitor = fakeMission({ fuel: [0, 4, 8, 12, 22, 32, 42, 100] }, { 3: { built: 'monitor' } });
    expect(seriesTakeaway(missionSeries(monitor), won)).toBe('Your crew filled the tank in 7 sols.');
    const flat = fakeMission({ fuel: [0, 10, 20, 30, 40, 50, 60, 100] }, { 3: { built: 'panel' } });
    expect(fuelSpeedup(missionSeries(flat))).toBeNull();
  });

  it('points at a storm that caught the crew outside the shelter', () => {
    const m = fakeMission({ fuel: [0, 20, 40, 60, 80, 100] }, { 2: storm(2, 0.8), 4: storm(0, 8) });
    expect(seriesTakeaway(missionSeries(m), won)).toBe('The solar storm on sol 4 hit while the shelter was off, so the dose jumped.');
    const half = fakeMission({ fuel: [0, 20, 40, 60, 80, 100] }, { 3: storm(1, 4) });
    expect(seriesTakeaway(missionSeries(half), won)).toMatch(/sol 3 hit with the shelter only half on/);
  });

  it('notices fuel slowing down in a dust storm', () => {
    const m = fakeMission({ fuel: [0, 15, 30, 33, 36, 39, 54, 69, 84, 100] }, { 3: { weather: 'dusty' }, 4: { weather: 'storm' }, 5: { weather: 'dusty' } });
    expect(seriesTakeaway(missionSeries(m), won)).toBe('Fuel grew slowly during the dust storm on sols 3 to 5, when the panels made less power.');
  });

  it('praises sheltering from every storm', () => {
    const m = fakeMission({ fuel: [0, 25, 50, 75, 100] }, { 1: storm(2, 0.8), 3: storm(2, 0.3, 3) });
    expect(seriesTakeaway(missionSeries(m), won)).toBe('You sheltered from both solar storms, so the dose stayed low.');
  });

  it('explains how a crew had to come home early', () => {
    const air = fakeMission({ fuel: [0, 10, 20, 30], air: [4, 2.5, 1, -0.5] });
    expect(seriesTakeaway(missionSeries(air), { status: 'lost', loseReason: 'air' })).toBe('The air ran out on sol 3, so the crew had to go home early.');
    const dusty = fakeMission({ fuel: [0, 10, 20, 30], food: [4, 2.5, 1, -0.5] }, { 2: { weather: 'storm' } });
    expect(seriesTakeaway(missionSeries(dusty), { status: 'lost', loseReason: 'food' })).toBe('The food ran out on sol 3, just after a dust storm cut your power.');
    const dose = fakeMission({ fuel: [0, 10, 20, 30], dose: [0, 10, 20, 28] }, { 3: storm(0, 8) });
    expect(seriesTakeaway(missionSeries(dose), { status: 'lost', loseReason: 'dose' })).toBe('The solar storm on sol 3 pushed the dose past the limit.');
    const earlier = fakeMission({ fuel: [0, 10, 20, 30, 40], dose: [0, 9, 18, 24, 28] }, { 1: storm(0, 8), 2: storm(1, 4) });
    expect(seriesTakeaway(missionSeries(earlier), { status: 'lost', loseReason: 'dose' })).toBe(
      'The storm on sol 1 hit the crew outside the shelter, so the dose passed the limit on sol 4.',
    );
    const creep = fakeMission({ fuel: [0, 10, 20, 30, 40], dose: [0, 7, 14, 21, 28] });
    expect(seriesTakeaway(missionSeries(creep), { status: 'lost', loseReason: 'dose' })).toBe('The dose crept up every sol until it passed the limit on sol 4.');
    const slow = fakeMission({ fuel: [0, 10, 20, 30, 40, 52.5] });
    expect(seriesTakeaway(missionSeries(slow), { status: 'lost', loseReason: 'window' })).toBe('The tank was only 52% full when the launch window closed on sol 5.');
  });
});

describe('campaign results keep the chart history', () => {
  it('stores a series for every crew, and it survives a save', () => {
    const c = playCampaign('series-camp', 'cadet', TEST_POOL, builder);
    expect(c.results).toHaveLength(3);
    for (const r of c.results) {
      expect(r.series).toBeDefined();
      expect(seriesSols(r.series!)).toBe(r.sols);
      expect(isMissionSeries(r.series)).toBe(true);
    }
    expect(deserialize(serialize(c))).toEqual(c);
  });

  it('resultFor fills in the series', () => {
    const end = playOut(createMission(testConfig('series-2')), builder);
    expect(resultFor(end).series).toEqual(missionSeries(end));
  });

  it('loads old saves that have no chart history', () => {
    const end = playOut(createMission(testConfig('series-3')), builder);
    const c = finishExpedition(newCampaign('series-3', 'cadet'), end);
    const old = JSON.parse(serialize(c));
    delete old.results[0].series;
    const back = deserialize(JSON.stringify(old));
    expect(back).not.toBeNull();
    expect(back!.results[0].series).toBeUndefined();
    expect(back!.results[0].sols).toBe(end.log.length);
  });

  it('drops a damaged chart history but keeps the save', () => {
    const end = playOut(createMission(testConfig('series-4')), builder);
    const c = finishExpedition(newCampaign('series-4', 'cadet'), end);
    const bad = JSON.parse(serialize(c));
    bad.results[0].series.air.pop();
    const back = deserialize(JSON.stringify(bad));
    expect(back).not.toBeNull();
    expect(back!.results[0].series).toBeUndefined();
    expect(back!.results[0].stars).toEqual(c.results[0].stars);
  });

  it('rejects things that are not a series', () => {
    const good: MissionSeries = missionSeries(fakeMission({ fuel: [0, 50, 100] }));
    expect(isMissionSeries(good)).toBe(true);
    expect(isMissionSeries(null)).toBe(false);
    expect(isMissionSeries({ ...good, dose: [0, 'x', 2] })).toBe(false);
    expect(isMissionSeries({ ...good, doseBudget: 0 })).toBe(false);
    expect(isMissionSeries({ ...good, built: [{ sol: 1, id: 'laser' }] })).toBe(false);
    expect(isMissionSeries({ ...good, storms: [{ sol: 1, shelter: 'maybe', dose: 1 }] })).toBe(false);
  });
});
