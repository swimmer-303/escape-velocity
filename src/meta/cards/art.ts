// Written with AI assistance (Claude Code). See README "Use of AI tools".
// Storm Cards: the card itself. The picture is procedural pixel art drawn on a tiny canvas (no AI images):
// the Sun, a sunspot dot placed where DONKI says the flare happened, and a burst sized by the real flare class.
// Particle storms show particles streaming away; CMEs show a cloud of solar gas (sized by its measured speed).
// Words on the card (class, date, region, rarity, tags) are real text, so they stay sharp and readable aloud.

import { h } from '../../ui/dom';
import {
  bigLabel,
  cardDate,
  cardTitle,
  isFarSideGiant,
  kindWord,
  parseFlareClass,
  parseLocation,
  rarityOf,
  RARITIES,
  RARITY_WORD,
  type CardFacts,
  type Rarity,
} from './rarity';
import type { StoredCard } from './store';

export const ART_W = 64;
export const ART_H = 48;

function hash(s: string): number {
  let x = 2166136261;
  for (let i = 0; i < s.length; i++) x = Math.imul(x ^ s.charCodeAt(i), 16777619);
  return x >>> 0;
}
function rng(seed: number): () => number {
  let a = seed || 1;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SPACE = ['#0b0a18', '#100d22', '#15122b'];
const SUN = ['#fff4c2', '#ffe08a', '#ffc94d', '#ff9a2e', '#e8602a'];
const RARITY_GLOW: Record<Rarity, string> = { common: '#9aa6c4', rare: '#5ef2e6', epic: '#c58bff', legendary: '#ffd34d' };

/** Where the art puts things: the Sun's center and radius, in canvas pixels. */
const SUN_X = 30;
const SUN_Y = 25;
const SUN_R = 14;

/** Size of the flare burst: grows by the same step for each 10 times stronger (C1 = 3 px, M1 = 6.5, X1 = 10, X10 = 13.5). */
export function burstSize(classType: string | null | undefined): number {
  const fc = parseFlareClass(classType);
  if (!fc) return 4;
  const steps = Math.log10(fc.flux / 1e-6); // C1 = 0, M1 = 1, X1 = 2
  return Math.max(2, Math.min(15, 3 + steps * 3.5));
}

/** The sunspot's spot on the Sun's disk, or null if DONKI gives no location or it is on the far side. */
export function spotXY(location: string | null | undefined): { x: number; y: number } | null {
  const p = parseLocation(location);
  if (!p || Math.abs(p.lon) > 90) return null;
  const rad = Math.PI / 180;
  return {
    x: SUN_X + SUN_R * Math.sin(p.lon * rad) * Math.cos(p.lat * rad),
    y: SUN_Y - SUN_R * Math.sin(p.lat * rad),
  };
}

/** Draws the card picture. Returns false when the browser gives no 2D canvas (tests, very old browsers). */
export function drawArt(canvas: HTMLCanvasElement, c: CardFacts): boolean {
  let g: CanvasRenderingContext2D | null = null;
  try {
    g = canvas.getContext('2d');
  } catch {
    g = null;
  }
  if (!g || typeof g.fillRect !== 'function') return false;
  const ctx = g;
  canvas.width = ART_W;
  canvas.height = ART_H;
  const r = rng(hash(c.id));
  const px = (x: number, y: number, col: string) => {
    const ix = Math.round(x);
    const iy = Math.round(y);
    if (ix < 0 || iy < 0 || ix >= ART_W || iy >= ART_H) return;
    ctx.fillStyle = col;
    ctx.fillRect(ix, iy, 1, 1);
  };
  const rarity = rarityOf(c);

  // Space, dithered in three bands, and a few stars.
  for (let y = 0; y < ART_H; y++) {
    for (let x = 0; x < ART_W; x++) {
      const band = (y / ART_H) * 2 + ((x + y) % 2) * 0.5;
      ctx.fillStyle = SPACE[Math.min(2, Math.floor(band))];
      ctx.fillRect(x, y, 1, 1);
    }
  }
  for (let i = 0; i < 26; i++) px(r() * ART_W, r() * ART_H, r() < 0.3 ? '#5ef2e6' : r() < 0.5 ? '#c2b59b' : '#4a3f7a');

  const far = isFarSideGiant(c);
  // A CME cloud from behind the Sun is drawn first, so the Sun covers its middle.
  if (c.kind === 'cme') drawCme(px, r, c, far);

  // The Sun: hot middle, darker toward the edge (limb darkening), checker-dithered between bands.
  for (let y = -SUN_R; y <= SUN_R; y++) {
    for (let x = -SUN_R; x <= SUN_R; x++) {
      const d = Math.sqrt(x * x + y * y) / SUN_R;
      if (d > 1) continue;
      let band = d < 0.35 ? 0 : d < 0.6 ? 1 : d < 0.8 ? 2 : d < 0.93 ? 3 : 4;
      const edge = [0.35, 0.6, 0.8, 0.93].some((b) => Math.abs(d - b) < 0.045);
      if (edge && (x + y) % 2 === 0) band = Math.min(4, band + 1);
      if (band > 0 && r() < 0.06) band = Math.min(4, band + 1); // granulation speckle
      px(SUN_X + x, SUN_Y + y, SUN[band]);
    }
  }

  const spot = spotXY(c.location);
  if (c.kind === 'flare') {
    // No location: put the burst on the Sun's upper-right edge.
    const at = spot ?? { x: SUN_X + SUN_R * 0.7, y: SUN_Y - SUN_R * 0.7 };
    if (spot) drawSpot(px, spot.x, spot.y);
    drawBurst(px, at.x, at.y, burstSize(c.classType), r);
  } else if (c.kind === 'sep') {
    if (spot) drawSpot(px, spot.x, spot.y);
    drawParticles(px, r, c.severity === 'major');
  }

  // Rarity sparkles in the corners (epic and legendary).
  if (rarity === 'epic' || rarity === 'legendary') {
    const glow = RARITY_GLOW[rarity];
    for (const [sx, sy] of [
      [4, 4],
      [ART_W - 5, ART_H - 5],
      ...(rarity === 'legendary' ? [[ART_W - 5, 4], [4, ART_H - 5]] : []),
    ]) {
      px(sx, sy, '#ffffff');
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) px(sx + dx, sy + dy, glow);
    }
  }
  return true;
}

type Px = (x: number, y: number, col: string) => void;

function drawSpot(px: Px, x: number, y: number) {
  // Dark core (umbra) with a reddish rim (penumbra).
  for (const [dx, dy] of [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]]) px(x + dx, y + dy, '#a8441c');
  px(x, y, '#3a1606');
  px(x + 1, y, '#3a1606');
}

function drawBurst(px: Px, x: number, y: number, size: number, r: () => number) {
  const rays = size >= 9 ? 16 : size >= 6 ? 12 : 8;
  const cols = ['#ffffff', '#fff4c2', '#ffe08a', '#ffb627', '#ff5a4f'];
  for (let i = 0; i < rays; i++) {
    const a = (i / rays) * Math.PI * 2 + r() * 0.2;
    const len = size * (i % 2 === 0 ? 1 : 0.6) * (0.85 + r() * 0.3);
    for (let t = 0; t <= len; t += 0.7) {
      const k = Math.min(cols.length - 1, Math.floor((t / Math.max(1, len)) * cols.length));
      px(x + Math.cos(a) * t, y + Math.sin(a) * t, cols[k]);
    }
  }
  // Bright core.
  const core = Math.max(1, size * 0.3);
  for (let dy = -core; dy <= core; dy++) for (let dx = -core; dx <= core; dx++) if (dx * dx + dy * dy <= core * core) px(x + dx, y + dy, '#ffffff');
}

function drawParticles(px: Px, r: () => number, toMars: boolean) {
  // Streaks flying away from the Sun toward the lower right, and a little Mars when an instrument there saw them.
  const n = toMars ? 20 : 14;
  for (let i = 0; i < n; i++) {
    const a = -0.2 + r() * 1.1;
    const start = SUN_R + 2 + r() * 20;
    const len = 2 + r() * 3;
    for (let t = 0; t < len; t += 0.8) {
      px(SUN_X + Math.cos(a) * (start + t), SUN_Y + Math.sin(a) * (start + t), t < 1 ? '#ffffff' : '#5ef2e6');
    }
  }
  if (toMars) {
    const mx = ART_W - 7;
    const my = ART_H - 7;
    for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) if (dx * dx + dy * dy <= 9) px(mx + dx, my + dy, dx + dy < -1 ? '#d9a066' : '#c2562a');
  }
}

function drawCme(px: Px, r: () => number, c: CardFacts, far: boolean) {
  // A shell of solar gas; bigger for a faster CME. From the far side it bulges out from behind the Sun.
  const v = c.speedKms ?? 800;
  const rad = SUN_R * (1.25 + Math.min(1.2, v / 2500));
  const cx = far ? SUN_X - 4 : SUN_X + 6;
  const cy = far ? SUN_Y - 2 : SUN_Y - 4;
  const from = far ? Math.PI * 0.55 : -Math.PI * 0.6;
  const to = far ? Math.PI * 1.75 : Math.PI * 0.35;
  for (let k = 0; k < 3; k++) {
    const rr = rad - k * 2.5;
    const col = k === 0 ? '#ff5a4f' : k === 1 ? '#ff9a2e' : '#c58bff';
    for (let a = from; a <= to; a += 0.02) {
      if (r() < 0.12 * k) continue;
      px(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, col);
    }
  }
  // Loose clumps inside the cloud.
  for (let i = 0; i < 40; i++) {
    const a = from + r() * (to - from);
    const d = rad * (0.6 + r() * 0.35);
    px(cx + Math.cos(a) * d, cy + Math.sin(a) * d, r() < 0.5 ? '#ff9a2e' : '#ffb627');
  }
}

/** What the picture shows, for screen readers. */
export function artLabel(c: CardFacts): string {
  if (c.kind === 'flare') {
    const where = c.region ? `sunspot region ${c.region}` : 'a sunspot';
    const cls = c.classType ? `${/^[AMX]/i.test(c.classType) ? 'an' : 'a'} ${c.classType}` : 'a';
    return `Pixel picture of the Sun with ${cls} flare bursting from ${where}.`;
  }
  if (c.kind === 'sep') return `Pixel picture of the Sun throwing out a stream of fast particles${c.severity === 'major' ? ' that reaches Mars' : ''}.`;
  return isFarSideGiant(c)
    ? 'Pixel picture of a giant cloud of solar gas bursting out from behind the Sun, from its far side.'
    : 'Pixel picture of a cloud of solar gas bursting from the Sun.';
}

function artEl(c: CardFacts): HTMLElement {
  const canvas = h('canvas', { class: 'sc-art', width: ART_W, height: ART_H, role: 'img', 'aria-label': artLabel(c) });
  if (drawArt(canvas, c)) return canvas;
  // No canvas here: a plain CSS Sun keeps the card looking right.
  return h('div', { class: 'sc-art sc-art-plain', role: 'img', 'aria-label': artLabel(c) }, h('span', { class: 'sc-plain-sun' }));
}

function pips(rarity: Rarity): HTMLElement {
  const n = RARITIES.indexOf(rarity) + 1;
  return h('span', { class: 'sc-pips', 'aria-hidden': 'true' }, ...Array.from({ length: n }, () => h('i', null)));
}

export interface CardOpts {
  stored?: StoredCard;
  fresh?: boolean;
  inSet?: boolean;
  /** Draws the NASA record link (not inside a button). */
  withLink?: boolean;
}

/** The face of a card. */
export function cardFace(c: CardFacts, o: CardOpts = {}): HTMLElement {
  const rarity = rarityOf(c);
  const far = isFarSideGiant(c);
  const label = bigLabel(c);
  return h(
    'div',
    { class: `sc-face sc-${rarity}${far ? ' sc-special' : ''}` },
    h('div', { class: 'sc-head' }, h('span', { class: 'sc-rarity' }, RARITY_WORD[rarity]), pips(rarity)),
    h(
      'div',
      { class: 'sc-art-wrap' },
      artEl(c),
      far ? h('span', { class: 'sc-ribbon' }, 'Special') : null,
      o.stored && o.stored.shieldedCount > 0 ? h('span', { class: 'sc-stamp' }, 'Shielded') : null,
      o.fresh ? h('span', { class: 'sc-new' }, 'New') : null,
      o.stored && o.stored.count > 1 ? h('span', { class: 'sc-count', title: `Met ${o.stored.count} times` }, `x${o.stored.count}`) : null,
    ),
    h('div', { class: `sc-big${label.length > 4 ? ' long' : ''}` }, label),
    h('div', { class: 'sc-kind' }, far ? 'Far-side CME' : kindWord(c)),
    h(
      'div',
      { class: 'sc-facts' },
      h('span', null, cardDate(c.time)),
      h('span', null, c.region ? `Region ${c.region}` : c.kind === 'flare' ? 'No region number' : c.kind === 'sep' ? 'Fast particles' : c.speedKms ? `${Math.round(c.speedKms).toLocaleString('en-US')} km/s` : 'Solar gas'),
    ),
    h(
      'div',
      { class: 'sc-tags' },
      h('span', { class: 'tag real' }, 'Real event'),
      h('span', { class: `tag ${c.origin}` }, c.origin === 'live' ? 'Live' : 'Archive'),
      o.inSet ? h('span', { class: 'tag set' }, 'May 2024') : null,
    ),
    o.withLink && c.link ? h('a', { class: 'sc-link', href: c.link, target: '_blank', rel: 'noopener' }, 'See the NASA record') : null,
    rarity === 'epic' || rarity === 'legendary' ? h('span', { class: 'sc-foil', 'aria-hidden': 'true' }) : null,
  );
}

/** Words a screen reader hears for a card button. */
export function cardSummary(c: CardFacts, s?: StoredCard, fresh?: boolean): string {
  const bits = [`${cardTitle(c)}, ${isFarSideGiant(c) ? 'special Legendary' : RARITY_WORD[rarityOf(c)]} card`];
  if (fresh) bits.push('new');
  bits.push(cardDate(c.time));
  if (c.region) bits.push(`sunspot region ${c.region}`);
  bits.push(`real event, ${c.origin === 'live' ? 'live' : 'archive'} data`);
  if (s) {
    bits.push(s.count === 1 ? 'met once' : `met ${s.count} times`);
    if (s.shieldedCount > 0) bits.push('shielded');
  }
  return bits.join('. ') + '.';
}

/** A tiny card for a toast. */
export function miniCard(c: CardFacts): HTMLElement {
  const rarity = rarityOf(c);
  return h('span', { class: `sc-mini sc-${rarity}`, 'aria-hidden': 'true' }, artEl(c), h('b', null, bigLabel(c)));
}
