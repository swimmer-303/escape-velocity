// @vitest-environment happy-dom
// Written with AI assistance (Claude Code). See README "Use of AI tools".
// Headless UI test for class codes: typing a code, a teacher making one, ?code= links, and
// the code staying with a saved campaign.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { App } from './app';
import { CssStage } from '../render/stage';
import { isClassCode } from '../sim/classcode';
import { balanced } from '../sim/strategies';
import { MODULE_LABEL } from './budget';
import { MODULE_IDS, type MissionState } from '../sim/types';
import type { Campaign } from '../sim/campaign';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
type AppInternals = { mission: MissionState; campaign: Campaign };
const internals = (app: App) => app as unknown as AppInternals;

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

function typeCode(text: string) {
  const input = document.querySelector<HTMLInputElement>('#class-code-input')!;
  expect(input).not.toBeNull();
  input.value = text;
  input.dispatchEvent(new Event('input'));
  button(/^Use code$/)!.click();
}

const modalText = () => document.querySelector('#modal-root')?.textContent ?? '';

function freshPage() {
  document.body.innerHTML = `<div id="app"><div id="stage"></div><header id="hud"></header><main id="dock"></main></div><div id="modal-root"></div>`;
}

beforeEach(() => {
  freshPage();
  vi.stubGlobal('fetch', () => Promise.reject(new Error('offline in tests')));
  try {
    localStorage.clear();
    localStorage.setItem('ev-tutorial-done', '1');
  } catch {
    /* ignore */
  }
});

afterEach(() => {
  history.replaceState(null, '', '/');
});

describe('class codes in the UI', () => {
  it('entering a code starts a campaign whose seed is the code, and it stays after Continue', async () => {
    const app = new App(new CssStage());
    (await waitFor(() => button(/New campaign/))).click();
    // A bad code is explained and not used.
    typeCode('K0RZQ');
    expect(document.querySelector('#class-code-msg')!.textContent).toMatch(/never use/);
    expect(button(/^Remove code$/)).toBeNull();
    // Lowercase, spaces and dashes are fine.
    typeCode(' k7r-zq ');
    expect(document.querySelector('.class-code')!.textContent).toMatch(/K7RZQ is on/);
    button(/Cadet/)!.click();
    expect(internals(app).campaign.seed).toBe('K7RZQ');
    expect(internals(app).campaign.classCode).toBe('K7RZQ');

    (await waitFor(() => button(/Land the crew/))).click();
    await waitFor(() => button(/Plan the day/));
    expect(internals(app).mission.config.seed).toBe('K7RZQ');
    button(/^Menu$/)!.click();
    expect(modalText()).toMatch(/Class code K7RZQ: compare your stars and choices with classmates/);

    // Reload the page and continue: the code is still there.
    freshPage();
    const app2 = new App(new CssStage());
    (await waitFor(() => button(/Continue: crew 1 of 3/))).click();
    expect(internals(app2).campaign.classCode).toBe('K7RZQ');
    expect(internals(app2).mission.config.seed).toBe('K7RZQ');
    button(/^Menu$/)!.click();
    expect(modalText()).toMatch(/Class code K7RZQ: compare your stars/);
  }, 20000);

  it('a teacher makes a code, with a link to share, and can play with it', async () => {
    const app = new App(new CssStage());
    (await waitFor(() => button(/New campaign/))).click();
    button(/Make a code for my class/)!.click();
    const code = document.querySelector('.cc-big')!.textContent ?? '';
    expect(isClassCode(code)).toBe(true);
    const link = document.querySelector<HTMLInputElement>('.cc-link-text')!.value;
    expect(link).toBe(`${location.origin}/?code=${code}`);
    expect(button(/Copy link/)).not.toBeNull();
    button(/Make a new code/)!.click();
    const code2 = document.querySelector('.cc-big')!.textContent ?? '';
    expect(isClassCode(code2)).toBe(true);
    button(/Play with this code/)!.click();
    expect(document.querySelector('.cc-big')).toBeNull();
    button(/Commander/)!.click();
    expect(internals(app).campaign.seed).toBe(code2);
    expect(internals(app).campaign.difficulty).toBe('commander');
  }, 20000);

  it('a ?code= link applies the code to a quick mission, shown on the end screen', async () => {
    history.replaceState(null, '', '/?code=b4x-n9');
    const app = new App(new CssStage());
    await waitFor(() => button(/Quick mission/));
    expect(modalText()).toMatch(/Class code B4XN9 is ready/);
    button(/Quick mission/)!.click();
    expect(internals(app).campaign.seed).toBe('B4XN9');
    expect(document.querySelector('.class-code')!.textContent).toMatch(/B4XN9 is on/);

    // Play the whole quick mission with a scripted player.
    for (let guard = 0; guard < 300 && !button(/Play again/); guard++) {
      if (document.querySelector('.crates .crate') && !button(/Plan the day/)) {
        document.querySelector<HTMLButtonElement>('.crates .crate')!.click();
        continue;
      }
      const plan = button(/Plan the day/);
      if (plan) {
        plan.click();
        const { alloc } = balanced(internals(app).mission);
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
    expect(internals(app).mission.status).not.toBe('playing');
    expect(modalText()).toMatch(/Class code B4XN9: compare your stars and choices with classmates/);
    // Play again keeps the same class Mars.
    button(/Play again/)!.click();
    expect(internals(app).campaign.seed).toBe('B4XN9');
  }, 30000);

  it('a code typed on the Quick mission screen re-seeds it; removing it goes back to a random Mars', async () => {
    const app = new App(new CssStage());
    (await waitFor(() => button(/Quick mission/))).click();
    const randomSeed = internals(app).campaign.seed;
    typeCode('q9mtk');
    expect(internals(app).campaign.seed).toBe('Q9MTK');
    expect(internals(app).campaign.classCode).toBe('Q9MTK');
    button(/^Remove code$/)!.click();
    expect(internals(app).campaign.classCode).toBeUndefined();
    expect(internals(app).campaign.seed).not.toBe('Q9MTK');
    expect(randomSeed).not.toBe('Q9MTK');
    expect(document.querySelector('#class-code-input')).not.toBeNull();
  }, 20000);

  it('?seed= still works when there is no class code', async () => {
    history.replaceState(null, '', '/?seed=abc123');
    const app = new App(new CssStage());
    (await waitFor(() => button(/New campaign/))).click();
    button(/Cadet/)!.click();
    expect(internals(app).campaign.seed).toBe('abc123');
    expect(internals(app).campaign.classCode).toBeUndefined();
  }, 20000);
});
