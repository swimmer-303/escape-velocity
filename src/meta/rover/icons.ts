// Written with AI assistance (Claude Code). See README "Use of AI tools".
// Pixel-art icons for Rover Expeditions, drawn as inline SVG rectangles (no emoji, no image files): the rover for the
// lobby tile, a rock for each kind of sample, and rarity pips (so rarity never relies on color alone).

import { RARITY_PIPS, RARITY_WORD, type Rarity, type SampleKind } from './samples';

const NS = 'http://www.w3.org/2000/svg';

function svg(size: number, view: number, rects: Array<[number, number, number, number, string]>, label?: string): SVGSVGElement {
  const s = document.createElementNS(NS, 'svg');
  s.setAttribute('viewBox', `0 0 ${view} ${view}`);
  s.setAttribute('width', String(size));
  s.setAttribute('height', String(size));
  s.setAttribute('shape-rendering', 'crispEdges');
  if (label) {
    s.setAttribute('role', 'img');
    s.setAttribute('aria-label', label);
  } else s.setAttribute('aria-hidden', 'true');
  for (const [x, y, w, h, fill] of rects) {
    const r = document.createElementNS(NS, 'rect');
    r.setAttribute('x', String(x));
    r.setAttribute('y', String(y));
    r.setAttribute('width', String(w));
    r.setAttribute('height', String(h));
    r.setAttribute('fill', fill);
    s.append(r);
  }
  return s;
}

/** A six-wheeled rover with its camera mast, 16 x 16 pixels. */
export function roverIcon(size = 48): SVGSVGElement {
  const body = '#e9e3d6';
  const shade = '#9aa0b5';
  const dark = '#2b2b33';
  const metal = '#4a4f63';
  return svg(size, 16, [
    // camera mast and head
    [10, 2, 3, 2, body],
    [10, 3, 3, 1, '#202838'],
    [11, 4, 1, 4, shade],
    // antenna
    [3, 4, 1, 4, metal],
    // deck and body
    [2, 8, 12, 1, shade],
    [3, 9, 10, 3, body],
    [3, 11, 10, 1, '#c9c2b4'],
    [12, 9, 1, 1, '#ffd84a'],
    // legs
    [2, 12, 12, 1, metal],
    // six wheels (three seen from the side)
    [1, 13, 3, 3, dark],
    [6, 13, 3, 3, dark],
    [11, 13, 3, 3, dark],
    [2, 14, 1, 1, '#55555f'],
    [7, 14, 1, 1, '#55555f'],
    [12, 14, 1, 1, '#55555f'],
  ]);
}

/** A chunky rock in the sample's colors (with a glint for ice, a band for layers...). `found` false: a dark outline. */
export function sampleIcon(kind: SampleKind, found = true, size = 40): SVGSVGElement {
  if (!found) {
    const o = '#4a3f7a';
    return svg(size, 12, [
      [3, 3, 6, 1, o],
      [2, 4, 1, 5, o],
      [9, 4, 1, 5, o],
      [3, 9, 6, 1, o],
      [5, 5, 2, 1, '#8a7fb8'],
      [6, 6, 1, 1, '#8a7fb8'],
      [5, 8, 1, 1, '#8a7fb8'],
    ]);
  }
  const c = kind.color;
  const a = kind.accent;
  return svg(size, 12, [
    [4, 2, 4, 1, c],
    [2, 3, 8, 1, c],
    [1, 4, 10, 5, c],
    [2, 9, 8, 1, c],
    [3, 10, 6, 1, '#00000055'],
    // the accent: a vein or band across the rock, and a glint
    [2, 6, 8, 1, a],
    [4, 4, 1, 1, a],
    [8, 7, 1, 1, a],
    [3, 3, 2, 1, '#ffffff66'],
  ]);
}

/** "Rare" with 3 of 4 pips: the word, the pips and the color all say the same thing. */
export function rarityTag(r: Rarity): HTMLElement {
  const el = document.createElement('span');
  el.className = `ev-rarity ${r}`;
  const pips = document.createElement('span');
  pips.className = 'pips';
  pips.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < 4; i++) {
    const p = document.createElement('i');
    if (i < RARITY_PIPS[r]) p.className = 'on';
    pips.append(p);
  }
  el.append(pips, document.createTextNode(RARITY_WORD[r]));
  return el;
}
