// Written with AI assistance (Claude Code). See README "Use of AI tools".
// Outpost Architect: Blueprint star rules. Twelve cards, each reachable with the parts unlocked before it, stars 2
// and 3 only count with star 1, the wrong site gives nothing, and unlocks and XP follow the stars.
import { describe, it, expect } from 'vitest';
import { CHALLENGES, isOpen, scoreChallenge, starTotals, unlockedBy, unlockedParts, xpPerStar, type Challenge } from './challenges';
import { readout } from './stress';
import { autoLayout, withBerms } from './fixtures.test-util';
import { STARTER_PARTS, PART_IDS, PARTS, type PartId } from './parts';
import type { Layout } from './layout';

const score = (ch: Challenge, layout: Layout) => scoreChallenge(ch, { layout, r: readout(layout) });
const byId = (id: string) => CHALLENGES.find((c) => c.id === id)!;

/** A base that wins 3 stars on each card, using only parts unlocked by the cards before it. */
const WINNERS: Record<string, Layout> = {
  'first-light': autoLayout('gale', { habitat: 1, o2: 1, greenhouse: 1, heater: 1, solar: 6, shelter: 1, monitor: 1, rocket: 1 }),
  'ten-panels': autoLayout('gale', { habitat: 2, o2: 1, greenhouse: 1, heater: 1, solar: 10, battery: 2, shelter: 1, monitor: 1, rocket: 1 }),
  'dust-buster': autoLayout('gale', { habitat: 2, o2: 1, greenhouse: 1, heater: 1, solar: 9, battery: 2, shelter: 1, monitor: 1, rocket: 1 }),
  'storm-shelter': autoLayout('gale', { habitat: 2, o2: 1, greenhouse: 1, heater: 1, solar: 9, battery: 2, shelter: 1, monitor: 1, rocket: 1 }),
  'eight-sols': autoLayout('gale', { habitat: 2, o2: 1, greenhouse: 1, heater: 1, solar: 11, battery: 2, shelter: 1, monitor: 1, rocket: 1 }),
  'ice-miner': autoLayout('arcadia', { habitat: 3, o2: 1, greenhouse: 1, heater: 2, solar: 14, battery: 3, shelter: 2, monitor: 1, rocket: 1 }),
  'moon-base': autoLayout('moon', { habitat: 2, o2: 1, greenhouse: 1, heater: 1, solar: 14, battery: 3, shelter: 1, rocket: 1 }),
  'lunar-night': autoLayout('moon', { habitat: 2, o2: 1, greenhouse: 1, heater: 1, solar: 10, battery: 2, reactor: 2, shelter: 1, rocket: 1 }),
  'shelter-six': withBerms('gale', { habitat: 3, o2: 1, greenhouse: 1, heater: 2, solar: 14, battery: 3, reactor: 1, shelter: 2, monitor: 1, rocket: 1 }),
  tiny: autoLayout('gale', { habitat: 2, o2: 1, greenhouse: 1, heater: 1, solar: 6, shelter: 1, monitor: 1, rocket: 1 }),
  'moon-express': autoLayout('moon', { habitat: 2, bigo2: 1, greenhouse: 1, heater: 1, solar: 6, reactor: 2, battery: 1, shelter: 1, rocket: 1 }),
  grand: withBerms('gale', { habitat: 3, bigo2: 1, greenhouse: 1, heater: 2, solar: 10, reactor: 2, battery: 3, shelter: 2, monitor: 1, rocket: 1 }),
};

describe('the blueprints', () => {
  it('has at least 12 cards with unique ids, goals, tips and checks', () => {
    expect(CHALLENGES.length).toBeGreaterThanOrEqual(12);
    expect(new Set(CHALLENGES.map((c) => c.id)).size).toBe(CHALLENGES.length);
    for (const c of CHALLENGES) {
      expect(c.goal.length).toBeGreaterThan(20);
      expect(c.tip.length).toBeGreaterThan(10);
      expect(c.needs.length).toBeGreaterThan(0);
    }
  });

  it('every card can be won with 3 stars using parts unlocked by then (a card\'s own unlock may be needed for star 3)', () => {
    let stars: Record<string, number> = {};
    for (const c of CHALLENGES) {
      const layout = WINNERS[c.id];
      expect(layout, c.id).toBeDefined();
      const have = unlockedParts({ ...stars, [c.id]: 1 });
      for (const p of layout.parts) expect(have.has(p.part), `${c.id} uses ${p.part}`).toBe(true);
      expect(score(c, layout).stars, c.id).toBe(3);
      stars = { ...stars, [c.id]: 3 };
    }
  });

  it('star 1 never needs the card\'s own unlock: the lunar night can be survived on batteries alone', () => {
    const batteries = autoLayout('moon', { habitat: 2, o2: 1, greenhouse: 1, heater: 1, solar: 9, battery: 2, shelter: 1, rocket: 1 });
    expect(batteries.parts.some((p) => p.part === 'reactor')).toBe(false);
    expect(score(byId('lunar-night'), batteries).stars).toBeGreaterThanOrEqual(1);
    // Every other winning base uses only parts unlocked before its card.
    let stars: Record<string, number> = {};
    for (const c of CHALLENGES) {
      if (c.id !== 'lunar-night') {
        const have = unlockedParts(stars);
        for (const p of WINNERS[c.id].parts) expect(have.has(p.part), `${c.id} uses ${p.part}`).toBe(true);
      }
      stars = { ...stars, [c.id]: 3 };
    }
  });

  it('gives no stars at the wrong site, even for a winning base', () => {
    const moonCard = byId('moon-base');
    const s = score(moonCard, WINNERS['ten-panels']);
    expect(s.stars).toBe(0);
    expect(s.needs[0]).toEqual({ text: 'Build at the Moon', ok: false });
  });

  it('stars 2 and 3 only count with star 1', () => {
    // Ten panels only: 11 panels breaks the goal, even though the base passes the stress test (star 2's check).
    const s = score(byId('ten-panels'), autoLayout('gale', { habitat: 2, o2: 1, greenhouse: 1, heater: 1, solar: 11, battery: 2, shelter: 1, monitor: 1, rocket: 1 }));
    expect(s.needs.find((n) => /10 solar/.test(n.text))?.ok).toBe(false);
    expect(s.stars).toBe(0);
    expect(s.star2).toBe(false);
    expect(s.star3).toBe(false);
  });

  it('counts 1, 2 or 3 stars', () => {
    const ch = byId('storm-shelter');
    // Passes, but not steady (no battery for the dust): 1 star... plus 90% shielded = 2.
    const two = score(ch, autoLayout('gale', { habitat: 2, o2: 1, greenhouse: 1, heater: 1, solar: 7, shelter: 1, monitor: 1, rocket: 1 }));
    expect(two.stars).toBe(2);
    expect(two.star3).toBe(false);
    expect(score(ch, WINNERS['storm-shelter']).stars).toBe(3);
    // Too small a crew: no stars.
    expect(score(ch, WINNERS['first-light']).stars).toBe(0);
  });

  it('opens cards in order (the first three are open), and unlocks parts with a star', () => {
    expect(isOpen(0, {})).toBe(true);
    expect(isOpen(2, {})).toBe(true);
    expect(isOpen(3, {})).toBe(false);
    expect(isOpen(3, { [CHALLENGES[2].id]: 1 })).toBe(true);
    const start = unlockedParts({});
    expect([...start].sort()).toEqual([...STARTER_PARTS].sort());
    expect(unlockedParts({ 'lunar-night': 1 }).has('reactor')).toBe(true);
    expect(unlockedBy('reactor')?.id).toBe('lunar-night');
  });

  it('every part is either a starter or unlocked by exactly one card', () => {
    for (const id of PART_IDS) {
      const by = CHALLENGES.filter((c) => c.unlocks.includes(id as PartId));
      if ((STARTER_PARTS as readonly string[]).includes(id)) expect(by, id).toHaveLength(0);
      else expect(by, `${id} (${PARTS[id].name})`).toHaveLength(1);
    }
  });

  it('harder cards give more XP per star, and totals add up', () => {
    expect(xpPerStar(0)).toBeLessThan(xpPerStar(CHALLENGES.length - 1));
    expect(starTotals({ 'first-light': 3, 'ten-panels': 1, junk: 3 })).toEqual({ got: 4, max: CHALLENGES.length * 3, done: 2 });
  });
});
