// @vitest-environment happy-dom
// Written with AI assistance (Claude Code). See README "Use of AI tools".
// Outpost Architect: saves survive corrupt or blocked storage, and stars only go up.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { STORE_KEY, SLOT_COUNT, cleanName, deleteSlot, loadCurrent, loadSlot, readSave, recordStars, saveCurrent, saveSlot } from './store';
import { autoLayout } from './fixtures.test-util';

beforeEach(() => localStorage.clear());

describe('builder storage', () => {
  it('saves and loads slots and the current base', () => {
    const l = autoLayout('moon', { habitat: 2, solar: 6, battery: 2 });
    saveSlot(2, 'Moon Base One', l);
    expect(readSave().slots[2]?.name).toBe('Moon Base One');
    expect(loadSlot(2)?.parts).toHaveLength(l.parts.length);
    expect(loadSlot(0)).toBeNull();
    deleteSlot(2);
    expect(loadSlot(2)).toBeNull();
    saveCurrent(l);
    expect(loadCurrent()?.site).toBe('moon');
    expect(saveSlot(99, 'x', l).slots).toHaveLength(SLOT_COUNT);
  });

  it('cleans names (length, markup, blanks)', () => {
    expect(cleanName('  <b>Mega</b> base  ')).toBe('bMega/b base');
    expect(cleanName('')).toBe('My base');
    expect(cleanName(42)).toBe('My base');
    expect(cleanName('x'.repeat(100))).toHaveLength(24);
  });

  it('stars only go up and report what is new', () => {
    expect(recordStars('first-light', 1)).toEqual({ before: 0, added: 1 });
    expect(recordStars('first-light', 3)).toEqual({ before: 1, added: 2 });
    expect(recordStars('first-light', 2)).toEqual({ before: 3, added: 0 });
    expect(readSave().stars['first-light']).toBe(3);
  });

  it('survives corrupt storage', () => {
    for (const junk of ['not json{', '"a string"', '[]', 'null', '{"v":2}', JSON.stringify({ v: 1, slots: 'x', stars: [], current: 5, seen: {} })]) {
      localStorage.setItem(STORE_KEY, junk);
      const s = readSave();
      expect(s.v).toBe(1);
      expect(s.slots).toHaveLength(SLOT_COUNT);
      expect(s.current).toBeNull();
    }
    localStorage.setItem(
      STORE_KEY,
      JSON.stringify({ v: 1, slots: [{ name: 'Bad', code: 'zzzz' }, { name: 'Good', code: '1g0' }, null], current: '1g999', stars: { 'first-light': 7, 'ten-panels': 2, hack: 3, grand: 'x' } }),
    );
    const s = readSave();
    expect(s.slots[0]).toBeNull();
    expect(s.current).toBeNull();
    expect(s.stars).toEqual({ 'ten-panels': 2 });
  });

  it('works when storage is blocked', () => {
    const get = vi.spyOn(localStorage, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const set = vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(readSave().slots).toHaveLength(SLOT_COUNT);
    expect(() => saveCurrent(autoLayout('gale', { habitat: 1 }))).not.toThrow();
    expect(recordStars('first-light', 2).added).toBe(2);
    expect(loadCurrent()).toBeNull();
    get.mockRestore();
    set.mockRestore();
  });
});
