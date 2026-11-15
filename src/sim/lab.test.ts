// Written with AI assistance (Claude Code). See README "Use of AI tools".
import { describe, it, expect } from 'vitest';
import {
  DUST_LEVELS,
  ORBIT_LEVELS,
  changedDials,
  crewO2KgPerDay,
  defaultLab,
  dustPowerFactor,
  hypothesisHeld,
  isRealLab,
  labLightMin,
  labOutcome,
  labSolarCells,
  labStageLook,
  labWeather,
  orbitIrradiance,
  orbitSunFactor,
  periAphRatio,
  sanitizeLab,
  stormDealFor,
  type LabSettings,
} from './lab';
import { createMission, getBriefing, runSol, emptyAlloc } from './sim';
import { balanced, playOut } from './strategies';
import { TEST_POOL, testConfig } from './fixtures.test-util';
import { TUNING, type Landing, type Site } from './constants';
import type { MissionConfig, SolPlan } from './types';

const SEV = { minor: 1, moderate: 2, major: 3 } as const;
const lab = (o: Partial<LabSettings> = {}): LabSettings => ({ ...defaultLab(), ...o });
const storms = (plan: SolPlan[]) => plan.filter((p) => p.storm).map((p) => p.storm!.event);
const configFor = (seed: string, l: LabSettings, site?: Site, landing?: Landing): MissionConfig => ({ ...testConfig(seed, 'cadet', 1, undefined, 0, site, landing), lab: l });

describe('Space Lab settings', () => {
  it('defaults are the real game', () => {
    const d = defaultLab();
    expect(isRealLab(d)).toBe(true);
    expect(changedDials(d)).toEqual([]);
    expect(d).toMatchObject({ world: 'gale', sun: 'average', orbit: 'average', dust: 'hazy', delayMin: null, crew: 4 });
    expect(labSolarCells(7, d)).toBe(7);
  });

  it('a lab mission on real settings plays exactly like a normal one (Gale, Arcadia and the Moon)', () => {
    for (const [site, landing, world] of [[undefined, undefined, 'gale'], [undefined, 'arcadia', 'arcadia'], ['moon', undefined, 'moon']] as const) {
      for (let i = 0; i < 12; i++) {
        const plain = testConfig(`real-${i}`, 'cadet', 1, undefined, 0, site, landing);
        const withLab = { ...plain, lab: lab({ world }) };
        const a = createMission(plain);
        const b = createMission(withLab);
        expect(b.plan).toEqual(a.plan);
        expect(b.crew).toBe(a.crew);
        const endA = playOut(a, balanced);
        const endB = playOut(b, balanced);
        expect(endB.log.map((r) => [r.cells, r.after])).toEqual(endA.log.map((r) => [r.cells, r.after]));
        expect(endB.status).toBe(endA.status);
      }
    }
  });

  it('sanitizes bad data', () => {
    expect(sanitizeLab(null)).toEqual(defaultLab());
    expect(sanitizeLab('nope')).toEqual(defaultLab());
    expect(sanitizeLab({ world: 'venus', sun: 'huge', orbit: 7, dust: null, crew: 99, delayMin: -4, seed: '<script>' })).toEqual({
      ...defaultLab(),
      crew: 6,
      delayMin: 3,
    });
    expect(sanitizeLab({ crew: 0.4, delayMin: 50.7 })).toMatchObject({ crew: 2, delayMin: 22 });
    expect(sanitizeLab({ crew: NaN, delayMin: Infinity }).crew).toBe(4);
    expect(sanitizeLab({ world: 'moon', sun: 'max', orbit: 'perihelion', dust: 'global', crew: 3, delayMin: 9, seed: 'lab-abc12' })).toEqual({
      world: 'moon',
      sun: 'max',
      orbit: 'perihelion',
      dust: 'global',
      crew: 3,
      delayMin: 9,
      seed: 'lab-abc12',
    });
  });

  it('Mars-only dials do not count as changes on the Moon', () => {
    expect(changedDials(lab({ world: 'moon', dust: 'global', orbit: 'perihelion', delayMin: 5 }))).toEqual([]);
    expect(changedDials(lab({ dust: 'global', crew: 6 }))).toEqual(['dust', 'crew']);
  });
});

describe('Space Lab physics', () => {
  it('Mars orbit: inverse-square sunlight from the NASA Mars Fact Sheet distances', () => {
    expect(orbitSunFactor('average')).toBe(1);
    expect(orbitSunFactor('perihelion')).toBeCloseTo(1.217, 3);
    expect(orbitSunFactor('aphelion')).toBeCloseTo(0.836, 3);
    expect(periAphRatio()).toBeCloseTo(1.455, 3); // "about 45% more sunlight at the closest point"
    expect(orbitIrradiance('average')).toBeCloseTo(586.2, 1);
  });

  it('closer orbit = more sun = more solar power', () => {
    const cells = ORBIT_LEVELS.map((o) => labSolarCells(7, lab({ orbit: o })));
    expect(cells).toEqual([6, 7, 9]);
    for (let i = 1; i < cells.length; i++) expect(cells[i]).toBeGreaterThanOrEqual(cells[i - 1]);
  });

  it('more dust = less solar power (built on the game dust losses and Opportunity 2018)', () => {
    const f = DUST_LEVELS.map(dustPowerFactor);
    for (let i = 1; i < f.length; i++) expect(f[i]).toBeLessThan(f[i - 1]);
    expect(dustPowerFactor('dusty')).toBeCloseTo(0.7);
    expect(dustPowerFactor('storm')).toBeCloseTo(0.6);
    expect(dustPowerFactor('global')).toBeCloseTo(22 / 700, 5);
    const cells = DUST_LEVELS.map((d) => labSolarCells(7, lab({ dust: d })));
    for (let i = 1; i < cells.length; i++) expect(cells[i]).toBeLessThanOrEqual(cells[i - 1]);
    expect(cells[cells.length - 1]).toBe(0);
  });

  it('the briefing shows the lab sunlight, and the Moon ignores the Mars-only dials', () => {
    const m = createMission(configFor('brief', lab({ dust: 'storm' })));
    const b = getBriefing(m);
    expect(b.cells).toBe(4); // 7 x 0.6 = 4.2
    expect(b.powerNotes.join(' ')).toMatch(/Space Lab sunlight: -3/);
    const moon = createMission(configFor('brief', lab({ world: 'moon', dust: 'global', orbit: 'aphelion' }), 'moon'));
    expect(getBriefing(moon).cells).toBe(7);
  });

  it('more crew = more air and food used per sol, and more oxygen breathed', () => {
    const used = [2, 4, 6].map((crew) => {
      const m = createMission(configFor('crew', lab({ crew })));
      const next = runSol(m, { ...emptyAlloc(), heaters: 1, fuel: getBriefing(m).cells - 1 }).next;
      return m.air - next.air;
    });
    expect(used).toEqual([2, 4, 6]);
    expect(crewO2KgPerDay(6)).toBeGreaterThan(crewO2KgPerDay(2));
    expect(crewO2KgPerDay(4)).toBeCloseTo(3.58, 2);
  });

  it('solar maximum deals more and bigger storms than solar minimum, all from the real pool', () => {
    expect(stormDealFor(TUNING.cadet, 'max').count).toBeGreaterThan(stormDealFor(TUNING.cadet, 'min').count);
    let minTotal = 0;
    let maxTotal = 0;
    for (let i = 0; i < 30; i++) {
      const lo = storms(createMission(configFor(`sun-${i}`, lab({ sun: 'min' }))).plan);
      const avg = storms(createMission(configFor(`sun-${i}`, lab())).plan);
      const hi = storms(createMission(configFor(`sun-${i}`, lab({ sun: 'max' }))).plan);
      expect(lo.length).toBeLessThan(avg.length);
      expect(hi.length).toBeGreaterThan(avg.length);
      expect(lo.some((e) => e.severity === 'major')).toBe(false);
      expect(hi.filter((e) => e.severity === 'major').length).toBeGreaterThanOrEqual(avg.filter((e) => e.severity === 'major').length);
      for (const e of [...lo, ...hi]) expect(TEST_POOL).toContainEqual(e);
      minTotal += lo.reduce((s, e) => s + SEV[e.severity], 0);
      maxTotal += hi.reduce((s, e) => s + SEV[e.severity], 0);
    }
    expect(maxTotal).toBeGreaterThan(minTotal * 2);
  });

  it('fair test: changing one dial leaves the rest of the mission alone', () => {
    for (let i = 0; i < 20; i++) {
      const real = createMission(configFor(`fair-${i}`, lab())).plan;
      // The Sun changes only the radiation storms (and Earth's outlook about them).
      const busy = createMission(configFor(`fair-${i}`, lab({ sun: 'max' }))).plan;
      expect(busy.map((p) => [p.weather, p.coldSnap, p.blackout, p.resupply, p.cleaning])).toEqual(real.map((p) => [p.weather, p.coldSnap, p.blackout, p.resupply, p.cleaning]));
      // Dust, delay and crew change nothing in the plan.
      expect(createMission(configFor(`fair-${i}`, lab({ dust: 'global', crew: 6, delayMin: 20 }))).plan).toEqual(real);
      // The orbit changes how big the dust storms are, never which days they come.
      const peri = createMission(configFor(`fair-${i}`, lab({ orbit: 'perihelion' }))).plan;
      expect(peri.map((p) => p.weather !== 'clear')).toEqual(real.map((p) => p.weather !== 'clear'));
      expect(peri.every((p) => p.weather !== 'dusty')).toBe(true);
      expect(peri.map((p) => p.storm)).toEqual(real.map((p) => p.storm));
    }
  });

  it('dust season: perihelion storms grow, aphelion storms shrink, clear days stay clear', () => {
    expect(labWeather('dusty', lab({ orbit: 'perihelion' }))).toBe('storm');
    expect(labWeather('storm', lab({ orbit: 'aphelion' }))).toBe('dusty');
    expect(labWeather('clear', lab({ orbit: 'perihelion' }))).toBe('clear');
    expect(labWeather('storm', lab({ world: 'moon', orbit: 'aphelion' }))).toBe('storm');
  });

  it('message delay: the dial on Mars, today when unset, 1.3 seconds on the Moon', () => {
    expect(labLightMin(lab({ delayMin: 5 }), 12)).toBe(5);
    expect(labLightMin(lab(), 12)).toBe(12);
    expect(labLightMin(lab({ world: 'moon', delayMin: 20 }), 12)).toBeCloseTo(1.3 / 60);
  });

  it('the 3D view: the dust dial thickens the sky, the orbit brightens the Sun', () => {
    expect(labStageLook(lab({ dust: 'global' }), 'clear').weather).toBe('storm');
    expect(labStageLook(lab({ dust: 'clear' }), 'dusty').weather).toBe('dusty');
    expect(labStageLook(lab({ orbit: 'perihelion' }), 'clear').labSun).toBeGreaterThan(1);
    expect(labStageLook(lab({ world: 'moon', dust: 'global' }), 'clear')).toEqual({ weather: 'clear', labSun: 1 });
  });

  it('hypothesis: sooner, later, same or not at all, compared with the real mission', () => {
    expect(labOutcome({ won: true, sols: 14 }, { won: true, sols: 12 })).toBe('sooner');
    expect(labOutcome({ won: true, sols: 14 }, { won: true, sols: 16 })).toBe('later');
    expect(labOutcome({ won: true, sols: 14 }, { won: true, sols: 14 })).toBe('same');
    expect(labOutcome({ won: true, sols: 14 }, { won: false, sols: 9 })).toBe('not');
    expect(labOutcome({ won: false, sols: 9 }, { won: true, sols: 20 })).toBe('sooner');
    expect(hypothesisHeld('later', 'later')).toBe(true);
    expect(hypothesisHeld('sooner', 'same')).toBe(false);
  });
});
