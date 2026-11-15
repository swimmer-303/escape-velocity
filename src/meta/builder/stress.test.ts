// Written with AI assistance (Claude Code). See README "Use of AI tools".
// Outpost Architect: the stress test on known layouts. A tiny base fails, a careful base passes with 1 or 2 stars,
// a storm-proof base gets 3, and the storm is the real May 20, 2024 event from the NASA DONKI snapshot.
import { describe, it, expect } from 'vitest';
import { DUST_STORM_LENGTH, MOON_TUNING, ARCADIA, STORM_DOSE } from '../../sim/constants';
import { may2024Pool } from '../../data/donki';
import { runStress, stressEvent, stressSchedule, readout, STRESS_SOLS } from './stress';
import { autoLayout, withBerms } from './fixtures.test-util';
import { emptyLayout } from './layout';

const FOUR = { habitat: 2, o2: 1, greenhouse: 1, heater: 1, shelter: 1, monitor: 1, rocket: 1 } as const;

describe('the schedule', () => {
  it('Mars: a 3-sol dust storm (the game length), a cold night and the solar storm', () => {
    const s = stressSchedule('gale');
    expect(s).toHaveLength(STRESS_SOLS);
    expect(s.filter((d) => d.weather !== 'clear')).toHaveLength(DUST_STORM_LENGTH);
    expect(s.filter((d) => d.coldSnap)).toHaveLength(1);
    expect(s.filter((d) => d.storm)).toHaveLength(1);
    expect(s.find((d) => d.storm)!.storm!.fast).toBe(true);
    // Orbiters spot the dust a day ahead.
    expect(s[1].saveForTomorrow).toBe(true);
  });

  it('Arcadia has the game\'s extra cold nights; the Moon has a lunar night of MOON_TUNING.nightLength turns', () => {
    expect(stressSchedule('arcadia').filter((d) => d.coldSnap)).toHaveLength(1 + ARCADIA.extraColdSnaps);
    const moon = stressSchedule('moon');
    expect(moon.filter((d) => d.night)).toHaveLength(MOON_TUNING.cadet.nightLength);
    expect(moon.every((d) => d.weather === 'clear' && !d.coldSnap)).toBe(true);
  });

  it('uses the real far-side eruption of May 20, 2024 from the DONKI snapshot', () => {
    const ev = stressEvent();
    expect(ev).not.toBeNull();
    expect(may2024Pool().some((e) => e.id === ev!.id)).toBe(true);
    expect(ev!.time.startsWith('2024-05-20')).toBe(true);
    expect(ev!.severity).toBe('major');
    expect(ev!.origin).toBe('archive');
  });
});

describe('pass and fail', () => {
  it('an empty pad fails with a plain reason', () => {
    const r = runStress(emptyLayout('gale'));
    expect(r.pass).toBe(false);
    expect(r.stars).toBe(0);
    expect(r.notes[0]).toMatch(/Habitat/);
  });

  it('no Sun watcher on Mars: the fast storm arrives before the warning, so the test fails', () => {
    const r = runStress(autoLayout('gale', { ...FOUR, monitor: 0, solar: 10, battery: 2 }));
    expect(r.pass).toBe(false);
    const storm = r.sols.find((s) => s.day.storm)!;
    expect(storm.plan.warned).toBe(false);
    expect(storm.plan.stormDose).toBe(STORM_DOSE.major);
    expect(r.notes.join(' ')).toMatch(/Sun watcher/);
  });

  it('too few shelter seats fails', () => {
    const r = runStress(autoLayout('gale', { ...FOUR, habitat: 3, heater: 2, solar: 14, battery: 2 }));
    expect(r.crew).toBe(6);
    expect(r.pass).toBe(false);
    expect(r.notes.join(' ')).toMatch(/fit 4 of 6/);
  });

  it('a lean base passes on its reserves (1 star), dipping into saved food in the dust storm', () => {
    const r = runStress(autoLayout('gale', { ...FOUR, solar: 7 }));
    expect(r.pass).toBe(true);
    expect(r.stars).toBe(1);
    expect(r.steady).toBe(false);
    expect(r.foodLeft).toBeLessThan(6 * 4 + 1e-9);
  });

  it('batteries before the dust storm make it steady (2 stars)', () => {
    const r = runStress(autoLayout('gale', { ...FOUR, solar: 10, battery: 2 }));
    expect(r.stars).toBe(2);
    expect(r.steady).toBe(true);
    expect(r.stormProof).toBe(false);
  });

  it('enough power to fill the rocket every sol, even in the dust, gets 3 stars', () => {
    const r = runStress(autoLayout('gale', { ...FOUR, solar: 11, battery: 2 }));
    expect(r.stars).toBe(3);
    expect(r.sols.every((s) => s.plan.fuelPct > 0)).toBe(true);
  });

  it('the lunar night: batteries alone get the crew through on reserves; a reactor makes it storm-proof', () => {
    const solarOnly = runStress(autoLayout('moon', { ...FOUR, monitor: 0, solar: 9, battery: 2 }));
    expect(solarOnly.pass).toBe(true);
    expect(solarOnly.steady).toBe(false);
    const reactor = runStress(autoLayout('moon', { ...FOUR, monitor: 0, solar: 10, battery: 2, reactor: 2 }));
    expect(reactor.stars).toBe(3);
  });

  it('six crew in two bermed shelters are 90% shielded with one cell each', () => {
    const r = runStress(withBerms('gale', { ...FOUR, habitat: 3, heater: 2, shelter: 2, solar: 14, battery: 3 }));
    const storm = r.sols.find((s) => s.day.storm)!;
    expect(storm.plan.sheltered).toBe(6);
    expect(storm.plan.block).toBeCloseTo(0.9, 10);
    expect(storm.plan.use.shelter).toBe(2);
    expect(r.pass).toBe(true);
  });

  it('the readout verdict predicts the test', () => {
    expect(readout(autoLayout('gale', { ...FOUR, solar: 7 })).verdict.text).toMatch(/dust storm/);
    expect(readout(autoLayout('moon', { ...FOUR, monitor: 0, solar: 9, battery: 2 })).verdict.text).toMatch(/night/);
    expect(readout(autoLayout('gale', { ...FOUR, solar: 11, battery: 2 })).verdict.tone).toBe('good');
    expect(readout(autoLayout('gale', { habitat: 2 })).verdict.text).toMatch(/power/i);
  });
});
