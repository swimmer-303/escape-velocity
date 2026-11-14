// Written with AI assistance (Claude Code). See README "Use of AI tools".
import { describe, it, expect } from 'vitest';
import { MAX_LEVEL, RANKS, levelFor, nextRank, progressFor, rankFor, rankLastLevel, xpForNext, xpToReach } from './curve';
import { XP } from './engine';

describe('XP curve', () => {
  it('starts gently and every level takes longer than the one before', () => {
    expect(xpToReach(1)).toBe(0);
    expect(xpToReach(2)).toBe(80);
    expect(xpToReach(3)).toBe(260);
    expect(xpToReach(5)).toBe(920);
    expect(xpToReach(MAX_LEVEL)).toBe(121520);
    for (let l = 1; l < MAX_LEVEL - 1; l++) expect(xpForNext(l + 1)).toBeGreaterThan(xpForNext(l));
    for (let l = 1; l < MAX_LEVEL; l++) expect(xpToReach(l + 1) - xpToReach(l)).toBe(xpForNext(l));
  });

  it('finds the level for any XP total, and stops at level 50', () => {
    expect(levelFor(0)).toBe(1);
    expect(levelFor(-5)).toBe(1);
    expect(levelFor(NaN)).toBe(1);
    expect(levelFor(79)).toBe(1);
    expect(levelFor(80)).toBe(2);
    expect(levelFor(919)).toBe(4);
    expect(levelFor(920)).toBe(5);
    expect(levelFor(10_000_000)).toBe(MAX_LEVEL);
    const p = progressFor(100);
    expect(p).toMatchObject({ level: 2, into: 20, need: 180, max: false });
    expect(progressFor(10_000_000)).toMatchObject({ level: 50, frac: 1, max: true });
  });

  it('reaches level 2 during a first mission and level 5 in about half an hour of play', () => {
    // A first mission: XP for each sol, plus a storm survived in the shelter around sol 4.
    let xp = 0;
    let levelTwoAt = 0;
    for (let sol = 1; sol <= 18 && !levelTwoAt; sol++) {
      xp += XP.sol + (sol === 4 ? XP.sheltered : 0);
      if (levelFor(xp) >= 2) levelTwoAt = sol;
    }
    expect(levelTwoAt).toBeGreaterThan(2);
    expect(levelTwoAt).toBeLessThanOrEqual(8);
    // About 30 minutes: ~45 sols, 4 storms sheltered, 3 upgrades, 2 launches with 2 stars, 2 daily missions.
    const halfHour = 45 * XP.sol + 4 * XP.sheltered + 3 * XP.upgrade + 2 * (XP.win + 2 * XP.star) + 50 + 75;
    expect(levelFor(halfHour)).toBe(5);
    // But not on the first mission alone.
    expect(levelFor(18 * XP.sol + 2 * XP.sheltered + XP.upgrade + XP.win + 2 * XP.star)).toBeLessThan(5);
  });
});

describe('rank titles', () => {
  it('has a title every few levels, from Cadet to Legend', () => {
    expect(RANKS[0]).toMatchObject({ name: 'Cadet', from: 1, tier: 0 });
    expect(RANKS[RANKS.length - 1]).toMatchObject({ name: 'Legend', from: MAX_LEVEL });
    for (let i = 1; i < RANKS.length; i++) {
      expect(RANKS[i].from).toBeGreaterThan(RANKS[i - 1].from);
      // Steadily longer gaps between titles.
      if (i > 1) expect(RANKS[i].from - RANKS[i - 1].from).toBeGreaterThanOrEqual(RANKS[i - 1].from - RANKS[Math.max(0, i - 2)].from);
    }
    expect(rankFor(1).name).toBe('Cadet');
    expect(rankFor(3).name).toBe('Rookie');
    expect(rankFor(5).name).toBe('Pilot');
    expect(rankFor(49).name).toBe('Star Voyager');
    expect(rankFor(50).name).toBe('Legend');
    expect(nextRank(5)?.name).toBe('Engineer');
    expect(nextRank(50)).toBeNull();
    expect(rankLastLevel(RANKS[0])).toBe(2);
    expect(rankLastLevel(RANKS[RANKS.length - 1])).toBe(50);
  });

  it('keeps every title kid-friendly and plain (no emoji)', () => {
    for (const r of RANKS) {
      expect(r.name).toMatch(/^[A-Za-z ]+$/);
      expect(r.blurb).toMatch(/^[\x20-\x7e]+$/);
    }
  });
});
