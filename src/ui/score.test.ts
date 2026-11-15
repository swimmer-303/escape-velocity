// @vitest-environment happy-dom
// Written with AI assistance (Claude Code). See README "Use of AI tools".
// Game-feel scoring: perfect sols, streak XP, the end-screen score and grade, and personal bests.
// None of it changes a mission (the sim's results stay exactly the same).
import { describe, it, expect, beforeEach } from 'vitest';
import { createMission, emptyAlloc, runSol, windowSol } from '../sim/sim';
import { newCampaign, missionConfigFor, starsFor } from '../sim/campaign';
import type { MissionState, SolReport } from '../sim/types';
import { bestScore, fuelPace, isPerfectSol, recordBest, scoreMission, streakXp } from './score';

function mission(): MissionState {
  const c = newCampaign('score-test', 'cadet');
  return createMission(missionConfigFor(c, 12, []));
}

function fakeReport(over: Partial<SolReport>, before = { air: 4, food: 4, dose: 1, fuel: 0 }, after = { air: 4, food: 4, dose: 1.2, fuel: 8 }): SolReport {
  return {
    sol: 1,
    alloc: emptyAlloc(),
    cells: 8,
    weather: 'clear',
    coldSnap: false,
    baseDose: 0.2,
    airMade: 0,
    foodMade: 0,
    fuelMade: 0,
    heaterShortfall: 0,
    newDamage: false,
    blackout: false,
    cleaning: false,
    stored: 0,
    before,
    after,
    ...over,
  };
}

beforeEach(() => localStorage.clear());

describe('perfect sols', () => {
  it('the fuel pace is a straight line from the starting fuel to (almost) full on the last sol', () => {
    expect(fuelPace(0, 0, 18)).toBe(0);
    expect(fuelPace(0, 18, 18)).toBeCloseTo(85);
    expect(fuelPace(50, 9, 18)).toBeCloseTo(50 + 50 * 0.5 * 0.85);
  });

  it('needs everything safe and the tank on pace', () => {
    const m = mission();
    const w = windowSol(m);
    const ok = fakeReport({});
    m.log = [ok];
    expect(isPerfectSol(ok, m, w)).toBe(true);
    expect(isPerfectSol(fakeReport({}, undefined, { air: 1.2, food: 4, dose: 1.2, fuel: 8 }), m, w)).toBe(false);
    expect(isPerfectSol(fakeReport({ heaterShortfall: 1 }), m, w)).toBe(false);
    expect(isPerfectSol(fakeReport({ newDamage: true }), m, w)).toBe(false);
    expect(isPerfectSol(fakeReport({}, undefined, { air: 4, food: 4, dose: m.doseBudget * 0.8, fuel: 8 }), m, w)).toBe(false);
    // Behind on fuel.
    expect(isPerfectSol(fakeReport({}, undefined, { air: 4, food: 4, dose: 1, fuel: 1 }), m, w)).toBe(false);
  });

  it('a storm counts only if the crew was in a powered shelter', () => {
    const m = mission();
    const event = { id: 'x', kind: 'flare', time: '2024-05-08T00:00:00Z' } as unknown as NonNullable<SolReport['storm']>['event'];
    const storm = { event, fast: false, warnedBy: 'earth' as const, shelterCells: 0, doseUnsheltered: 2, doseTaken: 2 };
    expect(isPerfectSol(fakeReport({ storm }), m, windowSol(m))).toBe(false);
    expect(isPerfectSol(fakeReport({ storm: { ...storm, shelterCells: 2, doseTaken: 0.2 } }), m, windowSol(m))).toBe(true);
  });

  it('streak XP is small and starts at two in a row', () => {
    expect([1, 2, 3, 4, 5, 9].map(streakXp)).toEqual([0, 10, 15, 20, 20, 20]);
  });

  it('checking for a perfect sol never changes the mission', () => {
    const m = mission();
    const alloc = { ...emptyAlloc(), air: 2, fuel: 2, greenhouse: 2, heaters: 1 };
    const a = runSol(m, alloc);
    const copy = JSON.stringify(a.next);
    isPerfectSol(a.report, a.next, windowSol(a.next));
    expect(JSON.stringify(a.next)).toBe(copy);
  });
});

describe('the end-screen score', () => {
  it('grades from the stars: S for all three with a tiny dose, A for 2 or 3, B for a launch, C for coming home early', () => {
    const m = mission();
    const w = windowSol(m);
    const won = (dose: number, built: boolean): MissionState => ({ ...m, status: 'won', fuel: 100, dose, builtThisExpedition: built ? ['panel'] : [], log: m.log });
    expect(starsFor(won(1, true)).length).toBe(3);
    expect(scoreMission(won(m.doseBudget * 0.3, true), w).grade).toBe('S');
    expect(scoreMission(won(m.doseBudget * 0.5, true), w).grade).toBe('A');
    expect(scoreMission(won(m.doseBudget * 0.5, false), w).grade).toBe('A');
    expect(scoreMission(won(m.doseBudget * 0.9, false), w).grade).toBe('B');
    expect(scoreMission({ ...m, status: 'lost', fuel: 40 }, w).grade).toBe('C');
  });

  it('adds up launching, fuel, safety, upgrades and time to spare', () => {
    const m = mission();
    const s = scoreMission({ ...m, status: 'won', fuel: 100, dose: 0, builtThisExpedition: ['panel'], log: [] }, 10, 'Days');
    expect(s.parts.map((p) => p.label)).toEqual(['Launched home', 'Rocket fuel', 'Crew safety', 'Upgrades built', 'Days to spare']);
    expect(s.score).toBe(1000 + 500 + 1000 + 250 + 1000);
    const lost = scoreMission({ ...m, status: 'lost', fuel: 30, dose: m.doseBudget }, 10);
    expect(lost.score).toBe(150);
  });

  it('keeps personal bests per mode', () => {
    expect(bestScore('quick-mars')).toBeNull();
    expect(recordBest('quick-mars', 1200)).toEqual({ isNew: true, previous: null });
    expect(recordBest('quick-mars', 900)).toEqual({ isNew: false, previous: 1200 });
    expect(recordBest('quick-mars', 1500)).toEqual({ isNew: true, previous: 1200 });
    expect(bestScore('quick-mars')).toBe(1500);
    expect(bestScore('daily-mars')).toBeNull();
  });
});
