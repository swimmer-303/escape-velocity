// Written with AI assistance (Claude Code). See README "Use of AI tools".
// Callsigns for challenge links: an adjective, a space word and a number, e.g. "Brave Comet 42". Kids never type a
// name, so a link can never carry a real name or anything unkind: every word comes from these two fixed lists.

export const ADJECTIVES = [
  'Brave', 'Swift', 'Clever', 'Bright', 'Bold', 'Calm', 'Cosmic', 'Daring', 'Eager', 'Epic', 'Happy', 'Jolly',
  'Keen', 'Lucky', 'Mighty', 'Noble', 'Plucky', 'Quick', 'Rapid', 'Smart', 'Steady', 'Super', 'Turbo', 'Zippy',
] as const;

export const SPACE_NOUNS = [
  'Comet', 'Rocket', 'Nebula', 'Quasar', 'Pulsar', 'Meteor', 'Orbit', 'Galaxy', 'Rover', 'Lander', 'Moon', 'Star',
  'Nova', 'Crater', 'Probe', 'Booster', 'Shuttle', 'Satellite', 'Asteroid', 'Aurora', 'Photon', 'Cosmos', 'Eclipse', 'Zenith',
] as const;

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
  return { adj: pick(ADJECTIVES), noun: pick(SPACE_NOUNS), num: 1 + Math.min(98, Math.floor(random() * 99)) };
}

/** Only a callsign made of words from our lists (exact spelling) and a number 1..99 passes. */
export function isCallsign(x: unknown): x is Callsign {
  if (!x || typeof x !== 'object') return false;
  const c = x as Partial<Callsign>;
  return (
    typeof c.adj === 'string' &&
    (ADJECTIVES as readonly string[]).includes(c.adj) &&
    typeof c.noun === 'string' &&
    (SPACE_NOUNS as readonly string[]).includes(c.noun) &&
    typeof c.num === 'number' &&
    Number.isInteger(c.num) &&
    c.num >= 1 &&
    c.num <= 99
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
