// @vitest-environment happy-dom
// Written with AI assistance (Claude Code). See README "Use of AI tools".
// Boots the real game with Outpost Architect loaded (happy-dom has no WebGL, so the pad is the flat grid): the lobby
// tile renders, the start card opens, a part is placed by click and by keyboard, the readout updates, a Blueprint
// runs its stress test (skipped to the end) and records stars and XP, the builder closes back to the title, and a
// shared ?base= link opens the builder with that base.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { App } from '../../ui/app';
import { CssStage } from '../../render/stage';
import { onGame } from '../hooks';
import '../index';
import { encodeLayout } from './share';
import { autoLayout } from './fixtures.test-util';
import { currentBuilder, openFromLink } from './index';
import { readSave, saveCurrent } from './store';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitFor<T>(fn: () => T | null | undefined, ms = 4000): Promise<T> {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const v = fn();
    if (v) return v;
    await sleep(10);
  }
  throw new Error('timed out waiting');
}
const btn = (root: ParentNode, text: RegExp) => ([...root.querySelectorAll('button')] as HTMLButtonElement[]).find((b) => text.test(b.textContent ?? '') && !b.disabled) ?? null;
const cell = (x: number, z: number) => document.querySelector<HTMLElement>(`.evb-cell[data-x="${x}"][data-z="${z}"]`);
const key = (el: Element, k: string, opts: KeyboardEventInit = {}) => el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...opts }));

beforeEach(() => {
  currentBuilder()?.close();
  document.body.innerHTML = `<div id="app"><div id="stage"></div><header id="hud"></header><main id="dock"></main></div><div id="modal-root"></div>`;
  vi.stubGlobal('fetch', () => Promise.reject(new Error('offline in tests')));
  localStorage.clear();
});

describe('Outpost Architect in the real game', () => {
  it('opens from its lobby tile, builds, runs a Blueprint stress test and goes back', async () => {
    new App(new CssStage());
    const tile = await waitFor(() => document.querySelector<HTMLButtonElement>('[data-tile="builder"]'));
    expect(tile.textContent).toMatch(/Outpost Architect/);
    expect(tile.textContent).toMatch(/Build your own base/);
    expect(tile.querySelector('svg')).not.toBeNull();
    tile.click();

    const layer = await waitFor(() => document.querySelector<HTMLElement>('.ev-builder[role="dialog"]'));
    expect(layer.getAttribute('aria-label')).toBe('Outpost Architect');
    expect(document.getElementById('app')!.hasAttribute('inert')).toBe(true);
    expect(document.getElementById('stage')!.style.display).toBe('none');
    // The start card: Free build, and 12 Blueprints (the first three open).
    const start = await waitFor(() => layer.querySelector('.evb-start'));
    expect(start.querySelectorAll('.evb-bp')).toHaveLength(12);
    expect(start.querySelectorAll('.evb-bp.locked').length).toBe(9);

    // Free build: put a Habitat down by clicking the flat pad.
    btn(start, /^Free build$/)!.click();
    expect(layer.querySelector('.evb-overlay')!.hasAttribute('hidden')).toBe(true);
    layer.querySelector<HTMLButtonElement>('.evb-cat:nth-child(2)')!.click(); // Life
    layer.querySelector<HTMLButtonElement>('.evb-part[data-part="habitat"]')!.click();
    cell(2, 2)!.click();
    expect(layer.querySelectorAll('.evb-cell[style]').length).toBe(4);
    expect(layer.querySelector('.evb-verdict')!.textContent).toMatch(/power/i);
    // A part that doesn't fit is refused with a reason.
    cell(3, 3)!.click();
    expect(layer.querySelectorAll('.evb-cell[style]').length).toBe(4);
    // Keyboard: Undo with Ctrl+Z, then place again with the arrows and Enter.
    key(layer, 'z', { ctrlKey: true });
    expect(layer.querySelectorAll('.evb-cell[style]').length).toBe(0);
    const pad = layer.querySelector<HTMLElement>('.evb-stage')!;
    key(pad, 'ArrowRight');
    key(pad, 'Enter');
    expect(layer.querySelectorAll('.evb-cell[style]').length).toBe(4);

    // A Blueprint: build a winning base for "First Light" and run its stress test.
    btn(layer, /^Blueprints$/)!.click();
    (await waitFor(() => layer.querySelector<HTMLButtonElement>('.evb-bp[data-challenge="first-light"]'))).click();
    const goal = layer.querySelector<HTMLElement>('.evb-goal')!;
    expect(goal.hidden).toBe(false);
    expect(goal.textContent).toMatch(/First Light/);
    const view = currentBuilder()!;
    const winner = autoLayout('gale', { habitat: 1, o2: 1, greenhouse: 1, heater: 1, solar: 6, shelter: 1, monitor: 1, rocket: 1 });
    // Place the winning base part by part through the view, like a player would.
    for (const p of winner.parts) {
      view.pick(p.part);
      for (let i = 0; i < p.rot; i++) view.rotate();
      view.onCell({ x: p.x, z: p.z }, 'tap');
    }
    expect(layer.querySelectorAll('.evb-checks li.ok').length).toBeGreaterThanOrEqual(3);
    const xp: number[] = [];
    const stop = onGame('xp', (p) => void xp.push(p.amount));
    btn(layer, /^Run stress test$/)!.click();
    const skip = await waitFor(() => btn(layer.querySelector('.evb-timeline')!, /^Skip$/));
    skip.click();
    const result = await waitFor(() => layer.querySelector('.evb-result'));
    stop();
    expect(result.textContent).toMatch(/Passed|Perfect/);
    expect(result.textContent).toMatch(/simplified test using the game's numbers/);
    expect(result.textContent).toMatch(/NASA DONKI/);
    expect(result.textContent).toMatch(/\+\d+ XP/);
    expect(readSave().stars['first-light']).toBe(3);
    expect(xp.reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
    expect(result.textContent).toMatch(/Unlocked: Light post/);

    // Close (Escape twice: the card, then the builder) and land back on the title with the tile's new status.
    key(layer, 'Escape');
    key(layer, 'Escape');
    await waitFor(() => !document.querySelector('.ev-builder'));
    expect(document.getElementById('app')!.hasAttribute('inert')).toBe(false);
    expect(document.getElementById('stage')!.style.display).toBe('');
    const again = await waitFor(() => document.querySelector<HTMLButtonElement>('[data-tile="builder"]'));
    expect(again.textContent).toMatch(/1 of 12 blueprints/);
  });

  it('keeps keyboard focus when a part is picked: it moves to the pad, so arrows and Enter work at once', async () => {
    new App(new CssStage());
    (await waitFor(() => document.querySelector<HTMLButtonElement>('[data-tile="builder"]'))).click();
    const layer = await waitFor(() => document.querySelector<HTMLElement>('.ev-builder[role="dialog"]'));
    btn(await waitFor(() => layer.querySelector('.evb-start')), /^Free build$/)!.click();
    layer.querySelector<HTMLButtonElement>('.evb-cat:nth-child(2)')!.click(); // Life
    const part = layer.querySelector<HTMLButtonElement>('.evb-part[data-part="habitat"]')!;
    part.focus();
    part.click(); // what Enter on a focused button does
    const pad = layer.querySelector<HTMLElement>('.evb-stage')!;
    expect(document.activeElement).toBe(pad);
    expect(layer.querySelector(':scope > .sr-only[role="status"]')!.textContent).toMatch(/Habitat in hand.*arrow keys/i);
    // Keys now reach the builder from the pad: arrows move, Enter places.
    key(document.activeElement!, 'ArrowRight');
    key(document.activeElement!, 'Enter');
    expect(layer.querySelectorAll('.evb-cell[style]').length).toBe(4);
    // The part stays in hand after placing: Escape puts it back, and focus stays inside the builder.
    key(document.activeElement!, 'Escape');
    expect(document.querySelector('.ev-builder')).not.toBeNull();
    expect(layer.contains(document.activeElement)).toBe(true);
    currentBuilder()!.close();
  });

  it('opens a shared ?base= link with that base, and ignores a broken one', async () => {
    new App(new CssStage());
    await waitFor(() => document.querySelector('[data-tile="builder"]'));
    // The player already has a base of their own: opening a friend's link keeps it safe in a slot.
    saveCurrent(autoLayout('gale', { habitat: 1, solar: 3 }));
    const code = encodeLayout(autoLayout('moon', { habitat: 2, solar: 6, battery: 2 }));
    expect(openFromLink(`?base=${code}`)).toBe(true);
    expect(readSave().slots.find((x) => x?.name === 'My last base')).toBeTruthy();
    const layer = await waitFor(() => document.querySelector<HTMLElement>('.ev-builder'));
    expect(layer.querySelector('.evb-site.on')!.textContent).toBe('Moon');
    expect(layer.querySelectorAll('.evb-cell[style]').length).toBe(2 * 4 + 6 * 2 + 2);
    expect(layer.querySelector('.evb-overlay')!.hasAttribute('hidden')).toBe(true);
    currentBuilder()!.close();
    expect(openFromLink('?base=notacode')).toBe(false);
    expect(document.querySelector('.ev-builder')).toBeNull();
  });
});
