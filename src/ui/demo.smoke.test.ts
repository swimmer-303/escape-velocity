// @vitest-environment happy-dom
// Written with AI assistance (Claude Code). See README "Use of AI tools".
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { App } from './app';
import { CssStage } from '../render/stage';
import type { MissionState } from '../sim/types';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const button = (re: RegExp) => ([...document.querySelectorAll('button')] as HTMLButtonElement[]).find((b) => re.test(b.textContent ?? '') && !b.disabled) ?? null;

beforeEach(() => {
  document.body.innerHTML = `<div id="app"><div id="stage"></div><header id="hud"></header><main id="dock"></main></div><div id="modal-root"></div>`;
  vi.stubGlobal('fetch', () => Promise.reject(new Error('offline in tests')));
  try {
    localStorage.clear();
  } catch {
    /* ignore */
  }
});

describe('Watch a demo', () => {
  it('plays a whole mission by itself, and any tap goes back to the title', async () => {
    const app = new App(new CssStage());
    const internals = app as unknown as { demoSpeed: number; mission: MissionState | null; phase: string };
    internals.demoSpeed = 0.01;
    for (let i = 0; i < 100 && !button(/Watch a demo/); i++) await sleep(10);
    button(/Watch a demo/)!.click();
    for (let i = 0; i < 1500 && internals.phase !== 'end'; i++) await sleep(10);
    expect(internals.phase).toBe('end');
    expect(internals.mission!.status).not.toBe('playing');
    expect(internals.mission!.log.length).toBeGreaterThan(1);
    expect(document.querySelector('.demo-banner')).not.toBeNull();
    window.dispatchEvent(new Event('pointerdown'));
    expect(document.querySelector('.demo-banner')).toBeNull();
    expect(document.querySelector('[aria-label="Escape Velocity title screen"]')).not.toBeNull();
  }, 60000);

  it('tapping out in the middle of a sol goes to the title and stays there', async () => {
    const app = new App(new CssStage());
    const internals = app as unknown as { demoSpeed: number; phase: string; ff: boolean };
    internals.demoSpeed = 0.01;
    for (let i = 0; i < 100 && !button(/Watch a demo/); i++) await sleep(10);
    button(/Watch a demo/)!.click();
    for (let i = 0; i < 1500 && internals.phase !== 'running'; i++) await sleep(5);
    expect(internals.phase).toBe('running');
    window.dispatchEvent(new Event('pointerdown'));
    expect(internals.phase).toBe('title');
    // The sol that was playing must not pop its debrief over the title when it finishes.
    internals.ff = true;
    await sleep(400);
    expect(internals.phase).toBe('title');
    expect(document.querySelector('[aria-label="Escape Velocity title screen"]')).not.toBeNull();
  }, 60000);
});
