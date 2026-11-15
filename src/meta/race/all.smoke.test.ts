// @vitest-environment happy-dom
// Written with AI assistance (Claude Code). See README "Use of AI tools".
// Rival Race with every other meta feature switched on (rank, Storm Cards, flight mini-games, Hangar, Season):
// a whole race through the real UI, skipping the landing and launch mini-games, ends on the podium, and no feature
// ever throws.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { App } from '../../ui/app';
import { CssStage } from '../../render/stage';
import { balanced } from '../../sim/strategies';
import { MODULE_LABEL } from '../../ui/budget';
import { MODULE_IDS, type MissionState } from '../../sim/types';
import '../index';
import { activeRace, resetRace } from './index';
import { loadSave } from './store';

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
  resetRace();
});

describe('Rival Race with every feature on', () => {
  it('plays a whole race to the podium, mini-games skipped, with no feature errors', async () => {
    const errors = vi.spyOn(console, 'error');
    const app = new App(new CssStage());
    const internals = app as unknown as { mission: MissionState; phase: string };
    (await waitFor(() => document.querySelector<HTMLButtonElement>('#modal-root [data-tile="race"]'))).click();
    (await waitFor(() => button(/Start race/))).click();
    let sawStandings = false;
    for (let guard = 0; guard < 400 && !button(/Play again/); guard++) {
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
        if (document.querySelector('#hud .race-hud .rh-row')) sawStandings = true;
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
    expect(internals.mission.status).not.toBe('playing');
    expect(internals.mission.config.seed).toBe(activeRace()!.seed);
    expect(sawStandings).toBe(true);
    const podium = await waitFor(() => document.querySelector<HTMLElement>('.race-overlay.race-podium'), 4000);
    expect(podium.textContent).toMatch(/You (won the race|finished)|It's a tie for/);
    expect(loadSave().races).toBe(1);
    expect(errors.mock.calls.filter((c) => String(c[0]).startsWith('[meta]'))).toEqual([]);
  }, 120000);
});
