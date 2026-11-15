// @vitest-environment happy-dom
// Written with AI assistance (Claude Code). See README "Use of AI tools".
// Rival Race building blocks: the HUD extension point in ../hooks, portraits, icons and the standings HUD.

import { describe, it, expect } from 'vitest';
import { addHudExtra, renderHudExtras } from '../hooks';
import { createMission } from '../../sim/sim';
import { missionConfigFor, newCampaign } from '../../sim/campaign';
import { lookFor, portrait, portraitGrid } from './portrait';
import { statusIcon, trophy } from './art';
import { StandingsHud } from './hud';
import { createRace, liveRows, racePool } from './race';

describe('HUD extras (hooks)', () => {
  const m = createMission(missionConfigFor(newCampaign('hud', 'cadet'), 12, []));

  it('renders what features add, skips nulls, and never lets one feature break the HUD', () => {
    const el = document.createElement('div');
    addHudExtra({ id: 't-a', render: () => el });
    addHudExtra({ id: 't-null', render: () => null });
    addHudExtra({
      id: 't-throws',
      render: () => {
        throw new Error('boom');
      },
    });
    const out = renderHudExtras(m, 'quick');
    expect(out).toContain(el);
    expect(out.every((x) => x instanceof HTMLElement)).toBe(true);
    // Registering the same id again replaces it.
    const el2 = document.createElement('div');
    addHudExtra({ id: 't-a', render: () => el2 });
    const again = renderHudExtras(m, 'quick');
    expect(again).toContain(el2);
    expect(again).not.toContain(el);
  });
});

describe('portraits and icons', () => {
  it('are the same for the same seed and differ between rivals', () => {
    expect(lookFor('rival|vega')).toEqual(lookFor('rival|vega'));
    const looks = ['vega', 'pip', 'kiko', 'bolt', 'rook', 'nova', 'zara'].map((id) => JSON.stringify(portraitGrid(lookFor(`rival|${id}`))) + JSON.stringify(lookFor(`rival|${id}`)));
    expect(new Set(looks).size).toBe(looks.length);
    for (const row of portraitGrid(lookFor('x'))) expect(row.length).toBe(12);
  });

  it('are inline SVG pixel art with labels when they carry meaning', () => {
    const svg = portrait('rival|vega', { size: 32, label: 'Captain Vega' });
    expect(svg.tagName.toLowerCase()).toBe('svg');
    expect(svg.getAttribute('aria-label')).toBe('Captain Vega');
    expect(svg.querySelectorAll('rect').length).toBeGreaterThan(10);
    expect(portrait('x').getAttribute('aria-hidden')).toBe('true');
    expect(statusIcon('won').getAttribute('aria-label')).toBe('Launched');
    expect(statusIcon('playing').getAttribute('aria-label')).toBe('Crew safe');
    expect(trophy('#ffd84a').querySelectorAll('rect').length).toBeGreaterThan(5);
  });
});

describe('standings HUD', () => {
  it('lists every crew with fuel and a crew-safe sign, and stays the same element between redraws', () => {
    const race = createRace({ league: 1, you: { adj: 'Bold', noun: 'Star', num: 7 }, seed: 'rhud', lightTimeMin: 12, eventPool: racePool() });
    const m = createMission(missionConfigFor(newCampaign(race.seed, race.difficulty, race.site), 12, race.eventPool));
    const hud = new StandingsHud(() => true);
    hud.reset(race.league, false);
    const root = hud.root;
    hud.update(liveRows(race, m), { sols: 0, banter: { racer: race.racers[1], text: 'My rocket is half full!' } });
    expect(hud.root).toBe(root);
    expect(root.querySelectorAll('.rh-row').length).toBe(4);
    expect(root.querySelector('.rh-row.k-you')!.getAttribute('aria-label')).toMatch(/you, rocket 0 percent full, crew safe/);
    expect(root.querySelectorAll('.rh-safe svg').length).toBe(4);
    expect(root.querySelector('.rh-banter')!.textContent).toContain('My rocket is half full!');
    expect(root.textContent).toContain('Silver league');
  });
});
