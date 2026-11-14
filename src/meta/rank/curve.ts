// Written with AI assistance (Claude Code). See README "Use of AI tools".
// Astronaut rank: the XP curve, the 50 levels and the rank titles. Pure functions, no DOM.
//
// Tuning: a sol is worth about 10 XP (see XP in ./index.ts) and a first-time player earns
// roughly 1,500-2,000 XP an hour, an experienced one about twice that. Each level takes 100 XP more than the one
// before (80, 180, 280, ...), so:
//   level 2 at 80 XP     (about 6 sols: during the very first mission)
//   level 3 at 260 XP    (about the end of the first mission)
//   level 5 at 920 XP    (about 30 minutes of play: the first new rank title after Rookie, "Pilot")
//   level 10 at 4,320 XP (an afternoon)
//   level 50 at 121,520 XP (Legend: a long-term goal of many weeks of play)

export const MAX_LEVEL = 50;

/** XP needed to go from `level` to `level + 1`. */
export function xpForNext(level: number): number {
  return 100 * level - 20;
}

/** Total XP needed to reach `level` (level 1 is 0). */
export function xpToReach(level: number): number {
  const n = Math.max(1, Math.min(MAX_LEVEL, Math.floor(level))) - 1;
  return n * (50 * (n + 1) - 20);
}

/** The level for a lifetime XP total. */
export function levelFor(xp: number): number {
  if (!Number.isFinite(xp) || xp <= 0) return 1;
  let level = 1;
  while (level < MAX_LEVEL && xpToReach(level + 1) <= xp) level++;
  return level;
}

export interface LevelProgress {
  level: number;
  /** XP earned since this level started. */
  into: number;
  /** XP this level takes in all (0 at the top level). */
  need: number;
  /** 0..1 along the bar (1 at the top level). */
  frac: number;
  max: boolean;
}

export function progressFor(xp: number): LevelProgress {
  const level = levelFor(xp);
  if (level >= MAX_LEVEL) return { level, into: 0, need: 0, frac: 1, max: true };
  const into = Math.max(0, Math.floor(xp) - xpToReach(level));
  const need = xpForNext(level);
  return { level, into, need, frac: Math.min(1, into / need), max: false };
}

// ------------------------------------------------------------------ ranks
export interface Rank {
  /** 0-based index into RANKS: also picks the badge art. */
  tier: number;
  name: string;
  /** First level of this rank. */
  from: number;
  /** One encouraging line for the level-up card and the rank ladder. */
  blurb: string;
}

const RANK_LIST: Array<Omit<Rank, 'tier'>> = [
  { name: 'Cadet', from: 1, blurb: 'Every astronaut starts here. Welcome to the team!' },
  { name: 'Rookie', from: 3, blurb: 'You have kept a whole crew safe. That is a real start.' },
  { name: 'Pilot', from: 5, blurb: 'You can steer a base through dust and solar storms.' },
  { name: 'Engineer', from: 8, blurb: 'You build things that help the next crew.' },
  { name: 'Scientist', from: 12, blurb: 'You read the space weather like a pro.' },
  { name: 'Specialist', from: 16, blurb: 'Crews trust you with the hardest jobs.' },
  { name: 'Commander', from: 21, blurb: 'You lead the whole outpost.' },
  { name: 'Flight Director', from: 27, blurb: 'You watch over every mission, start to finish.' },
  { name: 'Mars Pioneer', from: 34, blurb: 'You helped build a home on another world.' },
  { name: 'Star Voyager', from: 42, blurb: 'Very few explorers have come this far.' },
  { name: 'Legend', from: 50, blurb: 'The top rank. Crews will tell stories about you.' },
];

export const RANKS: readonly Rank[] = RANK_LIST.map((r, tier) => ({ ...r, tier }));

export function rankFor(level: number): Rank {
  let r = RANKS[0];
  for (const x of RANKS) if (level >= x.from) r = x;
  return r;
}

/** The next rank title, or null at the top. */
export function nextRank(level: number): Rank | null {
  return RANKS.find((r) => r.from > level) ?? null;
}

/** The last level of a rank (inclusive). */
export function rankLastLevel(r: Rank): number {
  const next = RANKS[r.tier + 1];
  return next ? next.from - 1 : MAX_LEVEL;
}
