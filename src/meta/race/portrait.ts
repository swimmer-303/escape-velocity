// Written with AI assistance (Claude Code). See README "Use of AI tools".
// Procedural pixel portraits for rival commanders (and for you and your friends' callsigns): a 12x12 astronaut
// in a helmet, built from a seed. Fictional faces only: no photos, no real people, no AI art.

import { makeRng } from '../../sim/rng';

const SVG_NS = 'http://www.w3.org/2000/svg';

// H helmet, A helmet stripe, V visor rim, S skin, E eyes, M mouth, R hair, B suit, D suit badge, . empty
const BASE = [
  '....HHHH....',
  '..HHAAAAHH..',
  '.HHVVVVVVHH.',
  '.HVSSSSSSVH.',
  'HHVSESSESVHH',
  'HHVSSSSSSVHH',
  'HHVSSMMSSVHH',
  '.HVVSSSSVVH.',
  '.HHHVVVVHHH.',
  '..HHHHHHHH..',
  '.BBBBDBBBBB.',
  'BBBBBBBBBBBB',
];

const HELMETS = ['#f4ead8', '#ffb627', '#5ef2e6', '#ff6bd6', '#7ddc5a', '#c58bff', '#ff5a4f', '#8fd3ff'];
const STRIPES = ['#ff5a4f', '#5b7bb5', '#ffb627', '#15122b', '#7ddc5a', '#c2562a'];
const SUITS = ['#5b7bb5', '#c2562a', '#2f8f4a', '#7a2e17', '#4a3f7a', '#1f6f6a', '#b0487a'];
// A range of skin tones.
const SKINS = ['#f6d3b3', '#e8b48e', '#d39a6a', '#b07548', '#8a5a36', '#5e3b22'];
const HAIRS = ['#2b1a10', '#5a3418', '#c98a3a', '#e8d27a', '#a0281e', '#1b1b2b', '#d8d8e0'];

export interface PortraitLook {
  helmet: string;
  stripe: string;
  suit: string;
  skin: string;
  hair: string;
  /** 0 none, 1 bangs, 2 side part */
  hairStyle: number;
  /** 0 smile, 1 grin, 2 small */
  mouth: number;
  antenna: boolean;
}

export function lookFor(seed: string): PortraitLook {
  const r = makeRng(`portrait|${seed}`);
  const pick = <T>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)];
  return {
    helmet: pick(HELMETS),
    stripe: pick(STRIPES),
    suit: pick(SUITS),
    skin: pick(SKINS),
    hair: pick(HAIRS),
    hairStyle: Math.floor(r() * 3),
    mouth: Math.floor(r() * 3),
    antenna: r() < 0.35,
  };
}

export function portraitGrid(look: PortraitLook): string[] {
  const g = BASE.map((row) => row.split(''));
  if (look.hairStyle === 1) for (let x = 3; x <= 8; x++) g[3][x] = 'R';
  if (look.hairStyle === 2) {
    for (let x = 3; x <= 6; x++) g[3][x] = 'R';
    g[4][3] = 'R';
  }
  if (look.mouth === 1) g[6][4] = g[6][7] = 'M';
  if (look.mouth === 2) g[6][6] = 'S';
  return g.map((row) => row.join(''));
}

/** An inline SVG portrait. `ghost` draws a friend's recorded run: see-through and cyan-edged. */
export function portrait(seed: string, opts: { size?: number; ghost?: boolean; label?: string } = {}): SVGSVGElement {
  const look = lookFor(seed);
  const colors: Record<string, string> = {
    H: look.helmet,
    A: look.stripe,
    V: '#15122b',
    S: look.skin,
    E: '#0b0a18',
    M: '#7a2e17',
    R: look.hair,
    B: look.suit,
    D: '#ffd84a',
  };
  const size = opts.size ?? 32;
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', look.antenna ? '0 -2 12 14' : '0 0 12 12');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('shape-rendering', 'crispEdges');
  svg.setAttribute('class', `race-face${opts.ghost ? ' ghost' : ''}`);
  if (opts.label) {
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', opts.label);
  } else svg.setAttribute('aria-hidden', 'true');
  const rect = (x: number, y: number, w: number, hgt: number, fill: string) => {
    const el = document.createElementNS(SVG_NS, 'rect');
    el.setAttribute('x', String(x));
    el.setAttribute('y', String(y));
    el.setAttribute('width', String(w));
    el.setAttribute('height', String(hgt));
    el.setAttribute('fill', fill);
    svg.append(el);
  };
  if (look.antenna) {
    rect(9, -2, 1, 3, '#c2b59b');
    rect(9, -2, 1, 1, '#ff5a4f');
  }
  portraitGrid(look).forEach((row, y) => {
    // Merge runs of the same color into one rect: fewer nodes.
    let x = 0;
    while (x < row.length) {
      const c = row[x];
      let w = 1;
      while (x + w < row.length && row[x + w] === c) w++;
      if (c !== '.') rect(x, y, w, 1, colors[c] ?? '#000');
      x += w;
    }
  });
  if (opts.ghost) svg.setAttribute('opacity', '0.75');
  return svg;
}
