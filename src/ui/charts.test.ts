// @vitest-environment happy-dom
// Written with AI assistance (Claude Code). See README "Use of AI tools".
// The "How your mission went" charts render on the real end screen and campaign finale.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { App } from './app';
import { CssStage } from '../render/stage';
import { createMission } from '../sim/sim';
import { builder, playCampaign, playOut, pureGreed } from '../sim/strategies';
import { testConfig, TEST_POOL } from '../sim/fixtures.test-util';
import { missionSeries } from '../sim/series';
import type { Campaign } from '../sim/campaign';
import type { MissionState } from '../sim/types';
import { missionChart } from './charts';

type Internals = {
  mission: MissionState | null;
  mode: 'campaign' | 'quick' | 'history' | null;
  campaign: Campaign | null;
  showEnd(first: boolean): Promise<void>;
  showFinale(): void;
};

beforeEach(() => {
  document.body.innerHTML = `<div id="app"><div id="stage"></div><header id="hud"></header><main id="dock"></main></div><div id="modal-root"></div>`;
  vi.stubGlobal('fetch', () => Promise.reject(new Error('offline in tests')));
  try {
    localStorage.clear();
  } catch {
    /* ignore */
  }
});

async function endScreen(end: MissionState) {
  const app = new App(new CssStage()) as unknown as Internals;
  app.mode = 'quick';
  app.mission = end;
  await app.showEnd(false);
  return document.querySelector('#modal-root .modal')!;
}

describe('mission charts', () => {
  it('the end screen shows an SVG chart of a finished mission', async () => {
    const end = playOut(createMission(testConfig('chart-1', 'cadet', 2, undefined, 14)), builder);
    expect(end.status).toBe('won');
    const modal = await endScreen(end);
    const fig = modal.querySelector('figure.mchart')!;
    expect(fig).not.toBeNull();
    expect(fig.textContent).toMatch(/How your mission went/);
    expect(fig.querySelector('.mchart-takeaway')!.textContent!.length).toBeGreaterThan(10);

    const svg = fig.querySelector('svg.mc-svg')!;
    expect(svg).not.toBeNull();
    expect(svg.getAttribute('role')).toBe('img');
    expect(svg.getAttribute('aria-label')).toMatch(new RegExp(`Chart of ${end.log.length} sols`));
    for (const line of ['fuel', 'air', 'food', 'dose']) expect(svg.querySelector(`path.mc-line.${line}`), line).not.toBeNull();
    // Every strip is titled, and the sol axis is labeled.
    const text = [...svg.querySelectorAll('text')].map((t) => t.textContent).join('|');
    expect(text).toMatch(/Fuel tank/);
    expect(text).toMatch(/Air and food/);
    expect(text).toMatch(/Radiation dose/);
    expect(text).toMatch(/Sol/);
    // Storms and upgrades appear as icons in the event rows.
    const s = missionSeries(end);
    expect(svg.querySelectorAll('svg svg').length).toBe(s.storms.length + s.built.length + s.cold.length);

    // Table view: one row for landing plus one per sol.
    expect(fig.querySelectorAll('.mchart-table tbody tr').length).toBe(end.log.length + 1);
    // The key names both life-support lines (not color alone).
    expect(fig.querySelector('.mchart-legend')!.textContent).toMatch(/Air.*Food/);

    // The readout starts on the last sol and steps with the arrow keys.
    const readout = fig.querySelector('.mchart-readout')!;
    expect(readout.textContent).toMatch(new RegExp(`End of sol ${end.log.length}`));
    const plot = fig.querySelector<HTMLElement>('.mchart-plot')!;
    plot.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    expect(readout.textContent).toMatch(new RegExp(`End of sol ${end.log.length - 1}`));
    plot.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
    expect(readout.textContent).toMatch(/Landing day/);
    expect(svg.ownerDocument.querySelectorAll('.mc-hl circle').length).toBe(4);
  });

  it('charts a mission that ended early too', async () => {
    const end = playOut(createMission(testConfig('chart-2')), pureGreed);
    expect(end.status).toBe('lost');
    const modal = await endScreen(end);
    expect(modal.querySelector('figure.mchart svg.mc-svg')).not.toBeNull();
    expect(modal.querySelector('.mchart-takeaway')!.textContent).toMatch(/sol \d+/);
  });

  it('draws at narrow phone widths without breaking', () => {
    const end = playOut(createMission(testConfig('chart-3', 'commander', 3)), builder);
    const fig = missionChart(missionSeries(end), { status: end.status, loseReason: end.loseReason });
    const svg = fig.querySelector('svg')!;
    expect(Number(svg.getAttribute('width'))).toBeGreaterThan(0);
    for (const p of fig.querySelectorAll('path')) expect(p.getAttribute('d')).not.toMatch(/NaN|Infinity/);
  });

  it('the campaign finale shows a small chart per crew, and a note for crews saved before charts existed', () => {
    const c = playCampaign('chart-camp', 'cadet', TEST_POOL, builder);
    delete c.results[0].series; // an old save
    const app = new App(new CssStage()) as unknown as Internals;
    app.mode = 'campaign';
    app.campaign = c;
    app.showFinale();
    const modal = document.querySelector('[aria-label="Campaign complete"]')!;
    const cards = modal.querySelectorAll('figure.mchart.compact');
    expect(cards.length).toBe(3);
    expect(cards[0].querySelector('svg.mc-svg')).toBeNull();
    expect(cards[0].textContent).toMatch(/No chart for this crew/);
    expect(cards[1].querySelector('svg.mc-svg')).not.toBeNull();
    expect(cards[2].querySelector('svg.mc-svg')!.getAttribute('aria-label')).toMatch(/Crew 3/);
  });
});
