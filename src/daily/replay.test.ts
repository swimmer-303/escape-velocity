// Written with AI assistance (Claude Code). See README "Use of AI tools".
// Daily challenge: dates, the site rule, replay verification and the board order.
import { describe, it, expect, vi } from 'vitest';
import { createMission, planFor } from '../sim/sim';
import { builder, playOut, pureGreed } from '../sim/strategies';
import { TEST_POOL } from '../sim/fixtures.test-util';
import { dailyConfigFor, offlineDailyConfig, type DayEvents } from './pool';
import { dailyMissionConfig, movesFromLog, replayDaily, scoreOf } from './replay';
import { addDays, compareScores, easternDate, isDateKey, prettyDate, siteForDate, type DailyConfig, type DailyMove, type DailyScore } from './protocol';

// Each test replays whole missions (hundreds, for the limits): allow for a busy CI machine.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const EVENTS: DayEvents = { pool: TEST_POOL, data: { status: 'archive', fetchedAt: null, startDate: null, endDate: null } };
const SAT = '2026-11-14';
const SUN = '2026-11-15';

function playDaily(cfg: DailyConfig, strategy = builder) {
  return playOut(createMission(dailyMissionConfig(cfg)), strategy);
}

describe('daily dates and site', () => {
  it('keys the day by the US Eastern date', () => {
    expect(easternDate(new Date('2026-11-15T03:30:00Z'))).toBe('2026-11-14'); // 10:30 PM in Charlotte
    expect(easternDate(new Date('2026-11-15T05:30:00Z'))).toBe('2026-11-15'); // 12:30 AM in Charlotte
    expect(easternDate(new Date('2026-07-04T03:59:00Z'))).toBe('2026-07-03'); // summer time: UTC-4
    expect(easternDate(new Date('2026-07-04T04:01:00Z'))).toBe('2026-07-04');
  });

  it('checks dates, adds days and shows them short', () => {
    expect(isDateKey('2026-11-15')).toBe(true);
    expect(isDateKey('2026-02-30')).toBe(false);
    expect(isDateKey('2026-11-5')).toBe(false);
    expect(isDateKey(20261115)).toBe(false);
    expect(addDays('2026-11-15', -14)).toBe('2026-11-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(prettyDate('2026-11-15')).toBe('Nov 15');
  });

  it('builds on Mars on most days and on the Moon on Sundays', () => {
    expect(siteForDate(SAT)).toBe('mars');
    expect(siteForDate(SUN)).toBe('moon');
    expect(siteForDate('2026-11-16')).toBe('mars');
    const moon = dailyConfigFor(SUN, EVENTS);
    expect(moon.site).toBe('moon');
    expect(moon.lightTimeMin * 60).toBeCloseTo(1.3, 5);
    expect(dailyConfigFor(SAT, EVENTS).lightTimeMin).toBeGreaterThan(3);
  });

  it('uses the date as the seed, so the offline challenge matches the plan of the day', () => {
    const off = offlineDailyConfig(SAT);
    expect(off.seed).toBe(SAT);
    expect(off.poolSource).toBe('archive');
    expect(off.eventPool.length).toBeGreaterThan(5);
    expect(off.eventPool.every((e) => e.origin === 'archive')).toBe(true);
  });
});

describe('daily replay verification', () => {
  for (const date of [SAT, SUN]) {
    it(`a valid move list scores exactly like the game it came from (${siteForDate(date)})`, () => {
      const cfg = dailyConfigFor(date, EVENTS);
      const end = playDaily(cfg);
      expect(end.status).not.toBe('playing');
      const moves = movesFromLog(end);
      expect(moves.length).toBe(end.log.length);
      const r = replayDaily(cfg, JSON.parse(JSON.stringify(moves)));
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.score).toEqual(scoreOf(end));
      expect(r.end.fuel).toBe(end.fuel);
      expect(r.end.dose).toBe(end.dose);
      expect(r.end.base).toEqual(end.base);
    });
  }

  it('the builder launches on today\'s Mars, and a greedy crew comes home early', () => {
    const cfg = dailyConfigFor(SAT, EVENTS);
    const won = replayDaily(cfg, movesFromLog(playDaily(cfg)));
    const lost = replayDaily(cfg, movesFromLog(playDaily(cfg, pureGreed)));
    expect(won.ok && won.score.won).toBe(true);
    expect(won.ok && won.score.stars).toBeGreaterThanOrEqual(1);
    expect(lost.ok && lost.score.won).toBe(false);
  });

  it('the same moves on a different pool (another day) are not today\'s game', () => {
    const today = dailyConfigFor(SAT, EVENTS);
    const moves = movesFromLog(playDaily(today));
    const other = offlineDailyConfig(SAT);
    const r = replayDaily(other, moves);
    // Either illegal on that day, or at least a different game: never silently today's score.
    if (r.ok) expect(r.end.plan).not.toEqual(createMission(dailyMissionConfig(today)).plan);
  });

  describe('rejects games the real game could never make', () => {
    const cfg = dailyConfigFor(SAT, EVENTS);
    const good = movesFromLog(playDaily(cfg));
    const copy = () => JSON.parse(JSON.stringify(good)) as DailyMove[];

    it('one extra power cell', () => {
      const moves = copy();
      moves[2].a[1] += 1; // one more cell on FUEL than the base had
      expect(replayDaily(cfg, moves)).toMatchObject({ ok: false, problem: 'illegal-alloc', turn: 3 });
    });

    it('a cell missing (every cell must be placed)', () => {
      const moves = copy();
      const i = moves[0].a.findIndex((n) => n > 0);
      moves[0].a[i] -= 1;
      expect(replayDaily(cfg, moves)).toMatchObject({ ok: false, problem: 'illegal-alloc', turn: 1 });
    });

    it('a module over its cap, or a module the base has not built', () => {
      const moves = copy();
      moves[0].a = [0, 0, 0, 0, 0, 0, 0, 0];
      moves[0].a[5] = 1; // the radiation monitor is not built on sol 1
      expect(replayDaily(cfg, moves)).toMatchObject({ ok: false, problem: 'illegal-alloc' });
    });

    it('a cargo crate on a day with no lander', () => {
      const moves = copy();
      const plan = createMission(dailyMissionConfig(cfg)).plan;
      const day = plan.findIndex((p) => !p.resupply);
      moves[day].c = 'food';
      expect(replayDaily(cfg, moves)).toMatchObject({ ok: false, problem: 'illegal-crate', turn: day + 1 });
      expect(planFor(createMission(dailyMissionConfig(cfg)), day + 1).resupply).toBe(false);
    });

    it('a Workshop project the base cannot build (no monitor on the Moon)', () => {
      const moon = dailyConfigFor(SUN, EVENTS);
      const moves = movesFromLog(playDaily(moon));
      moves[0].p = 'monitor';
      expect(replayDaily(moon, moves)).toMatchObject({ ok: false, problem: 'illegal-project', turn: 1 });
    });

    it('moves after the mission ended, an unfinished mission, and too many moves', () => {
      expect(replayDaily(cfg, [...copy(), copy()[0]])).toMatchObject({ ok: false, problem: 'extra-moves' });
      expect(replayDaily(cfg, copy().slice(0, 3))).toMatchObject({ ok: false, problem: 'unfinished' });
      expect(replayDaily(cfg, Array.from({ length: 41 }, () => copy()[0]))).toMatchObject({ ok: false, problem: 'too-many' });
    });

    it('anything that is not a move list', () => {
      for (const bad of [null, 'moves', {}, [], [null], [{ a: [1, 2, 3] }], [{ a: [0, 0, 0, 0, 0, 0, 0, -1] }], [{ a: [0.5, 0, 0, 0, 0, 0, 0, 0] }], [{ a: [0, 0, 0, 0, 0, 0, 0, 0], c: 'pizza' }], [{ a: [0, 0, 0, 0, 0, 0, 0, 0], p: 'castle' }]]) {
        expect(replayDaily(cfg, bad).ok, JSON.stringify(bad)).toBe(false);
      }
    });
  });
});

describe('daily board order', () => {
  const s = (won: boolean, sols: number, dose: number, stars: number, fuel = won ? 100 : 50): DailyScore => ({ won, sols, dose, stars, fuel });

  it('launched first, then fewer sols, then lower dose, then more stars', () => {
    const list = [
      s(false, 21, 5, 0, 90),
      s(true, 15, 9.5, 2),
      s(true, 14, 12.0, 1),
      s(true, 15, 9.5, 3),
      s(true, 15, 8.1, 1),
      s(false, 6, 2, 0, 20),
      s(false, 21, 4, 1, 95),
    ];
    const sorted = [...list].sort(compareScores);
    expect(sorted).toEqual([s(true, 14, 12.0, 1), s(true, 15, 8.1, 1), s(true, 15, 9.5, 3), s(true, 15, 9.5, 2), s(false, 21, 4, 1, 95), s(false, 21, 5, 0, 90), s(false, 6, 2, 0, 20)]);
  });

  it('equal scores are a tie (the board keeps them in the order they arrived)', () => {
    expect(compareScores(s(true, 15, 9.5, 2), s(true, 15, 9.5, 2))).toBe(0);
  });
});
