// Written with AI assistance (Claude Code). See README "Use of AI tools".
// Callsigns for challenge links: an adjective, a space word and a number, e.g. "Brave Comet 42". Kids never type a
// name, so a link can never carry a real name or anything unkind: every word comes from these two fixed lists.

// The same words as the Player Card (src/meta/season/callsign.ts) plus a few more, so any Player Card callsign can
// travel in a challenge link. Never remove a word: links made with it would stop working.
export const ADJECTIVES: readonly string[] = [
  'Brave', 'Bright', 'Bold', 'Calm', 'Clever', 'Cosmic', 'Curious', 'Daring', 'Eager', 'Fast',
  'Friendly', 'Gentle', 'Golden', 'Happy', 'Helpful', 'Jolly', 'Keen', 'Kind', 'Lucky', 'Mighty',
  'Nimble', 'Patient', 'Plucky', 'Quick', 'Quiet', 'Rapid', 'Sharp', 'Shiny', 'Silver', 'Smart',
  'Sparkly', 'Steady', 'Sunny', 'Swift', 'Super', 'Trusty', 'Turbo', 'Wise', 'Zippy', 'Stellar',
  'Epic', 'Noble',
];

export const SPACE_NOUNS: readonly string[] = [
  'Asteroid', 'Astro', 'Aurora', 'Beacon', 'Comet', 'Cosmo', 'Crater', 'Eclipse', 'Galaxy', 'Lander',
  'Meteor', 'Moon', 'Nebula', 'Nova', 'Orbit', 'Photon', 'Planet', 'Pulsar', 'Quasar', 'Rocket',
  'Rover', 'Satellite', 'Shuttle', 'Sky', 'Solar', 'Spark', 'Star', 'Starlight', 'Sunbeam', 'Voyager',
  'Zenith', 'Pioneer', 'Module', 'Booster', 'Capsule', 'Gravity', 'Horizon', 'Ion', 'Lunar', 'Mars',
  'Cosmos', 'Probe',
];

/** Numbers that carry rude or hateful meanings online (the same list as the Player Card). Never used. */
export const BLOCKED_NUMBERS: readonly number[] = [14, 18, 69, 88];

export interface Callsign {
  adj: string;
  noun: string;
  /** 1..99 */
  num: number;
}

export function callsignText(c: Callsign): string {
  return `${c.adj} ${c.noun} ${c.num}`;
}

/** A random callsign. `random` is injectable for tests. */
export function randomCallsign(random: () => number = Math.random): Callsign {
  const pick = <T>(xs: readonly T[]) => xs[Math.min(xs.length - 1, Math.floor(random() * xs.length))];
  let num = 1 + Math.min(98, Math.floor(random() * 99));
  while (BLOCKED_NUMBERS.includes(num)) num = (num % 99) + 1;
  return { adj: pick(ADJECTIVES), noun: pick(SPACE_NOUNS), num };
}

/** Only a callsign made of words from our lists (exact spelling) and a number 1..99 passes. */
export function isCallsign(x: unknown): x is Callsign {
  if (!x || typeof x !== 'object') return false;
  const c = x as Partial<Callsign>;
  return (
    typeof c.adj === 'string' &&
    ADJECTIVES.includes(c.adj) &&
    typeof c.noun === 'string' &&
    SPACE_NOUNS.includes(c.noun) &&
    typeof c.num === 'number' &&
    Number.isInteger(c.num) &&
    c.num >= 1 &&
    c.num <= 99 &&
    !BLOCKED_NUMBERS.includes(c.num)
  );
}

/** "brave-comet-42" for links. */
export function callsignSlug(c: Callsign): string {
  return `${c.adj.toLowerCase()}-${c.noun.toLowerCase()}-${c.num}`;
}

export function parseCallsignSlug(slug: string): Callsign | null {
  const m = /^([a-z]{2,12})-([a-z]{2,12})-([1-9]\d?)$/.exec(slug);
  if (!m) return null;
  const adj = ADJECTIVES.find((a) => a.toLowerCase() === m[1]);
  const noun = SPACE_NOUNS.find((n) => n.toLowerCase() === m[2]);
  const c = { adj: adj ?? '', noun: noun ?? '', num: Number(m[3]) };
  return isCallsign(c) ? c : null;
}
