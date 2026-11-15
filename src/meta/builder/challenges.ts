// Written with AI assistance (Claude Code). See README "Use of AI tools".
// Outpost Architect: Blueprint challenges. Twelve goal cards that get harder, each worth up to 3 stars and XP, each
// unlocking new parts or decor. Star 1 is the goal; stars 2 and 3 are harder extras (and need star 1).
// All checks run on the readout and stress test (./stress.ts), which use the game's own numbers.

import { ARCADIA, MOON_BATTERY, REAL } from '../../sim/constants';
import { PARTS, STARTER_PARTS, type PartId } from './parts';
import { countOf, workingParts, type Layout, type SiteId } from './layout';
import type { Readout } from './stress';

export interface Check {
  text: string;
  test: (c: Ctx) => boolean;
}

export interface Ctx {
  layout: Layout;
  r: Readout;
}

export interface Challenge {
  id: string;
  title: string;
  site: SiteId;
  /** The goal, in words for ages 7-12 (read aloud by "Read to me"). */
  goal: string;
  /** Requirements for star 1 (all must pass). */
  needs: Check[];
  star2: Check;
  star3: Check;
  unlocks: PartId[];
  /** A tip for when they're stuck. */
  tip: string;
}

const EPS = 1e-9;
/** A lunar night is about half a synodic month (NASA Moon Fact Sheet, REAL.moonSynodicDays): 14.8 days. */
export const LUNAR_NIGHT_DAYS = (REAL.moonSynodicDays / 2).toFixed(1);
const sols = (site: SiteId) => (site === 'moon' ? 'turns' : 'sols');

const crewAtLeast = (n: number): Check => ({ text: `Beds for at least ${n} crew`, test: ({ r }) => r.counts.crew >= n });
const sunnyOk: Check = {
  text: 'Air, food and heat on a sunny day',
  test: ({ r }) => r.sunny.heatShort === 0 && r.sunny.airMade + EPS >= r.sunny.airNeed && r.sunny.foodMade + EPS >= r.sunny.foodNeed && r.counts.crew > 0,
};
const passes: Check = { text: 'Pass the stress test', test: ({ r }) => r.stress.pass };
const starsAtLeast = (n: number): Check => ({ text: `${n} stars on the stress test`, test: ({ r }) => r.stress.stars >= n });
const fillWithin = (n: number, site: SiteId): Check => ({ text: `Rocket full in ${n} ${sols(site)} or less`, test: ({ r }) => r.counts.rocket && r.solsToFill !== null && r.solsToFill <= n });
const atMost = (part: PartId, n: number): Check => ({ text: `${n} ${PARTS[part].name.toLowerCase()}${n === 1 ? '' : 's'} or fewer`, test: ({ layout }) => countOf(layout, part) <= n });
const hasRocket: Check = { text: 'A Rocket and pad', test: ({ r }) => r.counts.rocket };
const everyoneNinety: Check = {
  text: 'Everyone 90% shielded in the solar storm',
  test: ({ r }) => r.stress.sols.some((s) => s.day.storm) && r.stress.sols.every((s) => !s.day.storm || (s.plan.sheltered >= r.counts.crew && s.plan.block >= 0.9 - EPS)) && r.counts.crew > 0,
};
const dustOk: Check = {
  text: 'Air, food and heat every day of the dust storm',
  test: ({ r }) =>
    r.counts.crew > 0 &&
    r.stress.sols.filter((s) => s.day.weather !== 'clear').every((s) => s.plan.heatShort === 0 && s.plan.airMade + EPS >= s.plan.airNeed && s.plan.foodMade + EPS >= s.plan.foodNeed),
};
const smallBase = (n: number): Check => ({ text: `${n} working parts or fewer (decor is free)`, test: ({ layout }) => workingParts(layout) <= n });

export const CHALLENGES: Challenge[] = [
  {
    id: 'first-light',
    title: 'First Light',
    site: 'gale',
    goal: 'Build a little base for 2 crew in Gale Crater. They need beds, air, food and heat on a sunny sol.',
    needs: [crewAtLeast(2), sunnyOk],
    star2: { text: 'Spare power fills a rocket', test: ({ r }) => r.counts.rocket && r.sunny.fuelPct > 0 },
    star3: passes,
    unlocks: ['lamp'],
    tip: 'A Habitat has 2 beds. Add solar panels, an O2 plant, a Greenhouse and a Heater.',
  },
  {
    id: 'ten-panels',
    title: 'Ten Panels Only',
    site: 'gale',
    goal: 'Keep 4 crew breathing, fed and warm with only 10 solar panels.',
    needs: [crewAtLeast(4), atMost('solar', 10), sunnyOk],
    star2: passes,
    star3: fillWithin(12, 'gale'),
    unlocks: ['flag'],
    tip: 'Two Habitats make 4 beds. Every cell you do not need for the crew can fill the rocket.',
  },
  {
    id: 'dust-buster',
    title: 'Dust Buster',
    site: 'gale',
    goal: 'Mars dust storms dim the solar panels. Keep 4 crew going right through a 3-sol dust storm.',
    needs: [crewAtLeast(4), sunnyOk, dustOk],
    star2: passes,
    star3: starsAtLeast(2),
    unlocks: ['antenna'],
    tip: 'Orbiters spot dust a day early. A Battery bank saves power the day before. More panels help too.',
  },
  {
    id: 'storm-shelter',
    title: 'Storm Shelter',
    site: 'gale',
    goal: 'Keep 4 crew safe in the biggest solar storm of May 2024. Everyone must be in a powered shelter.',
    needs: [crewAtLeast(4), passes],
    star2: everyoneNinety,
    star3: starsAtLeast(2),
    unlocks: ['berm'],
    tip: 'Fast storms reach Mars before Earth can warn you. A powered Sun watcher warns you in time.',
  },
  {
    id: 'eight-sols',
    title: 'Fill the Rocket in 8 Sols',
    site: 'gale',
    goal: 'The launch window is closing! With 4 crew, fill the rocket in 8 sols or less.',
    needs: [crewAtLeast(4), sunnyOk, fillWithin(8, 'gale')],
    star2: passes,
    star3: atMost('solar', 12),
    unlocks: ['bigo2'],
    tip: 'Every spare cell goes to the O2 plant as fuel. The crew still needs air, food and heat first.',
  },
  {
    id: 'ice-miner',
    title: 'Ice Miner',
    site: 'arcadia',
    goal: 'Arcadia Planitia has ice under the ground, but less sun and more cold nights. Keep 6 crew safe through the stress test.',
    needs: [crewAtLeast(6), passes],
    star2: atMost('greenhouse', 1),
    star3: starsAtLeast(2),
    unlocks: ['statue'],
    tip: `Water from the ice makes each greenhouse cell grow ${ARCADIA.greenhouseBoost === 2 ? 'twice' : `${ARCADIA.greenhouseBoost} times`} the food here. Cold nights need extra heat.`,
  },
  {
    id: 'moon-base',
    title: 'Moon Base',
    site: 'moon',
    goal: 'Build for 4 crew near the Moon\'s south pole: air, food and heat in the lunar day, and a rocket.',
    needs: [crewAtLeast(4), sunnyOk, hasRocket],
    star2: fillWithin(12, 'moon'),
    star3: passes,
    unlocks: ['planter'],
    tip: 'The Moon gets as much sunlight as Earth, but none at night. Batteries save daytime power.',
  },
  {
    id: 'lunar-night',
    title: 'Survive the Lunar Night',
    site: 'moon',
    goal: `A lunar night lasts about ${LUNAR_NIGHT_DAYS} Earth days, and the solar panels make nothing. Get 4 crew through it.`,
    needs: [crewAtLeast(4), passes],
    star2: starsAtLeast(2),
    star3: starsAtLeast(3),
    unlocks: ['reactor'],
    tip: `Each Battery bank holds ${MOON_BATTERY.capacity} cells and gives back up to ${MOON_BATTERY.releasePerNight} a night. You need enough for every night turn.`,
  },
  {
    id: 'shelter-six',
    title: 'Shelter for Six',
    site: 'gale',
    goal: 'Six crew, one giant solar storm. Keep everyone 90% shielded in the storm of May 20, 2024.',
    needs: [crewAtLeast(6), everyoneNinety],
    star2: passes,
    star3: starsAtLeast(3),
    unlocks: ['garage'],
    tip: 'A shelter fits 4 crew. 2 cells block 90%, or just 1 if a Regolith berm is right next to it.',
  },
  {
    id: 'tiny',
    title: 'Tiny but Mighty',
    site: 'gale',
    goal: 'Engineers love a base that does more with less. Pass the stress test with 4 crew and a rocket, using as few parts as you can.',
    needs: [crewAtLeast(4), hasRocket, passes],
    star2: smallBase(16),
    star3: smallBase(14),
    unlocks: ['workshop'],
    tip: 'Decor does not count. Which parts can you take away and still pass?',
  },
  {
    id: 'moon-express',
    title: 'Moon Express',
    site: 'moon',
    goal: 'Fill the rocket in 6 turns or less on the Moon, with 4 crew on board.',
    needs: [crewAtLeast(4), sunnyOk, fillWithin(6, 'moon')],
    star2: passes,
    star3: starsAtLeast(3),
    unlocks: [],
    tip: 'Batteries charge before the rocket gets any power. A Big O2 plant makes 50% more fuel per cell.',
  },
  {
    id: 'grand',
    title: 'Grand Outpost',
    site: 'gale',
    goal: 'The big one: 6 crew, 3 stars on the stress test, and a rocket that is full in 10 sols.',
    needs: [crewAtLeast(6), starsAtLeast(3), fillWithin(10, 'gale')],
    star2: fillWithin(9, 'gale'),
    star3: fillWithin(8, 'gale'),
    unlocks: [],
    tip: 'A reactor makes power day and night, dust or not. Shelters next to berms save power in a storm.',
  },
];

export function challengeById(id: string): Challenge | undefined {
  return CHALLENGES.find((c) => c.id === id);
}

export interface Score {
  stars: 0 | 1 | 2 | 3;
  needs: Array<{ text: string; ok: boolean }>;
  star2: boolean;
  star3: boolean;
}

/** Stars for a layout on a challenge. Wrong site: no stars. Stars 2 and 3 count only with star 1. */
export function scoreChallenge(ch: Challenge, ctx: Ctx): Score {
  const site = ctx.layout.site === ch.site;
  const needs = [{ text: `Build at ${siteWord(ch.site)}`, ok: site }, ...ch.needs.map((n) => ({ text: n.text, ok: safe(n, ctx) }))];
  const one = needs.every((n) => n.ok);
  const star2 = one && safe(ch.star2, ctx);
  const star3 = one && safe(ch.star3, ctx);
  const stars = (one ? 1 + (star2 ? 1 : 0) + (star3 ? 1 : 0) : 0) as Score['stars'];
  return { stars, needs, star2, star3 };
}

function safe(c: Check, ctx: Ctx): boolean {
  try {
    return !!c.test(ctx);
  } catch {
    return false;
  }
}

function siteWord(s: SiteId): string {
  return s === 'moon' ? 'the Moon' : s === 'arcadia' ? 'Arcadia Planitia' : 'Gale Crater';
}

/** XP for each new star on challenge number `index` (0-based): harder cards give more. */
export function xpPerStar(index: number): number {
  return 15 + 5 * Math.floor(index / 3);
}

/** Challenge `index` is open when it's one of the first three, or the one before it has a star. */
export function isOpen(index: number, stars: Record<string, number>): boolean {
  if (index < 3) return true;
  const prev = CHALLENGES[index - 1];
  return !!prev && (stars[prev.id] ?? 0) >= 1;
}

/** Every part this player can use: the starters plus the unlocks of every challenge with a star. */
export function unlockedParts(stars: Record<string, number>): Set<PartId> {
  const out = new Set<PartId>(STARTER_PARTS);
  for (const c of CHALLENGES) if ((stars[c.id] ?? 0) >= 1) for (const p of c.unlocks) out.add(p);
  return out;
}

/** The challenge that unlocks a part (for "Unlock it by finishing ..."). */
export function unlockedBy(part: PartId): Challenge | undefined {
  return CHALLENGES.find((c) => c.unlocks.includes(part));
}

/** Total stars collected, and the most there are. */
export function starTotals(stars: Record<string, number>): { got: number; max: number; done: number } {
  let got = 0;
  let done = 0;
  for (const c of CHALLENGES) {
    const s = Math.max(0, Math.min(3, stars[c.id] ?? 0));
    got += s;
    if (s >= 1) done++;
  }
  return { got, max: CHALLENGES.length * 3, done };
}
