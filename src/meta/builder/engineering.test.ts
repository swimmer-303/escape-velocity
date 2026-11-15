// Written with AI assistance (Claude Code). See README "Use of AI tools".
// Outpost Architect: the live readout uses the game's own numbers. Every rate is checked against the sim's own
// functions and constants for a real mission at each site, and the day plan is checked by hand on known bases.
import { describe, it, expect } from 'vitest';
import { ARCADIA, DUST_LOSS, HEATER_NEED, MODULE_CAP, MOON_BATTERY, MOON_NIGHT, RATES, REAL, STORM_DOSE, SHELTER_BLOCK, TUNING } from '../../sim/constants';
import { REACTOR_CELLS, UPGRADE_BOOST, airPerCell, backgroundDose, createMission, foodPerGreenhouseCell, fuelPctPerCell, greenhouseAirPerCell, solarCells } from '../../sim/sim';
import { freshBase } from '../../sim/upgrades';
import { TEST_POOL } from '../../sim/fixtures.test-util';
import { CLEAR_DAY, FRESH, countBase, heatNeed, planDay, ratesFor, solarToday } from './engineering';
import { readout } from './stress';
import { autoLayout, withBerms } from './fixtures.test-util';

describe("rates come from the game's sim", () => {
  it('matches the sim at Gale Crater', () => {
    const s = createMission({ seed: 't', difficulty: 'cadet', lightTimeMin: 12, eventPool: TEST_POOL, expedition: 1, base: freshBase(), prefillPct: 0 });
    const r = ratesFor('gale');
    expect(r.air).toBe(airPerCell(s));
    expect(r.air).toBe(RATES.airPerCell);
    expect(r.airBig).toBe(RATES.airPerCell * UPGRADE_BOOST);
    expect(r.food).toBe(foodPerGreenhouseCell(s));
    expect(r.ghAir).toBe(greenhouseAirPerCell(s));
    expect(r.fuel).toBeCloseTo(fuelPctPerCell(s), 10);
    expect(r.background).toBe(backgroundDose(s));
    expect(r.background).toBe(REAL.marsSurfaceMsvPerDay);
    expect(r.block).toEqual([...SHELTER_BLOCK]);
    expect(r.blockBerm).toEqual([0, SHELTER_BLOCK[2], SHELTER_BLOCK[2]]);
    expect(r.arraySite).toBe(solarCells(s));
    expect(r.doseBudget).toBe(TUNING.cadet.doseBudget);
    expect(r.startAirDays).toBe(TUNING.cadet.startAirDays);
  });

  it('matches the sim at Arcadia (ice: twice the greenhouse; less sun) and on the Moon', () => {
    const arc = createMission({ seed: 't', difficulty: 'cadet', landing: 'arcadia', lightTimeMin: 12, eventPool: TEST_POOL, expedition: 1, base: freshBase(), prefillPct: 0 });
    const ra = ratesFor('arcadia');
    expect(ra.food).toBe(foodPerGreenhouseCell(arc));
    expect(ra.food).toBe(RATES.foodPerGreenhouseCell * ARCADIA.greenhouseBoost);
    expect(ra.ghAir).toBe(greenhouseAirPerCell(arc));
    expect(ra.arraySite).toBe(solarCells(arc));
    expect(ra.arraySite).toBe(TUNING.cadet.baseCells - ARCADIA.sunCellsLost);
    const moon = createMission({ seed: 't', difficulty: 'cadet', site: 'moon', lightTimeMin: 1.3 / 60, eventPool: TEST_POOL, expedition: 1, base: freshBase(), prefillPct: 0 });
    const rm = ratesFor('moon');
    expect(rm.fuel).toBeCloseTo(fuelPctPerCell(moon), 10);
    expect(rm.background).toBeCloseTo(REAL.moonSurfaceUsvPerDay / 1000, 10);
    expect(rm.doseBudget).toBe(36);
  });
});

describe('making power', () => {
  it('panels: 1 cell each on a clear sol, the game rounding for dust, 6 of 7 at Arcadia, none on a lunar night', () => {
    expect(solarToday(7, 'gale', { weather: 'clear', night: false })).toBe(7);
    expect(solarToday(7, 'gale', { weather: 'dusty', night: false })).toBe(7 - Math.round(7 * DUST_LOSS.dusty));
    expect(solarToday(10, 'gale', { weather: 'storm', night: false })).toBe(10 - Math.round(10 * DUST_LOSS.storm));
    expect(solarToday(7, 'arcadia', { weather: 'clear', night: false })).toBe(TUNING.cadet.baseCells - ARCADIA.sunCellsLost);
    expect(solarToday(9, 'moon', { weather: 'clear', night: false })).toBe(9);
    expect(solarToday(9, 'moon', { weather: 'clear', night: true })).toBe(0);
    expect(solarToday(0, 'gale', { weather: 'clear', night: false })).toBe(0);
  });

  it('a reactor adds REACTOR_CELLS day and night; the game floor keeps a dark base at its backup cells', () => {
    const night = { weather: 'clear' as const, coldSnap: false, night: true };
    const withReactor = countBase(autoLayout('moon', { habitat: 2, solar: 4, reactor: 1 }));
    expect(planDay(withReactor, night).cells).toBe(Math.max(MOON_NIGHT.floorCells, REACTOR_CELLS));
    const solarOnly = countBase(autoLayout('moon', { habitat: 2, solar: 4 }));
    expect(planDay(solarOnly, night).cells).toBe(MOON_NIGHT.floorCells);
    // No power parts at all: nothing (no free floor).
    expect(planDay(countBase(autoLayout('gale', { habitat: 1 })), CLEAR_DAY).cells).toBe(0);
  });
});

describe('a day for 4 crew at Gale Crater', () => {
  const layout = autoLayout('gale', { habitat: 2, o2: 1, greenhouse: 1, heater: 1, solar: 10, shelter: 1, monitor: 1, rocket: 1 });
  const b = countBase(layout);
  const p = planDay(b, CLEAR_DAY);

  it('counts crew from beds and shelter seats', () => {
    expect(b.crew).toBe(4);
    expect(b.seats).toBe(4);
  });

  it('makes exactly what the sim rates say', () => {
    expect(p.cells).toBe(10);
    // Air: 4 crew need 4 person-days; the greenhouse adds 2 x 0.6 = 1.2, so 1 O2 cell (4) covers the rest.
    expect(p.airNeed).toBe(4 * RATES.usePerPersonPerSol);
    expect(p.use.air).toBe(1);
    expect(p.airMade).toBeCloseTo(RATES.airPerCell + 2 * RATES.airPerGreenhouseCell, 10);
    // Food: 4 / 2 per cell = 2 greenhouse cells.
    expect(p.use.food).toBe(2);
    expect(p.foodMade).toBe(4);
    // Heat: 1 per habitat (2) on a normal night.
    expect(p.heatNeed).toBe(2 * HEATER_NEED.normal);
    expect(p.use.heat).toBe(2);
    expect(p.use.monitor).toBe(MODULE_CAP.monitor);
    // Everything else fills the rocket at the sim's fuel rate.
    expect(p.use.fuel).toBe(10 - 1 - 2 - 2 - 1);
    expect(p.fuelPct).toBeCloseTo(p.use.fuel * ratesFor('gale').fuel, 10);
    expect(p.spare).toBe(0);
  });

  it('readout: rocket full in ceil(100 / fuel per sol) sols, and a friendly verdict', () => {
    const r = readout(layout);
    expect(r.solsToFill).toBe(Math.ceil(100 / r.sunny.fuelPct));
    expect(r.verdict.text.length).toBeGreaterThan(10);
  });
});

describe('the rules for heat, shelters, batteries and the O2 trade-off', () => {
  it('cold snaps and the lunar night add heat; extra greenhouse domes are one more building to heat', () => {
    const b = countBase(autoLayout('gale', { habitat: 2, greenhouse: 3 }));
    expect(heatNeed(b, { coldSnap: false, night: false })).toBe(2 + 2);
    expect(heatNeed(b, { coldSnap: true, night: false })).toBe(2 + 2 + HEATER_NEED.coldSnap);
    expect(heatNeed(b, { coldSnap: false, night: true })).toBe(2 + 2 + MOON_NIGHT.heaterExtra);
    expect(heatNeed(countBase(autoLayout('gale', { greenhouse: 1 })), { coldSnap: true, night: false })).toBe(0);
  });

  it('a heater takes at most MODULE_CAP.heaters cells, so a big base needs more heaters', () => {
    const b = countBase(autoLayout('gale', { habitat: 4, heater: 1, solar: 12 }));
    const p = planDay(b, CLEAR_DAY);
    expect(p.heatNeed).toBe(4);
    expect(p.use.heat).toBe(MODULE_CAP.heaters);
    expect(p.heatShort).toBe(1);
  });

  it('shelter: 2 cells block 90%, a berm next to it does the same with 1 cell; a fast storm needs the Sun watcher', () => {
    const storm = { ...CLEAR_DAY, storm: { severity: 'major' as const, fast: true } };
    const list = { habitat: 2, o2: 1, greenhouse: 1, heater: 1, solar: 10, shelter: 1, monitor: 1 };
    const base = autoLayout('gale', list);
    const warned = { ...FRESH, monitorOnline: true };
    const p = planDay(countBase(base), storm, warned);
    expect(p.warned).toBe(true);
    expect(p.use.shelter).toBe(2);
    expect(p.block).toBe(SHELTER_BLOCK[2]);
    expect(p.stormDose).toBeCloseTo(STORM_DOSE.major * (1 - SHELTER_BLOCK[2]), 10);
    const bermed = planDay(countBase(withBerms('gale', list)), storm, warned);
    expect(bermed.use.shelter).toBe(1);
    expect(bermed.block).toBe(SHELTER_BLOCK[2]);
    // No warning: the fast storm hits everyone unsheltered.
    const late = planDay(countBase(base), storm, FRESH);
    expect(late.warned).toBe(false);
    expect(late.stormDose).toBe(STORM_DOSE.major);
    // On the Moon, Earth's warning takes 1.3 seconds: always in time.
    const moon = planDay(countBase(autoLayout('moon', { habitat: 2, solar: 6, shelter: 1 })), storm, FRESH);
    expect(moon.warned).toBe(true);
  });

  it('a shelter fits 4: six crew in one shelter leaves two unprotected', () => {
    const storm = { ...CLEAR_DAY, storm: { severity: 'major' as const, fast: false } };
    const p = planDay(countBase(autoLayout('gale', { habitat: 3, solar: 10, shelter: 1 })), storm);
    expect(p.sheltered).toBe(4);
    expect(p.block).toBe(0);
    expect(p.stormDose).toBe(STORM_DOSE.major);
  });

  it('Moon batteries charge by day (up to 2 per bank) and hold MOON_BATTERY.capacity each', () => {
    const b = countBase(autoLayout('moon', { habitat: 2, o2: 1, greenhouse: 1, heater: 1, solar: 14, battery: 2 }));
    const day = planDay(b, CLEAR_DAY);
    expect(day.use.battery).toBe(2 * MODULE_CAP.battery);
    const full = planDay(b, CLEAR_DAY, { ...FRESH, stored: 2 * MOON_BATTERY.capacity });
    expect(full.use.battery).toBe(0);
    // At night the base takes only what it needs, up to MOON_BATTERY.releasePerNight per bank.
    const night = planDay(b, { weather: 'clear', coldSnap: false, night: true, nightsLeft: 3 }, { ...FRESH, stored: 12 });
    expect(night.fromBattery).toBeLessThanOrEqual(2 * MOON_BATTERY.releasePerNight);
    expect(night.heatShort).toBe(0);
  });

  it('no choice is free: every extra cell of air is a cell not filling the rocket', () => {
    const small = planDay(countBase(autoLayout('gale', { habitat: 2, o2: 1, greenhouse: 1, heater: 1, solar: 10, rocket: 1 })), CLEAR_DAY);
    const bigger = planDay(countBase(autoLayout('gale', { habitat: 3, o2: 1, greenhouse: 1, heater: 1, solar: 10, rocket: 1 })), CLEAR_DAY);
    expect(bigger.use.fuel).toBeLessThan(small.use.fuel);
    expect(bigger.fuelPct).toBeLessThan(small.fuelPct);
  });
});
