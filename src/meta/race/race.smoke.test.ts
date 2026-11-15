// @vitest-environment happy-dom
// Written with AI assistance (Claude Code). See README "Use of AI tools".
// Rival Race inside the real game: the lobby tile, a whole race played by a scripted player through the real UI
// (standings in the HUD every sol, the podium at the end, XP and league progress), the challenge link it makes,
// opening a friend's link, and nothing at all from the self-playing demo.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { App } from '../../ui/app';
import { CssStage } from '../../render/stage';
import { balanced } from '../../sim/strategies';
import { MODULE_LABEL } from '../../ui/budget';
import { MODULE_IDS, type MissionState } from '../../sim/types';
import { onGame } from '../hooks';
import './index';
import { activeRace, handleLink, resetRace } from './index';
import { decodeRun, encodeRun, type GhostRun } from './code';
import { STORAGE_KEY, loadSave } from './store';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const button = (re: RegExp) => ([...document.querySelectorAll('button')] as HTMLButtonElement[]).find((b) => re.test(b.textContent ?? '') && !b.disabled) ?? null;
async function waitFor<T>(fn: () => T | null | undefined, ms = 5000): Promise<T> {
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
  vi.stubGlobal('fetch', () => Promise.reject(new Error('offline in tests')));
  try {
    localStorage.clear();
    localStorage.setItem('ev-tutorial-done', '1');
  } catch {
    /* ignore */
  }
  history.replaceState(null, '', '/');
  resetRace();
});

/** Play the mission on screen to the end with the balanced player, checking the standings after every sol. */
async function playToEnd(internals: { mission: MissionState; phase: string }, onPlan?: () => void) {
  for (let guard = 0; guard < 300 && !button(/Play again/); guard++) {
    if (document.querySelector('.crates .crate') && !button(/Plan the day/)) {
      document.querySelector<HTMLButtonElement>('.crates .crate')!.click();
      continue;
    }
    const plan = button(/Plan the day/);
    if (plan) {
      plan.click();
      onPlan?.();
      const { alloc } = balanced(internals.mission);
      for (const id of MODULE_IDS) for (let k = 0; k < alloc[id]; k++) document.querySelector<HTMLButtonElement>(`button[aria-label="Add a cell to ${MODULE_LABEL[id]}"]`)?.click();
      (await waitFor(() => button(/^Run sol/))).click();
      (await waitFor(() => button(/^Skip$/))).click();
      continue;
    }
    const next = button(/Start sol|Launch!|See what happened|Land the crew/);
    if (next) {
      next.click();
      await sleep(0);
      continue;
    }
    await sleep(20);
  }
}

describe('Rival Race in the game', () => {
  it('plays a whole race: lobby, live standings, podium, XP, league progress and a challenge link', async () => {
    const xp: Array<{ amount: number; reason: string }> = [];
    const stop = onGame('xp', (p) => xp.push(p));
    // A feature that throws is caught (and logged) by the hooks: make sure ours never does.
    const errors = vi.spyOn(console, 'error');
    const app = new App(new CssStage());
    const internals = app as unknown as { mission: MissionState; phase: string };

    const tile = await waitFor(() => document.querySelector<HTMLButtonElement>('#modal-root [data-tile="race"]'));
    expect(tile.textContent).toContain('Rival Race');
    expect(tile.textContent).toContain('Bronze League');
    tile.click();
    const lobby = await waitFor(() => document.querySelector('#modal-root [aria-label="Rival Race"]'));
    expect(lobby.querySelectorAll('.race-rival').length).toBe(3);
    expect(lobby.textContent).toMatch(/same base with the same real storms/);
    (await waitFor(() => button(/Start race/))).click();
    const race = activeRace()!;
    expect(race).not.toBeNull();

    let checks = 0;
    let lastSols = -1;
    await playToEnd(internals, () => {
      // Every planning screen shows the standings, in step with the player.
      const hud = document.querySelector('#hud .race-hud');
      expect(hud).not.toBeNull();
      const rows = hud!.querySelectorAll('.rh-row');
      expect(rows.length).toBe(4);
      expect(hud!.querySelector('.rh-row.k-you')).not.toBeNull();
      // Rivals still racing have played exactly as many sols as you (a rival who launched or went home stops).
      for (const r of race.racers) if (r.kind === 'ai' && (!r.state || r.state.status === 'playing')) expect(r.state?.log.length ?? 0).toBe(internals.mission.log.length);
      expect(internals.mission.log.length).toBeGreaterThan(lastSols);
      lastSols = internals.mission.log.length;
      checks++;
    });
    stop();
    expect(errors.mock.calls.filter((c) => String(c[0]).startsWith('[meta]'))).toEqual([]);
    expect(internals.mission.status).not.toBe('playing');
    expect(internals.mission.config.seed).toBe(race.seed);
    expect(checks).toBeGreaterThan(3);
    // Rivals faced the very same mission config (the same storms).
    for (const r of race.racers) if (r.kind === 'ai') expect(r.state!.config.seed).toBe(race.seed);

    const podium = await waitFor(() => document.querySelector<HTMLElement>('.race-overlay.race-podium'), 4000);
    expect(podium.getAttribute('role')).toBe('dialog');
    expect(podium.textContent).toMatch(/You (won the race|finished \d(st|nd|rd|th))!/);
    expect(podium.querySelectorAll('.rp-step').length).toBe(3);
    expect(podium.textContent).toMatch(/\+\d+ XP/);
    expect(document.activeElement && podium.contains(document.activeElement)).toBe(true);
    expect(xp.some((x) => /Rival Race: \d(st|nd|rd|th) place/.test(x.reason) && x.amount > 0)).toBe(true);
    const s = loadSave();
    expect(s.races).toBe(1);
    expect(s.points).toBeGreaterThanOrEqual(0);
    expect(s.lastCode).not.toBeNull();
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).races).toBe(1);

    // Challenge a friend from the podium: a link with a valid code for this very run.
    const inPodium = (re: RegExp) => [...podium.querySelectorAll('button')].find((b) => re.test(b.textContent ?? '')) ?? null;
    inPodium(/Challenge a friend/)!.click();
    const input = await waitFor(() => podium.querySelector<HTMLInputElement>('.race-link'));
    expect(input.value.startsWith('https://playescapevelocity.com/?race=')).toBe(true);
    const g = decodeRun(new URL(input.value).searchParams.get('race'))!;
    expect(g).not.toBeNull();
    expect(g.seed).toBe(race.seed);
    expect(g.fuel.length).toBe(internals.mission.log.length);
    inPodium(/Copy link/)!.click();
    await waitFor(() => podium.querySelector('.race-copy-msg')?.textContent);
    inPodium(/^Done$/)!.click();
    expect(document.querySelector('.race-overlay')).toBeNull();
    // The end screen is still there, with its own "Challenge a friend" button.
    expect(button(/Play again/)).not.toBeNull();
    expect(document.querySelector('#modal-root .race-end-share')).not.toBeNull();
  }, 90000);

  it('opens a friend link: cleans the address, shows who to beat, and races their ghost', async () => {
    const ghost: GhostRun = {
      seed: 'rfriend',
      site: 'mars',
      difficulty: 'cadet',
      callsign: { adj: 'Brave', noun: 'Comet', num: 42 },
      fuel: [12, 25, 38, 50, 62, 75, 88, 100],
      status: 'won',
      dose: 9.4,
      life: 6.1,
      pool: '',
      lightTimeMin: 12.5,
    };
    new App(new CssStage());
    await waitFor(() => document.querySelector('#modal-root [data-tile="race"]'));
    history.replaceState(null, '', `/?race=${encodeRun(ghost)}&code=ABC`);
    handleLink();
    expect(location.search).toBe('?code=ABC');
    const intro = await waitFor(() => document.querySelector<HTMLElement>('#modal-root [aria-label="Friend challenge"]'));
    expect(intro.textContent).toContain("Beat Brave Comet 42's time!");
    expect(intro.textContent).toContain('seed rfriend');
    (await waitFor(() => button(/Start the challenge/))).click();
    const race = activeRace()!;
    expect(race.seed).toBe('rfriend');
    expect(race.racers.map((r) => r.kind)).toEqual(['you', 'ghost', 'ai', 'ai']);
    (await waitFor(() => button(/Land the crew/))).click();
    await waitFor(() => button(/Plan the day/), 8000);
    expect(document.querySelector('#hud .race-hud .rh-row.k-ghost')?.textContent).toContain('Brave Comet 42');
  }, 30000);

  it('rejects a broken link without starting anything', async () => {
    new App(new CssStage());
    await waitFor(() => document.querySelector('#modal-root [data-tile="race"]'));
    history.replaceState(null, '', '/?race=1.nope.<script>');
    handleLink();
    expect(location.search).toBe('');
    expect(document.querySelector('#modal-root [aria-label="Friend challenge"]')).toBeNull();
    expect(document.querySelector('.ev-toast')?.textContent).toMatch(/did not work/);
    expect(activeRace()).toBeNull();
  });

  it('gives nothing for the self-playing demo', async () => {
    const xp: string[] = [];
    const stop = onGame('xp', (p) => xp.push(p.reason));
    const app = new App(new CssStage());
    const internals = app as unknown as { demoSpeed: number; phase: string };
    internals.demoSpeed = 0.01;
    (await waitFor(() => button(/Watch a demo/))).click();
    for (let i = 0; i < 1500 && internals.phase !== 'end'; i++) await sleep(10);
    stop();
    expect(internals.phase).toBe('end');
    await sleep(900);
    expect(document.querySelector('.race-hud')).toBeNull();
    expect(document.querySelector('.race-overlay')).toBeNull();
    expect(document.querySelector('.race-end-share')).toBeNull();
    expect(xp.filter((r) => /Rival Race/.test(r))).toEqual([]);
    const s = loadSave();
    expect(s.races).toBe(0);
    expect(s.lastCode).toBeNull();
  }, 60000);
});
