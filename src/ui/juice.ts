// Written with AI assistance (Claude Code). See README "Use of AI tools".
// Game feel ("juice"): small, quick effects that make every action answer back.
// - A cell popping into a slot: a bounce, a little burst of sparks, a floating "+1", and a click that climbs the
//   scale when cells are placed one after another.
// - HUD meters that glide to their new values, and flash when a plan crosses into (or out of) the danger zone.
// - Storm hits (a red edge on the screen), the shelter holding (a cyan shield edge), good-news sparkle,
//   count-up numbers, and crew speech bubbles.
// Every effect checks reduced motion: then nothing moves or flashes (numbers and words still appear).
// The effect layer and its sparks are made once and reused (no new elements per frame), and nothing here runs per frame
// except a count-up while it counts.

import './juice.css';
import { h } from './dom';

// ------------------------------------------------------------------ the shared layer
const SPARKS = 24;
let layer: HTMLElement | null = null;
let sparks: HTMLElement[] = [];
let nextSpark = 0;
let vignetteEl: HTMLElement | null = null;

function getLayer(): HTMLElement {
  if (layer && layer.isConnected) return layer;
  layer = h('div', { class: 'juice-layer', 'aria-hidden': 'true' });
  sparks = Array.from({ length: SPARKS }, () => h('span', { class: 'juice-spark' }));
  layer.append(...sparks);
  vignetteEl = h('div', { class: 'juice-vignette' });
  layer.append(vignetteEl);
  document.body.append(layer);
  return layer;
}

/** Restart a CSS animation class on an element (remove it, let the browser notice, add it again). */
function restart(el: HTMLElement, cls: string) {
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
}

function center(el: Element): { x: number; y: number } {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

// Every effect is a CSS animation (juice.css): the browser runs it off the main loop, and the
// global reduced-motion rule in style.css switches all of them off.

/** A small burst of square sparks from a point on screen (reused spark elements; nothing new is made). */
export function burst(x: number, y: number, opts: { count?: number; colors?: string[]; spread?: number; reduced: boolean }) {
  if (opts.reduced) return;
  getLayer();
  const n = Math.min(SPARKS, opts.count ?? 8);
  const colors = opts.colors ?? ['#ffb627', '#ffe7a8', '#5ef2e6'];
  const spread = opts.spread ?? 34;
  const used: HTMLElement[] = [];
  for (let i = 0; i < n; i++) {
    const s = sparks[nextSpark];
    nextSpark = (nextSpark + 1) % SPARKS;
    const a = (i / n) * Math.PI * 2 + Math.random() * 0.6;
    const d = spread * (0.6 + Math.random() * 0.6);
    s.classList.remove('go');
    s.style.left = `${x}px`;
    s.style.top = `${y}px`;
    s.style.background = colors[i % colors.length];
    s.style.setProperty('--dx', `${Math.round(Math.cos(a) * d)}px`);
    s.style.setProperty('--dy', `${Math.round(Math.sin(a) * d)}px`);
    used.push(s);
  }
  // One layout read for the whole burst (not one per spark), then every spark flies.
  if (used.length) void used[0].offsetWidth;
  for (const s of used) s.classList.add('go');
}

/** Floating words ("+1", "TANK FULL!", "SHELTER HELD!") that rise and fade. With reduced motion they stay still. */
export function floatText(x: number, y: number, text: string, opts: { tone?: 'amber' | 'cyan' | 'green' | 'red' | 'gold'; big?: boolean; reduced: boolean }) {
  const host = getLayer();
  // Keep it tidy: at most a few words on screen at once.
  const words = host.querySelectorAll('.juice-float');
  if (words.length >= 6) words[0].remove();
  const el = h('span', { class: `juice-float tone-${opts.tone ?? 'amber'}${opts.big ? ' big' : ''}${opts.reduced ? ' still' : ' rise'}` }, text);
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  host.append(el);
  window.setTimeout(() => el.remove(), opts.big ? 1400 : 900);
}

/** A quick squash-and-stretch bounce on an element (nothing with reduced motion). */
export function bounce(el: Element | null | undefined, reduced: boolean, big = false) {
  if (!el || reduced) return;
  const e = el as HTMLElement;
  restart(e, big ? 'j-bounce-big' : 'j-bounce');
  window.setTimeout(() => e.classList.remove('j-bounce', 'j-bounce-big'), 320);
}

/** A cell lands in a slot: bounce, sparks, "+1". */
export function popCell(el: Element | null | undefined, reduced: boolean) {
  if (!el) return;
  bounce(el, reduced, true);
  const c = center(el);
  burst(c.x, c.y, { count: 8, reduced });
  floatText(c.x, c.y - 14, '+1', { tone: 'amber', reduced });
}

/** Good news: a gold and cyan sparkle around an element (or the middle of the screen). */
export function sparkle(el: Element | null | undefined, reduced: boolean, label?: string) {
  const c = el ? center(el) : { x: window.innerWidth / 2, y: window.innerHeight * 0.4 };
  burst(c.x, c.y, { count: 14, spread: 60, colors: ['#ffd84a', '#5ef2e6', '#ffffff'], reduced });
  if (label) floatText(c.x, c.y - 10, label, { tone: 'gold', big: true, reduced });
}

/**
 * The screen's edge glows for a moment: red when a storm hits the crew, cyan when the shelter blocks it.
 * One slow pulse (well under 3 flashes a second); never with reduced motion.
 */
export function vignette(kind: 'storm' | 'shield', reduced: boolean) {
  if (reduced) return;
  getLayer();
  const v = vignetteEl!;
  v.classList.remove('storm', 'shield');
  v.classList.add(kind);
  restart(v, 'pulse');
}

// ------------------------------------------------------------------ placing cells
/** Cells placed one after another climb the scale (a semitone each, up an octave), then it resets after a pause. */
export class PlaceCombo {
  private step = 0;
  private last = -Infinity;
  /** The pitch for the next placement (1 = normal). */
  next(now = performance.now()): number {
    this.step = now - this.last < 1400 ? Math.min(12, this.step + 1) : 0;
    this.last = now;
    return Math.pow(2, this.step / 12);
  }
  reset() {
    this.step = 0;
    this.last = -Infinity;
  }
}

// ------------------------------------------------------------------ the HUD
const prevWidths = new Map<string, string>();

/**
 * The HUD is redrawn from scratch on every change: glide each bar from where it was to its new width.
 * Call right after a redraw (not while a sol plays: those frames move on their own).
 */
export function easeMeters(root: HTMLElement, reduced: boolean) {
  const bars = root.querySelectorAll<HTMLElement>('.meter .fill, .meter .ghost');
  if (!bars.length) {
    prevWidths.clear();
    return;
  }
  const seen = new Map<string, number>();
  const moving: Array<{ el: HTMLElement; to: string }> = [];
  bars.forEach((el) => {
    const meter = el.closest('.meter');
    const kind = (meter?.className.match(/\b(power|life|dose|fuel)\b/) ?? ['', 'x'])[1];
    const part = `${kind}:${el.classList.contains('ghost') ? 'g' : 'f'}:${el.classList.contains('air') ? 'a' : el.classList.contains('food') ? 'o' : ''}`;
    const n = seen.get(part) ?? 0;
    seen.set(part, n + 1);
    const key = `${part}:${n}`;
    const to = el.style.width;
    const from = prevWidths.get(key);
    prevWidths.set(key, to);
    if (reduced || !from || from === to) return;
    // The bars have a stepped CSS width transition (style.css): start from the old width, then let it glide.
    el.style.width = from;
    moving.push({ el, to });
  });
  if (!moving.length) return;
  void moving[0].el.offsetWidth; // one layout read for all the bars
  for (const m of moving) m.el.style.width = m.to;
}

/** Forget the last widths (a new mission starts from scratch). */
export function resetMeters() {
  prevWidths.clear();
}

export interface MeterSnapshot {
  life: number;
  dose: number;
  fuel: number;
}

/**
 * Which meters a plan change just pushed across a line: life support under 1 day (red), the dose over 75% of the
 * budget (red), or a full fuel tank (good). Returns the meters to flash and how.
 */
export function crossings(before: MeterSnapshot | null, after: MeterSnapshot, doseBudget: number): Array<{ meter: 'life' | 'dose' | 'fuel'; tone: 'good' | 'bad' }> {
  if (!before) return [];
  const out: Array<{ meter: 'life' | 'dose' | 'fuel'; tone: 'good' | 'bad' }> = [];
  const lifeLine = 1;
  if (before.life >= lifeLine && after.life < lifeLine) out.push({ meter: 'life', tone: 'bad' });
  else if (before.life < lifeLine && after.life >= lifeLine) out.push({ meter: 'life', tone: 'good' });
  const doseLine = doseBudget * 0.75;
  if (before.dose <= doseLine && after.dose > doseLine) out.push({ meter: 'dose', tone: 'bad' });
  else if (before.dose > doseLine && after.dose <= doseLine) out.push({ meter: 'dose', tone: 'good' });
  if (before.fuel < 100 && after.fuel >= 100) out.push({ meter: 'fuel', tone: 'good' });
  return out;
}

/** Flash one HUD meter (a glow that fades; with reduced motion, a steady outline for a moment). */
export function flashMeter(root: HTMLElement, meter: string, tone: 'good' | 'bad') {
  const el = root.querySelector<HTMLElement>(`.meter.${meter}`);
  if (!el) return;
  el.classList.remove('jflash-good', 'jflash-bad');
  // Restart the animation: read layout once so the class change counts as new.
  void el.offsetWidth;
  el.classList.add(`jflash-${tone}`);
}

// ------------------------------------------------------------------ numbers that count up
/**
 * Count a number up in an element, about 30 steps a second (plenty for numbers, and lighter than every frame).
 * With reduced motion, or a length of 0, it shows the end value at once.
 */
export function countUp(el: HTMLElement, to: number, opts: { from?: number; ms?: number; format?: (n: number) => string; reduced: boolean; onTick?: () => void; onDone?: () => void }) {
  const fmt = opts.format ?? ((n: number) => Math.round(n).toLocaleString('en-US'));
  const from = opts.from ?? 0;
  const ms = opts.ms ?? 900;
  if (opts.reduced || ms <= 0) {
    el.textContent = fmt(to);
    opts.onDone?.();
    return;
  }
  const start = performance.now();
  let lastTick = 0;
  el.textContent = fmt(from);
  const step = () => {
    if (!el.isConnected && performance.now() - start > 50) return;
    const now = performance.now();
    const k = Math.min(1, (now - start) / ms);
    const e = 1 - Math.pow(1 - k, 3);
    el.textContent = fmt(from + (to - from) * e);
    if (opts.onTick && now - lastTick > 70 && k < 1) {
      lastTick = now;
      opts.onTick();
    }
    if (k < 1) window.setTimeout(step, 33);
    else opts.onDone?.();
  };
  window.setTimeout(step, 33);
}

// ------------------------------------------------------------------ crew bubbles
let bubbleHost: HTMLElement | null = null;

/** A crew member says something during the sol: a portrait and a short line, over the 3D view, for a few seconds. */
export function crewBubble(portrait: HTMLElement | null, name: string, text: string, opts: { reduced: boolean; ms?: number }) {
  if (!bubbleHost || !bubbleHost.isConnected) {
    bubbleHost = h('div', { class: 'crew-bubbles', role: 'status', 'aria-live': 'polite' });
    document.body.append(bubbleHost);
  }
  // Keep it to two at a time.
  while (bubbleHost.children.length >= 2) bubbleHost.firstElementChild!.remove();
  const b = h('div', { class: `crew-bubble${opts.reduced ? ' still' : ''}` }, portrait, h('div', { class: 'crew-bubble-text' }, h('b', null, name), h('span', null, text)));
  bubbleHost.append(b);
  window.setTimeout(() => {
    b.classList.add('out');
    window.setTimeout(() => b.remove(), 300);
  }, opts.ms ?? 2600);
}

/** Take every crew bubble away (leaving the sol early). */
export function clearCrewBubbles() {
  bubbleHost?.replaceChildren();
}
