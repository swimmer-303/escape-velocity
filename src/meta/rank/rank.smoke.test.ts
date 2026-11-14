// @vitest-environment happy-dom
// Written with AI assistance (Claude Code). See README "Use of AI tools".
// The rank module inside the real game: the player card on the title screen, XP from a whole quick mission played
// by a scripted player, the level-up card over the end screen (never during a sol), and nothing from the demo.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { App } from '../../ui/app';
import { CssStage } from '../../render/stage';
import { balanced } from '../../sim/strategies';
import { MODULE_LABEL } from '../../ui/budget';
import { MODULE_IDS, type MissionState } from '../../sim/types';
import { onGame } from '../hooks';
import './index';
import { pendingLevels, rankState, resetRankEngine } from './engine';
import { resetRankUi } from './ui';

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
  resetRankEngine();
  resetRankUi();
});

describe('Astronaut rank in the game', () => {
  it('shows the player card, earns XP over a quick mission, and celebrates on the end screen', async () => {
    const app = new App(new CssStage());
    const internals = app as unknown as { mission: MissionState; phase: string };
    await waitFor(() => button(/Quick mission/));
    const strip = document.querySelector('#modal-root .title-meta .rank-strip');
    expect(strip).not.toBeNull();
    expect(strip!.textContent).toContain('Cadet');
    // The player card sits above the play buttons.
    expect(strip!.compareDocumentPosition(button(/Quick mission/)!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    let celebratedDuringPlay = false;
    const stop = onGame('sol', () => {
      if (document.querySelector('.ev-levelup')) celebratedDuringPlay = true;
    });
    button(/Quick mission/)!.click();
    (await waitFor(() => button(/Start quick mission/))).click();
    for (let guard = 0; guard < 300 && !button(/Play again/); guard++) {
      if (document.querySelector('.ev-levelup') && internals.phase !== 'end') celebratedDuringPlay = true;
      if (document.querySelector('.crates .crate') && !button(/Plan the day/)) {
        document.querySelector<HTMLButtonElement>('.crates .crate')!.click();
        continue;
      }
      const plan = button(/Plan the day/);
      if (plan) {
        plan.click();
        const { alloc } = balanced(internals.mission);
        for (const id of MODULE_IDS) for (let k = 0; k < alloc[id]; k++) document.querySelector<HTMLButtonElement>(`button[aria-label="Add a cell to ${MODULE_LABEL[id]}"]`)?.click();
        (await waitFor(() => button(/^Run sol/))).click();
        expect(document.querySelector('.rank-chip') || rankState().stats.sols === 0).toBeTruthy();
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
    stop();
    expect(internals.mission.status).not.toBe('playing');
    expect(celebratedDuringPlay).toBe(false);
    const s = rankState();
    expect(s.stats.sols).toBe(internals.mission.log.length);
    expect(s.stats.missions).toBe(1);
    expect(s.xp).toBeGreaterThanOrEqual(10 * internals.mission.log.length + 30);
    // A whole mission is enough for level 2: the card shows over the end screen, then hands focus back.
    const card = await waitFor(() => document.querySelector<HTMLElement>('.ev-levelup'), 4000);
    expect(card.textContent).toMatch(/Level \d+/);
    expect(pendingLevels()).toEqual([]);
    expect(document.querySelector('.rank-chip')).not.toBeNull();
    card.querySelector<HTMLButtonElement>('button')!.click();
    expect(document.querySelector('.ev-levelup')).toBeNull();
    expect(button(/Play again/)).not.toBeNull();
  }, 60000);

  it('gives nothing for the self-playing demo', async () => {
    const app = new App(new CssStage());
    const internals = app as unknown as { demoSpeed: number; phase: string };
    internals.demoSpeed = 0.01;
    (await waitFor(() => button(/Watch a demo/))).click();
    for (let i = 0; i < 1500 && internals.phase !== 'end'; i++) await sleep(10);
    expect(internals.phase).toBe('end');
    expect(rankState().xp).toBe(0);
    expect(rankState().stats.sols).toBe(0);
    expect(document.querySelector('.rank-chip')).toBeNull();
    await sleep(1500);
    expect(document.querySelector('.ev-levelup')).toBeNull();
  }, 60000);
});
