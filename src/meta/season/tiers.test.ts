// Written with AI assistance (Claude Code). See README "Use of AI tools".
// Season 1 tier math and the reward list: tier 10 in about the first hour, tier 40 after many hours, every 5th
// tier big, every reward real, and the season end date honest.
import { describe, it, expect } from 'vitest';
import { MAX_TIER, isBigTier, seasonCountdown, seasonEnd, seasonOver, tierFor, tierProgress, timeLeftWords, xpForNextTier, xpToReachTier } from './season';
import { BANNERS, FRAMES, PATCHES, TIERS, TITLES, DEFAULT_CARD, SEASON_HANGAR, rewardWords, tierOf } from './rewards';
import { SEASON_XP } from './engine';
import { patchMarkup } from './art';

describe('tier math', () => {
  it('starts at tier 1 (a welcome gift) and climbs to tier 40', () => {
    expect(tierFor(0)).toBe(1);
    expect(tierFor(-5)).toBe(1);
    expect(tierFor(NaN)).toBe(1);
    expect(xpToReachTier(1)).toBe(0);
    expect(xpToReachTier(MAX_TIER)).toBe(31050);
    expect(tierFor(1e9)).toBe(MAX_TIER);
    expect(xpForNextTier(MAX_TIER)).toBe(0);
  });

  it('is the exact inverse of the XP table at every tier', () => {
    for (let t = 1; t <= MAX_TIER; t++) {
      expect(tierFor(xpToReachTier(t))).toBe(t);
      if (t > 1) expect(tierFor(xpToReachTier(t) - 1)).toBe(t - 1);
    }
  });

  it('never gets cheaper: 200 a tier up to 10, then 50 more each tier', () => {
    for (let t = 1; t < 10; t++) expect(xpForNextTier(t)).toBe(200);
    for (let t = 10; t < MAX_TIER; t++) expect(xpForNextTier(t)).toBe(xpForNextTier(t - 1) + (t === 10 ? 50 : 50));
  });

  it('reaches about tier 10 in a first hour of play, and tier 40 only after many hours', () => {
    // The rank module's tuning: a first-time player earns about 1,500-2,000 XP an hour; Season XP mirrors it.
    // A typical first hour: ~5 missions of ~12 sols, a few shelters and upgrades, 2 launches, the day-one gift,
    // and the bonus XP other modes send as 'xp' events: ~6 new Storm Cards (10-50 XP each) and ~4 flight medals
    // (25-60 XP each, see ../cards/rarity.ts and ../flight/physics.ts).
    const sols = 60;
    const play = sols * SEASON_XP.sol + 5 * SEASON_XP.sheltered + 4 * SEASON_XP.upgrade + 2 * (SEASON_XP.win + SEASON_XP.star) + 3 * SEASON_XP.loss;
    const bonus = 6 * 20 + 4 * 40;
    const firstHour = play + bonus + 50;
    expect(firstHour).toBeGreaterThan(1500);
    expect(firstHour).toBeLessThan(2000);
    expect(tierFor(firstHour)).toBeGreaterThanOrEqual(8);
    expect(tierFor(firstHour)).toBeLessThanOrEqual(10);
    // With one weekly challenge done in that hour (300-500 Season XP), it is tier 10.
    expect(tierFor(firstHour + 350)).toBeGreaterThanOrEqual(10);
    expect(tierFor(2000)).toBe(10);
    // Tier 40 needs over 10 hours at a brisk 3,000 Season XP an hour.
    expect(xpToReachTier(MAX_TIER) / 3000).toBeGreaterThan(10);
  });

  it('reports progress inside a tier', () => {
    const p = tierProgress(1900);
    expect(p).toMatchObject({ tier: 10, into: 100, need: 250, max: false });
    expect(tierProgress(1e9)).toMatchObject({ tier: MAX_TIER, max: true, frac: 1 });
  });
});

describe('the 40 tiers', () => {
  it('has a reward on every tier, a big one every 5th, and four Hangar items on big tiers', () => {
    expect(TIERS).toHaveLength(MAX_TIER);
    for (const t of TIERS) {
      expect(t.rewards.length, `tier ${t.tier}`).toBeGreaterThan(0);
      expect(t.big).toBe(t.tier % 5 === 0);
      expect(isBigTier(t.tier)).toBe(t.big);
      if (t.big) expect(t.rewards.length).toBeGreaterThanOrEqual(2);
      for (const x of t.rewards) expect(rewardWords(x).length).toBeGreaterThan(3);
    }
    const hangar = TIERS.flatMap((t) => t.rewards.filter((x) => x.kind === 'hangar').map((x) => ({ id: x.id, big: t.big })));
    expect(hangar.map((x) => x.id).sort()).toEqual(Object.values(SEASON_HANGAR).map((x) => x.id).sort());
    expect(hangar.every((x) => x.big)).toBe(true);
  });

  it('gives every cosmetic exactly once (or by default), and "Storm Chaser" is a title', () => {
    const lists = { title: TITLES, banner: BANNERS, frame: FRAMES, patch: PATCHES } as const;
    for (const [kind, list] of Object.entries(lists)) {
      expect(new Set(list.map((x) => x.id)).size).toBe(list.length);
      for (const item of list) {
        const at = tierOf(kind as keyof typeof lists, item.id);
        if (item.id === (DEFAULT_CARD as Record<string, string>)[kind]) expect(at).toBe(0);
        else expect(at, `${kind} ${item.id}`).toBeGreaterThan(0);
      }
    }
    expect(TITLES.some((t) => t.name === 'Storm Chaser')).toBe(true);
  });

  it('draws original patches with no agency names or logos', () => {
    for (const p of PATCHES) {
      const svg = patchMarkup(p, 48);
      expect(svg.startsWith('<svg')).toBe(true);
      expect(svg).not.toMatch(/nasa|noaa|esa\b|meatball|insignia/i);
    }
  });

  it('banners stay dark enough for white text (contrast 4.5:1 or more)', () => {
    const lum = (hex: string) => {
      const n = hex.replace('#', '');
      const full = n.length === 3 ? n.split('').map((c) => c + c).join('') : n;
      const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    for (const b of BANNERS) {
      // The lightest stop of each gradient is checked by its listed colors.
      const colors = b.css.match(/#[0-9a-f]{6}/gi) ?? [];
      const light = Math.max(...colors.filter((c) => c.toLowerCase() !== '#ffd34d' && c.toLowerCase() !== '#ffffff').map(lum));
      expect((1.05) / (light + 0.05), b.name).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe('the season end date', () => {
  it('ends after January 31, 2027, and says so gracefully', () => {
    expect(seasonEnd().getFullYear()).toBe(2027);
    expect(seasonOver(new Date(2027, 0, 31, 23, 59))).toBe(false);
    expect(seasonOver(new Date(2027, 1, 1, 0, 0))).toBe(true);
    expect(seasonCountdown(new Date(2026, 10, 14, 12))).toMatch(/^Ends in \d+ days$/);
    expect(seasonCountdown(new Date(2027, 2, 1))).toBe('Season 1 complete');
  });

  it('words time left for kids', () => {
    expect(timeLeftWords(3 * 86_400_000)).toBe('3 days');
    expect(timeLeftWords(25 * 3_600_000)).toBe('1 day 1 hour');
    expect(timeLeftWords(24 * 3_600_000)).toBe('1 day');
    expect(timeLeftWords(5 * 3_600_000)).toBe('5 hours');
    expect(timeLeftWords(10 * 60_000)).toBe('less than an hour');
  });
});
