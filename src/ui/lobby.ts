// Written with AI assistance (Claude Code). See README "Use of AI tools".
// The lobby: the title screen as a game hub. A big PLAY button, the player's rank strip, then a grid of mode tiles.
// The game's own modes (Quick mission, New campaign, Daily challenge, May 2024 storms, Class mission and the real-science
// tools) are lobby tiles registered here, in the same list as the meta features' tiles (src/meta/hooks.ts addTitleExtra),
// so everything sorts by `order` into one grid:
//   0 rank strip · 5 player card · 6 season · 8 quick mission · 9 new campaign · 12 rival race · 14 daily challenge ·
//   16 May 2024 storms · 20 Storm Cards · 24 rover · 30 Hangar · 36 base builder · 40 Flight school · 50 class mission ·
//   60 explore the real science
// A tile (titleTile, src/meta/tile.ts) takes one grid cell; anything else (a strip or a group) spans the full width,
// unless it has the class `title-tile-group` (one cell, like a tile, with its own buttons inside).
// "NEW" badges: tiles the player has never opened get a small NEW badge, once they have finished the first-sol tutorial
// (a brand-new player sees a calm lobby with one big PLAY button). Opened tiles are kept in localStorage (ev-lobby-v1).

import './lobby.css';
import { h } from './dom';
import { iconSvg, type IconName } from './icons';
import { titleTile, type TileAccent } from '../meta/tile';
import type { TitleExtra } from '../meta/hooks';

const KEY = 'ev-lobby-v1';

interface LobbyState {
  /** Tile ids the player has opened at least once. */
  opened: string[];
  /** How many times the full cold open has played. */
  intros: number;
}

export function loadLobby(): LobbyState {
  try {
    const raw = localStorage.getItem(KEY);
    const v = raw ? (JSON.parse(raw) as Partial<LobbyState>) : {};
    return { opened: Array.isArray(v.opened) ? v.opened.filter((x) => typeof x === 'string') : [], intros: typeof v.intros === 'number' ? v.intros : 0 };
  } catch {
    return { opened: [], intros: 0 };
  }
}

function saveLobby(s: LobbyState) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* private mode: badges just show again next time */
  }
}

export function markOpened(id: string) {
  const s = loadLobby();
  if (s.opened.includes(id)) return;
  s.opened.push(id);
  saveLobby(s);
}

export function countIntro() {
  const s = loadLobby();
  s.intros++;
  saveLobby(s);
}

/** A pixel icon as a bare <svg>, sized for a lobby tile. */
export function tileIcon(name: IconName, size = 40): Element {
  const t = document.createElement('template');
  t.innerHTML = iconSvg(name, size);
  return t.content.firstElementChild!;
}

/**
 * Give unopened tiles a NEW badge (only when `showNew`; never over a tile's own badge), and remember every tile the
 * player opens. Works on any `[data-tile]` element, so new features get it for free.
 */
export function decorateLobby(root: ParentNode, showNew: boolean) {
  const opened = new Set(loadLobby().opened);
  root.querySelectorAll<HTMLElement>('[data-tile]').forEach((el) => {
    const id = el.getAttribute('data-tile')!;
    if (showNew && !opened.has(id) && !el.querySelector(':scope > .title-tile-badge')) {
      el.append(h('span', { class: 'title-tile-badge lobby-new' }, 'NEW'));
    }
    el.addEventListener(
      'click',
      () => {
        markOpened(id);
        el.querySelector(':scope > .lobby-new')?.remove();
      },
      { capture: true },
    );
  });
}

// ------------------------------------------------------------------ the game's own modes
export interface LobbyActions {
  quick(): void;
  campaign(): void;
  daily(): void;
  history(): void;
  /** False when the May 2024 data is missing from this build. */
  historyReady: boolean;
  classMission(): void;
  radar(): void;
  planner(): void;
  scienceLog(): void;
}

function tile(id: string, name: string, sub: string, iconName: IconName, accent: TileAccent, onClick: () => void, opts: { disabled?: boolean; small?: boolean } = {}) {
  const t = titleTile({ id, name, sub, icon: tileIcon(iconName, opts.small ? 32 : 40), accent, onClick });
  if (opts.small) t.classList.add('small');
  if (opts.disabled) t.disabled = true;
  return t;
}

/** The game's own modes as lobby tiles (registered by the App with addTitleExtra). */
export function lobbyExtras(a: LobbyActions): TitleExtra[] {
  return [
    { id: 'quick', order: 8, render: () => tile('quick', 'Quick mission', 'One crew, about 10 minutes. Pick Mars or the Moon.', 'rocket', 'amber', a.quick) },
    { id: 'campaign', order: 9, render: () => tile('campaign', 'New campaign', '3 crews, about 35 minutes. Saves after every sol.', 'greenhouse', 'green', a.campaign) },
    { id: 'daily', order: 14, render: () => tile('daily', 'Daily challenge', 'Same mission for everyone today. Beat the board.', 'sun', 'gold', a.daily) },
    {
      id: 'history',
      order: 16,
      render: () => tile('history', 'May 2024 storms', 'Replay the real solar storms of May 2024.', 'radiation', 'red', a.history, { disabled: !a.historyReady }),
    },
    { id: 'class', order: 50, render: () => tile('class', 'Class mission', 'Mission Control: the whole class runs one base.', 'antenna', 'magenta', a.classMission) },
    {
      id: 'explore',
      order: 60,
      render: () =>
        h(
          'section',
          { class: 'lobby-explore', 'aria-label': 'Explore the real science' },
          h('div', { class: 'kicker' }, 'Explore the real science'),
          h(
            'div',
            { class: 'lobby-explore-row' },
            tile('radar', 'Space weather radar', 'Real storms from the Sun', 'monitor', 'cyan', a.radar, { small: true }),
            tile('planner', 'Trip planner: the way home', 'Real paths from Mars to Earth', 'o2', 'cyan', a.planner, { small: true }),
            tile('science-log', 'Science Log', 'Where every number comes from', 'crate', 'cyan', a.scienceLog, { small: true }),
          ),
        ),
    },
  ];
}
