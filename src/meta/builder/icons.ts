// Written with AI assistance (Claude Code). See README "Use of AI tools".
// Outpost Architect: small inline pixel pictures (SVG, no emoji): the lobby tile, stars, a padlock, part footprints
// and the stress test's day icons. All are decoration (aria-hidden); the words beside them carry the meaning.

import { PARTS, type PartId } from './parts';

const NS = 'http://www.w3.org/2000/svg';

function svg(w: number, h: number, inner: string, size: number, cls = ''): SVGSVGElement {
  const el = document.createElementNS(NS, 'svg');
  el.setAttribute('viewBox', `0 0 ${w} ${h}`);
  el.setAttribute('width', String(size));
  el.setAttribute('height', String(Math.round((size * h) / w)));
  el.setAttribute('shape-rendering', 'crispEdges');
  el.setAttribute('aria-hidden', 'true');
  el.setAttribute('focusable', 'false');
  if (cls) el.setAttribute('class', cls);
  el.innerHTML = inner;
  return el;
}

const r = (x: number, y: number, w: number, h: number, fill: string) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"/>`;

/** The lobby tile: a habitat dome, a solar panel and a crane arm over a grid pad (12 x 12). */
export function tileIcon(): SVGSVGElement {
  const pad = r(0, 10, 12, 2, '#7a4a30') + r(1, 10, 1, 1, '#ffe0b0') + r(5, 10, 1, 1, '#ffe0b0') + r(9, 10, 1, 1, '#ffe0b0');
  const dome = r(1, 6, 5, 4, '#e9e3d6') + r(2, 5, 3, 1, '#e9e3d6') + r(2, 7, 1, 1, '#ffb627') + r(4, 7, 1, 1, '#ffb627');
  const panel = r(7, 6, 4, 2, '#26386e') + r(8, 8, 1, 2, '#9aa0b5') + r(10, 8, 1, 2, '#9aa0b5');
  const crane = r(9, 1, 1, 5, '#5ef2e6') + r(5, 1, 5, 1, '#5ef2e6') + r(5, 2, 1, 2, '#5ef2e6');
  return svg(12, 12, pad + dome + panel + crane, 48);
}

/** A pixel star, filled or hollow. */
export function starIcon(filled: boolean, size = 18): SVGSVGElement {
  const c = filled ? '#ffd84a' : '#4a3f7a';
  const shape = [
    [4, 0, 1, 2],
    [3, 2, 3, 1],
    [0, 3, 9, 1],
    [1, 4, 7, 1],
    [2, 5, 5, 1],
    [1, 6, 3, 1],
    [5, 6, 3, 1],
    [1, 7, 2, 1],
    [6, 7, 2, 1],
  ];
  const fill = shape.map(([x, y, w, h]) => r(x, y, w, h, c)).join('');
  return svg(9, 8, fill, size, `evb-star${filled ? ' on' : ''}`);
}

/** Three stars in a row, `n` of them filled. */
export function starRow(n: number, size = 18): HTMLSpanElement {
  const s = document.createElement('span');
  s.className = 'evb-stars';
  s.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < 3; i++) s.append(starIcon(i < n, size));
  return s;
}

export function lockIcon(size = 14): SVGSVGElement {
  return svg(10, 12, r(3, 0, 4, 1, 'currentColor') + r(2, 1, 1, 4, 'currentColor') + r(7, 1, 1, 4, 'currentColor') + r(1, 5, 8, 7, 'currentColor') + r(4, 7, 2, 3, '#15122b'), size);
}

/** A part's footprint as colored squares (shows how much room it takes). */
export function partIcon(part: PartId, size = 28): SVGSVGElement {
  const p = PARTS[part];
  const n = Math.max(p.w, p.d);
  let inner = '';
  for (let i = 0; i < p.w; i++) for (let j = 0; j < p.d; j++) inner += r(i * 5 + 0.5, j * 5 + 0.5, 4, 4, p.color);
  inner += `<rect x="0.25" y="0.25" width="${p.w * 5 - 0.5}" height="${p.d * 5 - 0.5}" fill="none" stroke="#000" stroke-width="0.5"/>`;
  return svg(n * 5, n * 5, inner, size, 'evb-part-icon');
}

export type DayIcon = 'sun' | 'dust' | 'cold' | 'storm' | 'night';
export function dayIcon(kind: DayIcon, size = 20): SVGSVGElement {
  switch (kind) {
    case 'sun':
      return svg(8, 8, r(2, 2, 4, 4, '#ffb627') + r(3, 0, 2, 1, '#ffb627') + r(3, 7, 2, 1, '#ffb627') + r(0, 3, 1, 2, '#ffb627') + r(7, 3, 1, 2, '#ffb627'), size);
    case 'dust':
      return svg(8, 8, r(0, 1, 6, 1, '#d9a066') + r(2, 3, 6, 1, '#c98a52') + r(0, 5, 5, 1, '#d9a066') + r(3, 7, 4, 1, '#c98a52'), size);
    case 'cold':
      return svg(8, 8, r(3, 0, 2, 8, '#8fd3ff') + r(0, 3, 8, 2, '#8fd3ff') + r(1, 1, 1, 1, '#8fd3ff') + r(6, 1, 1, 1, '#8fd3ff') + r(1, 6, 1, 1, '#8fd3ff') + r(6, 6, 1, 1, '#8fd3ff'), size);
    case 'storm':
      return svg(8, 8, r(4, 0, 3, 1, '#c58bff') + r(3, 1, 3, 2, '#c58bff') + r(2, 3, 5, 1, '#c58bff') + r(3, 4, 2, 2, '#c58bff') + r(2, 6, 2, 2, '#c58bff'), size);
    case 'night':
      return svg(8, 8, r(2, 1, 3, 6, '#f4f0e6') + r(1, 2, 1, 4, '#f4f0e6') + r(5, 1, 1, 1, '#f4f0e6') + r(5, 6, 1, 1, '#f4f0e6'), size);
  }
}

/** Small arrow and plus/minus pictures for the camera buttons. */
export function arrowIcon(dir: 'left' | 'right' | 'in' | 'out' | 'home', size = 18): SVGSVGElement {
  const c = 'currentColor';
  switch (dir) {
    case 'left':
      return svg(8, 8, r(1, 3, 6, 2, c) + r(2, 2, 1, 4, c) + r(3, 1, 1, 6, c), size);
    case 'right':
      return svg(8, 8, r(1, 3, 6, 2, c) + r(5, 2, 1, 4, c) + r(4, 1, 1, 6, c), size);
    case 'in':
      return svg(8, 8, r(1, 3, 6, 2, c) + r(3, 1, 2, 6, c), size);
    case 'out':
      return svg(8, 8, r(1, 3, 6, 2, c), size);
    case 'home':
      return svg(8, 8, r(3, 0, 2, 1, c) + r(2, 1, 4, 1, c) + r(1, 2, 6, 1, c) + r(1, 3, 6, 5, c) + r(3, 5, 2, 3, '#15122b'), size);
  }
}
