// Written with AI assistance (Claude Code). See README "Use of AI tools".
// Rocket paint jobs as a tiny pixel picture. The 3D stage wraps the picture around the rocket (nearest-neighbor
// filtering, so it stays blocky like a PS1 game) and the Hangar draws its previews from the very same pixels.
// No Three.js in here: the title screen can draw previews without loading the 3D view.

import type { Cosmetics } from './stage';

export type RocketPaint = Cosmetics['rocket'];

/** The paint picture's size in pixels: around the rocket (x) by up the rocket (y, 0 = the bottom). Low-res on purpose. */
export const PAINT_W = 16;
export const PAINT_H = 48;

/** The painted part of the rocket, in scene units above the pad: booster bottom, nose cone base, nose tip. */
export const ROCKET_SPAN = { bottom: 0.4, noseBase: 4.8, top: 6.1 } as const;

/** The first picture row that lands on the nose cone. */
export const NOSE_ROW = Math.floor(((ROCKET_SPAN.noseBase - ROCKET_SPAN.bottom) / (ROCKET_SPAN.top - ROCKET_SPAN.bottom)) * PAINT_H);

/** Flame tongue heights (in rows) for the 'flames' paint, repeating around the rocket. */
const FLAME = [9, 15, 19, 13, 8, 12, 17, 11];
/** A 2x2 ordered-dither matrix: soft, retro steps between the bands of a gradient. */
const DITHER = [0.125, 0.625, 0.875, 0.375];

function hash(x: number, y: number) {
  let h = (x * 374761393 + y * 668265263) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** The paint color at picture pixel (x, y): x wraps around the rocket, y counts up from the bottom. */
export function paintAt(p: RocketPaint, x: number, y: number): string {
  const c = p.colors.length ? p.colors : ['#f4f0e6'];
  const at = (i: number) => c[Math.min(c.length - 1, Math.max(0, i))];
  x = ((x % PAINT_W) + PAINT_W) % PAINT_W;
  if (p.nose && y >= NOSE_ROW) return p.nose;
  switch (p.pattern) {
    case 'stripes':
      // Bands 4 rows tall, cycling through the colors (candy stripes, rainbows).
      return c[Math.floor(y / 4) % c.length];
    case 'checker':
      // Big black-and-white style checks, 4 pixels square.
      return at((Math.floor(x / 4) + Math.floor(y / 4)) % 2);
    case 'gradient': {
      // Bottom to top through every color, with dithered steps between them.
      const f = (y / (PAINT_H - 1)) * (c.length - 1);
      const i = Math.floor(f);
      return at(f - i > DITHER[(x % 2) + (y % 2) * 2] ? i + 1 : i);
    }
    case 'flames': {
      // Flames licking up from the bottom: an outer color, and a hotter one inside.
      const top = FLAME[x % FLAME.length];
      if (y < top - 6) return at(2);
      if (y < top) return at(1);
      return at(0);
    }
    case 'dots': {
      // Polka dots, 2 pixels wide, every other row of dots shifted half a step.
      const row = Math.floor(y / 6);
      const dx = (x + (row % 2) * 4) % 8;
      return dx >= 2 && dx < 4 && y % 6 >= 2 && y % 6 < 4 ? at(1) : at(0);
    }
    case 'stars': {
      // A night sky full of stars.
      const s = hash(x, y);
      return s < 0.07 ? at(1) : s < 0.1 ? at(2) : at(0);
    }
    case 'bolt': {
      // Two lightning zigzags winding up the rocket, on opposite sides.
      const t = (y / 8) % 2;
      const zig = Math.round(1 + Math.abs(t - 1) * 5);
      const d = Math.min(Math.abs(x - zig), Math.abs(x - zig - 8));
      return d <= 1 ? at(1) : at(0);
    }
    default:
      return at(0);
  }
}

/** '#rrggbb' (or '#rgb') to [r, g, b], 0..255. */
export function hexRgb(hex: string): [number, number, number] {
  let s = hex.replace('#', '');
  if (s.length === 3) s = s.replace(/./g, (ch) => ch + ch);
  const n = parseInt(s, 16);
  if (!Number.isFinite(n) || s.length !== 6) return [255, 255, 255];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** The whole paint picture as RGBA bytes, bottom row first (the way a texture's v runs up the rocket). */
export function paintPixels(p: RocketPaint, w = PAINT_W, h = PAINT_H): Uint8Array {
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, g, b] = hexRgb(paintAt(p, x, y));
      const i = (y * w + x) * 4;
      out[i] = r;
      out[i + 1] = g;
      out[i + 2] = b;
      out[i + 3] = 255;
    }
  }
  return out;
}
