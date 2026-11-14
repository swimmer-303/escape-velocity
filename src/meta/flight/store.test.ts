// @vitest-environment happy-dom
// Written with AI assistance (Claude Code). See README "Use of AI tools".
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { STORE_KEY, bestFor, recordFlight, upgradeXp } from './store';

beforeEach(() => localStorage.clear());

describe('best flight medals', () => {
  it('remembers the best medal per game and world, and says when a flight beats it', () => {
    expect(bestFor('landing', 'mars')).toBeNull();
    expect(recordFlight('landing', 'mars', 'silver', 0.6)).toEqual({ prev: null, newBest: true });
    expect(recordFlight('landing', 'mars', 'bronze', 0.4).newBest).toBe(false);
    expect(bestFor('landing', 'mars')!.medal).toBe('silver');
    expect(recordFlight('landing', 'mars', 'silver', 0.65).newBest).toBe(true);
    const r = recordFlight('landing', 'mars', 'gold', 0.9);
    expect(r.newBest).toBe(true);
    expect(r.prev!.medal).toBe('silver');
    expect(bestFor('landing', 'mars')!.medal).toBe('gold');
    expect(bestFor('landing', 'moon')).toBeNull();
    expect(bestFor('launch', 'mars')).toBeNull();
    expect(JSON.parse(localStorage.getItem(STORE_KEY)!).best['landing-mars'].medal).toBe('gold');
  });

  it('survives broken or blocked storage', () => {
    localStorage.setItem(STORE_KEY, '{not json');
    expect(bestFor('launch', 'moon')).toBeNull();
    localStorage.setItem(STORE_KEY, JSON.stringify({ v: 1, best: { 'launch-moon': { medal: 'platinum' } } }));
    expect(bestFor('launch', 'moon')).toBeNull();
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('full');
    });
    expect(() => recordFlight('launch', 'moon', 'gold', 1)).not.toThrow();
    spy.mockRestore();
  });

  it('XP for a better medal is the difference, and nothing for the same or worse', () => {
    expect(upgradeXp('gold', null)).toBe(60);
    expect(upgradeXp('gold', 'silver')).toBe(20);
    expect(upgradeXp('silver', 'gold')).toBe(0);
    expect(upgradeXp('bronze', 'bronze')).toBe(0);
  });
});
