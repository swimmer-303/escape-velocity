// @vitest-environment happy-dom
// Written with AI assistance (Claude Code). See README "Use of AI tools".
// Headless smoke test: boots the real UI and clicks through whole missions like a player would.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { App } from './app';
import { CssStage } from '../render/stage';
import { balanced } from '../sim/strategies';
import { MODULE_LABEL } from './budget';
import { MODULE_IDS, type MissionState } from '../sim/types';

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
});

async function playMission(startLabel: RegExp) {
  const app = new App(new CssStage());
  (await waitFor(() => button(startLabel))).click();
  let sols = 0;
  for (let guard = 0; guard < 80; guard++) {
    const mission = (app as unknown as { mission: MissionState }).mission;
    const planBtn = button(/Plan the day/);
    const crate = document.querySelector<HTMLButtonElement>('.crate[aria-pressed="false"]');
    if (crate && button(/Choose a crate first/) === null && !planBtn) {
      crate.click();
      continue;
    }
    if (document.querySelector('.crates') && !planBtn) {
      document.querySelector<HTMLButtonElement>('.crate')!.click();
      continue;
    }
    if (planBtn) {
      planBtn.click();
      const { alloc } = balanced(mission);
      for (const id of MODULE_IDS) {
        for (let k = 0; k < alloc[id]; k++) {
          const box = document.querySelector<HTMLButtonElement>(`button[aria-label="Add a cell to ${MODULE_LABEL[id]}"]`);
          expect(box, `slot for ${id}`).not.toBeNull();
          box!.click();
        }
      }
      const run = await waitFor(() => button(/^Run sol/));
      run.click();
      (await waitFor(() => button(/Skip/))).click();
      sols++;
      continue;
    }
    const next = button(/Start sol|Launch!|See what happened/);
    if (next) {
      next.click();
      continue;
    }
    if (button(/Play again/)) return { app, sols, mission: (app as unknown as { mission: MissionState }).mission };
    await sleep(20);
  }
  throw new Error('mission did not finish');
}

describe('UI smoke test', () => {
  it('plays a full Cadet mission from title to the end screen', async () => {
    const { sols, mission } = await playMission(/Start mission/);
    expect(sols).toBeGreaterThan(5);
    expect(mission.status).not.toBe('playing');
    expect(document.querySelector('.modal h2')?.textContent).toBeTruthy();
    // Data honesty: offline, so the badge must not say LIVE.
    expect(document.querySelector('.data-badge')?.textContent ?? '').not.toMatch(/LIVE/);
  }, 20000);

  it('plays the May 2024 history scenario', async () => {
    const { mission } = await playMission(/May 2024 storms/);
    expect(mission.config.scenario).toBe('may2024');
    expect(mission.log.some((r) => r.storm?.event.kind === 'cme' || r.storm?.event.classType?.startsWith('X'))).toBe(true);
  }, 20000);
});
