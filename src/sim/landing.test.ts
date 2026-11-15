// Written with AI assistance (Claude Code). See README "Use of AI tools".
// The ice landing site (Arcadia Planitia): a real two-sided trade-off, sane balance, and Gale Crater left exactly as it was.
import { describe, it, expect } from 'vitest';
import { createMission, getBriefing, simulateWhatIf, emptyAlloc, foodPerGreenhouseCell, greenhouseAirPerCell, solarCells, windowSol } from './sim';
import { builder, balanced, evenSplit, ignoresRadiation, pureGreed, greedyBreathing, playOut, playCampaign, type Strategy } from './strategies';
import { testConfig, TEST_POOL } from './fixtures.test-util';
import { newCampaign, missionConfigFor, serialize, deserialize, finishExpedition, prefillFor } from './campaign';
import { ARCADIA, TUNING, ARCADIA_TUNING, MOON_TUNING, RATES, expeditionFor, landingOf, tuningFor } from './constants';
import { siteText } from './site';
import { freshBase } from './upgrades';

const ice = (seed: string, difficulty: 'cadet' | 'commander' = 'cadet', expedition = 1) => createMission(testConfig(seed, difficulty, expedition, freshBase(), 0, undefined, 'arcadia'));
const gale = (seed: string, difficulty: 'cadet' | 'commander' = 'cadet', expedition = 1) => createMission(testConfig(seed, difficulty, expedition));

describe('landing site: Arcadia Planitia (ice)', () => {
  it('a builder wins at least 90% of every Cadet expedition of an Arcadia campaign', () => {
    const wins = [0, 0, 0];
    for (let i = 0; i < 60; i++) for (const r of playCampaign(`ab-${i}`, 'cadet', TEST_POOL, builder, 11, 'mars', 'arcadia').results) if (r.status === 'won') wins[r.n - 1]++;
    for (const w of wins) expect(w).toBeGreaterThanOrEqual(54);
  });

  it('a builder wins at least 90% of Cadet quick missions at Arcadia', () => {
    let wins = 0;
    for (let i = 0; i < 100; i++) if (playOut(ice(`aq-${i}`), builder).status === 'won') wins++;
    expect(wins).toBeGreaterThanOrEqual(90);
  });

  it('Commander at Arcadia is hard but fair: a builder wins some first crews, later crews do not collapse, careless play loses', () => {
    const n = 60;
    const wins = (strategy: Strategy) => {
      const w = [0, 0, 0];
      for (let i = 0; i < n; i++) for (const r of playCampaign(`acmd-${i}`, 'commander', TEST_POOL, strategy, 11, 'mars', 'arcadia').results) if (r.status === 'won') w[r.n - 1]++;
      return w;
    };
    // Before the bigger greenhouse boost (2 -> 3): about 19 / 18 / 8% for a builder. The first crew had no power to
    // spare, so nothing got built and crews 2 and 3 (5 and 6 people) had only the 6-cell starting array.
    const b = wins(builder);
    expect(b[0]).toBeGreaterThanOrEqual(n * 0.3);
    expect(b[0]).toBeLessThanOrEqual(n * 0.8);
    expect(b[1]).toBeGreaterThanOrEqual(n * 0.3);
    expect(b[2]).toBeGreaterThanOrEqual(n * 0.3);
    // The radiation choices still matter: ignoring the storms loses almost every first crew.
    expect(wins(ignoresRadiation)[0]).toBeLessThanOrEqual(n * 0.15);
    expect(wins(evenSplit)[0]).toBeLessThanOrEqual(n * 0.15);
  });

  it('pure greed always loses at Arcadia', () => {
    for (const d of ['cadet', 'commander'] as const)
      for (let i = 0; i < 100; i++) {
        expect(playOut(ice(`ag-${i}`, d), pureGreed).status).toBe('lost');
        expect(playOut(ice(`ag-${i}`, d), greedyBreathing).status).toBe('lost');
      }
  });

  it('costs sunlight and warmth: fewer solar cells and more cold snaps than Gale Crater', () => {
    for (const d of ['cadet', 'commander'] as const) {
      expect(solarCells(ice('sun', d))).toBe(solarCells(gale('sun', d)) - ARCADIA.sunCellsLost);
      expect(getBriefing(ice('sun', d)).cells).toBe(getBriefing(gale('sun', d)).cells - ARCADIA.sunCellsLost);
      for (let i = 0; i < 40; i++)
        for (const exp of [1, 2, 3]) {
          const colds = ice(`ac-${i}`, d, exp).plan.filter((p) => p.coldSnap).length;
          expect(colds).toBe(TUNING[d].coldSnaps + ARCADIA.extraColdSnaps);
        }
    }
    // The prefill robot runs on the same smaller array.
    expect(prefillFor(freshBase(), 'cadet', 'mars', 'arcadia')).toBeLessThan(prefillFor(freshBase(), 'cadet'));
  });

  it('gives water: each greenhouse cell grows more food and more air than at Gale Crater', () => {
    const a = ice('gh');
    const g = gale('gh');
    expect(foodPerGreenhouseCell(a)).toBe(foodPerGreenhouseCell(g) * ARCADIA.greenhouseBoost);
    expect(greenhouseAirPerCell(a)).toBe(RATES.airPerGreenhouseCell * ARCADIA.greenhouseBoost);
    expect(greenhouseAirPerCell(g)).toBe(RATES.airPerGreenhouseCell);
    const alloc = { ...emptyAlloc(), greenhouse: 2, heaters: 1 };
    const after = (s: typeof a) => simulateWhatIf(s, { ...alloc, fuel: getBriefing(s).cells - 3 }, 'none').next;
    expect(after(a).food - a.food).toBeGreaterThan(after(g).food - g.food);
    expect(after(a).air - a.air).toBeGreaterThan(after(g).air - g.air);
  });

  it('is a real trade-off: slower for the first crew, easier for the big last crew', () => {
    let iceSols = 0;
    let galeSols = 0;
    let iceE3 = 0;
    let galeE3 = 0;
    for (let i = 0; i < 60; i++) {
      iceSols += playOut(ice(`at-${i}`), balanced).log.length;
      galeSols += playOut(gale(`at-${i}`), balanced).log.length;
      if (playCampaign(`at-${i}`, 'cadet', TEST_POOL, balanced, 11, 'mars', 'arcadia').results[2].status === 'won') iceE3++;
      if (playCampaign(`at-${i}`, 'cadet', TEST_POOL, balanced).results[2].status === 'won') galeE3++;
    }
    // Less power: the first crew takes longer to fill the tank...
    expect(iceSols).toBeGreaterThan(galeSols);
    // ...but a crew of 6 eats a lot, and cheap food from the ice pays off.
    expect(iceE3).toBeGreaterThan(galeE3);
  });

  it('keeps the same crews, launch windows and fuel as Gale Crater (only the story of crew 1 changes)', () => {
    for (const n of [1, 2, 3]) {
      const a = expeditionFor(n, 'mars', 'arcadia');
      const g = expeditionFor(n, 'mars');
      expect({ ...a, blurb: '' }).toEqual({ ...g, blurb: '' });
    }
    expect(expeditionFor(1, 'mars', 'arcadia').blurb).toContain('Arcadia Planitia');
    expect(windowSol(ice('w'))).toBe(windowSol(gale('w')));
    expect(siteText(ice('t').config).where).toBe('Arcadia Planitia');
    expect(siteText(gale('t').config).where).toBe('Gale Crater');
  });

  it('saves and loads an Arcadia campaign, and the base carries over', () => {
    const c = playCampaign('asave', 'cadet', TEST_POOL, builder, 11, 'mars', 'arcadia');
    expect(c.landing).toBe('arcadia');
    expect(deserialize(serialize(c))).toEqual(c);
    const c0 = newCampaign('acfg', 'cadet', 'mars', 'arcadia');
    const cfg = missionConfigFor(c0, 11, TEST_POOL);
    expect(cfg.landing).toBe('arcadia');
    expect(cfg.lightTimeMin).toBe(11);
    const c1 = finishExpedition(c0, playOut(createMission(cfg), builder));
    expect(c1.landing).toBe('arcadia');
    expect(missionConfigFor(c1, 11, TEST_POOL).landing).toBe('arcadia');
  });
});

describe('landing site: Gale Crater and the Moon are unchanged', () => {
  it('Gale Crater is the default, and its configs and tuning are exactly what they were', () => {
    const c = newCampaign('gcfg', 'cadet');
    expect('landing' in c).toBe(false);
    expect('landing' in missionConfigFor(c, 11, TEST_POOL)).toBe(false);
    expect('landing' in newCampaign('gcfg', 'cadet', 'mars', 'gale')).toBe(false);
    for (const d of ['cadet', 'commander'] as const) {
      expect(tuningFor(d, 'mars')).toBe(TUNING[d]);
      expect(tuningFor(d)).toBe(TUNING[d]);
      expect(tuningFor(d, 'mars', 'gale')).toBe(TUNING[d]);
      expect(tuningFor(d, 'mars', 'arcadia')).toBe(ARCADIA_TUNING[d]);
    }
  });

  it('old saves (no landing field) load as Gale Crater', () => {
    const old = JSON.stringify({ version: 1, seed: 'old', difficulty: 'cadet', expedition: 1, base: freshBase(), prefillPct: 0, results: [], usedEventIds: [] });
    const loaded = deserialize(old)!;
    expect(loaded.landing).toBeUndefined();
    expect(landingOf(loaded)).toBe('gale');
    expect('landing' in missionConfigFor(loaded, 11, TEST_POOL)).toBe(false);
  });

  it('the Moon ignores a landing site', () => {
    const c = newCampaign('mland', 'cadet', 'moon', 'arcadia');
    expect('landing' in c).toBe(false);
    expect(landingOf({ site: 'moon', landing: 'arcadia' })).toBe('gale');
    expect(tuningFor('cadet', 'moon', 'arcadia')).toBe(MOON_TUNING.cadet);
    const s = createMission(testConfig('mland', 'cadet', 1, freshBase(), 0, 'moon'));
    expect(foodPerGreenhouseCell({ ...s, config: { ...s.config, landing: 'arcadia' } })).toBe(foodPerGreenhouseCell(s));
  });

  it('the same seed gives Gale Crater the same mission as before', () => {
    // Gale plans and results do not depend on the new code path (no landing = Gale).
    const a = playOut(createMission(testConfig('same-gale')), builder);
    const b = playOut(createMission({ ...testConfig('same-gale'), landing: 'gale' }), builder);
    expect(b.log).toEqual(a.log);
  });
});
