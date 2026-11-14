// Written with AI assistance (Claude Code). See README "Use of AI tools".
// One shared look for the big lobby tiles that features add to the title screen (via addTitleExtra in ./hooks):
// a chunky retro button with an icon, a name, one line of status, and an optional badge ("NEW", "LIVE", "3/5").
// Every new feature uses this, so the lobby reads as one game instead of a pile of panels.

import './tile.css';
import { h } from '../ui/dom';

export type TileAccent = 'amber' | 'cyan' | 'green' | 'gold' | 'magenta' | 'red';

export interface TileOpts {
  /** Stable id, also used as data-tile (tests and styles find tiles by it). */
  id: string;
  name: string;
  /** One short status line, e.g. "3 new targets today" or "Tier 7 of 40". */
  sub?: string;
  /** A small inline SVG or canvas (48x48 is drawn at 40px). No emoji: they look different on every device. */
  icon?: Node | null;
  /** A short badge in the corner, e.g. 'NEW', 'LIVE', '2/3'. */
  badge?: string;
  accent?: TileAccent;
  onClick: () => void;
}

export function titleTile(o: TileOpts): HTMLButtonElement {
  return h(
    'button',
    { class: `title-tile accent-${o.accent ?? 'amber'}`, type: 'button', 'data-tile': o.id, onclick: () => o.onClick() },
    o.icon ? h('span', { class: 'title-tile-icon', 'aria-hidden': 'true' }, o.icon) : null,
    h('span', { class: 'title-tile-text' }, h('span', { class: 'title-tile-name' }, o.name), o.sub ? h('span', { class: 'title-tile-sub' }, o.sub) : null),
    o.badge ? h('span', { class: 'title-tile-badge' }, o.badge) : null,
  );
}
