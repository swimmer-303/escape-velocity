// @vitest-environment happy-dom
// Written with AI assistance (Claude Code). See README "Use of AI tools".
// The Space Lab inside the real game: open it from the lobby, turn a dial (the readout and the save follow), start a
// lab mission and see the SPACE LAB badge, play it to the end through the real UI, and check the result card, the
// notebook, the capped XP, and that NOTHING counted for Rival Race, the season, Storm Cards, rank rewards, stars or
// the class board. Also the Settings dialog section.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { App } from '../../ui/app';
import { CssStage } from '../../render/stage';
import { balanced } from '../../sim/strategies';
import { MODULE_LABEL } from '../../ui/budget';
import { MODULE_IDS, type MissionState } from '../../sim/types';
import { getBriefing } from '../../sim/sim';
import { onGame, renderSettingsSections, type GameEventMap } from '../hooks';
import '../index';
import { resetRace } from '../race';
import { LAB_XP, STORAGE_KEY, loadSave } from './store';

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

const fetched: string[] = [];
beforeEach(() => {
  document.body.innerHTML = `<div id="app"><div id="stage"></div><header id="hud"></header><main id="dock"></main></div><div id="modal-root"></div>`;
  fetched.length = 0;
  vi.stubGlobal('fetch', (url: unknown) => {
    fetched.push(String(url));
    return Promise.reject(new Error('offline in tests'));
  });
  try {
    localStorage.clear();
    localStorage.setItem('ev-tutorial-done', '1');
  } catch {
    /* ignore */
  }
  history.replaceState(null, '', '/');
  resetRace();
});

/** Play the mission on screen to the end with the balanced player. */
async function playToEnd(internals: { mission: MissionState }, onPlan?: () => void) {
  for (let guard = 0; guard < 400 && !button(/Play again/); guard++) {
    // The landing and launch mini-games (every meta feature is on here): skip them.
    const skipGame = document.querySelector<HTMLButtonElement>('.ev-flight-skip');
    if (skipGame) {
      skipGame.click();
      await sleep(0);
      continue;
    }
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

const SAVES = ['ev-season-v1', 'ev-race-v1', 'ev-cards-v1'];
const snapshotSaves = () => Object.fromEntries(SAVES.map((k) => [k, localStorage.getItem(k)]));
const rankXp = () => (JSON.parse(localStorage.getItem('ev-rank-v1') ?? '{"xp":0}') as { xp: number }).xp ?? 0;

describe('Space Lab in the game', () => {
  it('opens from the lobby, a dial changes the readout, a lab mission shows the badge, and nothing counts for races, the season, cards or stars', async () => {
    const errors = vi.spyOn(console, 'error');
    const events: Array<{ kind: string; mode?: string; stars?: number }> = [];
    const xp: Array<GameEventMap['xp']> = [];
    const stops = [
      onGame('sol', (p) => events.push({ kind: 'sol', mode: p.mode })),
      onGame('mission-end', (p) => events.push({ kind: 'end', mode: p.mode, stars: p.stars.length })),
      onGame('xp', (p) => xp.push(p)),
    ];
    const app = new App(new CssStage());
    const internals = app as unknown as { mission: MissionState };

    const tile = await waitFor(() => document.querySelector<HTMLButtonElement>('#modal-root [data-tile="space-lab"]'));
    expect(tile.textContent).toContain('Space Lab');
    tile.click();
    const lab = await waitFor(() => document.querySelector<HTMLElement>('#modal-root [aria-label="Space Lab"]'));
    expect(lab.textContent).toMatch(/not a real NASA simulation/);
    expect(lab.textContent).toMatch(/no stars, races, daily board or season/);
    expect(lab.textContent).toMatch(/change one thing at a time/);
    expect(lab.querySelectorAll('.lab-dial').length).toBe(6);
    // Every slider tells a screen reader its value in words.
    for (const input of lab.querySelectorAll<HTMLInputElement>('input[type="range"]')) expect(input.getAttribute('aria-valuetext')).toBeTruthy();

    // Turn the dust dial to "Dust storm": the live readout and the save follow.
    const dust = lab.querySelector<HTMLInputElement>('[data-dial="dust"] input[type="range"]')!;
    expect(lab.querySelector('#lab-ro-dust')!.textContent).toMatch(/Solar power: 7 cells a sol \(normal\)/);
    dust.value = '3';
    dust.dispatchEvent(new Event('input'));
    expect(dust.getAttribute('aria-valuetext')).toBe('Dust storm');
    expect(lab.querySelector('#lab-ro-dust')!.textContent).toMatch(/Tau 3: 60% .* Solar power: 4 cells a sol \(normal 7\)/);
    expect(lab.querySelector('.lab-summary')!.textContent).toMatch(/You changed 1 thing: a fair test/);
    expect(loadSave().settings.dust).toBe('storm');
    // A hypothesis before the run.
    lab.querySelector<HTMLInputElement>('input[name="lab-hyp"][value="later"]')!.click();
    expect(loadSave().hypothesis).toBe('later');

    const before = snapshotSaves();
    const xpBefore = rankXp();
    button(/Run the experiment/)!.click();
    await waitFor(() => document.querySelector('#modal-root')?.textContent?.includes('Space Lab experiment'));
    (await waitFor(() => button(/Land the crew/))).click();
    await waitFor(() => internals.mission?.config.lab);
    expect(internals.mission.config.lab!.dust).toBe('storm');
    // The lab's sunlight in the briefing's power notes.
    expect(getBriefing(internals.mission).powerNotes).toContain('Space Lab sunlight: -3');

    // On every planning screen: the SPACE LAB badge and label in the HUD, and the stored (ARCHIVE) storm data.
    let checks = 0;
    await playToEnd(internals, () => {
      const hud = document.querySelector('#hud')!;
      expect(hud.querySelector('.lab-hud-badge')?.textContent).toContain('SPACE LAB');
      expect(hud.textContent).toMatch(/ARCHIVE · real DONKI data \(Space Lab\)/);
      checks++;
    });
    expect(checks).toBeGreaterThan(2);
    for (const s of stops) s();
    expect(internals.mission.status).not.toBe('playing');
    // Every event says 'lab', and the end gives no stars.
    expect(events.length).toBeGreaterThan(3);
    expect(events.every((e) => e.mode === 'lab')).toBe(true);
    expect(events.filter((e) => e.kind === 'end')).toEqual([{ kind: 'end', mode: 'lab', stars: 0 }]);
    // Only the lab's own capped XP, for rank only.
    expect(xp).toEqual([{ amount: LAB_XP, reason: 'Space Lab experiment finished', source: 'lab' }]);
    expect(rankXp()).toBe(xpBefore + LAB_XP);
    // Nothing counted for the season (pass or weekly challenges), Rival Race or Storm Cards.
    expect(snapshotSaves()).toEqual(before);
    // No class board or daily board report went out.
    expect(fetched.filter((u) => /class|daily|board|race/i.test(u))).toEqual([]);

    // The end screen: labeled, a Lab result card, no star row, no certificate.
    const end = document.querySelector<HTMLElement>('#modal-root .modal')!;
    expect(end.querySelector('.kicker')!.textContent).toMatch(/SPACE LAB/);
    const card = end.querySelector<HTMLElement>('.lab-result')!;
    expect(card).not.toBeNull();
    expect(card.textContent).toMatch(/What you changed/);
    expect(card.textContent).toMatch(/Dust in the air: Dust storm \(tau 3\)/);
    expect(card.textContent).toMatch(/Fair test/);
    expect(card.textContent).toMatch(/Your hypothesis: launch later/);
    expect(card.textContent).toMatch(/The science:/);
    expect(end.querySelector('.stars')).toBeNull();
    expect(button(/Get my certificate/)).toBeNull();
    // The notebook remembers it.
    const save = loadSave();
    expect(save.notebook.length).toBe(1);
    expect(save.notebook[0]).toMatchObject({ hypothesis: 'later', xp: LAB_XP, settings: { dust: 'storm' } });
    expect(save.notebook[0].autoReal && save.notebook[0].autoLab).toBeTruthy();
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).notebook.length).toBe(1);
    button(/^Lab Notebook$/)!.click();
    const nb = await waitFor(() => document.querySelector<HTMLElement>('#modal-root [aria-label="Lab Notebook"]'));
    expect(nb.querySelectorAll('.lab-entry').length).toBe(1);
    expect(errors.mock.calls.filter((c) => String(c[0]).startsWith('[meta]'))).toEqual([]);
  }, 30000);

  it('caps experiment XP at 3 a day', async () => {
    const { recordExperiment } = await import('./index');
    const { createMission } = await import('../../sim/sim');
    const { labMissionConfig } = await import('./experiment');
    const { defaultLab } = await import('../../sim/lab');
    const xp: number[] = [];
    const stop = onGame('xp', (p) => xp.push(p.amount));
    const m = { ...createMission(labMissionConfig({ ...defaultLab(), crew: 2 }, 12)), status: 'won' as const };
    for (let i = 0; i < 5; i++) recordExperiment(m, true);
    stop();
    expect(xp).toEqual([LAB_XP, LAB_XP, LAB_XP]);
    expect(loadSave().notebook.length).toBe(5);
  });

  it('adds a Space Lab section to the Settings dialog that opens the lab', async () => {
    new App(new CssStage());
    await waitFor(() => document.querySelector('#modal-root [data-tile="space-lab"]'));
    const sections = renderSettingsSections(() => {});
    const lab = sections.find((s) => s.querySelector('#lab-settings-h'))!;
    expect(lab).toBeTruthy();
    expect(lab.textContent).toMatch(/Real conditions at Gale Crater/);
    document.body.append(lab);
    [...lab.querySelectorAll('button')].find((b) => /Open the Space Lab/.test(b.textContent ?? ''))!.click();
    await waitFor(() => document.querySelector('#modal-root [aria-label="Space Lab"]'));
  });
});
