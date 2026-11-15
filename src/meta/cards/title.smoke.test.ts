// @vitest-environment happy-dom
// Written with AI assistance (Claude Code). See README "Use of AI tools".
// The Storm Cards row on the real title screen: it uses the game's own space-weather load (no extra request),
// opens the collection, and Back returns to the title screen.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { App } from '../../ui/app';
import { CssStage } from '../../render/stage';
import { poolFacts } from './pool';
import './index';

beforeEach(() => {
  document.body.innerHTML = `<div id="app"><div id="stage"></div><header id="hud"></header><main id="dock"></main></div><div id="modal-root"></div>`;
  localStorage.clear();
  history.replaceState(null, '', '/');
});

describe('Storm Cards on the title screen', () => {
  it('shows a compact row, opens the collection and goes back, without fetching anything itself', async () => {
    const fetchSpy = vi.fn(() => Promise.reject(new Error('offline in tests')));
    vi.stubGlobal('fetch', fetchSpy);
    new App(new CssStage());
    const row = () => document.querySelector<HTMLButtonElement>('.title-screen [data-tile="storm-cards"]');
    expect(row()).not.toBeNull();
    expect(row()!.textContent).toContain('Storm Cards');
    // Let the game's own load finish (offline here, so the stored snapshot, labeled ARCHIVE).
    await vi.waitFor(() => expect(document.querySelector('.data-badge, .title-screen')).not.toBeNull());
    await new Promise((r) => setTimeout(r, 50));
    const callsByGame = fetchSpy.mock.calls.length;
    expect(row()!.textContent).toContain(`0 of ${poolFacts().length} collected`);
    expect(row()!.querySelector('.tag.live')).toBeNull();

    row()!.click();
    const screen = document.querySelector('#modal-root [aria-label="Storm Cards"]');
    expect(screen).not.toBeNull();
    expect(screen!.querySelectorAll('.sc-missing').length).toBeGreaterThan(0);
    // Storm Cards made no network request of its own.
    expect(fetchSpy.mock.calls.length).toBe(callsByGame);

    Array.from(screen!.querySelectorAll('button')).find((b) => b.textContent === 'Back to the title screen')!.click();
    expect(document.querySelector('#modal-root [aria-label="Escape Velocity title screen"]')).not.toBeNull();
    expect(row()).not.toBeNull();
  });
});
