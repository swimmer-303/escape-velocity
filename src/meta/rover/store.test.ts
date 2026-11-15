// Written with AI assistance (Claude Code). See README "Use of AI tools".
// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { STORE_KEY, defaultSite, freshStore, gotToday, loadStore, rememberGameSite, rollDay, sanitize, saveStore } from './store';

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('rover store', () => {
  it('starts fresh and round-trips', () => {
    const s = loadStore();
    expect(s).toEqual(freshStore());
    s.museum['gale-mudstone'] = { count: 2, first: '2026-11-14' };
    s.best.gale = { haul: 3, distance: 1200 };
    s.today = { date: '2026-11-14', got: { gale: ['2026-11-14:gale:0'], arcadia: [], moon: [] } };
    saveStore(s);
    expect(loadStore()).toEqual(s);
  });

  it('survives corrupt storage: bad JSON, wrong types, unknown samples, junk lists', () => {
    for (const raw of ['{not json', 'null', '42', '"text"', '[]', JSON.stringify({ v: 2 }), JSON.stringify({ v: 1, museum: 'x', best: [], today: 5 })]) {
      localStorage.setItem(STORE_KEY, raw);
      expect(loadStore()).toEqual(freshStore());
    }
    localStorage.setItem(
      STORE_KEY,
      JSON.stringify({
        v: 1,
        lastGameSite: 'venus',
        lastRoverSite: 'moon',
        museum: { 'gale-mudstone': { count: 3.7, first: '2026-11-01' }, 'made-up': { count: 9 }, 'moon-ice': { count: -1 }, 'arc-ice': null },
        today: { date: '2026-11-14', got: { gale: ['a', 'a', 7, null, 'b'], arcadia: 'x', mars: ['c'] } },
        best: { gale: { haul: 'lots', distance: 1e12 }, moon: { haul: 4, distance: 300 } },
        trips: -5,
        totalSamples: Infinity,
      }),
    );
    const s = loadStore();
    expect(s.lastGameSite).toBeNull();
    expect(s.lastRoverSite).toBe('moon');
    expect(Object.keys(s.museum)).toEqual(['gale-mudstone']);
    expect(s.museum['gale-mudstone'].count).toBe(3);
    expect(s.today.got.gale).toEqual(['a', 'b']);
    expect(s.today.got.arcadia).toEqual([]);
    expect(s.best.gale).toEqual({ haul: 0, distance: 1e6 });
    expect(s.best.moon).toEqual({ haul: 4, distance: 300 });
    expect(s.trips).toBe(0);
    expect(s.totalSamples).toBe(0);
  });

  it('keeps working when localStorage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('full');
    });
    expect(loadStore()).toEqual(freshStore());
    expect(() => saveStore(freshStore())).not.toThrow();
    expect(() => rememberGameSite('moon')).not.toThrow();
  });

  it('forgets yesterday\'s banked targets when a new day starts', () => {
    const s = sanitize({ v: 1, today: { date: '2026-11-13', got: { gale: ['2026-11-13:gale:0'] } } });
    expect(gotToday(s, 'gale', '2026-11-14').size).toBe(0);
    expect(gotToday(s, 'gale', '2026-11-13').size).toBe(1);
    rollDay(s, '2026-11-14');
    expect(s.today).toEqual({ date: '2026-11-14', got: { gale: [], arcadia: [], moon: [] } });
  });

  it('preselects the last game\'s site, then the last drive\'s, then Gale Crater', () => {
    expect(defaultSite()).toBe('gale');
    const s = loadStore();
    s.lastRoverSite = 'arcadia';
    saveStore(s);
    expect(defaultSite()).toBe('arcadia');
    rememberGameSite('moon');
    expect(defaultSite()).toBe('moon');
  });
});
