// Written with AI assistance (Claude Code). See README "Use of AI tools".
// Banking a haul at the charging pad: samples go into the Sample Museum, today's targets are marked as found,
// personal bests are checked, and XP is given ONCE per kind of sample banked (a bigger amount for more of a kind,
// rarer kinds, and kinds new to the Museum). Also the tow: when the battery runs out, the tow rover has room for only
// some of the samples. Pure functions over a store object; the caller saves it.

import { emitGame } from '../hooks';
import { NEW_ENTRY_XP, RARITY_XP, sampleKind, type Rarity } from './samples';
import { rollDay, type RoverStore } from './store';
import type { RoverSite } from './sites';

export interface AboardSample {
  targetId: string;
  kind: string;
}

export interface KindBanked {
  kind: string;
  name: string;
  rarity: Rarity;
  count: number;
  xp: number;
  /** First time in the Museum. */
  isNew: boolean;
}

export interface BankResult {
  byKind: KindBanked[];
  total: number;
  xp: number;
  newEntries: string[];
  bestHaul: { prev: number; isNew: boolean };
  bestDistance: { prev: number; isNew: boolean };
}

export type XpEmitter = (amount: number, reason: string) => void;
const defaultEmit: XpEmitter = (amount, reason) => emitGame('xp', { amount, reason });

/** The tow rover has room for about half the samples (rounded up, so a single sample is always saved). */
export function keptAfterTow(n: number): number {
  return n <= 0 ? 0 : Math.ceil(n / 2);
}

/** Which samples the tow brings home: the rarest first (the friendly choice), then in the order they were found. */
export function towHaul(aboard: AboardSample[]): AboardSample[] {
  const rank: Record<Rarity, number> = { legendary: 3, rare: 2, uncommon: 1, common: 0 };
  const keep = keptAfterTow(aboard.length);
  return aboard
    .map((s, i) => ({ s, i, r: rank[sampleKind(s.kind)?.rarity ?? 'common'] }))
    .sort((a, b) => b.r - a.r || a.i - b.i)
    .slice(0, keep)
    .sort((a, b) => a.i - b.i)
    .map((x) => x.s);
}

/** Bank a haul (after a trip, or after the tow). Mutates `store`; emits one XP event per kind banked. */
export function bankHaul(store: RoverStore, site: RoverSite, date: string, haul: AboardSample[], distance: number, emit: XpEmitter = defaultEmit): BankResult {
  rollDay(store, date);
  const got = new Set(store.today.got[site]);
  const groups = new Map<string, AboardSample[]>();
  for (const s of haul) {
    if (!sampleKind(s.kind) || got.has(s.targetId)) continue; // unknown, or banked already today
    got.add(s.targetId);
    const list = groups.get(s.kind) ?? [];
    list.push(s);
    groups.set(s.kind, list);
  }
  store.today.got[site] = [...got];

  const byKind: KindBanked[] = [];
  const newEntries: string[] = [];
  let total = 0;
  let xp = 0;
  for (const [id, list] of groups) {
    const kind = sampleKind(id)!;
    const entry = store.museum[id];
    const isNew = !entry;
    store.museum[id] = { count: (entry?.count ?? 0) + list.length, first: entry?.first || date };
    const amount = RARITY_XP[kind.rarity] * list.length + (isNew ? NEW_ENTRY_XP : 0);
    total += list.length;
    xp += amount;
    if (isNew) newEntries.push(id);
    byKind.push({ kind: id, name: kind.name, rarity: kind.rarity, count: list.length, xp: amount, isNew });
    emit(amount, `Rover sample${list.length > 1 ? `s x${list.length}` : ''}: ${kind.name}${isNew ? ' (new in the Museum)' : ''}`);
  }

  const best = store.best[site];
  const bestHaul = { prev: best.haul, isNew: total > best.haul };
  const bestDistance = { prev: best.distance, isNew: Math.round(distance) > Math.round(best.distance) };
  if (bestHaul.isNew) best.haul = total;
  if (bestDistance.isNew) best.distance = Math.round(distance);
  store.trips += 1;
  store.totalSamples += total;
  store.lastRoverSite = site;
  store.lastPlayed = date;
  return { byKind, total, xp, newEntries, bestHaul, bestDistance };
}
