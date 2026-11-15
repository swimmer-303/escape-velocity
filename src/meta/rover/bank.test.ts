// Written with AI assistance (Claude Code). See README "Use of AI tools".
// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { bankHaul, keptAfterTow, towHaul, type AboardSample } from './bank';
import { freshStore } from './store';
import { NEW_ENTRY_XP, RARITY_XP } from './samples';
import { onGame } from '../hooks';

const D = '2026-11-14';
const s = (i: number, kind: string): AboardSample => ({ targetId: `${D}:gale:${i}`, kind });

beforeEach(() => localStorage.clear());

describe('banking a haul', () => {
  it('emits XP once per kind of sample banked, not once per sample', () => {
    const store = freshStore();
    const emit = vi.fn();
    const res = bankHaul(store, 'gale', D, [s(0, 'gale-mudstone'), s(1, 'gale-mudstone'), s(2, 'gale-meteorite')], 800, emit);
    expect(emit).toHaveBeenCalledTimes(2);
    expect(res.total).toBe(3);
    const mud = res.byKind.find((k) => k.kind === 'gale-mudstone')!;
    expect(mud.count).toBe(2);
    expect(mud.xp).toBe(RARITY_XP.common * 2 + NEW_ENTRY_XP);
    expect(emit).toHaveBeenCalledWith(mud.xp, expect.stringContaining('Lake mudstone'));
    expect(res.xp).toBe(emit.mock.calls.reduce((t, c) => t + (c[0] as number), 0));
    expect(res.newEntries.sort()).toEqual(['gale-meteorite', 'gale-mudstone']);
  });

  it('goes through the game\'s xp event by default (the rank module and the season pass listen to it)', () => {
    const seen: number[] = [];
    const stop = onGame('xp', ({ amount }) => seen.push(amount));
    bankHaul(freshStore(), 'moon', D, [{ targetId: `${D}:moon:0`, kind: 'moon-regolith' }, { targetId: `${D}:moon:1`, kind: 'moon-ice' }], 100);
    stop();
    expect(seen).toEqual([RARITY_XP.common + NEW_ENTRY_XP, RARITY_XP.legendary + NEW_ENTRY_XP]);
  });

  it('gives the new-entry bonus only the first time, and never banks a target twice in a day', () => {
    const store = freshStore();
    const emit = vi.fn();
    bankHaul(store, 'gale', D, [s(0, 'gale-mudstone')], 100, emit);
    const again = bankHaul(store, 'gale', D, [s(0, 'gale-mudstone'), s(1, 'gale-mudstone')], 100, emit);
    expect(again.total).toBe(1);
    expect(again.byKind[0]).toMatchObject({ isNew: false, xp: RARITY_XP.common });
    expect(store.museum['gale-mudstone'].count).toBe(2);
    expect(store.today.got.gale.sort()).toEqual([`${D}:gale:0`, `${D}:gale:1`]);
    expect(emit).toHaveBeenCalledTimes(2);
  });

  it('ignores unknown samples and gives no XP for an empty haul', () => {
    const emit = vi.fn();
    const res = bankHaul(freshStore(), 'gale', D, [{ targetId: 'x', kind: 'not-a-sample' }], 50, emit);
    expect(res.total).toBe(0);
    expect(emit).not.toHaveBeenCalled();
  });

  it('keeps personal bests per site', () => {
    const store = freshStore();
    const r1 = bankHaul(store, 'gale', D, [s(0, 'gale-mudstone'), s(1, 'gale-veins')], 900, vi.fn());
    expect(r1.bestHaul).toEqual({ prev: 0, isNew: true });
    expect(r1.bestDistance.isNew).toBe(true);
    const r2 = bankHaul(store, 'gale', D, [s(2, 'gale-dune')], 400, vi.fn());
    expect(r2.bestHaul).toEqual({ prev: 2, isNew: false });
    expect(r2.bestDistance).toEqual({ prev: 900, isNew: false });
    expect(store.best.gale).toEqual({ haul: 2, distance: 900 });
    expect(store.best.moon).toEqual({ haul: 0, distance: 0 });
    expect(store.trips).toBe(2);
    expect(store.totalSamples).toBe(3);
    expect(store.lastPlayed).toBe(D);
  });
});

describe('the tow', () => {
  it('has room for about half the samples (rounded up), keeping the rarest', () => {
    expect([0, 1, 2, 3, 4, 5].map(keptAfterTow)).toEqual([0, 1, 1, 2, 2, 3]);
    const kept = towHaul([s(0, 'gale-mudstone'), s(1, 'gale-organics'), s(2, 'gale-veins'), s(3, 'gale-meteorite')]);
    expect(kept.map((k) => k.kind)).toEqual(['gale-organics', 'gale-meteorite']);
  });
});
