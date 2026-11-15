// @vitest-environment happy-dom
// Written with AI assistance (Claude Code). See README "Use of AI tools".
import { describe, it, expect } from 'vitest';
import { earthCard, builtList } from './views';
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

describe('From the Moon to Earth', () => {
  it('names the Moon on a Moon base, and the battery line talks about the lunar night', () => {
    let s = createMission(testConfig('earth-moon', 'cadet', 1, undefined, 0, 'moon'));
    const b = getBriefing(s);
    const a = emptyAlloc();
    a.heaters = b.heaterNeed;
    a.battery = 0;
    a.fuel = b.cells - a.heaters;
    s = runSol(s, a).next;
    s = { ...s, base: { ...s.base, levels: { ...s.base.levels, panel: 1 } } };
    const text = earthCard(s).textContent ?? '';
    expect(text).toMatch(/From the Moon to Earth/);
    expect(text).toMatch(/Living within limits on the Moon/);
    expect(text).toMatch(/lunar night/);
    expect(text).not.toMatch(/Mars|stormy/);
  });
});

describe('builtList', () => {
  it('counts repeats instead of listing the same upgrade over and over', () => {
    expect(builtList(['panel', 'panel', 'panel'])).toBe('Solar panel row x3');
    expect(builtList(['panel', 'battery', 'panel'])).toMatch(/^Solar panel row x2, \S/);
    expect(builtList([])).toBe('');
  });
});
