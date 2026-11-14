// Written with AI assistance (Claude Code). See README "Use of AI tools".
// Little pixel-art previews for the Hangar tiles, the title screen, toasts and the level-up screen: an astronaut
// in the suit, the rocket in its paint (drawn from the same pixels as the 3D rocket's texture), the rover pet,
// and a habitat with its lights on. Drawn on a tiny canvas and scaled up with crisp pixels. Where there is no
// canvas, a plain color swatch stands in. Previews are decoration: the item's name is always written beside them.

import { paintAt, PAINT_H, PAINT_W, NOSE_ROW } from '../../render/paint';
import type { HangarItem } from './items';

type Px = string | null;
interface Sprite {
  w: number;
  h: number;
  px: (x: number, y: number) => Px;
  /** Ring around the shape: a dark outline by default, or a soft glow color. */
  ring?: string;
}

const OUTLINE = '#1a1420';
const HELMET = '#f4f0e6';
const VISOR = '#ffb627';

// One letter per pixel. h helmet, v visor, b suit, t trim; e eyes, a antenna (trim), w hull, s base ring, L lights.
const ASTRONAUT = [
  '....hhhh....',
  '...hhhhhh...',
  '..hhvvvvhh..',
  '..hhvvvvhh..',
  '...hhhhhh...',
  '...bbbbbb...',
  '..bbbbbbbb..',
  '.bbbbbbbbbb.',
  '.bb.tttt.bb.',
  '.bb.bbbb.bb.',
  '.tt.bbbb.tt.',
  '....bbbb....',
  '...bb..bb...',
  '...bb..bb...',
  '...tt..tt...',
  '............',
];
const PET = [
  '................',
  '................',
  '................',
  '.........e......',
  '.........a......',
  '...bbbbbbbbbb...',
  '...bbbbbbbbbb...',
  '...bbeebbeebb...',
  '...bbeebbeebb...',
  '...bbbbbbbbbb...',
  '....aaaaaaaa....',
  '..aabbbbbbbbaa..',
  '..aabbbbbbbbaa..',
  '..aabbbbbbbbaa..',
  '..aaaaaaaaaaaa..',
  '................',
];
const HAB = [
  '................',
  '................',
  '................',
  '................',
  '......wwww......',
  '....wwwwwwww....',
  '...wwwwwwwwww...',
  '..wwwwwwwwwwww..',
  '..wLLwwLLwwLLw..',
  '.wwLLwwLLwwLLww.',
  '.wwwwwwwwwwwwww.',
  '.ssssssssssssss.',
  '.ssssssssssssss.',
  '................',
  '................',
  '................',
];

function fromMap(map: string[], colors: Record<string, string>, ring?: string): Sprite {
  return { w: map[0].length, h: map.length, px: (x, y) => colors[map[y][x]] ?? null, ring };
}

function mix(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ch = (s: number) => Math.round(((pa >> s) & 255) * (1 - t) + ((pb >> s) & 255) * t);
  return `#${((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, '0')}`;
}

/** The rocket, 16 x 32: nose rows 0-6, body rows 7-28 (8 pixels wide), fins at the bottom, engine bell below. */
function rocketSprite(look: Extract<HangarItem, { slot: 'rocket' }>['look']): Sprite {
  const BODY_TOP = 7;
  const BODY_BOTTOM = 28;
  return {
    w: 16,
    h: 32,
    px: (x, y) => {
      if (y < BODY_TOP) {
        const half = 1 + Math.round((y / (BODY_TOP - 1)) * 3);
        if (x < 8 - half || x >= 8 + half) return null;
        const ty = NOSE_ROW + Math.round(((BODY_TOP - 1 - y) / (BODY_TOP - 1)) * (PAINT_H - 1 - NOSE_ROW));
        return paintAt(look, x, ty);
      }
      if (y <= BODY_BOTTOM) {
        if (x >= 4 && x < 12) {
          const ty = Math.round(((BODY_BOTTOM - y) / (BODY_BOTTOM - BODY_TOP)) * (NOSE_ROW - 1));
          const c = paintAt(look, x % PAINT_W, ty);
          return look.shiny && x === 5 ? mix(c, '#ffffff', 0.45) : c;
        }
        const fin = y - (BODY_BOTTOM - 6);
        if (fin >= 0) {
          const reach = 1 + Math.floor(fin / 2);
          if ((x < 4 && x >= 4 - reach) || (x >= 12 && x < 12 + reach)) return look.fins;
        }
        return null;
      }
      if (y === BODY_BOTTOM + 1 && x >= 6 && x < 10) return '#4a4f63';
      if (y === BODY_BOTTOM + 2 && x >= 5 && x < 11) return '#4a4f63';
      return null;
    },
  };
}

export function spriteFor(item: HangarItem): Sprite {
  switch (item.slot) {
    case 'suit':
      return fromMap(ASTRONAUT, { h: HELMET, v: VISOR, b: item.look.body, t: item.look.trim }, item.look.glow ? item.look.body : undefined);
    case 'rocket':
      return rocketSprite(item.look);
    case 'pet':
      // No pet: a dim outline of where one could be.
      if (!item.look) return fromMap(PET, { e: '#3a3260', a: '#3a3260', b: '#3a3260' }, '#2e2654');
      return fromMap(PET, { e: item.look.eyes, a: item.look.trim, b: item.look.body }, item.look.glow ? item.look.body : undefined);
    case 'lights':
      return fromMap(HAB, { w: '#e9e3d6', s: '#c9c2b4', L: item.look });
  }
}

/** The color that stands for an item when there is no canvas to draw on. */
export function mainColor(item: HangarItem): string {
  switch (item.slot) {
    case 'suit':
      return item.look.body;
    case 'rocket':
      return item.look.colors[0] ?? '#f4f0e6';
    case 'pet':
      return item.look?.body ?? '#3a3260';
    case 'lights':
      return item.look;
  }
}

function draw(sprite: Sprite): HTMLCanvasElement | null {
  const canvas = document.createElement('canvas');
  canvas.width = sprite.w;
  canvas.height = sprite.h;
  let g: CanvasRenderingContext2D | null = null;
  try {
    g = canvas.getContext('2d');
  } catch {
    g = null;
  }
  if (!g) return null;
  const filled = (x: number, y: number) => x >= 0 && y >= 0 && x < sprite.w && y < sprite.h && sprite.px(x, y) !== null;
  for (let y = 0; y < sprite.h; y++) {
    for (let x = 0; x < sprite.w; x++) {
      const c = sprite.px(x, y);
      if (c) {
        g.fillStyle = c;
        g.fillRect(x, y, 1, 1);
      } else if (filled(x - 1, y) || filled(x + 1, y) || filled(x, y - 1) || filled(x, y + 1)) {
        // The outline (or glow) hugging the shape keeps it readable on any background.
        g.fillStyle = sprite.ring ?? OUTLINE;
        g.globalAlpha = sprite.ring ? 0.6 : 1;
        g.fillRect(x, y, 1, 1);
        g.globalAlpha = 1;
      }
    }
  }
  return canvas;
}

/**
 * A preview for one item. `size`: 'tile' (Hangar tiles, about 64 px tall) or 'small' (title screen, toasts,
 * the level-up screen; about 32 px). Decorative (aria-hidden): the item's name always goes with it.
 */
export function itemPreview(item: HangarItem, size: 'tile' | 'small' = 'tile'): HTMLElement {
  const box = document.createElement('span');
  box.className = `hangar-px ${size} slot-${item.slot}${item.slot === 'rocket' ? ' tall' : ''}`;
  box.setAttribute('aria-hidden', 'true');
  const canvas = draw(spriteFor(item));
  if (canvas) box.append(canvas);
  else {
    const swatch = document.createElement('span');
    swatch.className = 'hangar-px-fallback';
    swatch.style.background = mainColor(item);
    box.append(swatch);
  }
  return box;
}

/** A pixel padlock for locked tiles (an inline picture, no emoji). */
export const LOCK_SVG =
  '<svg viewBox="0 0 10 12" width="15" height="18" shape-rendering="crispEdges" aria-hidden="true" focusable="false">' +
  '<rect x="3" y="0" width="4" height="1" fill="currentColor"/><rect x="2" y="1" width="1" height="4" fill="currentColor"/>' +
  '<rect x="7" y="1" width="1" height="4" fill="currentColor"/><rect x="1" y="5" width="8" height="7" fill="currentColor"/>' +
  '<rect x="4" y="7" width="2" height="3" fill="#15122b"/></svg>';
