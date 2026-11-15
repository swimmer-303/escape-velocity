// Written with AI assistance (Claude Code). See README "Use of AI tools".
// Who is ahead. Pure functions, no DOM.
// Final results: the first crew to launch with everyone safe wins. Ties go to fewer sols, then a lower radiation
// dose, then more air and food left. Crews that went home early come after every crew that launched, ordered by
// how full their rocket got, then how long they lasted.

export interface Finish {
  id: string;
  launched: boolean;
  /** Sols played (the launch sol for a crew that launched). */
  sols: number;
  /** Radiation dose at the end, mSv (game value). */
  dose: number;
  /** Days of air plus days of food left at the end. */
  life: number;
  /** Rocket fuel at the end, % (100 for a launch). */
  fuel: number;
}

const r1 = (x: number) => Math.round((Number.isFinite(x) ? x : 0) * 10) / 10;

/** Negative when `a` finished ahead of `b`; 0 for a true tie. Compared at 0.1 precision (what a challenge link keeps). */
export function compareFinish(a: Finish, b: Finish): number {
  if (a.launched !== b.launched) return a.launched ? -1 : 1;
  if (a.launched) {
    if (a.sols !== b.sols) return a.sols - b.sols;
    if (r1(a.dose) !== r1(b.dose)) return r1(a.dose) - r1(b.dose);
    return r1(b.life) - r1(a.life);
  }
  if (Math.floor(a.fuel) !== Math.floor(b.fuel)) return Math.floor(b.fuel) - Math.floor(a.fuel);
  if (a.sols !== b.sols) return b.sols - a.sols;
  return r1(a.dose) - r1(b.dose);
}

export type Placed<T> = T & { place: number };

/** How you did against one other racer in the final results (a true tie shares a place). */
export type Versus = 'ahead' | 'behind' | 'tie';
export function versus(me: { place: number }, other: { place: number }): Versus {
  return me.place < other.place ? 'ahead' : me.place > other.place ? 'behind' : 'tie';
}

/** Everyone else who shares your place (a true tie: same sols, radiation, and air and food). */
export function tiedWith<T extends { place: number; id: string }>(results: readonly T[], me: T): T[] {
  return results.filter((r) => r.id !== me.id && r.place === me.place);
}

/** Sort and number the places (1 = first). True ties share a place. Stable: ties keep their input order. */
export function rankFinishes<T extends Finish>(list: readonly T[]): Array<Placed<T>> {
  const sorted = list.map((f, i) => ({ f, i })).sort((a, b) => compareFinish(a.f, b.f) || a.i - b.i);
  return sorted.map(({ f }) => ({ ...f, place: 1 + sorted.filter((o) => compareFinish(o.f, f) < 0).length }));
}

// ------------------------------------------------------------------ live standings (mid-race)
export interface LiveEntry {
  id: string;
  status: 'playing' | 'won' | 'lost';
  fuel: number;
  /** Sols played so far (or the launch sol). */
  sols: number;
  /** Known only for crews still playing on this device; a friend's recorded run only has its final dose. */
  dose: number;
  life: number;
  /** Dose and air/food are not known yet (a friend's recorded run, mid-race): skip those tie-breaks. */
  partial?: boolean;
}

const STATUS_ORDER = { won: 0, playing: 1, lost: 2 } as const;

/**
 * Mid-race order: launched crews first, then the fullest rockets, then crews that went home. Same fuel? The same
 * tie-breaks as the final results: less radiation, then more air and food left (when both are known).
 */
export function compareLive(a: LiveEntry, b: LiveEntry): number {
  if (a.status !== b.status) return STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
  if (a.status === 'won') return compareFinish({ ...a, launched: true }, { ...b, launched: true });
  if (Math.floor(a.fuel) !== Math.floor(b.fuel)) return Math.floor(b.fuel) - Math.floor(a.fuel);
  if (a.status === 'lost' && a.sols !== b.sols) return b.sols - a.sols;
  if (a.partial || b.partial) return 0;
  if (r1(a.dose) !== r1(b.dose)) return r1(a.dose) - r1(b.dose);
  return r1(b.life) - r1(a.life);
}

/** Mid-race places are always distinct (1, 2, 3, 4): a crew can only move up by passing someone. */
export function rankLive<T extends LiveEntry>(list: readonly T[]): Array<Placed<T>> {
  const sorted = list.map((f, i) => ({ f, i })).sort((a, b) => compareLive(a.f, b.f) || a.i - b.i);
  return sorted.map(({ f }, k) => ({ ...f, place: k + 1 }));
}

/** XP for a finishing place (1st to 4th), plus a little more in higher leagues. */
export const PLACE_XP = [150, 100, 70, 50] as const;
export function xpForPlace(place: number, leagueIndex: number): number {
  const base = PLACE_XP[Math.max(0, Math.min(PLACE_XP.length - 1, place - 1))];
  return base + 10 * Math.max(0, Math.min(4, leagueIndex));
}

export function ordinal(n: number): string {
  return n === 1 ? '1st' : n === 2 ? '2nd' : n === 3 ? '3rd' : `${n}th`;
}
