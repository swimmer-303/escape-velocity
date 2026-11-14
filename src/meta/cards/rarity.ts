// Written with AI assistance (Claude Code). See README "Use of AI tools".
// Storm Cards: what a card is made of (a copy of the real NASA DONKI event's own data) and how rare it is.
// Rarity comes only from the real data: the flare's GOES X-ray class, whether a particle storm was recorded
// at Mars, and a CME's measured speed. Every sentence here is computed from those fields; nothing is invented.

import type { Severity, SpaceWeatherEvent } from '../../sim/types';

export type Rarity = 'common' | 'rare' | 'epic' | 'legendary';
export const RARITIES: readonly Rarity[] = ['common', 'rare', 'epic', 'legendary'];
export const RARITY_WORD: Record<Rarity, string> = { common: 'Common', rare: 'Rare', epic: 'Epic', legendary: 'Legendary' };
/** XP for collecting a new card of each rarity. */
export const RARITY_XP: Record<Rarity, number> = { common: 10, rare: 25, epic: 50, legendary: 100 };
/** Extra XP for the special far-side card, and for finishing the May 2024 set. */
export const SPECIAL_BONUS_XP = 50;
export const SET_BONUS_XP = 150;

/** The facts printed on a card: copied from the real event when the crew met it, so the card outlives the 30-day feed. */
export interface CardFacts {
  /** DONKI activity id, e.g. "2024-05-14T16:51:00-FLR-001". */
  id: string;
  kind: SpaceWeatherEvent['kind'];
  /** GOES class for flares, e.g. "X8.7". */
  classType?: string;
  /** ISO time: flare peak, particle storm onset, or CME start. */
  time: string;
  /** NOAA sunspot region number. */
  region?: number | null;
  /** DONKI source location on the Sun as seen from Earth, e.g. "S16W15". */
  location?: string | null;
  /** The NASA DONKI record. */
  link?: string;
  /** CME speed, km/s (DONKI's most accurate analysis). */
  speedKms?: number | null;
  /** DONKI links this flare to a burst of fast particles. */
  linkedSep?: boolean;
  severity: Severity;
  /** LIVE: fetched from NASA when the crew met it. ARCHIVE: from a stored copy of NASA's data. */
  origin: 'live' | 'archive';
  /** The game's own note for this storm (shown with a NOTE tag, never as data). */
  note?: string;
}

export function factsFromEvent(e: SpaceWeatherEvent): CardFacts {
  const f: CardFacts = { id: e.id, kind: e.kind, time: e.time, severity: e.severity, origin: e.origin === 'live' ? 'live' : 'archive' };
  if (e.classType) f.classType = e.classType;
  if (e.activeRegionNum != null) f.region = e.activeRegionNum;
  if (e.sourceLocation) f.location = e.sourceLocation;
  if (e.link) f.link = e.link;
  if (e.speedKms != null) f.speedKms = e.speedKms;
  if (e.linkedSep) f.linkedSep = true;
  if (e.note) f.note = e.note;
  return f;
}

// ------------------------------------------------------------------ the flare scale
export type FlareLetter = 'A' | 'B' | 'C' | 'M' | 'X';
export const FLARE_LETTERS: readonly FlareLetter[] = ['A', 'B', 'C', 'M', 'X'];
/** Peak X-ray brightness (watts per square meter) of a class-1 flare of each letter, as NOAA's GOES satellites measure it. */
const LETTER_FLUX: Record<FlareLetter, number> = { A: 1e-8, B: 1e-7, C: 1e-6, M: 1e-5, X: 1e-4 };

export interface FlareClass {
  letter: FlareLetter;
  /** The number after the letter (1.0 when DONKI gives none). */
  value: number;
  /** Peak X-ray brightness in W/m². */
  flux: number;
}

export function parseFlareClass(s: string | null | undefined): FlareClass | null {
  const m = /^\s*([ABCMX])\s*(\d+(?:\.\d+)?)?\s*$/i.exec(s ?? '');
  if (!m) return null;
  const letter = m[1].toUpperCase() as FlareLetter;
  const value = m[2] ? Number(m[2]) : 1;
  if (!Number.isFinite(value) || value <= 0) return null;
  return { letter, value, flux: value * LETTER_FLUX[letter] };
}

/** How many times stronger flare class `a` is than a class-1 flare of `letter` (e.g. X3.9 vs M = 39). */
export function timesStronger(a: FlareClass, letter: FlareLetter): number {
  return a.flux / LETTER_FLUX[letter];
}

/** "39", "3.9", "1,200": at most one decimal, no float noise. */
export function niceNumber(x: number): string {
  return x.toLocaleString('en-US', { maximumFractionDigits: x < 10 ? 1 : 0 });
}

// ------------------------------------------------------------------ rarity
/** The May 20, 2024 CME from the far side of the Sun (no source location seen from Earth, 2,000+ km/s). */
export function isFarSideGiant(c: Pick<CardFacts, 'kind' | 'time' | 'location' | 'speedKms'>): boolean {
  return c.kind === 'cme' && c.time.startsWith('2024-05-20') && !c.location && (c.speedKms ?? 0) >= 2000;
}

export function rarityOf(c: Pick<CardFacts, 'kind' | 'classType' | 'severity' | 'speedKms' | 'time' | 'location'>): Rarity {
  if (c.kind === 'flare') {
    const fc = parseFlareClass(c.classType);
    if (fc) {
      if (fc.letter === 'X') return fc.value >= 5 ? 'legendary' : 'epic';
      if (fc.letter === 'M') return 'rare';
      return 'common';
    }
    return c.severity === 'major' ? 'epic' : c.severity === 'moderate' ? 'rare' : 'common';
  }
  if (c.kind === 'sep') return c.severity === 'major' ? 'epic' : 'rare';
  // CME: by its measured speed.
  const v = c.speedKms ?? 0;
  if (v >= 2000) return 'legendary';
  if (v >= 1000) return 'epic';
  return 'rare';
}

/** Rarity first (legendary on top), then the stronger flare / faster CME, then the newest. */
export function rarityRank(r: Rarity): number {
  return RARITIES.indexOf(r);
}

export function strength(c: Pick<CardFacts, 'kind' | 'classType' | 'speedKms'>): number {
  if (c.kind === 'flare') return parseFlareClass(c.classType)?.flux ?? 0;
  if (c.kind === 'cme') return (c.speedKms ?? 0) * 1e-6;
  return 0;
}

/** The rule printed on the "How rarity works" note. */
export const RARITY_RULES: Array<{ rarity: Rarity; text: string }> = [
  { rarity: 'common', text: 'C-class solar flares.' },
  { rarity: 'rare', text: 'M-class flares (10 times stronger than C), particle storms, and solar eruptions (CMEs) slower than 1,000 km/s.' },
  { rarity: 'epic', text: 'X-class flares (10 times stronger than M), particle storms that an instrument at Mars recorded, and CMEs from 1,000 km/s.' },
  { rarity: 'legendary', text: 'X5 flares and stronger, and CMEs of 2,000 km/s or faster, like the far-side giant of May 20, 2024.' },
];

// ------------------------------------------------------------------ words for a card
export function kindWord(c: Pick<CardFacts, 'kind'>): string {
  return c.kind === 'flare' ? 'Solar flare' : c.kind === 'sep' ? 'Particle storm' : 'Solar eruption (CME)';
}

/** The big label on the card: "X8.7", "SEP" or "CME". */
export function bigLabel(c: Pick<CardFacts, 'kind' | 'classType'>): string {
  if (c.kind === 'flare') return parseFlareClass(c.classType) ? c.classType!.trim().toUpperCase() : 'FLARE';
  return c.kind === 'sep' ? 'SEP' : 'CME';
}

/** "X8.7 solar flare", "Particle storm", "Far-side CME". */
export function cardTitle(c: CardFacts): string {
  if (isFarSideGiant(c)) return 'Far-side CME';
  if (c.kind === 'flare' && c.classType) return `${c.classType} solar flare`;
  return kindWord(c);
}

/** "May 14, 2024" (UTC, the date NASA records). */
export function cardDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

/** "May 14, 2024 at 16:51 UTC". */
export function cardDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const hm = d.toISOString().slice(11, 16);
  return `${cardDate(iso)} at ${hm} UTC`;
}

/** DONKI source location, e.g. "S16W15" or "N08E61", in degrees (north and west positive). */
export function parseLocation(loc: string | null | undefined): { lat: number; lon: number } | null {
  const m = /^\s*([NS])(\d{1,2})([EW])(\d{1,3})\s*$/i.exec(loc ?? '');
  if (!m) return null;
  const lat = Number(m[2]) * (m[1].toUpperCase() === 'N' ? 1 : -1);
  const lon = Number(m[4]) * (m[3].toUpperCase() === 'W' ? 1 : -1);
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon };
}

/** "16 degrees south and 15 degrees west of the middle of the Sun's face (as seen from Earth)". */
export function locationWords(loc: string | null | undefined): string | null {
  const p = parseLocation(loc);
  if (!p) return null;
  const ns = p.lat === 0 ? 'on the Sun\'s equator' : `${Math.abs(p.lat)} degrees ${p.lat > 0 ? 'north' : 'south'}`;
  const ew = p.lon === 0 ? 'on the center line' : `${Math.abs(p.lon)} degrees ${p.lon > 0 ? 'west' : 'east'}`;
  return `${ns} and ${ew} of the middle of the Sun's face, as seen from Earth (DONKI writes ${loc!.trim().toUpperCase()}).`;
}

/** "an M1", "an X1", "a C1": the letter names start with a vowel sound for A, M and X. */
function an(letter: FlareLetter): string {
  return letter === 'A' || letter === 'M' || letter === 'X' ? 'an' : 'a';
}

/** Plain-words lines about what the flare class means, all computed from the class. */
export function classMeaning(classType: string | null | undefined): string[] {
  const fc = parseFlareClass(classType);
  if (!fc) return [];
  const label = classType!.trim().toUpperCase();
  const lines = [
    `The letter is how bright the flare's X-ray flash was, measured by NOAA's GOES satellites. The letters go A, B, C, M, X, and each letter is 10 times stronger than the one before.`,
    `The number tells how far up its letter it went: ${label} was ${niceNumber(fc.value)} times as strong as ${an(fc.letter)} ${fc.letter}1 flare.`,
  ];
  const i = FLARE_LETTERS.indexOf(fc.letter);
  const lower = FLARE_LETTERS.slice(Math.max(0, i - 2), i).reverse();
  if (lower.length) {
    const parts = lower.map((l) => `${niceNumber(timesStronger(fc, l))} times as strong as ${an(l)} ${l}1 flare`);
    lines.push(`So ${label} was about ${parts.join(', and about ')}.`);
  }
  return lines;
}
