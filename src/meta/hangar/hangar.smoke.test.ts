// @vitest-environment happy-dom
// Written with AI assistance (Claude Code). See README "Use of AI tools".
// Boots the real game with the Hangar loaded: the title screen gets its Hangar button, the Hangar opens in the
// game's own dialog layer, equipping paints the (swappable) stage, the 3D stage swapped in later gets the same
// looks, and Back returns to the title screen.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { App } from '../../ui/app';
import { CssStage, SwappableStage, type Cosmetics, type Stage } from '../../render/stage';
import { setLevelProvider } from '../hooks';
import './index';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const button = (text: RegExp) => ([...document.querySelectorAll('button')] as HTMLButtonElement[]).find((b) => text.test(b.textContent ?? '') && !b.disabled) ?? null;
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
  localStorage.clear();
});

describe('the Hangar in the real game', () => {
  it('opens from the title screen, paints the base live, follows a stage swap, and goes back', async () => {
    setLevelProvider(() => 6);
    const stage = new SwappableStage(new CssStage());
    new App(stage);
    const open = await waitFor(() => button(/^Hangar/));
    expect(open.getAttribute('aria-label')).toMatch(/new items to equip/);
    open.click();
    const dialog = await waitFor(() => document.querySelector<HTMLElement>('#modal-root [role="dialog"][aria-label="Hangar"]'));
    expect(dialog.classList.contains('hangar-modal')).toBe(true);
    expect(document.activeElement?.getAttribute('role')).toBe('tab');

    // The 3D stage arrives later (it loads lazily): it is handed the looks equipped so far.
    const painted: Cosmetics[] = [];
    const three: Stage = { mount() {}, setScene() {}, setTimeOfDay() {}, storm() {}, launch: async () => {}, setReducedMotion() {}, dispose() {}, setCosmetics: (c) => void painted.push(c) };
    dialog.querySelector<HTMLButtonElement>('.hangar-tile[data-id="suit-lime"] button')!.click();
    stage.swap(three);
    expect(painted.at(-1)!.suit.body).toBe('#9be04a');
    dialog.querySelector<HTMLButtonElement>('.hangar-tile[data-id="suit-cyan"] button')!.click();
    expect(painted.at(-1)!.suit.body).toBe('#5ef2e6');

    button(/^Back$/)!.click();
    await waitFor(() => document.querySelector('[aria-label="Escape Velocity title screen"]'));
    expect(document.querySelector('.hangar-strip')).not.toBeNull();
    setLevelProvider(() => 1);
  });
});
