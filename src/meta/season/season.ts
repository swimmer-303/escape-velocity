// Written with AI assistance (Claude Code). See README "Use of AI tools".
// Season 1: Solar Maximum. The season's dates, its 40 tiers and the Season XP each tier takes. Pure, no DOM.
//
// The name is real science: on October 15, 2024, NASA, NOAA and the Solar Cycle Prediction Panel announced that
// the Sun had reached its solar maximum period, the busiest part of its roughly 11-year cycle.
// Source: NASA, "NASA, NOAA: Sun Reaches Maximum Phase in 11-Year Solar Cycle" (Oct 15, 2024),
// https://science.nasa.gov/science-research/heliophysics/nasa-noaa-sun-reaches-maximum-phase-in-11-year-solar-cycle/
//
// Tier math. Season XP comes from the same play that gives Astronaut rank XP (10 a sol, 25 for sheltering from a
// storm, 40 an upgrade, 100 + 25 a star for a launch...), plus every 'xp' event from other modes (Storm Cards,
// flight medals, and any new mode), plus weekly challenges, the welcome-back gift and event challenges.
// The rank module's own tuning says a first-time player earns about 1,500-2,000 XP an hour.
//   - Tiers 1 to 10 cost a flat 200 Season XP each (tier 1 is free, a welcome gift at 0 XP), so tier 10 is at
//     1,800 XP: about the first hour, a little sooner with the day-one gift and a weekly challenge or two.
//   - After tier 10 each tier costs 50 more than the one before (250, 300, ... 1,700), so tier 20 is at 6,550,
//     tier 30 at 16,300 and tier 40 at 31,050 XP: at 2,500-3,000 Season XP an hour (play plus challenges) that is
//     roughly 10 to 12 hours, spread over the 11 weeks of the season. Nobody has to play every day to finish.

export const SEASON_ID = 's1';
export const SEASON_NAME = 'Season 1: Solar Maximum';
export const SEASON_SHORT = 'Solar Maximum';
export const MAX_TIER = 40;
/** Every 5th tier is a big one. */
export const BIG_EVERY = 5;

/**
 * The season ends at the very end of Jan 31, 2027 (local time): a game choice, not a NASA date.
 * Months are 0-based in Date: (2027, 1, 1) is Feb 1, 2027 at midnight.
 */
export function seasonEnd(): Date {
  return new Date(2027, 1, 1, 0, 0, 0, 0);
}
export const SEASON_END_WORDS = 'January 31, 2027';

export function seasonOver(now: Date): boolean {
  return now.getTime() >= seasonEnd().getTime();
}

/** Total Season XP needed to reach `tier` (tier 1 is 0: a welcome gift). */
export function xpToReachTier(tier: number): number {
  const t = Math.max(1, Math.min(MAX_TIER, Math.floor(tier)));
  if (t <= 10) return 200 * (t - 1);
  const k = t - 10;
  return 1800 + 200 * k + (50 * k * (k + 1)) / 2;
}

/** Season XP to go from `tier` to `tier + 1` (0 at the top). */
export function xpForNextTier(tier: number): number {
  if (tier >= MAX_TIER) return 0;
  return xpToReachTier(tier + 1) - xpToReachTier(tier);
}

/** The tier reached with this much Season XP (1..40). */
export function tierFor(xp: number): number {
  if (!Number.isFinite(xp) || xp <= 0) return 1;
  let t = 1;
  while (t < MAX_TIER && xpToReachTier(t + 1) <= xp) t++;
  return t;
}

export interface TierProgress {
  tier: number;
  into: number;
  need: number;
  frac: number;
  max: boolean;
}

export function tierProgress(xp: number): TierProgress {
  const tier = tierFor(xp);
  if (tier >= MAX_TIER) return { tier, into: 0, need: 0, frac: 1, max: true };
  const into = Math.max(0, Math.floor(xp) - xpToReachTier(tier));
  const need = xpForNextTier(tier);
  return { tier, into, need, frac: Math.min(1, into / need), max: false };
}

export function isBigTier(tier: number): boolean {
  return tier % BIG_EVERY === 0;
}

// ------------------------------------------------------------------ countdowns
const DAY_MS = 86_400_000;

/** "78 days", "1 day", "5 hours", "less than an hour". */
export function timeLeftWords(ms: number): string {
  if (ms <= 0) return 'no time';
  const days = Math.floor(ms / DAY_MS);
  if (days >= 2) return `${days} days`;
  const hours = Math.floor(ms / 3_600_000);
  if (hours >= 24) {
    const rest = hours - 24;
    return rest ? `1 day ${rest} ${rest === 1 ? 'hour' : 'hours'}` : '1 day';
  }
  if (hours >= 1) return `${hours} ${hours === 1 ? 'hour' : 'hours'}`;
  return 'less than an hour';
}

/** "Ends in 78 days" or "Season 1 complete". */
export function seasonCountdown(now: Date): string {
  if (seasonOver(now)) return 'Season 1 complete';
  return `Ends in ${timeLeftWords(seasonEnd().getTime() - now.getTime())}`;
}

/** Plain words for the season fact on the season screen (kept next to its source above). */
export const SEASON_FACT =
  'Solar maximum is the busiest part of the Sun\'s 11-year cycle: more sunspots, more flares, more storms. In October 2024, NASA and NOAA announced that the Sun had reached its solar maximum period.';
export const SEASON_FACT_SOURCE = 'https://science.nasa.gov/science-research/heliophysics/nasa-noaa-sun-reaches-maximum-phase-in-11-year-solar-cycle/';
