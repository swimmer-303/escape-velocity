// @vitest-environment happy-dom
// Written with AI assistance (Claude Code). See README "Use of AI tools".
import { describe, it, expect } from 'vitest';
import { earthCard } from './views';
import { createMission, runSol, getBriefing, emptyAlloc } from '../sim/sim';
import { testConfig } from '../sim/fixtures.test-util';
import { EARTH_LINKS } from '../data/earth';

describe('From Mars to Earth card', () => {
  it('always links water recycling, adds farming when the crew grew food, and cites NASA Spinoff', () => {
    let s = createMission(testConfig('earth'));
    const b = getBriefing(s);
    const a = emptyAlloc();
    a.heaters = b.heaterNeed;
    a.greenhouse = 2;
    a.air = 1;
    a.fuel = b.cells - a.heaters - a.greenhouse - a.air;
    s = runSol(s, a).next;
    const card = earthCard(s);
    expect(card.textContent).toMatch(/From Mars to Earth/);
    expect(card.textContent).toMatch(/drinking water/);
    expect(card.textContent).toMatch(/vertical farm/);
    expect([...card.querySelectorAll('a')].every((x) => x.getAttribute('href')?.startsWith('https://'))).toBe(true);
    expect(EARTH_LINKS.every((l) => /nasa\.gov/.test(l.url))).toBe(true);
  });
});
