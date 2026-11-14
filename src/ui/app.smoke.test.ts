// @vitest-environment happy-dom
// Written with AI assistance (Claude Code). See README "Use of AI tools".
// Headless smoke test: boots the real UI and clicks through whole games like a player would.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { App } from './app';
import { CssStage } from '../render/stage';
import { builder } from '../sim/strategies';
import { MODULE_LABEL } from './budget';
import { MODULE_IDS, type MissionState } from '../sim/types';
import { UPGRADES } from '../sim/upgrades';
import type { Campaign } from '../sim/campaign';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function button(text: RegExp): HTMLButtonElement | null {
  return ([...document.querySelectorAll('button')] as HTMLButtonElement[]).find((b) => text.test(b.textContent ?? '') && !b.disabled) ?? null;
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
  vi.stubGlobal('fetch', () => Promise.reject(new Error('offline in tests')));
  try {
    localStorage.clear();
  } catch {
    /* ignore */
  }
});

type AppInternals = { mission: MissionState; campaign: Campaign };

/** Plays until `done()` says stop. Uses the builder strategy, picking Workshop projects through the UI. */
async function play(app: App, done: () => boolean) {
  const internals = app as unknown as AppInternals;
  let sols = 0;
  for (let guard = 0; guard < 400 && !done(); guard++) {
    if (document.querySelector('.crates .crate') && !button(/Plan the day/)) {
      document.querySelector<HTMLButtonElement>('.crates .crate')!.click();
      continue;
    }
    const planBtn = button(/Plan the day/);
    if (planBtn) {
      planBtn.click();
      const want = builder(internals.mission).project;
      if (want && want !== internals.mission.base.project) {
        button(/Choose project/)!.click();
        const card = [...document.querySelectorAll('.upgrade')].find((c) => c.textContent?.includes(UPGRADES[want].name.toUpperCase()));
        card!.querySelector<HTMLButtonElement>('button')!.click();
        button(/^Done$/)!.click();
      }
      const { alloc } = builder(internals.mission);
      for (const id of MODULE_IDS) {
        for (let k = 0; k < alloc[id]; k++) {
          const box = document.querySelector<HTMLButtonElement>(`button[aria-label="Add a cell to ${MODULE_LABEL[id]}"]`);
          expect(box, `slot for ${id}`).not.toBeNull();
          box!.click();
        }
      }
      (await waitFor(() => button(/^Run sol/))).click();
      (await waitFor(() => button(/^Skip$/))).click();
      sols++;
      continue;
    }
    const next = button(/Start sol|Launch!|See what happened|Land the crew|Send the next crew|Meet the next crew|See your base/);
    if (next) {
      next.click();
      await sleep(0);
      continue;
    }
    await sleep(20);
  }
  return sols;
}

describe('UI smoke test', () => {
  it('guides a first-time player through the first sol, and can be skipped', async () => {
    new App(new CssStage());
    (await waitFor(() => button(/Quick mission/))).click();
    (await waitFor(() => button(/Land the crew/))).click();
    const bubble = await waitFor(() => document.querySelector('.coach-bubble'));
    expect(bubble.textContent).toMatch(/PLAN THE DAY/);
    button(/Plan the day/)!.click();
    await sleep(0);
    expect(document.querySelector('.coach-bubble')!.textContent).toMatch(/power cells/);
    button(/^Next$/)!.click();
    expect(document.querySelector('.coach-bubble')!.textContent).toMatch(/AIR/);
    document.querySelector<HTMLButtonElement>('button[aria-label="Add a cell to Air"]')!.click();
    expect(document.querySelector('.coach-bubble')!.textContent).toMatch(/FUEL/);
    button(/Skip tutorial/)!.click();
    expect(document.querySelector('.coach-bubble')).toBeNull();
    expect(localStorage.getItem('ev-tutorial-done')).toBe('1');
  }, 20000);

  it('plays a whole 3-crew campaign from title to the finale, with saving', async () => {
    const app = new App(new CssStage());
    (await waitFor(() => button(/New campaign/))).click();
    (await waitFor(() => button(/Cadet/))).click();
    const sols = await play(app, () => !!document.querySelector('[aria-label="Campaign complete"]'));
    expect(sols).toBeGreaterThan(20);
    const c = (app as unknown as AppInternals).campaign;
    expect(c.results.length).toBe(3);
    expect(Object.values(c.base.levels).reduce((a, b) => a + b, 0)).toBeGreaterThan(2);
    expect(document.querySelector('.data-badge')?.textContent ?? '').not.toMatch(/LIVE/);
  }, 60000);

  it('resumes a saved campaign mid-expedition', async () => {
    const app = new App(new CssStage());
    (await waitFor(() => button(/New campaign/))).click();
    (await waitFor(() => button(/Cadet/))).click();
    const internals = app as unknown as AppInternals;
    await play(app, () => !!internals.mission && internals.mission.sol >= 4);
    const sol = internals.mission.sol;
    // Reload the page.
    document.body.innerHTML = `<div id="app"><div id="stage"></div><header id="hud"></header><main id="dock"></main></div><div id="modal-root"></div>`;
    const app2 = new App(new CssStage());
    const cont = await waitFor(() => button(/Continue: crew 1 of 3/));
    cont.click();
    expect((app2 as unknown as AppInternals).mission.sol).toBe(sol);
  }, 30000);

  it('plays the May 2024 history scenario', async () => {
    const app = new App(new CssStage());
    (await waitFor(() => button(/May 2024 storms/))).click();
    await play(app, () => !!button(/Play again/));
    const m = (app as unknown as AppInternals).mission;
    expect(m.config.scenario).toBe('may2024');
    expect(m.log.some((r) => r.storm?.event.kind === 'cme' || r.storm?.event.classType?.startsWith('X'))).toBe(true);
  }, 30000);
});
