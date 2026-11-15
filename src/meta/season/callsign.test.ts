// Written with AI assistance (Claude Code). See README "Use of AI tools".
// Callsign safety: only friendly words from our own lists, no free text, no rude numbers, and re-rolls change it.
import { describe, it, expect } from 'vitest';
import { ADJECTIVES, BLOCKED_NUMBERS, MAX_NUMBER, MIN_NUMBER, SPACE_NOUNS, callsignText, isValidCallsign, rollCallsign } from './callsign';

// A small list of things that must never appear inside a callsign word (checked as substrings, any case).
const NEVER = ['ass', 'butt', 'poo', 'pee', 'sex', 'kill', 'dead', 'die', 'hate', 'gun', 'fat', 'ugly', 'dumb', 'stupid', 'nazi', 'drug', 'beer', 'fart', 'damn', 'hell'];

function seq(values: number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length];
}

describe('callsign word lists', () => {
  it('are plain, capitalized, unique words', () => {
    for (const list of [ADJECTIVES, SPACE_NOUNS]) {
      expect(list.length).toBeGreaterThanOrEqual(30);
      expect(new Set(list).size).toBe(list.length);
      for (const w of list) expect(w).toMatch(/^[A-Z][a-z]{1,11}$/);
    }
  });

  it('hold no rude or scary words, even inside a word', () => {
    for (const w of [...ADJECTIVES, ...SPACE_NOUNS]) for (const bad of NEVER) expect(w.toLowerCase().includes(bad), `${w} contains ${bad}`).toBe(false);
  });

  it('never makes a blocked number, and stays between 1 and 99', () => {
    for (let i = 0; i < 2000; i++) {
      const c = rollCallsign();
      expect(isValidCallsign(c)).toBe(true);
      expect(c.num).toBeGreaterThanOrEqual(MIN_NUMBER);
      expect(c.num).toBeLessThanOrEqual(MAX_NUMBER);
      expect(BLOCKED_NUMBERS).not.toContain(c.num);
    }
    // Even when the random source lands right on one.
    const c = rollCallsign(seq([0, 0, 68 / 99 + 0.001]));
    expect(BLOCKED_NUMBERS).not.toContain(c.num);
  });

  it('re-rolls to something different, even from a stuck random source', () => {
    const a = rollCallsign(seq([0.5]));
    const b = rollCallsign(seq([0.5]), a);
    expect(callsignText(b)).not.toBe(callsignText(a));
    expect(isValidCallsign(b)).toBe(true);
  });

  it('rejects anything not built from the lists (no free-text names)', () => {
    expect(isValidCallsign({ adj: 'Brave', noun: 'Comet', num: 42 })).toBe(true);
    expect(isValidCallsign({ adj: 'Sam', noun: 'Comet', num: 42 })).toBe(false);
    expect(isValidCallsign({ adj: 'Brave', noun: 'Comet', num: 69 })).toBe(false);
    expect(isValidCallsign({ adj: 'Brave', noun: 'Comet', num: 4.5 })).toBe(false);
    expect(isValidCallsign({ adj: 'Brave', noun: 'Comet', num: 100 })).toBe(false);
    expect(isValidCallsign('Brave Comet 42')).toBe(false);
    expect(isValidCallsign(null)).toBe(false);
    expect(callsignText({ adj: 'Brave', noun: 'Comet', num: 42 })).toBe('Brave Comet 42');
  });
});
