// Written with AI assistance (Claude Code). See README "Use of AI tools".
import { describe, it, expect } from 'vitest';
import { DAILY_MISSIONS, dayKey, missionById, missionsForDay, previousDay, type TrackEvent } from './daily';
import { fakeMission, fakeReport, fakeStorm } from './fixtures';

const solEv = (over: Parameters<typeof fakeReport>[0] = {}, mode: 'quick' | 'daily' | 'history' = 'quick', site?: 'moon'): TrackEvent => {
  const m = fakeMission({}, site ? { site } : {});
  return { type: 'sol', before: m, after: m, report: fakeReport(over), mode };
};
const endEv = (won: boolean, over: Parameters<typeof fakeMission>[0] = {}, stars: Array<'launch' | 'safe' | 'builder'> = [], difficulty: 'cadet' | 'commander' = 'cadet'): TrackEvent => ({
  type: 'end',
  mission: fakeMission({ status: won ? 'won' : 'lost', ...over }, { difficulty }),
  won,
  mode: 'quick',
  stars,
});

describe('daily mission pick', () => {
  it('is the same for everyone on the same day: one quick, one medium and one stretch goal', () => {
    const a = missionsForDay('2026-11-14').map((m) => m.id);
    expect(missionsForDay('2026-11-14').map((m) => m.id)).toEqual(a);
    expect(new Set(a).size).toBe(3);
    expect(missionsForDay('2026-11-14').map((m) => m.slot)).toEqual(['easy', 'medium', 'hard']);
  });

  it('changes from day to day, and every mission in the pool comes up within a few months', () => {
    const seen = new Set<string>();
    const combos = new Set<string>();
    let key = '2027-03-01';
    for (let i = 0; i < 120; i++) {
      const ids = missionsForDay(key).map((m) => m.id);
      ids.forEach((id) => seen.add(id));
      combos.add(ids.join());
      key = previousDay(key);
    }
    expect(seen.size).toBe(DAILY_MISSIONS.length);
    expect(combos.size).toBeGreaterThan(60);
  });

  it('has about 20 kinds of mission with unique ids and plain words', () => {
    expect(DAILY_MISSIONS.length).toBeGreaterThanOrEqual(20);
    expect(new Set(DAILY_MISSIONS.map((m) => m.id)).size).toBe(DAILY_MISSIONS.length);
    for (const m of DAILY_MISSIONS) {
      expect(m.goal).toBeGreaterThan(0);
      expect(m.xp).toBeGreaterThan(0);
      expect(`${m.title} ${m.detail}`).toMatch(/^[\x20-\x7e]+$/);
    }
  });

  it('uses the local calendar day, across month and year ends', () => {
    expect(dayKey(new Date(2026, 10, 14, 23, 59))).toBe('2026-11-14');
    expect(dayKey(new Date(2026, 0, 5, 0, 1))).toBe('2026-01-05');
    expect(previousDay('2026-03-01')).toBe('2026-02-28');
    expect(previousDay('2028-03-01')).toBe('2028-02-29');
    expect(previousDay('2026-01-01')).toBe('2025-12-31');
  });
});

describe('daily mission progress', () => {
  const count = (id: string, ev: TrackEvent) => missionById(id)!.count(ev);

  it('counts sols, cells and greenhouse days', () => {
    expect(count('play-sols', solEv())).toBe(1);
    expect(count('fuel-cells', solEv({ alloc: { air: 1, fuel: 4, greenhouse: 0, heaters: 1, shelter: 0, monitor: 0, build: 0, battery: 0 } }))).toBe(4);
    expect(count('greenhouse', solEv({ alloc: { air: 1, fuel: 4, greenhouse: 0, heaters: 1, shelter: 0, monitor: 0, build: 0, battery: 0 } }))).toBe(0);
    expect(count('greenhouse', solEv())).toBe(1);
    expect(count('play-sols', endEv(true))).toBe(0);
  });

  it('counts a storm only when the crew was in the shelter', () => {
    expect(count('shelter', solEv({ storm: fakeStorm({ shelterCells: 1 }) }))).toBe(1);
    expect(count('shelter', solEv({ storm: fakeStorm({ shelterCells: 0 }) }))).toBe(0);
    expect(count('shelter', solEv())).toBe(0);
    expect(count('big-storm', solEv({ storm: fakeStorm({ severity: 'major' }) }))).toBe(1);
    expect(count('big-storm', solEv({ storm: fakeStorm({ severity: 'moderate' }) }))).toBe(0);
    expect(count('monitor', solEv({ storm: fakeStorm({ warnedBy: 'monitor' }) }))).toBe(1);
    expect(count('monitor', solEv({ storm: fakeStorm({ warnedBy: 'earth' }) }))).toBe(0);
  });

  it('counts a warm cold night, a dusty sol, upgrades, Moon days and play modes', () => {
    expect(count('cold-night', solEv({ coldSnap: true, heaterShortfall: 0 }))).toBe(1);
    expect(count('cold-night', solEv({ coldSnap: true, heaterShortfall: 1 }))).toBe(0);
    expect(count('cold-night', solEv({ coldSnap: false }))).toBe(0);
    expect(count('dust', solEv({ weather: 'dusty' }))).toBe(1);
    expect(count('build', solEv({ built: 'panel', builtAll: ['panel', 'berm'] }))).toBe(2);
    expect(count('build', solEv({ built: 'panel' }))).toBe(1);
    expect(count('moon', solEv({}, 'quick', 'moon'))).toBe(1);
    expect(count('moon', solEv())).toBe(0);
    expect(count('history', solEv({}, 'history'))).toBe(1);
    expect(count('crate', solEv({ crate: 'food' }))).toBe(1);
  });

  it('checks the launch goals at the end of a mission', () => {
    expect(count('launch', endEv(true))).toBe(1);
    expect(count('launch', endEv(false))).toBe(0);
    expect(count('finish', endEv(false))).toBe(1);
    expect(count('safe-launch', endEv(true, { dose: 40, doseBudget: 100 }))).toBe(1);
    expect(count('safe-launch', endEv(true, { dose: 60, doseBudget: 100 }))).toBe(0);
    expect(count('fast-fill', endEv(true, { log: new Array(12).fill(fakeReport()) }))).toBe(1);
    expect(count('fast-fill', endEv(true, { log: new Array(13).fill(fakeReport()) }))).toBe(0);
    expect(count('three-stars', endEv(true, {}, ['launch', 'safe', 'builder']))).toBe(1);
    expect(count('three-stars', endEv(true, {}, ['launch', 'safe']))).toBe(0);
    expect(count('commander', endEv(true, {}, [], 'commander'))).toBe(1);
    expect(count('commander', endEv(true, {}, [], 'cadet'))).toBe(0);
    expect(count('level-up', { type: 'level', level: 3 })).toBe(1);
  });
});
