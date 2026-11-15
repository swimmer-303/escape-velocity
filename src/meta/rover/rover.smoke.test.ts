// Written with AI assistance (Claude Code). See README "Use of AI tools".
// @vitest-environment happy-dom
// Boots the real game with Rover Expeditions loaded: the lobby tile shows today's targets, opens the start card in the
// game's own dialog layer (site choice, controls, Start, Museum, Close), the Museum opens and comes back, a played sol
// preselects that base's site, and Start without WebGL (happy-dom has none) shows a friendly card and cleans up.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { App } from '../../ui/app';
import { CssStage, SwappableStage } from '../../render/stage';
import { emitGame, type GameEventMap } from '../hooks';
import { STORE_KEY } from './store';
import { targetCount, todayKey } from './targets';
import { defaultSite, freshStore } from './store';
import { bankHaul } from './bank';
import { LESSON, resultsCard } from './ui';
import './index';

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
const tile = () => document.querySelector<HTMLButtonElement>('[data-tile="rover"]');

beforeEach(() => {
  document.body.innerHTML = `<div id="app"><div id="stage"></div><header id="hud"></header><main id="dock"></main></div><div id="modal-root"></div>`;
  vi.stubGlobal('fetch', () => Promise.reject(new Error('offline in tests')));
  localStorage.clear();
});

describe('Rover Expeditions in the real game', () => {
  it('shows a lobby tile with today\'s targets, opens the start card, the Museum, and closes again', async () => {
    new App(new SwappableStage(new CssStage()));
    const t = await waitFor(tile);
    const n = targetCount('gale', todayKey());
    expect(t.textContent).toContain('Rover Expeditions');
    expect(t.textContent).toContain(`${n} new targets today`);
    expect(t.classList.contains('accent-green')).toBe(true);
    expect(t.querySelector('svg')).not.toBeNull();
    expect(t.textContent).toContain('NEW');
    // No emoji anywhere on the tile.
    expect(/\p{Extended_Pictographic}/u.test(t.textContent ?? '')).toBe(false);

    t.click();
    const card = await waitFor(() => document.querySelector<HTMLElement>('#modal-root [role="dialog"][aria-label="Rover Expeditions"]'));
    const radios = [...card.querySelectorAll<HTMLInputElement>('input[type="radio"][name="ev-rover-site"]')];
    expect(radios.map((r) => r.value)).toEqual(['gale', 'arcadia', 'moon']);
    expect(radios.find((r) => r.checked)?.value).toBe('gale');
    expect(card.textContent).toMatch(/hold near a target to scan/);
    expect(card.textContent).toMatch(/battery drains/);
    expect(card.querySelector('[data-rover="start"]')).not.toBeNull();
    expect(document.activeElement?.getAttribute('data-rover')).toBe('start');
    expect(card.querySelector('.ev-rover-science')!.textContent).toMatch(/shrunk 100 times/);

    // Picking the Moon swaps the Science notes.
    radios[2].checked = true;
    radios[2].dispatchEvent(new Event('change'));
    expect(card.querySelector('.ev-rover-science')!.textContent).toMatch(/made up/);

    card.querySelector<HTMLButtonElement>('[data-rover="museum"]')!.click();
    const museum = await waitFor(() => document.querySelector<HTMLElement>('#modal-root [role="dialog"][aria-label="Sample Museum"]'));
    expect(museum.querySelectorAll('.ev-museum-item').length).toBe(20);
    expect(museum.textContent).toContain('0 of 20 kinds found');
    [...museum.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === 'Back')!.click();
    const again = await waitFor(() => document.querySelector<HTMLElement>('#modal-root [role="dialog"][aria-label="Rover Expeditions"]'));
    // Back on the start card with the Moon still chosen.
    expect(again.querySelector<HTMLInputElement>('input[value="moon"]')!.checked).toBe(true);

    again.querySelector<HTMLButtonElement>('[data-rover="close"]')!.click();
    await waitFor(() => document.querySelector('[aria-label="Escape Velocity title screen"]'));
    expect(tile()).not.toBeNull();
  });

  it('preselects the site of the player\'s last game (from the sol event), but not from the demo', () => {
    const sol = (site: 'mars' | 'moon', landing: 'gale' | 'arcadia', demo: boolean) =>
      ({ after: { config: { site, landing } }, demo }) as unknown as GameEventMap['sol'];
    emitGame('sol', sol('mars', 'arcadia', true));
    expect(defaultSite()).toBe('gale');
    emitGame('sol', sol('mars', 'arcadia', false));
    expect(defaultSite()).toBe('arcadia');
    emitGame('sol', sol('moon', 'gale', false));
    expect(defaultSite()).toBe('moon');
    expect(JSON.parse(localStorage.getItem(STORE_KEY)!).lastGameSite).toBe('moon');
  });

  it('survives corrupt storage on the title screen', async () => {
    localStorage.setItem(STORE_KEY, '{"v":1,"museum":[1,2],"today":"x"');
    new App(new SwappableStage(new CssStage()));
    const t = await waitFor(tile);
    expect(t.textContent).toContain('new targets today');
  });

  it('starts a drive and, with no WebGL, shows a friendly card, cleans up and returns to the title', async () => {
    new App(new SwappableStage(new CssStage()));
    (await waitFor(tile)).click();
    const card = await waitFor(() => document.querySelector<HTMLElement>('#modal-root [aria-label="Rover Expeditions"]'));
    card.querySelector<HTMLButtonElement>('[data-rover="start"]')!.click();
    const layer = await waitFor(() => document.querySelector<HTMLElement>('.ev-rover-host [role="dialog"]'), 10000);
    expect(layer.getAttribute('aria-label')).toMatch(/Rover expedition: Gale Crater/);
    expect(document.getElementById('app')!.hasAttribute('inert')).toBe(true);
    const close = await waitFor(() => layer.querySelector<HTMLButtonElement>('[data-rover-choice="ok"]'));
    expect(layer.textContent).toMatch(/cannot draw the 3D drive/);
    close.click();
    await waitFor(() => document.querySelector('[aria-label="Escape Velocity title screen"]'));
    expect(document.querySelector('.ev-rover-host')).toBeNull();
    expect(document.getElementById('app')!.hasAttribute('inert')).toBe(false);
  });

  it('results card: haul, distance, XP, new Museum entries, bests, the lesson and new targets tomorrow (and a friendly tow)', () => {
    const store = freshStore();
    const result = bankHaul(store, 'gale', '2026-11-14', [{ targetId: '2026-11-14:gale:0', kind: 'gale-organics' }], 1234, () => {});
    const card = resultsCard({ site: 'gale', result, distance: 1234, towed: true, lost: 1, left: 3 });
    const text = card.textContent ?? '';
    expect(text).toContain('Towed home');
    expect(text).toContain('only had room for 1 of your 2 samples');
    expect(text).toContain('Rock with ancient organics');
    expect(text).toContain('New in the Museum');
    expect(text).toContain('Distance driven: 1,234 m');
    expect(text).toContain('New best: 1 sample in one trip!');
    expect(text).toContain(`+${result.xp} XP`);
    expect(text).toContain(LESSON);
    expect(text).toContain('New targets tomorrow');
    expect(card.querySelector('.ev-rarity.legendary')?.textContent).toContain('Legendary');
  });
});
