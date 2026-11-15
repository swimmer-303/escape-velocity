// Written with AI assistance (Claude Code). See README "Use of AI tools".
// The Hangar screen: four sections (Suits, Rocket, Pet, Lights) of tiles, each with a pixel preview and its
// name. Unlocked items have an Equip button; locked ones show a padlock and the level that unlocks them.
// The dialog sits at the side of the screen (a bottom sheet on narrow screens), so the 3D base stays in view
// and changes the moment something is equipped. The camera swings to the rocket or the habitat for those
// sections, and the sky turns to dusk when there are lights or glowing things to admire.

import { h } from '../../ui/dom';
import { titleTile } from '../tile';
import { playerLevel, type MetaContext } from '../hooks';
import { ITEMS, SLOTS, SLOT_WORDS, fullName, isUnlocked, itemsIn, nextUnlock, type HangarItem, type Slot } from './items';
import { applyLooks, equip, equippedAll, equippedItem, markAllSeen, newItems } from './store';
import { itemPreview, LOCK_SVG } from './preview';

/** Times of day for the 3D stage: midday, and dusk (the crew is still outside, the lights show up). */
export const DAY = 0.25;
export const DUSK = 0.52;

/** The dialog's accessible name (also how tests find it). */
export const HANGAR_LABEL = 'Hangar';

function equipLabel(item: HangarItem, on: boolean): string {
  if (item.slot === 'pet' && !item.look) return on ? 'No pet, chosen' : 'Choose no pet';
  return on ? `${fullName(item)}, equipped` : `Equip ${fullName(item)}`;
}

/** Point the 3D view at what this section changes, at a time of day that shows it off. */
function showOff(ctx: MetaContext, slot: Slot, level: number) {
  const eq = equippedAll(level);
  ctx.stage.focusModule?.(slot === 'rocket' ? 'rocket' : slot === 'lights' ? 'heaters' : null);
  const glows = slot === 'lights' || (slot === 'suit' && !!eq.suit.look.glow) || (slot === 'pet' && !!eq.pet.look?.glow);
  ctx.stage.setTimeOfDay(glows ? DUSK : DAY);
}

/** Open the Hangar in the game's dialog layer. */
export function openHangar(ctx: MetaContext, start: Slot = 'suit'): HTMLElement {
  const level = playerLevel();
  // "New" badges show for this visit; next time these items are old friends.
  const fresh = new Set(newItems(level).map((i) => i.id));
  markAllSeen(level);
  let tab: Slot = start;

  const live = h('p', { class: 'sr-only', 'aria-live': 'polite' });
  const panel = h('div', { class: 'hangar-panel', role: 'tabpanel', id: 'hangar-panel' });
  const tabs = new Map<Slot, HTMLButtonElement>();

  const back = () => {
    ctx.stage.focusModule?.(null);
    ctx.stage.setTimeOfDay(DAY);
    ctx.showTitle();
  };

  const onEquip = (item: HangarItem) => {
    if (!equip(item.id, level)) return;
    applyLooks(ctx, level);
    ctx.audio.sfx('place');
    live.textContent = item.slot === 'pet' && !item.look ? 'No pet.' : `${fullName(item)} equipped.`;
    renderPanel();
    panel.querySelector<HTMLElement>(`[data-id="${item.id}"] button`)?.focus();
    showOff(ctx, tab, level);
  };

  const tile = (item: HangarItem, equippedId: string) => {
    const unlocked = isUnlocked(item, level);
    const on = item.id === equippedId;
    return h(
      'li',
      { class: `hangar-tile${unlocked ? '' : ' locked'}${on ? ' on' : ''}`, 'data-id': item.id },
      fresh.has(item.id) ? h('span', { class: 'hangar-new' }, 'New') : null,
      itemPreview(item),
      h('span', { class: 'hangar-name' }, item.name),
      unlocked
        ? h(
            'button',
            {
              class: `btn small hangar-equip ${on ? 'cyan' : 'go'}`,
              'aria-pressed': on ? 'true' : 'false',
              'aria-label': equipLabel(item, on),
              onclick: () => {
                if (!on) onEquip(item);
              },
            },
            on ? 'Equipped' : 'Equip',
          )
        : h(
            'span',
            { class: 'hangar-lock' },
            h('span', { class: 'hangar-lock-icon', html: LOCK_SVG }),
            h('span', null, h('span', { class: 'sr-only' }, 'Locked. '), h('small', null, 'Unlocks at'), h('b', null, item.season ? `${item.season} or level ${item.level}` : `Level ${item.level}`)),
          ),
    );
  };

  function renderPanel() {
    const equipped = equippedItem(tab, level);
    const list = itemsIn(tab);
    const open = list.filter((i) => isUnlocked(i, level)).length;
    panel.setAttribute('aria-labelledby', `hangar-tab-${tab}`);
    panel.replaceChildren(h('p', { class: 'hangar-count' }, `${open} of ${list.length} unlocked`), h('ul', { class: 'hangar-grid' }, ...list.map((i) => tile(i, equipped.id))));
    if (equipped.fact) panel.append(h('p', { class: 'hangar-fact' }, h('b', null, 'Did you know? '), equipped.fact));
  }

  function select(slot: Slot, focus = false) {
    tab = slot;
    for (const [s, b] of tabs) {
      const sel = s === slot;
      b.setAttribute('aria-selected', sel ? 'true' : 'false');
      b.tabIndex = sel ? 0 : -1;
      b.classList.toggle('on', sel);
    }
    renderPanel();
    if (focus) tabs.get(slot)?.focus();
    showOff(ctx, slot, level);
  }

  // Arrow keys move between the sections (the usual tab-list keys).
  const onTabKey = (e: KeyboardEvent) => {
    const i = SLOTS.indexOf(tab);
    const to = e.key === 'ArrowRight' ? (i + 1) % SLOTS.length : e.key === 'ArrowLeft' ? (i + SLOTS.length - 1) % SLOTS.length : e.key === 'Home' ? 0 : e.key === 'End' ? SLOTS.length - 1 : -1;
    if (to < 0) return;
    e.preventDefault();
    select(SLOTS[to], true);
  };

  for (const slot of SLOTS) {
    const n = itemsIn(slot).filter((i) => fresh.has(i.id)).length;
    const b = h(
      'button',
      { class: 'btn small hangar-tab', role: 'tab', id: `hangar-tab-${slot}`, 'aria-controls': 'hangar-panel', onclick: () => select(slot), onkeydown: onTabKey },
      SLOT_WORDS[slot].tab,
      n ? h('span', { class: 'hangar-new' }, h('span', { class: 'sr-only' }, ', '), `${n} new`) : null,
    );
    tabs.set(slot, b);
  }

  // Fill in the first section before the dialog opens; the dialog puts the keyboard focus on its tab.
  select(start);
  tabs.get(start)!.setAttribute('data-autofocus', '');
  const unlocked = ITEMS.filter((i) => isUnlocked(i, level)).length;
  const next = nextUnlock(level);
  const box = ctx.modal(
    h(
      'div',
      { class: 'hangar' },
      h('div', { class: 'kicker' }, 'Hangar'),
      h('h2', null, 'Make the base your own'),
      h(
        'p',
        { class: 'hangar-sub' },
        `Astronaut level ${level}: ${unlocked} of ${ITEMS.length} unlocked. `,
        next ? `Next, at level ${next.level}: ${fullName(next)}.` : 'You have unlocked everything. Legend!',
      ),
      h('div', { class: 'hangar-tabs', role: 'tablist', 'aria-label': 'Hangar sections' }, ...tabs.values()),
      panel,
      live,
      h('div', { class: 'actions end' }, h('button', { class: 'btn small', onclick: back }, 'Back')),
    ),
    { label: HANGAR_LABEL, onClose: back },
  );
  box.classList.add('hangar-modal');
  // Escape goes back to the title, like the Back button.
  box.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || e.defaultPrevented) return;
    e.preventDefault();
    back();
  });
  return box;
}

/** The title screen's Hangar button: a peek at the current suit, and what's new or what unlocks next. */
export function titleStrip(open: () => void): HTMLElement {
  const level = playerLevel();
  const n = newItems(level).length;
  const next = nextUnlock(level);
  const note = n ? `${n} new ${n === 1 ? 'item' : 'items'} to equip` : next ? `Next at level ${next.level}: ${fullName(next)}` : 'Everything unlocked!';
  // A lobby tile (src/meta/tile.ts), wearing the crew's current suit as its icon.
  const tile = titleTile({
    id: 'hangar',
    name: 'Hangar',
    sub: note,
    icon: itemPreview(equippedItem('suit', level), 'small'),
    badge: n ? `${n} NEW` : undefined,
    accent: 'magenta',
    onClick: open,
  });
  tile.classList.add('hangar-strip');
  if (n) tile.classList.add('has-new');
  tile.setAttribute('aria-label', `Hangar: suits, rocket paint, rover pets and lights. ${note}.`);
  return tile;
}
