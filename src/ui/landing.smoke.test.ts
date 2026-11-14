// Written with AI assistance (Claude Code). See README "Use of AI tools".
// @vitest-environment happy-dom
// Headless smoke test for the landing-site choice: pick Arcadia Planitia in the chooser, see the real SWIM value,
// land, and check the mission, the 3D scene and a resumed save all know where the base is.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { App } from './app';
import { CssStage, type StageScene } from '../render/stage';
import type { MissionState } from '../sim/types';
import type { Campaign } from '../sim/campaign';
import { fmtIce, swimAt } from '../data/swim';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function button(text: RegExp): HTMLButtonElement | null {
  return ([...document.querySelectorAll('button')] as HTMLButtonElement[]).find((b) => text.test(b.textContent ?? '') && !b.disabled) ?? null;
}

async function waitFor<T>(fn: () => T | null | undefined, ms = 8000): Promise<T> {
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

function recordingStage() {
  const stage = new CssStage();
  const scenes: StageScene[] = [];
  const setScene = stage.setScene.bind(stage);
  stage.setScene = (scene) => {
    scenes.push(scene);
    setScene(scene);
  };
  return { stage, scenes };
}

describe('landing site chooser', () => {
  it('Gale Crater is picked by default, and the picker hides on the Moon', async () => {
    new App(new CssStage());
    (await waitFor(() => button(/New campaign/))).click();
    expect((await waitFor(() => button(/^Gale Crater/))).getAttribute('aria-pressed')).toBe('true');
    expect(button(/^Arcadia Planitia/)!.getAttribute('aria-pressed')).toBe('false');
    button(/The Moon/)!.click();
    expect(button(/^Gale Crater/)).toBeNull();
    expect(button(/^Arcadia Planitia/)).toBeNull();
  }, 30000);

  it('starts a Quick mission at Arcadia Planitia, with the real SWIM value and icy 3D ground', async () => {
    const { stage, scenes } = recordingStage();
    const app = new App(stage);
    (await waitFor(() => button(/Quick mission/))).click();
    (await waitFor(() => button(/^Arcadia Planitia/))).click();
    expect(button(/^Arcadia Planitia/)!.getAttribute('aria-pressed')).toBe('true');
    expect(document.body.textContent).toMatch(/Mars, at Arcadia Planitia/);
    (await waitFor(() => button(/Start quick mission/))).click();
    const card = await waitFor(() => document.querySelector('.landing-card'));
    expect(card.textContent).toContain(fmtIce(swimAt('arcadia', 'c0_1')));
    expect(card.textContent).toMatch(/Gale Crater it reads/);
    expect(document.body.textContent).toMatch(/icy plains of Arcadia Planitia/);
    (await waitFor(() => button(/Land the crew/))).click();
    await waitFor(() => button(/Plan the day/), 15000);
    const m = (app as unknown as AppInternals).mission;
    expect(m.config.landing).toBe('arcadia');
    expect(m.config.site ?? 'mars').toBe('mars');
    expect(scenes.some((s) => s.landing === 'arcadia' && s.crew > 0)).toBe(true);
  }, 40000);

  it('a Gale Crater campaign looks exactly as before (no landing written), and an Arcadia save resumes at Arcadia', async () => {
    const app = new App(new CssStage());
    (await waitFor(() => button(/New campaign/))).click();
    (await waitFor(() => button(/Cadet/))).click();
    expect('landing' in (app as unknown as AppInternals).campaign).toBe(false);
    expect(document.querySelector('.landing-card')).toBeNull();

    document.body.innerHTML = `<div id="app"><div id="stage"></div><header id="hud"></header><main id="dock"></main></div><div id="modal-root"></div>`;
    localStorage.clear();
    const app2 = new App(new CssStage());
    (await waitFor(() => button(/New campaign/))).click();
    (await waitFor(() => button(/^Arcadia Planitia/))).click();
    (await waitFor(() => button(/Cadet/))).click();
    expect((app2 as unknown as AppInternals).campaign.landing).toBe('arcadia');
    (await waitFor(() => button(/Land the crew/))).click();
    await waitFor(() => button(/Plan the day/), 15000);

    // Reload the page and continue.
    document.body.innerHTML = `<div id="app"><div id="stage"></div><header id="hud"></header><main id="dock"></main></div><div id="modal-root"></div>`;
    const { stage, scenes } = recordingStage();
    const app3 = new App(stage);
    (await waitFor(() => button(/Continue: crew 1 of 3/))).click();
    expect((app3 as unknown as AppInternals).mission.config.landing).toBe('arcadia');
    expect(scenes.at(-1)?.landing).toBe('arcadia');
  }, 60000);
});
