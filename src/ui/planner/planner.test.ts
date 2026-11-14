// @vitest-environment happy-dom
// Written with AI assistance (Claude Code). See README "Use of AI tools".
// The Trip planner screen: it works out the chart, picks the next launch window, answers the keyboard and buttons,
// has a text summary and a table, and opens from the title screen and the "26 months later" interlude.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderPlanner, plannerSpec, bandOf, BANDS } from './planner';
import { contourSegments } from './contours';
import { tripHomeLine } from './tiein';
import { App } from '../app';
import { CssStage } from '../../render/stage';
import { newCampaign, type Campaign } from '../../sim/campaign';
import { daysSinceJ2000 } from '../../orbits/ephemeris';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const NOW = new Date('2026-11-14T12:00:00Z');
// A coarser grid than the real one (10-day steps), so the test runs fast.
const SPEC = { ...plannerSpec(NOW), departStep: 10, departCount: 274, tofStep: 10, tofCount: 35 };

beforeEach(() => {
  document.body.innerHTML = `<div id="app"><div id="stage"></div><header id="hud"></header><main id="dock"></main></div><div id="modal-root"></div>`;
  vi.stubGlobal('fetch', () => Promise.reject(new Error('offline in tests')));
  try {
    localStorage.clear();
  } catch {
    /* ignore */
  }
});

async function openPlanner() {
  let backs = 0;
  const p = renderPlanner({ reducedMotion: true, back: () => backs++, now: NOW, spec: SPEC });
  document.body.append(p.el);
  await p.ready;
  return { el: p.el, backs: () => backs };
}

const key = (el: Element, k: string, shiftKey = false) => el.dispatchEvent(new KeyboardEvent('keydown', { key: k, shiftKey, bubbles: true }));

describe('Trip planner screen', () => {
  it('works out the chart, then selects the next launch window home (Aug 2028)', async () => {
    const { el } = await openPlanner();
    expect(el.querySelector('h2')!.textContent).toBe('Plan the trip home');
    expect(el.textContent).toMatch(/Mars is ahead of Earth just right; that lines up about every 26 months/);
    const takeaway = el.querySelector('.tp-takeaway')!.textContent!;
    expect(takeaway).toMatch(/Jul 2026, Aug 2028, Aug 2030 and Feb 2033/);
    expect(takeaway).toMatch(/average about 26 months/);
    const trip = el.querySelector('.tp-trip')!.textContent!;
    expect(trip).toMatch(/Leave Mars\s*Aug \d+, 2028/);
    expect(trip).toMatch(/Reach Earth\s*Jul \d+, 2029/);
    expect(trip).toMatch(/5\.8 km\/s/);
    expect(trip).toMatch(/Cheapest/);
    expect(trip).toMatch(/escape speed \(5\.0\)/);
    expect(trip).toMatch(/hits Earth's air at 11\.\d km\/s/);
    expect(trip).toMatch(/Mars is \d+ degrees ahead of Earth/);
    // The screen-reader summary and the live line say the same in words.
    expect(el.querySelector('#tp-summary')!.textContent).toMatch(/launch windows: Jul 2026 .*Aug 2028/);
    expect(el.querySelector('[aria-live]')!.textContent).toMatch(/Leave Mars Aug \d+, 2028, reach Earth Jul \d+, 2029/);
    // Window markers and month gaps are drawn on the chart.
    expect(el.querySelectorAll('.tp-overlay .tp-win').length).toBe(4);
    expect([...el.querySelectorAll('.tp-overlay .tp-gaplabel')].map((t) => t.textContent)).toEqual(['24 months', '25 months', '30 months']);
    expect(el.querySelector('.tp-overlay')!.textContent).toMatch(/TODAY/);
  });

  it('keyboard: arrows move the trip, B jumps to the best trip, N and P hop between windows', async () => {
    const { el } = await openPlanner();
    const plot = el.querySelector<HTMLElement>('.tp-plot')!;
    const live = () => el.querySelector('[aria-live]')!.textContent!;
    const start = live();
    key(plot, 'ArrowUp');
    expect(live()).not.toBe(start);
    expect(live()).toMatch(/Aug \d+, 2028/);
    key(plot, 'ArrowRight', true);
    expect(live()).toMatch(/Leave Mars (Sep|Oct) \d+, 2028/); // Shift: 6 steps of 10 days on the test grid
    key(plot, 'N');
    expect(live()).toMatch(/Leave Mars Aug \d+, 2030/);
    key(plot, 'P');
    key(plot, 'P');
    expect(live()).toMatch(/Leave Mars Jul \d+, 2026/);
    // "Best trip" is the cheapest trip that leaves after today: Feb 2033 (5.75 km/s) edges out Aug 2028 (5.80).
    key(plot, 'B');
    expect(live()).toMatch(/Leave Mars Feb \d+, 2033/);
    key(plot, 'Home');
    expect(live()).toMatch(/Leave Mars Jan 1, 2026/);
    expect(live()).toMatch(/way too costly/);
  });

  it('buttons, the table view and Back', async () => {
    const { el, backs } = await openPlanner();
    const btn = (re: RegExp) => [...el.querySelectorAll('button')].find((b) => re.test(b.textContent ?? ''))!;
    btn(/Later window/).click();
    expect(el.querySelector('.tp-trip')!.textContent).toMatch(/Leave Mars\s*Aug \d+, 2030/);
    btn(/Best trip/).click();
    expect(el.querySelector('.tp-trip')!.textContent).toMatch(/Leave Mars\s*Feb \d+, 2033/);
    const tables = el.querySelectorAll('.tp-numbers table');
    expect(tables.length).toBe(2);
    expect(tables[0].querySelectorAll('tbody tr').length).toBe(4);
    expect(tables[1].querySelectorAll('tbody tr').length).toBe(90); // every month from Jan 2026 to Jun 2033
    expect(tables[0].textContent).toMatch(/Jul \d+, 2026/);
    btn(/^Back$/).click();
    expect(backs()).toBe(1);
  });

  it('color bands follow the legend', () => {
    expect(BANDS.map((b) => b.label)).toEqual(['under 6', '6 to 7', '7 to 8', '8 to 10', '10 to 12', 'over 12']);
    expect(bandOf(5.7)).toBe(0);
    expect(bandOf(6)).toBe(1);
    expect(bandOf(11.9)).toBe(4);
    expect(bandOf(40)).toBe(5);
    expect(bandOf(NaN)).toBe(5);
  });
});

describe('contour lines', () => {
  it('draw a closed ring around a single low point', () => {
    // A 5x5 bowl: 1 in the middle, 9 at the edges; the level-5 line rings the center.
    const nx = 5;
    const vals = Array.from({ length: 25 }, (_, k) => {
      const i = k % nx;
      const j = Math.floor(k / nx);
      return 1 + 2 * Math.max(Math.abs(i - 2), Math.abs(j - 2)) ** 2;
    });
    const segs = contourSegments(vals, nx, 5, 5);
    expect(segs.length).toBeGreaterThan(3);
    // Every endpoint is shared by exactly two segments: the ring is closed.
    const ends = new Map<string, number>();
    for (const [x1, y1, x2, y2] of segs) for (const p of [`${x1.toFixed(6)},${y1.toFixed(6)}`, `${x2.toFixed(6)},${y2.toFixed(6)}`]) ends.set(p, (ends.get(p) ?? 0) + 1);
    for (const n of ends.values()) expect(n).toBe(2);
    // NaN (no path) counts as very high: no line through a fully NaN area.
    expect(contourSegments([NaN, NaN, NaN, NaN], 2, 2, 5)).toEqual([]);
  });
});

describe('Trip planner in the game', () => {
  it('opens from the title screen and goes back', async () => {
    new App(new CssStage());
    const open = [...document.querySelectorAll('button')].find((b) => /Trip planner/.test(b.textContent ?? ''))!;
    expect(open).toBeTruthy();
    open.click();
    for (let i = 0; i < 200 && !document.querySelector('.planner'); i++) await sleep(10);
    expect(document.querySelector('#modal-root .modal[aria-label="Trip planner"] .planner')).not.toBeNull();
    [...document.querySelectorAll('#modal-root button')].find((b) => b.textContent === 'Back')!.dispatchEvent(new MouseEvent('click'));
    expect(document.querySelector('.planner')).toBeNull();
    expect(document.querySelector('#modal-root')!.textContent).toMatch(/Escape Velocity/);
  });

  it('the "26 months later" interlude links to it, and Back returns to the interlude', async () => {
    const app = new App(new CssStage()) as unknown as { campaign: Campaign; mode: string; showInterlude(): void };
    const c = newCampaign('planner-test', 'cadet');
    app.campaign = { ...c, expedition: 2 };
    app.mode = 'campaign';
    app.showInterlude();
    const link = [...document.querySelectorAll('#modal-root button')].find((b) => /Why 26 months/.test(b.textContent ?? '')) as HTMLButtonElement;
    expect(link).toBeTruthy();
    link.click();
    for (let i = 0; i < 200 && !document.querySelector('.planner'); i++) await sleep(10);
    expect(document.querySelector('.planner')).not.toBeNull();
    (document.querySelector('#modal-root .close-x') as HTMLButtonElement).click();
    expect(document.querySelector('#modal-root')!.textContent).toMatch(/The base waits for its next crew/);
  });

  it('the launch end-screen line names the real speed for each crew window', async () => {
    const line = tripHomeLine(1, NOW);
    document.body.append(line);
    for (let i = 0; i < 300 && line.hidden; i++) await sleep(10);
    expect(line.hidden).toBe(false);
    expect(line.textContent).toMatch(/leaving Mars in August 2028/);
    expect(line.textContent).toMatch(/about 5\.\d km\/s: escape speed plus 0\.\d km\/s more/);
    const third = tripHomeLine(3, NOW);
    for (let i = 0; i < 300 && third.hidden; i++) await sleep(10);
    expect(third.textContent).toMatch(/February 2033/);
    expect(daysSinceJ2000(NOW.getTime())).toBeGreaterThan(9000);
  }, 30_000);
});
