// Written with AI assistance (Claude Code). See README "Use of AI tools".
// Weekly challenges: ISO weeks, the same 7 for everyone each week, and nothing copied from the daily missions.
import { describe, it, expect } from 'vitest';
import { WEEKLY_CHALLENGES, WEEKLY_COUNT, challengesForWeek, isoWeekKey, nextWeekStart } from './weekly';
import { DAILY_MISSIONS } from '../rank/daily';
import { detectLiveEvent, eventChallenges, gannonFromSnapshot } from './live';
import { liveFeed, snapshotWith } from './fixtures';

describe('ISO weeks', () => {
  it('matches known ISO week numbers', () => {
    expect(isoWeekKey(new Date(2026, 10, 14))).toBe('2026-W46'); // Saturday Nov 14, 2026
    expect(isoWeekKey(new Date(2026, 10, 9))).toBe('2026-W46'); // its Monday
    expect(isoWeekKey(new Date(2026, 10, 16))).toBe('2026-W47'); // the next Monday
    expect(isoWeekKey(new Date(2021, 0, 1))).toBe('2020-W53'); // Jan 1, 2021 belongs to 2020's last week
    expect(isoWeekKey(new Date(2024, 11, 30))).toBe('2025-W01'); // Dec 30, 2024 is in 2025's week 1
    expect(isoWeekKey(new Date(2027, 0, 31, 23, 30))).toBe('2027-W04');
  });

  it('counts down to next Monday at midnight', () => {
    const sat = new Date(2026, 10, 14, 19, 0);
    const next = nextWeekStart(sat);
    expect(next.getDay()).toBe(1);
    expect([next.getFullYear(), next.getMonth(), next.getDate(), next.getHours()]).toEqual([2026, 10, 16, 0]);
    // A Monday counts down a whole week.
    expect(nextWeekStart(new Date(2026, 10, 16, 9)).getDate()).toBe(23);
  });
});

describe('the weekly pick', () => {
  it('is the same for everyone in a week (deterministic), and 7 different challenges', () => {
    const a = challengesForWeek('2026-W46').map((c) => c.id);
    const b = challengesForWeek('2026-W46').map((c) => c.id);
    expect(a).toEqual(b);
    expect(a).toHaveLength(WEEKLY_COUNT);
    expect(new Set(a).size).toBe(WEEKLY_COUNT);
  });

  it('changes from week to week', () => {
    const weeks = Array.from({ length: 12 }, (_, i) => challengesForWeek(`2026-W${String(40 + i).padStart(2, '0')}`).map((c) => c.id).join(','));
    expect(new Set(weeks).size).toBeGreaterThan(8);
    // Over a season every challenge shows up at least once.
    const seen = new Set(Array.from({ length: 30 }, (_, i) => challengesForWeek(`2027-W${String(i + 1).padStart(2, '0')}`).map((c) => c.id)).flat());
    expect(seen.size).toBe(WEEKLY_CHALLENGES.length);
  });

  it('is bigger than the daily missions and never reuses one', () => {
    const daily = new Set(DAILY_MISSIONS.map((m) => m.id));
    for (const c of WEEKLY_CHALLENGES) {
      expect(daily.has(c.id)).toBe(false);
      expect(c.xp).toBeGreaterThanOrEqual(300);
      expect(c.title.length).toBeLessThan(48);
    }
    expect(new Set(WEEKLY_CHALLENGES.map((c) => c.id)).size).toBe(WEEKLY_CHALLENGES.length);
  });

  it('never says "sol" in a title: titles pop up during Moon play, where a turn is a "day"', () => {
    const titles = [...WEEKLY_CHALLENGES.map((c) => c.title), ...eventChallenges(gannonFromSnapshot()).map((c) => c.title)];
    const live = detectLiveEvent(liveFeed(snapshotWith(new Date('2026-11-14T20:00:00Z'), { flares: [{ cls: 'M2.0', hoursAgo: 3 }] })), new Date('2026-11-14T20:00:00Z'))!;
    titles.push(...eventChallenges(live).map((c) => c.title));
    for (const t of titles) expect(t, t).not.toMatch(/\bsols?\b/i);
  });
});
