// @vitest-environment happy-dom
// Written with AI assistance (Claude Code). See README "Use of AI tools".
// Season save data: junk, wrong types, made-up ids, unsafe callsigns and blocked storage never break the game.
import { describe, it, expect, beforeEach } from 'vitest';
import { STORAGE_KEY, freshState, loadState, sanitize, saveState } from './store';
import { DEFAULT_CARD } from './rewards';
import { isValidCallsign } from './callsign';

beforeEach(() => localStorage.clear());

describe('season storage safety', () => {
  it('starts fresh with nothing saved, with a safe callsign and the default card', () => {
    const s = loadState();
    expect(s.xp).toBe(0);
    expect(s.claimed).toEqual([]);
    expect(isValidCallsign(s.card.callsign)).toBe(true);
    expect(s.card).toMatchObject(DEFAULT_CARD);
  });

  it('falls back field by field from junk', () => {
    for (const junk of [null, 42, 'hi', [], { xp: 'lots' }, { claimed: 'all' }]) {
      const s = sanitize(junk);
      expect(s.xp).toBe(0);
      expect(s.claimed).toEqual([]);
    }
    const s = sanitize({
      xp: 1234.9,
      claimed: [1, 1, 2, 99, -1, 'x', 3.5, 40],
      announced: 1e9,
      weekly: { week: '2026-W46', ids: ['w-sols-40', 'not-a-challenge'], progress: [5, 5] },
      login: { last: 'yesterday', count: -4 },
      events: [{ id: 'live:2026-11-05T18:21:00-FLR-001', progress: [9, 'x'], rewarded: true }, { id: '<script>', progress: [] }],
      eventPatches: [
        { id: 'live:2026-11-05T18:21:00-FLR-001', kind: 'flare', mark: 'M3.5', date: 'Nov 5, 2026' },
        { id: 'live:x', kind: 'flare', mark: '<b>hi</b>', date: 'Nov 5, 2026' },
        { id: 'archive:gannon-2024', kind: 'gannon', mark: 'G5', date: 'May 10, 2024' },
        { id: 'archive:gannon-2024', kind: 'gannon', mark: 'G5', date: 'May 10, 2024' },
      ],
      card: { callsign: { adj: 'Rude', noun: 'Word', num: 7 }, title: 't-made-up', banner: 'b-aurora', frame: 42, patch: 'archive:gannon-2024' },
      stats: { sols: 12, missions: 'many', bestLevel: 99, bestRank: 'Commander<script>' },
    });
    expect(s.xp).toBe(1234);
    expect(s.claimed).toEqual([1, 2, 40]);
    expect(s.announced).toBe(40);
    expect(s.weekly).toBeNull(); // a challenge we do not know: start the week over
    expect(s.login).toEqual({ last: null, count: 0 });
    expect(s.events).toHaveLength(1);
    expect(s.events[0].progress).toEqual([9, 0, 0]);
    expect(s.eventPatches.map((p) => p.id)).toEqual(['live:2026-11-05T18:21:00-FLR-001', 'archive:gannon-2024']);
    expect(isValidCallsign(s.card.callsign)).toBe(true);
    expect(s.card.callsign.adj).not.toBe('Rude');
    expect(s.card.title).toBe(DEFAULT_CARD.title);
    expect(s.card.banner).toBe('b-aurora');
    expect(s.card.frame).toBe(DEFAULT_CARD.frame);
    expect(s.card.patch).toBe('archive:gannon-2024');
    expect(s.stats).toMatchObject({ sols: 12, missions: 0, bestLevel: 50, bestRank: null });
  });

  it('reads damaged JSON as a fresh start, and round-trips a real save', () => {
    localStorage.setItem(STORAGE_KEY, '{not json');
    expect(loadState().xp).toBe(0);
    const s = freshState();
    s.xp = 777;
    s.claimed = [1, 2];
    saveState(s);
    expect(loadState()).toEqual(s);
  });

  it('never throws when storage is blocked', () => {
    const get = Storage.prototype.getItem;
    const set = Storage.prototype.setItem;
    Storage.prototype.getItem = () => {
      throw new Error('blocked');
    };
    Storage.prototype.setItem = () => {
      throw new Error('blocked');
    };
    try {
      expect(loadState().xp).toBe(0);
      expect(() => saveState(freshState())).not.toThrow();
    } finally {
      Storage.prototype.getItem = get;
      Storage.prototype.setItem = set;
    }
  });
});
