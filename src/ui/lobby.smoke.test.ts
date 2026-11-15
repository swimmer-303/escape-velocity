// @vitest-environment happy-dom
// Written with AI assistance (Claude Code). See README "Use of AI tools".
// The lobby: PLAY first, the rank strip, then the mode tiles; NEW badges once the tutorial is done; PLAY takes a
// brand-new player straight to a short crew intro. The cold open never runs on the simple stage, and the real one
// (with a stand-in 3D stage) swoops, slams the logo in, and gets out of the way on any key.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { App } from './app';
import { CssStage, type Stage } from '../render/stage';
import { runColdOpen } from './coldopen';
import { GameAudio } from './audio';
import { crossings, PlaceCombo, countUp } from './juice';
import { balanced } from '../sim/strategies';
import { MODULE_LABEL } from './budget';
import { MODULE_IDS, type MissionState } from '../sim/types';
import { onGame } from '../meta/hooks';
import '../meta';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const button = (re: RegExp) => ([...document.querySelectorAll('button')] as HTMLButtonElement[]).find((b) => re.test(b.textContent ?? '') && !b.disabled) ?? null;
/** Past the landing mini-game (Flight school's interstitial): press its Skip, then wait for the briefing. */
async function toBriefing() {
  for (let i = 0; i < 300 && !button(/Plan the day/); i++) {
    const skip = button(/^Skip/);
    if (skip && !skip.closest('.coach-bubble')) skip.click();
    await sleep(10);
  }
  return button(/Plan the day/);
}
async function waitFor<T>(fn: () => T | null | undefined, ms = 3000): Promise<T> {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const v = fn();
    if (v) return v;
    await sleep(10);
  }
  throw new Error('timed out waiting');
}

beforeEach(() => {
  document.body.innerHTML = `<div id="app"><div id="stage"></div><header id="hud"></header><main id="dock"></main></div><div id="modal-root"></div>`;
  document.documentElement.className = '';
  vi.stubGlobal('fetch', () => Promise.reject(new Error('offline in tests')));
  localStorage.clear();
  history.replaceState(null, '', '/');
});

describe('the lobby', () => {
  it('puts PLAY first, then the rank strip, then a grid of mode tiles, with the logo, GitHub and the AI disclosure', () => {
    new App(new CssStage());
    const screen = document.querySelector<HTMLElement>('.title-screen.lobby')!;
    expect(screen).not.toBeNull();
    expect(document.getElementById('modal-root')!.classList.contains('lobby-root')).toBe(true);
    // The logo is the headline; screen readers still hear the name.
    const h1 = screen.querySelector('h1')!;
    expect(h1.textContent).toBe('Escape Velocity');
    expect(h1.querySelector('img')!.getAttribute('src')).toBe('/art/logo.png');
    const play = button(/^PLAY/)!;
    expect(play.textContent).toContain('One crew on Mars');
    expect(document.activeElement).toBe(play);
    const meta = screen.querySelector('.title-meta')!;
    const ids = [...meta.querySelectorAll('[data-tile]')].map((t) => t.getAttribute('data-tile'));
    for (const id of ['quick', 'campaign', 'daily', 'history', 'storm-cards', 'hangar', 'flight-school', 'class', 'radar', 'planner', 'science-log']) expect(ids).toContain(id);
    // Sorted by order: quick mission before the daily challenge before Storm Cards before the class mission.
    expect(ids.indexOf('quick')).toBeLessThan(ids.indexOf('daily'));
    expect(ids.indexOf('daily')).toBeLessThan(ids.indexOf('storm-cards'));
    expect(ids.indexOf('storm-cards')).toBeLessThan(ids.indexOf('class'));
    const rank = meta.querySelector('.rank-strip')!;
    expect(rank.compareDocumentPosition(play) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
    expect(screen.querySelector('.menu a.btn.github')).not.toBeNull();
    expect(screen.querySelector('.ai-disclosure')!.textContent).toMatch(/the logo was made with Claude/);
    expect(screen.querySelector('.sun-panel, .title-foot')).not.toBeNull();
    // A brand-new player sees no NEW badges.
    expect(screen.querySelector('.lobby-new')).toBeNull();
    expect(document.querySelector('.cold-open')).toBeNull();
  });

  it('shows NEW on modes not opened yet (after the tutorial), and drops it once opened', async () => {
    localStorage.setItem('ev-tutorial-done', '1');
    new App(new CssStage());
    const tile = () => document.querySelector<HTMLButtonElement>('[data-tile="radar"]')!;
    expect(tile().querySelector('.lobby-new')!.textContent).toBe('NEW');
    // A tile with its own badge (Storm Cards' "2 NEW", say) never gets a second one.
    for (const t of document.querySelectorAll('[data-tile]')) expect(t.querySelectorAll(':scope > .title-tile-badge').length).toBeLessThanOrEqual(1);
    tile().click();
    await waitFor(() => document.querySelector('[aria-label="Space weather radar"]'));
    expect(JSON.parse(localStorage.getItem('ev-lobby-v1')!).opened).toContain('radar');
    document.querySelector<HTMLButtonElement>('.close-x')!.click();
    await waitFor(() => document.querySelector('.title-screen'));
    expect(tile().querySelector('.lobby-new')).toBeNull();
    expect(document.querySelector('[data-tile="planner"] .lobby-new')).not.toBeNull();
  });

  it('PLAY takes a first-time player to a short crew intro, then the landing and the guided first sol', async () => {
    const app = new App(new CssStage());
    button(/^PLAY/)!.click();
    const intro = await waitFor(() => document.querySelector<HTMLElement>('#modal-root .modal'));
    expect(intro.textContent).toContain('Your first mission');
    expect(intro.querySelectorAll('.first-crew li').length).toBeGreaterThan(0);
    expect(intro.querySelectorAll('.card').length).toBe(0);
    expect((app as unknown as { mode: string }).mode).toBe('quick');
    button(/Land the crew/)!.click();
    expect(await toBriefing()).not.toBeNull();
    expect(document.querySelector('.coach-bubble')).not.toBeNull();
  });

  it('PLAY says Continue when there is a saved campaign', async () => {
    new App(new CssStage());
    button(/New campaign/)!.click();
    button(/Cadet/)!.click();
    (await waitFor(() => button(/Land the crew/))).click();
    expect(await toBriefing()).not.toBeNull();
    document.body.innerHTML = `<div id="app"><div id="stage"></div><header id="hud"></header><main id="dock"></main></div><div id="modal-root"></div>`;
    new App(new CssStage());
    expect(button(/^PLAY/)!.textContent).toMatch(/Continue: crew 1 of 3/);
  });

  it('never runs the cold open on the simple stage, even when asked', () => {
    new App(new CssStage(), { intro: true });
    expect(document.querySelector('.cold-open')).toBeNull();
    expect(document.documentElement.classList.contains('ev-cold')).toBe(false);
  });
});

describe('a whole quick mission with the game feel', () => {
  it('shows perfect sols, then a score, a grade, a personal best and modes to try next', async () => {
    localStorage.setItem('ev-tutorial-done', '1');
    const app = new App(new CssStage());
    const internals = app as unknown as { mission: MissionState };
    const xp: string[] = [];
    const stop = onGame('xp', (p) => xp.push(p.reason));
    let perfect = 0;
    button(/Quick mission/)!.click();
    (await waitFor(() => button(/Start quick mission/))).click();
    for (let guard = 0; guard < 300 && !button(/Play again/); guard++) {
      if (document.querySelector('.crates .crate') && !button(/Plan the day/)) {
        document.querySelector<HTMLButtonElement>('.crates .crate')!.click();
        continue;
      }
      const skipFlight = document.querySelector('.ev-flight-host, #modal-root .ev-flight') ? button(/^Skip/) : null;
      if (skipFlight) {
        skipFlight.click();
        await sleep(10);
        continue;
      }
      const plan = button(/Plan the day/);
      if (plan) {
        plan.click();
        const { alloc } = balanced(internals.mission);
        for (const id of MODULE_IDS) for (let k = 0; k < alloc[id]; k++) document.querySelector<HTMLButtonElement>(`button[aria-label="Add a cell to ${MODULE_LABEL[id]}"]`)?.click();
        // Every cell placed: the Run button is ready (it pulses).
        expect(document.querySelector('.dock .btn.go.ready')).not.toBeNull();
        (await waitFor(() => button(/^Run sol/))).click();
        (await waitFor(() => button(/^Skip$/))).click();
        await waitFor(() => document.querySelector('.sol-tally'));
        if (document.querySelector('.streak-banner')) perfect++;
        continue;
      }
      const next = button(/Start sol|Launch!|See what happened|Land the crew/);
      if (next) {
        next.click();
        await sleep(0);
        continue;
      }
      // The launch mini-game, if it is up.
      const skip = button(/^Skip/);
      if (skip) skip.click();
      await sleep(20);
    }
    stop();
    const panel = document.querySelector('.score-panel')!;
    expect(panel).not.toBeNull();
    expect(panel.querySelector('.grade')!.textContent).toMatch(/^[SABC]$/);
    expect(panel.querySelector('.score-pb')!.textContent).toBe('New personal best!');
    expect(JSON.parse(localStorage.getItem('ev-best-v1')!)['quick-mars']).toBeGreaterThan(0);
    expect(document.querySelectorAll('.end-next [data-tile]').length).toBe(2);
    // Play again sits right under the score, before the full story of the mission.
    const again = button(/Play again/)!;
    expect(again.compareDocumentPosition(document.querySelector('.mchart, h3')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // A balanced player has perfect sols; two in a row earn a little streak XP.
    expect(perfect).toBeGreaterThan(0);
    if (xp.some((r) => /streak/.test(r))) expect(xp.filter((r) => /streak/.test(r)).every((r) => /^Perfect sol streak x\d+$/.test(r))).toBe(true);
  }, 30000);
});

describe('the cold open', () => {
  function fakeStage() {
    const flights: number[] = [];
    const stage = { flyIn: (s: number) => void flights.push(s), canFlyIn: () => true } as unknown as Stage & { canFlyIn(): boolean };
    return { stage, flights };
  }

  it('swoops in, then any key skips straight to the lobby', async () => {
    const { stage, flights } = fakeStage();
    const reveal = vi.fn();
    runColdOpen({ stage, audio: new GameAudio(true), full: true, onTitle: () => true, reveal });
    expect(document.querySelector('.cold-open')).not.toBeNull();
    expect(document.documentElement.classList.contains('ev-cold')).toBe(true);
    expect(document.getElementById('modal-root')!.hasAttribute('inert')).toBe(true);
    await sleep(0);
    expect(flights[0]).toBeGreaterThanOrEqual(6);
    expect(document.querySelector('.cold-logo')!.getAttribute('src')).toBe('/art/logo.png');
    const key = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    window.dispatchEvent(key);
    expect(key.defaultPrevented).toBe(true);
    expect(reveal).toHaveBeenCalledTimes(1);
    expect(flights.at(-1)).toBe(0);
    expect(document.documentElement.classList.contains('ev-cold')).toBe(false);
    expect(document.getElementById('modal-root')!.hasAttribute('inert')).toBe(false);
    await sleep(400);
    expect(document.querySelector('.cold-open')).toBeNull();
  });

  it('return visits get only a short camera move, with nothing in the way', async () => {
    const { stage, flights } = fakeStage();
    runColdOpen({ stage, audio: new GameAudio(true), full: false, onTitle: () => true, reveal: () => {} });
    expect(document.querySelector('.cold-open')).toBeNull();
    await sleep(0);
    expect(flights).toEqual([1.8]);
  });
});

describe('game feel helpers', () => {
  it('flashes a meter only when a plan pushes it across a line', () => {
    expect(crossings(null, { life: 0.5, dose: 1, fuel: 0 }, 50)).toEqual([]);
    expect(crossings({ life: 2, dose: 1, fuel: 90 }, { life: 0.8, dose: 1, fuel: 100 }, 50)).toEqual([
      { meter: 'life', tone: 'bad' },
      { meter: 'fuel', tone: 'good' },
    ]);
    expect(crossings({ life: 0.8, dose: 40, fuel: 10 }, { life: 1.2, dose: 30, fuel: 12 }, 50)).toEqual([
      { meter: 'life', tone: 'good' },
      { meter: 'dose', tone: 'good' },
    ]);
  });

  it('cells placed in a row climb the scale, and a pause starts it over', () => {
    const c = new PlaceCombo();
    expect(c.next(1000)).toBe(1);
    expect(c.next(1300)).toBeCloseTo(Math.pow(2, 1 / 12));
    expect(c.next(1600)).toBeCloseTo(Math.pow(2, 2 / 12));
    expect(c.next(5000)).toBe(1);
  });

  it('count-ups show the final number at once with reduced motion', () => {
    const el = document.createElement('b');
    countUp(el, 1234, { reduced: true });
    expect(el.textContent).toBe('1,234');
  });
});
