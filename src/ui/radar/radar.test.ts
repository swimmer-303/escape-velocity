// @vitest-environment happy-dom
// Written with AI assistance (Claude Code). See README "Use of AI tools".
// Space weather radar screen: honest LIVE/ARCHIVE labels, the calm-month message and May 2024 replay,
// the timeline (keyboard and play/pause), the list, and how the game opens it.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderRadar } from './radar';
import type { SpaceWeatherFeed } from '../../data/donki';
import type { DonkiCme, DonkiSnapshot } from '../../data/donki-normalize';
import { App } from '../app';
import { CssStage } from '../../render/stage';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const text = (el: Element) => (el.textContent ?? '').replace(/\s+/g, ' ');
const NOW = Date.parse('2026-11-14T18:00:00Z');

const cme = (over: Partial<DonkiCme> = {}): DonkiCme => ({
  id: '2026-11-09T18:15:00-CME-001',
  startTime: '2026-11-09T18:15Z',
  speed: 726,
  sourceLocation: null,
  link: 'https://ccmc.gsfc.nasa.gov/DONKI/view/CME/49447/-1',
  time21_5: '2026-11-09T21:40Z',
  longitude: 65,
  latitude: -2,
  halfAngle: 10,
  enlil: { runs: 2, completedAt: '2026-11-10T05:00Z', link: 'https://ccmc.gsfc.nasa.gov/DONKI/view/WSA-ENLIL/2/-1', earth: null, mars: { time: '2026-11-13T12:00Z', glancing: true, minor: false } },
  ...over,
});
const snap = (cmes: DonkiCme[], over: Partial<DonkiSnapshot> = {}): DonkiSnapshot => ({
  fetchedAt: '2026-11-14T17:30:00.000Z',
  startDate: '2026-10-15',
  endDate: '2026-11-14',
  sourceUrl: 'https://ccmc.gsfc.nasa.gov/DONKI/WS/get',
  flares: [],
  seps: [],
  cmes,
  gsts: [],
  included: ['FLR', 'SEP', 'CME'],
  ...over,
});
const live = (s: DonkiSnapshot): SpaceWeatherFeed => ({ status: 'live', snapshot: s, fetchedAt: s.fetchedAt, via: 'proxy' });
const never = () => new Promise<DonkiSnapshot>(() => undefined);

function mount(el: HTMLElement) {
  document.body.append(el);
  return el;
}
const btn = (root: ParentNode, label: RegExp) => [...root.querySelectorAll('button')].find((b) => label.test(b.textContent ?? '')) as HTMLButtonElement;

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('Space weather radar', () => {
  it('shows live CMEs as LIVE, with the planets, the arcs, a summary and a list', () => {
    const el = mount(renderRadar({ feed: live(snap([cme()])), now: NOW, loadLive: never }));
    const source = el.querySelector('.radar-source')!;
    expect(source.querySelector('.tag')!.textContent).toBe('LIVE');
    expect(text(el.querySelector('.radar-summary')!)).toContain("NASA's DONKI database lists 1 CME");
    expect(el.querySelectorAll('.radar-svg .rd-planet')).toHaveLength(2);
    expect(text(el.querySelector('.radar-svg')!)).toMatch(/Earth.*Mars/);
    // Opens on "now": the Nov 9 CME is past Mars by Nov 14, so nothing is drawn in flight.
    expect(el.querySelector('.radar-date')!.textContent).toContain('Nov 14, 2026');
    // The list leads with CMEs headed for Mars and quotes NASA's model next to our estimate.
    const item = el.querySelector('.radar-item')!;
    expect(text(item)).toContain('CME on Nov 9, 726 km/s, headed 65° west of Earth');
    expect(text(item)).toContain('(estimate)');
    expect(text(item)).toContain("NASA's ENLIL model predicted a glancing blow at Mars on Nov 13, 12:00 UTC");
    expect(item.querySelector('a[href*="WSA-ENLIL"]')).not.toBeNull();
    expect(btn(el, /Headed for Mars \(1\)/).getAttribute('aria-pressed')).toBe('true');
    // The SVG has a text description for screen readers.
    expect(el.querySelector('.radar-svg')!.getAttribute('aria-label')).toMatch(/Mars is 1\.\d\d AU from the Sun, \d+° west of Earth/);
  });

  it('"Show" jumps to that CME and draws its arc with its speed', () => {
    const el = mount(renderRadar({ feed: live(snap([cme()])), now: NOW, loadLive: never }));
    btn(el, /^Show$/).click();
    // Just after launch: its front about 0.35 AU from the Sun.
    expect(el.querySelector('.radar-date')!.textContent).toContain('Nov 10, 2026');
    const arc = el.querySelector('.rd-cme.rd-sel')!;
    expect(arc.classList.contains('rd-medium')).toBe(true);
    expect(text(arc)).toContain('726 km/s');
    expect(btn(el, /^Showing$/).getAttribute('aria-pressed')).toBe('true');
  });

  it('timeline: arrow keys move 6 hours, Space plays and pauses, Start and End jump', async () => {
    const el = mount(renderRadar({ feed: live(snap([cme()])), now: NOW, loadLive: never, reducedMotion: true }));
    btn(el, /^Start$/).click();
    const range = el.querySelector<HTMLInputElement>('.radar-range')!;
    expect(range.value).toBe('0');
    expect(range.getAttribute('aria-valuetext')).toBe('Oct 15, 2026, 00:00 UTC');
    range.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(range.value).toBe('6');
    range.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageUp', bubbles: true }));
    expect(range.value).toBe('30');
    range.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    const play = el.querySelector<HTMLButtonElement>('.radar-play')!;
    expect(play.textContent).toBe('Pause');
    await sleep(600);
    expect(Number(range.value)).toBeGreaterThan(30);
    range.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    expect(play.textContent).toBe('Play');
    btn(el, /^Now$/).click();
    expect(range.value).toBe(range.max);
    // A screen reader hears where things are after each move.
    expect(el.querySelector('[aria-live]')!.textContent).toMatch(/^Radar for Nov 14, 2026/);
  });

  it('a calm month says so and offers the May 2024 replay (ARCHIVE), opening on the far-side CME of May 20', () => {
    const calm = snap([cme({ longitude: -60, enlil: null })]);
    const el = mount(renderRadar({ feed: live(calm), now: NOW, loadLive: never }));
    expect(text(el.querySelector('.radar-summary')!)).toContain('The Sun was calm toward Mars this month: 1 CME, none headed for Mars.');
    btn(el.querySelector('.radar-calm')!, /Replay May 2024/).click();
    expect(el.querySelector('.radar-source .tag')!.textContent).toBe('ARCHIVE');
    expect(btn(el, /^Replay: May 2024$/).getAttribute('aria-pressed')).toBe('true');
    expect(text(el.querySelector('.radar-summary')!)).toContain('Fastest: 2,678 km/s on May 20');
    expect(el.querySelector('.radar-date')!.textContent).toContain('May 20, 2024');
    expect(text(el.querySelector('.rd-cme.rd-sel')!)).toContain('2,678 km/s');
    expect(text(el.querySelector('.radar-notes')!)).toContain('Curiosity measured 8,100 micrograys');
    // Back to the live month.
    btn(el, /^Last 30 days$/).click();
    expect(el.querySelector('.radar-source .tag')!.textContent).toBe('LIVE');
  });

  it('never calls stored data live, and upgrades to LIVE only after NASA answers', async () => {
    // The game's feed has no CMEs (an older server, or the direct fetch): stored data first.
    const noCmes = snap([], { included: ['FLR', 'SEP'] });
    let answer!: (s: DonkiSnapshot) => void;
    const el = mount(renderRadar({ feed: live(noCmes), now: NOW, loadLive: () => new Promise((r) => (answer = r)) }));
    const source = () => el.querySelector('.radar-source')!;
    expect(source().querySelector('.tag')!.textContent).toBe('ARCHIVE');
    expect(text(source())).toContain('Checking NASA for live data...');
    expect(text(el)).not.toMatch(/\bLIVE\b/);
    answer(snap([cme()], { included: ['CME'] }));
    await sleep(0);
    expect(source().querySelector('.tag')!.textContent).toBe('LIVE');
    expect(text(source())).toContain('straight from NASA');
  });

  it('stays ARCHIVE when NASA cannot be reached', async () => {
    const feed: SpaceWeatherFeed = { status: 'archive', snapshot: null, fetchedAt: null, via: 'snapshot' };
    const el = mount(renderRadar({ feed, now: NOW, loadLive: () => Promise.reject(new Error('offline')) }));
    await sleep(0);
    const source = el.querySelector('.radar-source')!;
    expect(source.querySelector('.tag')!.textContent).toBe('ARCHIVE');
    expect(text(source)).not.toContain('Checking');
    expect(text(el.querySelector('.radar-summary')!)).toContain("NASA's DONKI database lists");
  });
});

describe('opening the radar from the game', () => {
  beforeEach(() => {
    document.body.innerHTML = `<div id="app"><div id="stage"></div><header id="hud"></header><main id="dock"></main></div><div id="modal-root"></div>`;
    vi.stubGlobal('fetch', () => Promise.reject(new Error('offline in tests')));
    try {
      localStorage.clear();
    } catch {
      /* ignore */
    }
  });

  async function waitFor<T>(fn: () => T | null | undefined, ms = 3000): Promise<T> {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      const v = fn();
      if (v) return v;
      await sleep(10);
    }
    throw new Error('timed out waiting');
  }

  it('from the title screen, and back', async () => {
    new App(new CssStage());
    btn(document, /^Space weather radar$/).click();
    const dialog = await waitFor(() => document.querySelector('[aria-label="Space weather radar"]'));
    expect(dialog.querySelector('.radar-svg')).not.toBeNull();
    // Offline: the stored snapshot, labeled ARCHIVE.
    expect(dialog.querySelector('.radar-source .tag')!.textContent).toBe('ARCHIVE');
    dialog.querySelector<HTMLButtonElement>('.close-x')!.click();
    await waitFor(() => document.querySelector('[aria-label="Escape Velocity title screen"]'));
  });

  it('stays open when the NASA feed arrives after it was opened', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    vi.stubGlobal('fetch', () => gate.then(() => Promise.reject(new Error('offline in tests'))));
    new App(new CssStage());
    btn(document, /^Space weather radar$/).click();
    await waitFor(() => document.querySelector('[aria-label="Space weather radar"]'));
    release();
    await sleep(50);
    expect(document.querySelector('[aria-label="Space weather radar"]')).not.toBeNull();
    expect(document.querySelector('[aria-label="Escape Velocity title screen"]')).toBeNull();
  });

  it("from the morning briefing's space-weather card", async () => {
    new App(new CssStage());
    (await waitFor(() => btn(document, /^Quick mission$/))).click();
    (await waitFor(() => btn(document, /Start quick mission/) ?? btn(document, /Land the crew/))).click();
    const land = await waitFor(() => btn(document, /Land the crew/) ?? btn(document, /Plan the day/));
    if (/Land the crew/.test(land.textContent ?? '')) land.click();
    await waitFor(() => btn(document, /Plan the day/));
    const link = await waitFor(() => [...document.querySelectorAll('button.linkish')].find((b) => /See it on the radar/.test(b.textContent ?? '')) as HTMLButtonElement | undefined);
    link.click();
    await waitFor(() => document.querySelector('[aria-label="Space weather radar"]'));
  });
});
