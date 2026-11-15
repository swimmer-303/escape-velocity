// Written with AI assistance (Claude Code). See README "Use of AI tools".
// Callsigns for the Player Card: an adjective, a space word and a number, like "Brave Comet 42".
// Kids never type a name: a callsign is only ever built from these hand-picked, friendly word lists, so there is
// nothing to moderate and nothing that could identify a child. Pure functions, no DOM.

export const ADJECTIVES: readonly string[] = [
  'Brave', 'Bright', 'Bold', 'Calm', 'Clever', 'Cosmic', 'Curious', 'Daring', 'Eager', 'Fast',
  'Friendly', 'Gentle', 'Golden', 'Happy', 'Helpful', 'Jolly', 'Keen', 'Kind', 'Lucky', 'Mighty',
  'Nimble', 'Patient', 'Plucky', 'Quick', 'Quiet', 'Rapid', 'Sharp', 'Shiny', 'Silver', 'Smart',
  'Speedy', 'Steady', 'Sunny', 'Swift', 'Super', 'Trusty', 'Turbo', 'Wise', 'Zippy', 'Stellar',
];

export const SPACE_NOUNS: readonly string[] = [
  'Asteroid', 'Astro', 'Aurora', 'Beacon', 'Comet', 'Cosmo', 'Crater', 'Eclipse', 'Galaxy', 'Lander',
  'Meteor', 'Moon', 'Nebula', 'Nova', 'Orbit', 'Photon', 'Planet', 'Pulsar', 'Quasar', 'Rocket',
  'Rover', 'Satellite', 'Shuttle', 'Sky', 'Solar', 'Spark', 'Star', 'Starlight', 'Sunbeam', 'Voyager',
  'Zenith', 'Pioneer', 'Module', 'Booster', 'Capsule', 'Gravity', 'Horizon', 'Ion', 'Lunar', 'Mars',
];

export const MIN_NUMBER = 1;
export const MAX_NUMBER = 99;
/** Numbers that carry rude or hateful meanings online. A callsign never uses them. */
export const BLOCKED_NUMBERS: readonly number[] = [14, 18, 69, 88];

export interface Callsign {
  adj: string;
  noun: string;
  num: number;
}

export function callsignText(c: Callsign): string {
  return `${c.adj} ${c.noun} ${c.num}`;
}

/** Is this a callsign we could have made ourselves (both words from the lists, a number 1-99)? */
export function isValidCallsign(c: unknown): c is Callsign {
  if (!c || typeof c !== 'object') return false;
  const x = c as Partial<Callsign>;
  return (
    typeof x.adj === 'string' &&
    ADJECTIVES.includes(x.adj) &&
    typeof x.noun === 'string' &&
    SPACE_NOUNS.includes(x.noun) &&
    typeof x.num === 'number' &&
    Number.isInteger(x.num) &&
    x.num >= MIN_NUMBER &&
    x.num <= MAX_NUMBER &&
    !BLOCKED_NUMBERS.includes(x.num)
  );
}

/** A new random callsign, never the same as `not` (re-roll). `rand` returns 0..1 (tests pass their own). */
export function rollCallsign(rand: () => number = Math.random, not?: Callsign | null): Callsign {
  const pick = <T>(list: readonly T[]) => list[Math.min(list.length - 1, Math.floor(rand() * list.length))];
  for (let i = 0; i < 20; i++) {
    const c: Callsign = { adj: pick(ADJECTIVES), noun: pick(SPACE_NOUNS), num: MIN_NUMBER + Math.min(MAX_NUMBER - MIN_NUMBER, Math.floor(rand() * MAX_NUMBER)) };
    if (isValidCallsign(c) && (!not || callsignText(c) !== callsignText(not))) return c;
  }
  // A stuck random source: step the number by hand to the next allowed one.
  const base = not ?? { adj: ADJECTIVES[0], noun: SPACE_NOUNS[0], num: MIN_NUMBER };
  let num = base.num;
  do num = (num % MAX_NUMBER) + 1;
  while (BLOCKED_NUMBERS.includes(num));
  return { adj: base.adj, noun: base.noun, num };
}
