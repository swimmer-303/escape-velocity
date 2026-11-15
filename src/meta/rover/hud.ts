// Written with AI assistance (Claude Code). See README "Use of AI tools".
// The drive's heads-up display, in plain DOM and 2D canvas (no three.js): the battery gauge with its "Head home!"
// warning, samples aboard, the way home, a compass strip with the targets on it, a north-up minimap of the real
// ground, and a spoken summary for the "Read to me" button.

import { h, clear } from '../../ui/dom';
import { sampleIcon } from './icons';
import { RARITY_COLOR, RARITY_WORD, sampleKind, type Rarity } from './samples';
import { bearingTo, BATTERY, type HomeAlert, type DustDevil, devilAt } from './physics';
import { WORLD_RADIUS, type RoverSite } from './sites';
import type { Heightfield } from './terrain';

export interface HudTarget {
  x: number;
  z: number;
  kind: string;
  rarity: Rarity;
  state: 'open' | 'aboard' | 'banked';
}

export interface HudView {
  x: number;
  z: number;
  heading: number;
  battery: number;
  alert: HomeAlert;
  aboard: string[];
  targets: HudTarget[];
  devils: DustDevil[];
  time: number;
  lights: boolean;
}

const TAU = Math.PI * 2;
/** Angle difference wrapped to -PI..PI. */
export function wrapAngle(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

/** Where something is, in words: "ahead", "to your left", "behind you"... `rel` is its bearing minus your heading. */
export function directionWords(rel: number): string {
  const d = (wrapAngle(rel) * 180) / Math.PI;
  const a = Math.abs(d);
  const side = d > 0 ? 'right' : 'left';
  if (a < 20) return 'straight ahead';
  if (a < 70) return `ahead, to your ${side}`;
  if (a < 115) return `to your ${side}`;
  if (a < 160) return `behind you, to your ${side}`;
  return 'behind you';
}

export function nearestOpen(v: Pick<HudView, 'x' | 'z' | 'targets'>): { index: number; dist: number } | null {
  let best: { index: number; dist: number } | null = null;
  v.targets.forEach((t, i) => {
    if (t.state !== 'open') return;
    const d = Math.hypot(t.x - v.x, t.z - v.z);
    if (!best || d < best.dist) best = { index: i, dist: d };
  });
  return best;
}

const ALERT_WORD: Record<HomeAlert, string> = { ok: 'OK', soon: 'Plan the way home', now: 'HEAD HOME!' };

export class RoverHud {
  readonly el: HTMLElement;
  readonly warn: HTMLElement;
  readonly prompt: HTMLElement;
  private batteryBox: HTMLElement;
  private fill: HTMLElement;
  private pct: HTMLElement;
  private state: HTMLElement;
  private aboardN: HTMLElement;
  private aboardIcons: HTMLElement;
  private homeArrow: HTMLElement;
  private homeDist: HTMLElement;
  private compass: HTMLCanvasElement;
  private compassText: HTMLElement;
  private map: HTMLCanvasElement;
  private relief: HTMLCanvasElement | null = null;
  private promptBar: HTMLElement;
  private promptText: HTMLElement;
  private lastAboard = '';
  private last: HudView | null = null;

  constructor(site: RoverSite, field: Heightfield | null) {
    this.fill = h('span', { class: 'fill' });
    this.pct = h('b', null, '100%');
    this.state = h('span', { class: 'state' }, 'OK');
    this.batteryBox = h(
      'div',
      { class: 'ev-rgauge battery', 'data-state': 'ok' },
      h('span', { class: 'lbl' }, 'Battery'),
      h('span', { class: 'bar' }, this.fill),
      h('span', { class: 'val' }, this.pct, ' ', this.state),
    );
    this.aboardN = h('b', null, '0');
    this.aboardIcons = h('span', { class: 'icons' });
    this.homeArrow = h('span', { class: 'ev-rarrow', 'aria-hidden': 'true' });
    this.homeDist = h('b', null, '0 m');
    this.compass = h('canvas', { class: 'ev-rover-compass', width: 240, height: 26, 'aria-hidden': 'true' });
    this.compassText = h('span', { class: 'ev-rover-compass-text' });
    this.map = h('canvas', { class: 'ev-rover-map', width: 120, height: 120, 'aria-hidden': 'true' });
    this.warn = h('div', { class: 'ev-rover-warn', hidden: true }, 'Head home!');
    this.promptBar = h('span', { class: 'fill' });
    this.promptText = h('span', null, '');
    this.prompt = h('div', { class: 'ev-rover-prompt', hidden: true }, this.promptText, h('span', { class: 'bar' }, this.promptBar));
    this.el = h(
      'div',
      { class: 'ev-rover-hud' },
      this.batteryBox,
      h('div', { class: 'ev-rgauge aboard' }, h('span', { class: 'lbl' }, 'Samples aboard'), h('span', { class: 'val' }, this.aboardN, this.aboardIcons)),
      h('div', { class: 'ev-rgauge home' }, h('span', { class: 'lbl' }, 'Charging pad'), h('span', { class: 'val' }, this.homeArrow, this.homeDist)),
    );
    if (field) this.relief = reliefMap(field, site);
  }

  /** The compass strip and the minimap, for the game layer to place. */
  get compassEl(): HTMLElement {
    return h('div', { class: 'ev-rover-compass-box' }, this.compass, this.compassText);
  }
  get mapEl(): HTMLCanvasElement {
    return this.map;
  }

  update(v: HudView) {
    this.last = v;
    const pct = Math.max(0, Math.min(100, Math.round((v.battery / BATTERY.full) * 100)));
    this.fill.style.width = `${pct}%`;
    this.pct.textContent = `${pct}%`;
    this.state.textContent = ALERT_WORD[v.alert];
    const st = v.alert === 'now' ? 'danger' : v.alert === 'soon' ? 'warn' : 'ok';
    if (this.batteryBox.dataset.state !== st) this.batteryBox.dataset.state = st;
    this.warn.hidden = v.alert !== 'now';

    const key = v.aboard.join(',');
    if (key !== this.lastAboard) {
      this.lastAboard = key;
      this.aboardN.textContent = String(v.aboard.length);
      clear(this.aboardIcons);
      for (const id of v.aboard.slice(0, 8)) {
        const k = sampleKind(id);
        if (k) this.aboardIcons.append(sampleIcon(k, true, 18));
      }
    }

    const dHome = Math.hypot(v.x, v.z);
    this.homeDist.textContent = `${Math.round(dHome)} m`;
    const relHome = wrapAngle(bearingTo(v.x, v.z, 0, 0) - v.heading);
    this.homeArrow.style.transform = `rotate(${dHome < 1 ? 0 : (relHome * 180) / Math.PI}deg)`;

    this.drawCompass(v);
    this.drawMap(v);
  }

  /** Show the scan prompt (null hides it). */
  setPrompt(text: string | null, progress = 0) {
    this.prompt.hidden = text === null;
    if (text === null) return;
    if (this.promptText.textContent !== text) this.promptText.textContent = text;
    this.promptBar.style.width = `${Math.round(progress * 100)}%`;
  }

  private drawCompass(v: HudView) {
    const g = this.compass.getContext?.('2d');
    const near = nearestOpen(v);
    const t = near ? v.targets[near.index] : null;
    // A no-break space keeps "156 m" together when the caption wraps on a phone.
    const text = t ? `${sampleKind(t.kind)?.name ?? 'Target'}: ${Math.round(near!.dist)}\u00a0m` : v.aboard.length ? 'All targets aboard. Head home!' : 'No targets left today';
    if (this.compassText.textContent !== text) this.compassText.textContent = text;
    if (!g) return;
    const W = this.compass.width;
    const H = this.compass.height;
    g.clearRect(0, 0, W, H);
    g.fillStyle = 'rgba(21,18,43,0.85)';
    g.fillRect(0, 0, W, H);
    const span = Math.PI * 0.6; // half the strip, radians
    const xOf = (bearing: number) => W / 2 + (wrapAngle(bearing - v.heading) / span) * (W / 2);
    g.font = '10px monospace';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const letters: Array<[string, number]> = [['N', 0], ['E', TAU / 4], ['S', TAU / 2], ['W', (3 * TAU) / 4]];
    for (let k = 0; k < 24; k++) {
      const b = (k / 24) * TAU;
      const x = xOf(b);
      if (x < 0 || x > W) continue;
      g.fillStyle = '#4a3f7a';
      g.fillRect(Math.round(x), H - 6, 1, 4);
    }
    for (const [l, b] of letters) {
      const x = xOf(b);
      if (x < 4 || x > W - 4) continue;
      g.fillStyle = l === 'N' ? '#ff5a4f' : '#c2b59b';
      g.fillText(l, Math.round(x), 8);
    }
    // Home, then targets (the nearest drawn last, biggest).
    const mark = (bearing: number, color: string, size: number, shape: 'square' | 'diamond') => {
      let x = xOf(bearing);
      const off = x < 3 || x > W - 3;
      x = Math.max(3, Math.min(W - 3, x));
      g.fillStyle = color;
      const y = 18;
      if (shape === 'square') g.fillRect(Math.round(x - size / 2), y - size / 2, size, size);
      else {
        g.beginPath();
        g.moveTo(x, y - size / 2 - 1);
        g.lineTo(x + size / 2 + 1, y);
        g.lineTo(x, y + size / 2 + 1);
        g.lineTo(x - size / 2 - 1, y);
        g.fill();
      }
      if (off) g.fillRect(Math.round(x) - 1, 2, 2, 2);
    };
    mark(bearingTo(v.x, v.z, 0, 0), '#5ef2e6', 6, 'square');
    v.targets.forEach((tt, i) => {
      if (tt.state === 'open' && (!near || i !== near.index)) mark(bearingTo(v.x, v.z, tt.x, tt.z), RARITY_COLOR[tt.rarity], 5, 'diamond');
    });
    if (t) mark(bearingTo(v.x, v.z, t.x, t.z), RARITY_COLOR[t.rarity], 9, 'diamond');
    g.fillStyle = '#ffffff';
    g.fillRect(W / 2 - 1, 0, 2, 4);
  }

  private drawMap(v: HudView) {
    const g = this.map.getContext?.('2d');
    if (!g) return;
    const W = this.map.width;
    const R = W / 2 - 2;
    const toMap = (x: number, z: number): [number, number] => [W / 2 + (-x / WORLD_RADIUS) * R, W / 2 - (z / WORLD_RADIUS) * R];
    g.clearRect(0, 0, W, W);
    if (this.relief) g.drawImage(this.relief, 0, 0, W, W);
    else {
      g.fillStyle = '#211b40';
      g.fillRect(0, 0, W, W);
    }
    // Dust devils.
    for (const d of v.devils) {
      const p = devilAt(d, v.time);
      const [x, y] = toMap(p.x, p.z);
      g.strokeStyle = '#ffb627';
      g.lineWidth = 1;
      g.beginPath();
      g.arc(x, y, 3, 0, TAU);
      g.stroke();
    }
    // Pad.
    const [px, py] = toMap(0, 0);
    g.fillStyle = '#5ef2e6';
    g.fillRect(Math.round(px - 3), Math.round(py - 3), 6, 6);
    // Targets: open ones as rarity-colored diamonds with a dark edge.
    for (const t of v.targets) {
      if (t.state !== 'open') continue;
      const [x, y] = toMap(t.x, t.z);
      g.fillStyle = '#000000';
      g.beginPath();
      g.moveTo(x, y - 5);
      g.lineTo(x + 5, y);
      g.lineTo(x, y + 5);
      g.lineTo(x - 5, y);
      g.fill();
      g.fillStyle = RARITY_COLOR[t.rarity];
      g.beginPath();
      g.moveTo(x, y - 3.5);
      g.lineTo(x + 3.5, y);
      g.lineTo(x, y + 3.5);
      g.lineTo(x - 3.5, y);
      g.fill();
    }
    // The rover: a white arrow pointing where it is heading.
    const [rx, ry] = toMap(v.x, v.z);
    const a = v.heading; // screen: north up, east right
    const fx = Math.sin(a);
    const fy = -Math.cos(a);
    g.fillStyle = '#ffffff';
    g.strokeStyle = '#000000';
    g.beginPath();
    g.moveTo(rx + fx * 6, ry + fy * 6);
    g.lineTo(rx - fx * 4 - fy * 4, ry - fy * 4 + fx * 4);
    g.lineTo(rx - fx * 4 + fy * 4, ry - fy * 4 - fx * 4);
    g.closePath();
    g.fill();
    g.stroke();
    g.fillStyle = '#f4ead8';
    g.font = '9px monospace';
    g.fillText('N', W / 2 - 3, 9);
  }

  /** Everything on the HUD in words, for "Read to me" and screen readers. */
  summary(): string {
    const v = this.last;
    if (!v) return '';
    const pct = Math.round((v.battery / BATTERY.full) * 100);
    const parts = [`Battery ${pct} percent${v.alert === 'now' ? '. Head home now!' : v.alert === 'soon' ? '. Start planning the way home.' : '.'}`];
    parts.push(`${v.aboard.length} ${v.aboard.length === 1 ? 'sample' : 'samples'} aboard.`);
    const near = nearestOpen(v);
    if (near) {
      const t = v.targets[near.index];
      const rel = bearingTo(v.x, v.z, t.x, t.z) - v.heading;
      parts.push(`Nearest target: ${sampleKind(t.kind)?.name ?? 'a sample'}, ${RARITY_WORD[t.rarity]}, ${Math.round(near.dist)} meters, ${directionWords(rel)}.`);
    } else parts.push('No targets left to find today.');
    const dHome = Math.hypot(v.x, v.z);
    if (dHome > 12) parts.push(`The charging pad is ${Math.round(dHome)} meters away, ${directionWords(bearingTo(v.x, v.z, 0, 0) - v.heading)}.`);
    else parts.push('You are at the charging pad.');
    return parts.join(' ');
  }
}

/** A small shaded-relief picture of the real ground for the minimap (drawn once). */
export function reliefMap(field: Heightfield, site: RoverSite, size = 120): HTMLCanvasElement | null {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const g = c.getContext?.('2d');
  if (!g) return null;
  const img = g.createImageData(size, size);
  const base = site === 'moon' ? [120, 118, 114] : site === 'arcadia' ? [150, 96, 70] : [160, 80, 44];
  const R = size / 2 - 2;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const i = (py * size + px) * 4;
      const dx = (px - size / 2) / R;
      const dy = (py - size / 2) / R;
      const inside = dx * dx + dy * dy <= 1;
      const x = -dx * WORLD_RADIUS;
      const z = -dy * WORLD_RADIUS;
      let shade = 0.25;
      if (inside) {
        // Light from the north-west, like most shaded-relief maps.
        const e = (field.height(x - 8, z) - field.height(x + 8, z)) / 16;
        const n = (field.height(x, z + 8) - field.height(x, z - 8)) / 16;
        shade = Math.max(0.35, Math.min(1.25, 0.8 + (e - n) * 2.2 + field.height(x, z) * 0.004));
      }
      img.data[i] = Math.min(255, base[0] * shade);
      img.data[i + 1] = Math.min(255, base[1] * shade);
      img.data[i + 2] = Math.min(255, base[2] * shade);
      img.data[i + 3] = inside ? 235 : 0;
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}
