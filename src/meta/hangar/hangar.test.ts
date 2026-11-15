// @vitest-environment happy-dom
// Written with AI assistance (Claude Code). See README "Use of AI tools".
// The Hangar: the unlock schedule, equipping and saving (and surviving junk in storage), "New" badges,
// level-up toasts, the title-screen button, and the dialog with its locked and unlocked tiles.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import './index';
import { ITEMS, DEFAULTS, SLOTS, itemById, itemsIn, nextUnlock, isUnlocked, fullName } from './items';
import { STORAGE_KEY, loadSave, equip, equippedItem, currentCosmetics, newItems, markAllSeen, resetLooksMemo, unlocksToAnnounce } from './store';
import { itemPreview, spriteFor } from './preview';
import { DAY, DUSK, HANGAR_LABEL } from './view';
import { emitGame, renderTitleExtras, rewardsAtLevel, setLevelProvider, setMetaContext, type MetaContext } from '../hooks';
import type { Cosmetics, FocusKey, Stage } from '../../render/stage';
import type { GameAudio } from '../../ui/audio';

function fakeContext() {
  const root = document.createElement('div');
  root.id = 'modal-root';
  document.body.append(root);
  const painted: Cosmetics[] = [];
  const focus: Array<FocusKey | null> = [];
  const times: number[] = [];
  const stage = {
    mount() {},
    setScene() {},
    setTimeOfDay: (t: number) => void times.push(t),
    storm() {},
    launch: async () => {},
    setReducedMotion() {},
    dispose() {},
    focusModule: (k: FocusKey | null) => void focus.push(k),
    setCosmetics: (c: Cosmetics) => void painted.push(c),
  } satisfies Stage;
  const showTitle = vi.fn();
  const ctx: MetaContext = {
    stage,
    audio: { sfx: vi.fn() } as unknown as GameAudio,
    modal(content, opts) {
      root.replaceChildren();
      const box = document.createElement('div');
      box.className = 'modal';
      box.setAttribute('role', 'dialog');
      box.setAttribute('aria-modal', 'true');
      box.setAttribute('aria-label', opts.label);
      if (opts.onClose) {
        const x = document.createElement('button');
        x.className = 'close-x';
        x.textContent = 'X';
        x.addEventListener('click', opts.onClose);
        box.append(x);
      }
      box.append(content as Node);
      root.append(box);
      return box;
    },
    closeModal: () => root.replaceChildren(),
    showTitle,
    reducedMotion: () => false,
  };
  return { ctx, root, painted, focus, times, showTitle };
}

const dialog = () => document.querySelector<HTMLElement>(`[role="dialog"][aria-label="${HANGAR_LABEL}"]`);
const tileOf = (id: string) => document.querySelector<HTMLElement>(`.hangar-tile[data-id="${id}"]`)!;
const buttons = (root: ParentNode = document) => [...root.querySelectorAll('button')] as HTMLButtonElement[];

beforeEach(() => {
  document.body.innerHTML = '';
  localStorage.clear();
  setLevelProvider(() => 1);
  resetLooksMemo();
});

describe('unlock schedule', () => {
  it('has no duplicate items: unique ids, unique names and unique looks in each section', () => {
    expect(new Set(ITEMS.map((i) => i.id)).size).toBe(ITEMS.length);
    for (const slot of SLOTS) {
      const list = itemsIn(slot);
      expect(new Set(list.map((i) => i.name)).size, slot).toBe(list.length);
      expect(new Set(list.map((i) => JSON.stringify(i.look))).size, slot).toBe(list.length);
      for (const i of list) expect(i.id.startsWith(`${slot}-`)).toBe(true);
    }
  });

  it('unlocks something at every level from 2 to 30, then a few big ones up to 50', () => {
    for (let level = 2; level <= 30; level++) expect(ITEMS.some((i) => i.level === level), `level ${level}`).toBe(true);
    for (const i of ITEMS) {
      expect(i.level).toBeGreaterThanOrEqual(1);
      expect(i.level).toBeLessThanOrEqual(50);
    }
    expect(itemById('rocket-gold')!.level).toBeGreaterThanOrEqual(38);
    expect(itemById('rocket-gold')!.level).toBeLessThanOrEqual(42);
    expect(itemById('suit-legend')!.level).toBe(50);
    expect(itemById('suit-glow')!.level).toBeGreaterThan(30);
    // The first rover pet comes early.
    const firstPet = Math.min(...itemsIn('pet').filter((i) => i.look).map((i) => i.level));
    expect(firstPet).toBeLessThanOrEqual(5);
    // About ten suits, several paint jobs, a few pets and light colors.
    expect(itemsIn('suit').length).toBeGreaterThanOrEqual(10);
    expect(itemsIn('rocket').length).toBeGreaterThanOrEqual(7);
    expect(itemsIn('pet').filter((i) => i.look).length).toBeGreaterThanOrEqual(3);
    expect(itemsIn('lights').length).toBeGreaterThanOrEqual(4);
  });

  it('starts with white and orange suits, the classic rocket, amber lights and no pet, and only those at level 1', () => {
    for (const slot of SLOTS) expect(itemById(DEFAULTS[slot])!.level).toBe(1);
    const atOne = ITEMS.filter((i) => isUnlocked(i, 1)).map((i) => i.id).sort();
    expect(atOne).toEqual(['lights-amber', 'pet-none', 'rocket-classic', 'suit-orange', 'suit-white']);
    expect(nextUnlock(1)!.level).toBe(2);
    expect(nextUnlock(50)).toBeNull();
  });

  it('shows every unlock on the level-up screen, with a preview, but not the starting items', () => {
    const at4 = rewardsAtLevel(4);
    expect(at4.map((r) => r.name)).toContain('Bolt the rover pet');
    expect(at4.find((r) => r.name === 'Bolt the rover pet')!.kind).toBe('Rover pet');
    expect(at4[0].preview!()).toBeInstanceOf(HTMLElement);
    expect(rewardsAtLevel(1).filter((r) => r.id.startsWith('hangar-'))).toEqual([]);
    expect(rewardsAtLevel(40).map((r) => r.name)).toContain('Gold rocket paint');
  });

  it('draws a preview for every item (a canvas where there is one, a named color swatch otherwise)', () => {
    for (const item of ITEMS) {
      const el = itemPreview(item);
      expect(el.getAttribute('aria-hidden')).toBe('true');
      expect(el.querySelector('canvas, .hangar-px-fallback')).not.toBeNull();
      // The sprite has real pixels in it.
      const s = spriteFor(item);
      let filled = 0;
      for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) if (s.px(x, y)) filled++;
      expect(filled, item.id).toBeGreaterThan(20);
    }
  });
});

describe('equipping and saving', () => {
  it('starts on the defaults and equips only unlocked items, saving the choice', () => {
    expect(currentCosmetics(1)).toEqual({
      suit: itemById('suit-white')!.look,
      rocket: itemById('rocket-classic')!.look,
      pet: null,
      lights: '#ffb627',
    });
    expect(equip('suit-purple', 1)).toBe(false); // level 8 item
    expect(equip('nope', 50)).toBe(false);
    expect(equip('suit-purple', 8)).toBe(true);
    expect(equip('pet-bolt', 8)).toBe(true);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).equipped.suit).toBe('suit-purple');
    expect(loadSave().equipped).toEqual({ suit: 'suit-purple', rocket: 'rocket-classic', pet: 'pet-bolt', lights: 'lights-amber' });
    const c = currentCosmetics(8);
    expect(c.suit.body).toBe('#a065e0');
    expect(c.pet).toEqual(itemById('pet-bolt')!.look);
  });

  it('falls back to the default while a saved choice is above the current level (and keeps the save)', () => {
    equip('rocket-flames', 20);
    expect(equippedItem('rocket', 1).id).toBe('rocket-classic');
    expect(equippedItem('rocket', 14).id).toBe('rocket-flames');
    expect(loadSave().equipped.rocket).toBe('rocket-flames');
  });

  it('survives junk in storage: bad JSON, wrong types, unknown ids, items from another section', () => {
    for (const junk of ['{nope', 'null', '42', '"text"', '[]', JSON.stringify({ equipped: 'x', seen: 'y', toasted: 'z' })]) {
      localStorage.setItem(STORAGE_KEY, junk);
      expect(loadSave()).toEqual({ equipped: DEFAULTS, seen: [], toasted: 0 });
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ equipped: { suit: 'rocket-gold', rocket: 'rocket-gold', pet: 7, lights: 'lights-nope' }, seen: ['suit-cyan', 5, 'gone'], toasted: 3.7 }));
    expect(loadSave()).toEqual({ equipped: { ...DEFAULTS, rocket: 'rocket-gold' }, seen: ['suit-cyan'], toasted: 3 });
  });

  it('carries on when storage is blocked', () => {
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(loadSave().equipped).toEqual(DEFAULTS);
    expect(() => equip('suit-orange', 1)).not.toThrow();
    get.mockRestore();
    set.mockRestore();
  });
});

describe('new items and level-up toasts', () => {
  it('counts items unlocked since the last visit (never the starting ones)', () => {
    expect(newItems(1)).toEqual([]);
    expect(newItems(5).map((i) => i.id)).toEqual(['suit-cyan', 'rocket-stripes', 'pet-bolt', 'lights-cyan']);
    markAllSeen(5);
    expect(newItems(5)).toEqual([]);
    expect(newItems(6).map((i) => i.id)).toEqual(['suit-lime']);
  });

  it('announces each unlock once, including levels skipped in a jump', () => {
    expect(unlocksToAnnounce(2).map((i) => i.id)).toEqual(['suit-cyan']);
    expect(unlocksToAnnounce(2)).toEqual([]); // the same level again: no repeat
    expect(unlocksToAnnounce(5).map((i) => i.id)).toEqual(['rocket-stripes', 'pet-bolt', 'lights-cyan']);
  });

  it('pops a toast on level-up, and repaints the base with saved choices that are now unlocked', () => {
    const { ctx, painted } = fakeContext();
    setMetaContext(ctx);
    equip('suit-cyan', 2); // chosen earlier, at level 2
    setLevelProvider(() => 2);
    emitGame('level-up', { level: 2, rank: 'Cadet' });
    const toasts = [...document.querySelectorAll('.ev-toast')].map((t) => t.textContent);
    expect(toasts).toEqual(['New suit color unlocked: Cyan. Equip it in the Hangar.']);
    expect(painted.at(-1)!.suit.body).toBe('#5ef2e6');
    emitGame('level-up', { level: 3, rank: 'Cadet' });
    expect(document.querySelector('.ev-toast:last-child')!.textContent).toBe('New rocket paint unlocked: Candy Stripes. Equip it in the Hangar.');
  });
});

describe('the Hangar screen', () => {
  it('paints the saved looks when the game starts', async () => {
    equip('suit-orange', 1);
    // A fresh game: new copies of the hooks and the Hangar, as on page load.
    vi.resetModules();
    const hooks = await import('../hooks');
    await import('./index');
    const { ctx, painted } = fakeContext();
    expect(painted).toEqual([]);
    hooks.setMetaContext(ctx);
    expect(painted.length).toBe(1);
    expect(painted[0].suit.body).toBe('#e8742a');
  });

  it('adds a compact Hangar button to the title screen that tells what is new or what unlocks next', () => {
    const { ctx } = fakeContext();
    setMetaContext(ctx);
    const strip = () => renderTitleExtras().find((e) => e.classList.contains('hangar-strip'))!;
    expect(strip().textContent).toContain('Next at level 2: Cyan suit');
    setLevelProvider(() => 8);
    expect(strip().textContent).toContain('7 new items to equip');
    expect(strip().getAttribute('aria-label')).toMatch(/^Hangar: .*7 new items to equip/);
    expect(strip().querySelector('.title-tile-badge')!.textContent).toBe('7 NEW');
  });

  it('opens from the title, shows locked and unlocked tiles, equips live, and goes back to the title', () => {
    const { ctx, painted, focus, times, showTitle } = fakeContext();
    setMetaContext(ctx);
    setLevelProvider(() => 8);
    const strip = renderTitleExtras().find((e) => e.classList.contains('hangar-strip'))!;
    document.body.append(strip);
    (strip as HTMLButtonElement).click();
    const box = dialog()!;
    expect(box).not.toBeNull();
    expect(box.classList.contains('hangar-modal')).toBe(true);

    // Four sections; Suits first, and its tab is where the keyboard starts.
    const tabs = [...box.querySelectorAll<HTMLElement>('[role="tab"]')];
    expect(tabs[0].hasAttribute('data-autofocus')).toBe(true);
    expect(tabs[0].tabIndex).toBe(0);
    expect(tabs[1].tabIndex).toBe(-1);
    expect(tabs.map((t) => t.textContent!.replace(/,? ?\d+ new/, ''))).toEqual(['Suits', 'Rocket', 'Pet', 'Lights']);
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');
    expect(box.querySelector('[role="tabpanel"]')!.getAttribute('aria-labelledby')).toBe('hangar-tab-suit');

    // Unlocked tiles have Equip buttons; the equipped one says so; locked ones show a padlock and their level.
    const white = tileOf('suit-white');
    expect(white.classList.contains('on')).toBe(true);
    expect(white.querySelector('button')!.getAttribute('aria-label')).toBe('White suit, equipped');
    expect(white.querySelector('button')!.getAttribute('aria-pressed')).toBe('true');
    const purple = tileOf('suit-purple');
    expect(purple.querySelector('button')!.textContent).toBe('Equip');
    expect(purple.querySelector('button')!.getAttribute('aria-label')).toBe('Equip Purple suit');
    expect(purple.querySelector('.hangar-new')!.textContent).toBe('New');
    const red = tileOf('suit-red');
    expect(red.classList.contains('locked')).toBe(true);
    expect(red.querySelector('button')).toBeNull();
    expect(red.querySelector('.hangar-lock svg')).not.toBeNull();
    expect(red.textContent).toContain('Unlocks at');
    expect(red.textContent).toContain('Level 13');
    expect(red.querySelector('.hangar-name')!.textContent).toBe('Red');
    expect(box.textContent).toContain('Did you know?');

    // Equip: the base changes right away, the tile says Equipped, the choice is saved.
    purple.querySelector('button')!.click();
    expect(painted.at(-1)!.suit.body).toBe('#a065e0');
    expect(tileOf('suit-purple').querySelector('button')!.getAttribute('aria-label')).toBe('Purple suit, equipped');
    expect(tileOf('suit-purple').querySelector('button')!.textContent).toBe('Equipped');
    expect(tileOf('suit-white').querySelector('button')!.textContent).toBe('Equip');
    expect(document.activeElement).toBe(tileOf('suit-purple').querySelector('button'));
    expect(loadSave().equipped.suit).toBe('suit-purple');
    expect(box.querySelector('[aria-live]')!.textContent).toBe('Purple suit equipped.');

    // Arrow keys move between sections; the camera looks at what the section changes.
    tabs[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(tabs[1].getAttribute('aria-selected')).toBe('true');
    expect(tabs[0].getAttribute('aria-selected')).toBe('false');
    expect(tabs[1].tabIndex).toBe(0);
    expect(document.activeElement).toBe(tabs[1]);
    expect(focus.at(-1)).toBe('rocket');
    expect(tileOf('rocket-checkers').querySelector('button')).not.toBeNull();
    expect(tileOf('rocket-sunset').classList.contains('locked')).toBe(true);
    tileOf('rocket-checkers').querySelector('button')!.click();
    expect(painted.at(-1)!.rocket.pattern).toBe('checker');

    // Pet: no pet, or Bolt.
    tabs[2].click();
    expect(focus.at(-1)).toBeNull();
    tileOf('pet-bolt').querySelector('button')!.click();
    expect(painted.at(-1)!.pet).toEqual(itemById('pet-bolt')!.look);
    expect(tileOf('pet-none').querySelector('button')!.getAttribute('aria-label')).toBe('Choose no pet');

    // Lights: the habitat, at dusk so the lights show.
    tabs[3].dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    expect(tabs[3].getAttribute('aria-selected')).toBe('true');
    expect(focus.at(-1)).toBe('heaters');
    expect(times.at(-1)).toBe(DUSK);

    // Back to the title: the camera and the sky go back too.
    buttons(box).find((b) => b.textContent === 'Back')!.click();
    expect(showTitle).toHaveBeenCalledTimes(1);
    expect(focus.at(-1)).toBeNull();
    expect(times.at(-1)).toBe(DAY);

    // Next visit: nothing is new any more.
    const again = renderTitleExtras().find((e) => e.classList.contains('hangar-strip'))!;
    expect(again.textContent).not.toContain('new');
    expect(again.textContent).not.toContain('NEW');
    (again as HTMLButtonElement).click();
    expect(dialog()!.querySelector('.hangar-new')).toBeNull();
    // The close button and Escape go back to the title too.
    dialog()!.querySelector<HTMLButtonElement>('.close-x')!.click();
    expect(showTitle).toHaveBeenCalledTimes(2);
    (again as HTMLButtonElement).click();
    dialog()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(showTitle).toHaveBeenCalledTimes(3);
  });

  it('with no rank yet (level 1), only the starting items can be equipped', () => {
    const { ctx } = fakeContext();
    setMetaContext(ctx);
    (renderTitleExtras().find((e) => e.classList.contains('hangar-strip')) as HTMLButtonElement).click();
    const box = dialog()!;
    const equipButtons = buttons(box).filter((b) => b.classList.contains('hangar-equip'));
    expect(equipButtons.map((b) => b.closest('.hangar-tile')!.getAttribute('data-id'))).toEqual(['suit-white', 'suit-orange']);
    expect(box.querySelectorAll('.hangar-tile.locked').length).toBe(itemsIn('suit').length - 2);
    expect(box.textContent).toContain(`Next, at level 2: ${fullName(itemById('suit-cyan')!)}`);
  });
});
