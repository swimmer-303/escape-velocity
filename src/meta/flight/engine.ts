// Written with AI assistance (Claude Code). See README "Use of AI tools".
// The small engine both flight mini-games share: a full-screen layer with a chunky pixel canvas, keyboard, mouse and
// touch controls, a fixed-step game loop, a HUD strip, a centered card for the how-to and results screens, a big
// caption for key moments (also read out by screen readers), screen shake, particles and quiet sounds.
// Everything it starts (listeners, the animation frame, sound) is undone by destroy().

import './flight.css';
import { h, clear, prefersReducedMotion, type Child } from '../../ui/dom';
import type { Sfx } from '../../ui/audio';
import { decorateDialog } from '../../ui/access';
import { reader } from '../../ui/voice';
import type { FlightInput } from './physics';

export interface FlightSound {
  sfx(name: Sfx): void;
  muted?: boolean;
  /** The Settings dialog's sound mix: the rumble follows the effects slider (60 = as loud as before it existed). */
  levels?: { sfxVolume: number };
}

export const ABORT = Symbol('flight-abort');
export type Abort = typeof ABORT;

export interface ShellOptions {
  /** The layer to draw in. It is cleared when the shell is destroyed. */
  root: HTMLElement;
  label: string;
  audio: FlightSound | null;
  reducedMotion: boolean;
  /** Parts of the page behind the game to make inert while it is open. */
  inert?: Array<HTMLElement | null>;
}

export interface Loop {
  update(dt: number): void;
  draw(): void;
}

export interface PanelButton<T extends string> {
  id: T;
  label: string;
  primary?: boolean;
}

/** Fixed simulation step, seconds. */
export const STEP = 1 / 60;

const THRUST_KEYS = new Set([' ', 'Spacebar', 'ArrowUp', 'w', 'W']);
const LEFT_KEYS = new Set(['ArrowLeft', 'a', 'A']);
const RIGHT_KEYS = new Set(['ArrowRight', 'd', 'D']);
type Ctl = 'thrust' | 'left' | 'right';

function ctlOf(key: string): Ctl | null {
  if (THRUST_KEYS.has(key)) return 'thrust';
  if (LEFT_KEYS.has(key)) return 'left';
  if (RIGHT_KEYS.has(key)) return 'right';
  return null;
}

function isInteractive(t: EventTarget | null): boolean {
  // The on-screen flight buttons don't count: Space still fires the engine after tapping them.
  return t instanceof HTMLElement && !!t.closest('button:not(.ev-flight-ctl), a, input, select, textarea, [contenteditable="true"]');
}

export function reducedMotionWanted(flag: boolean): boolean {
  try {
    return flag || prefersReducedMotion() || document.documentElement.classList.contains('reduce-motion');
  } catch {
    return flag;
  }
}

// ------------------------------------------------------------------ particles
export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  color: string;
  size: number;
  /** Downward pull (in the game's own units per second squared). */
  fall: number;
}

export class Particles {
  list: Particle[] = [];
  constructor(private readonly cap = 260) {}
  add(p: Omit<Particle, 'max'>) {
    if (this.list.length >= this.cap) this.list.shift();
    this.list.push({ ...p, max: p.life });
  }
  update(dt: number) {
    for (const p of this.list) {
      p.life -= dt;
      p.vy += p.fall * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
    this.list = this.list.filter((p) => p.life > 0);
  }
  /** Draw with a function that maps the particle's units to canvas pixels. */
  draw(g: CanvasRenderingContext2D, toScreen: (x: number, y: number) => [number, number]) {
    for (const p of this.list) {
      const [sx, sy] = toScreen(p.x, p.y);
      const s = Math.max(1, Math.round(p.size * (0.5 + 0.5 * (p.life / p.max))));
      g.fillStyle = p.color;
      g.fillRect(Math.round(sx - s / 2), Math.round(sy - s / 2), s, s);
    }
  }
}

// ------------------------------------------------------------------ engine sound
/** A quiet rocket rumble: filtered noise whose volume follows the throttle. */
class Rumble {
  private ctx?: AudioContext;
  private gain?: GainNode;
  private src?: AudioBufferSourceNode;
  private failed = false;
  private level = 0;

  /** `level` 0-1 follows the throttle; `scale` is the effects volume (1 at the default slider position). */
  set(throttle: number, scale = 1) {
    const level = Math.max(0, Math.min(1, throttle)) * Math.max(0, Math.min(2, scale));
    if (this.failed) return;
    if (level <= 0 && !this.ctx) return;
    if (this.ctx && Math.abs(level - this.level) < 0.01) return;
    this.level = level;
    try {
      if (!this.ctx) {
        const AC = (window as unknown as { AudioContext?: typeof AudioContext }).AudioContext;
        if (!AC) {
          this.failed = true;
          return;
        }
        const ctx = new AC();
        const buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
        const d = buf.getChannelData(0);
        let last = 0;
        for (let i = 0; i < d.length; i++) {
          // Brown-ish noise: a deep rumble rather than a hiss.
          last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
          d[i] = last * 3.5;
        }
        const src = ctx.createBufferSource();
        src.buffer = buf;
        src.loop = true;
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 420;
        const gain = ctx.createGain();
        gain.gain.value = 0;
        src.connect(filter).connect(gain).connect(ctx.destination);
        src.start();
        this.ctx = ctx;
        this.gain = gain;
        this.src = src;
      }
      this.gain!.gain.setTargetAtTime(level * 0.07, this.ctx.currentTime, 0.05);
    } catch {
      this.failed = true;
    }
  }

  stop() {
    try {
      this.src?.stop();
    } catch {
      /* already stopped */
    }
    try {
      void this.ctx?.close();
    } catch {
      /* nothing to close */
    }
    this.ctx = undefined;
    this.gain = undefined;
    this.src = undefined;
    this.level = 0;
  }
}

// ------------------------------------------------------------------ the shell
export class FlightShell {
  readonly el: HTMLElement;
  readonly canvas: HTMLCanvasElement;
  readonly g: CanvasRenderingContext2D | null;
  readonly hud: HTMLElement;
  readonly caption: HTMLElement;
  readonly panel: HTMLElement;
  readonly controls: HTMLElement;
  readonly live: HTMLElement;
  readonly skipBtn: HTMLButtonElement;
  readonly reduced: boolean;
  readonly input: FlightInput = { thrust: false, left: false, right: false };
  /** Resolves when the player skips, or when something goes wrong: the game then ends quietly. */
  readonly aborted: Promise<Abort>;
  /** Canvas size in game pixels, and how many screen pixels each one covers. */
  W = 320;
  H = 180;
  scale = 4;
  /** Seconds the game has been running (not counting pauses). */
  time = 0;
  paused = false;
  destroyed = false;
  shakeX = 0;
  shakeY = 0;
  onResize?: () => void;

  private abortFn: (a: Abort) => void = () => {};
  private cleanups: Array<() => void> = [];
  private loop?: Loop;
  private rafId = 0;
  private usingTimeout = false;
  private last = -1;
  private acc = 0;
  private shakeAmt = 0;
  private keys = new Set<Ctl>();
  private pointers = new Map<number, Ctl>();
  private rumble = new Rumble();
  private captionTimer = 0;
  private inertEls: Array<{ el: HTMLElement; had: boolean }> = [];
  private readonly root: HTMLElement;
  private readonly audio: FlightSound | null;

  constructor(opts: ShellOptions) {
    this.root = opts.root;
    this.audio = opts.audio;
    this.reduced = reducedMotionWanted(opts.reducedMotion);
    this.aborted = new Promise<Abort>((res) => (this.abortFn = res));

    this.canvas = h('canvas', { class: 'ev-flight-canvas', 'aria-hidden': 'true' });
    let g: CanvasRenderingContext2D | null = null;
    try {
      g = this.canvas.getContext('2d');
    } catch {
      g = null;
    }
    this.g = g;
    this.hud = h('div', { class: 'ev-flight-hud' });
    this.skipBtn = h(
      'button',
      { class: 'btn ev-flight-skip', type: 'button', 'aria-label': 'Skip (Escape key)', 'aria-keyshortcuts': 'Escape' },
      'Skip',
      h('span', { class: 'ev-flight-key', 'aria-hidden': 'true' }, 'Esc'),
    );
    this.skipBtn.addEventListener('click', () => this.skip());
    this.caption = h('div', { class: 'ev-flight-caption', 'aria-hidden': 'true' });
    this.panel = h('div', { class: 'ev-flight-panel', hidden: true });
    this.controls = h('div', { class: 'ev-flight-controls', hidden: true });
    this.live = h('div', { class: 'sr-only', role: 'status', 'aria-live': 'polite' });
    this.el = h(
      'div',
      { class: `ev-flight${this.reduced ? ' calm' : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': opts.label, tabindex: '-1' },
      this.canvas,
      h('div', { class: 'ev-flight-top' }, this.hud, this.skipBtn),
      this.caption,
      this.controls,
      this.panel,
      this.live,
    );

    clear(this.root);
    this.root.append(this.el);
    for (const el of opts.inert ?? []) {
      if (!el || el === this.root || el.contains(this.root)) continue;
      this.inertEls.push({ el, had: el.hasAttribute('inert') });
      el.setAttribute('inert', '');
    }

    this.listen(window, 'keydown', (e) => this.onKey(e as KeyboardEvent, true));
    this.listen(window, 'keyup', (e) => this.onKey(e as KeyboardEvent, false));
    this.listen(window, 'blur', () => this.releaseAll());
    this.listen(window, 'resize', () => this.resize());
    this.listen(window, 'pointerup', (e) => this.pointerUp(e as PointerEvent));
    this.listen(window, 'pointercancel', (e) => this.pointerUp(e as PointerEvent));
    this.listen(document, 'visibilitychange', () => this.onVisibility());
    this.listen(this.el, 'contextmenu', (e) => e.preventDefault());
    // Holding anywhere on the picture fires the engine (phones and tablets).
    this.listen(this.canvas, 'pointerdown', (e) => this.pointerDown(e as PointerEvent, 'thrust'));
    this.resize();
  }

  // ---------------------------------------------------------------- lifecycle
  private listen(target: EventTarget, type: string, fn: (e: Event) => void, opts?: AddEventListenerOptions) {
    target.addEventListener(type, fn, opts);
    this.cleanups.push(() => target.removeEventListener(type, fn, opts));
  }

  skip() {
    if (this.destroyed) return;
    this.sfx('click');
    this.abortFn(ABORT);
  }

  /** Something broke: end the mini-game quietly (the mission carries on). */
  fail(e: unknown) {
    console.error('[flight] mini-game error', e);
    this.abortFn(ABORT);
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.stop();
    for (const fn of this.cleanups.splice(0)) {
      try {
        fn();
      } catch {
        /* keep cleaning */
      }
    }
    window.clearTimeout(this.captionTimer);
    this.rumble.stop();
    this.stopReading();
    for (const { el, had } of this.inertEls) if (!had) el.removeAttribute('inert');
    this.inertEls = [];
    this.el.remove();
    clear(this.root);
    this.abortFn(ABORT);
  }

  // ---------------------------------------------------------------- canvas size
  resize() {
    const w = this.el.clientWidth || window.innerWidth || 960;
    const hgt = this.el.clientHeight || window.innerHeight || 540;
    // Chunky pixels: each game pixel covers 2 to 6 screen pixels, about 320 x 200 game pixels on a laptop.
    this.scale = Math.max(2, Math.min(6, Math.round(Math.min(w / 320, hgt / 200))));
    this.W = Math.max(120, Math.ceil(w / this.scale));
    this.H = Math.max(120, Math.ceil(hgt / this.scale));
    this.canvas.width = this.W;
    this.canvas.height = this.H;
    if (this.g) this.g.imageSmoothingEnabled = false;
    this.onResize?.();
  }

  // ---------------------------------------------------------------- loop
  start(loop: Loop) {
    this.loop = loop;
    this.last = -1;
    this.acc = 0;
    this.schedule();
  }

  stop() {
    this.loop = undefined;
    if (this.rafId) {
      if (this.usingTimeout) window.clearTimeout(this.rafId);
      else window.cancelAnimationFrame?.(this.rafId);
    }
    this.rafId = 0;
    this.rumble.set(0);
  }

  private schedule() {
    if (this.destroyed || !this.loop || this.rafId) return;
    if (typeof window.requestAnimationFrame === 'function') {
      this.usingTimeout = false;
      this.rafId = window.requestAnimationFrame(this.frame);
    } else {
      this.usingTimeout = true;
      this.rafId = window.setTimeout(() => this.frame(performance.now()), 16);
    }
  }

  private frame = (now: number) => {
    this.rafId = 0;
    if (this.destroyed || !this.loop) return;
    try {
      if (this.last < 0) this.last = now;
      let dt = (now - this.last) / 1000;
      this.last = now;
      if (!(dt >= 0)) dt = 0;
      dt = Math.min(dt, 0.1);
      if (!this.paused) {
        this.acc += dt;
        while (this.acc >= STEP - 1e-9 && this.loop) {
          this.acc -= STEP;
          this.time += STEP;
          this.loop.update(STEP);
        }
        this.shakeAmt *= Math.pow(0.004, dt);
        if (this.shakeAmt < 0.3) this.shakeAmt = 0;
        this.shakeX = this.shakeAmt ? Math.round((Math.random() * 2 - 1) * this.shakeAmt) : 0;
        this.shakeY = this.shakeAmt ? Math.round((Math.random() * 2 - 1) * this.shakeAmt) : 0;
      }
      this.loop?.draw();
    } catch (e) {
      this.stop();
      this.fail(e);
      return;
    }
    this.schedule();
  };

  private onVisibility() {
    const hidden = document.visibilityState === 'hidden';
    this.paused = hidden;
    this.last = -1;
    if (hidden) {
      this.releaseAll();
      this.rumble.set(0);
    }
  }

  // ---------------------------------------------------------------- input
  private onKey(e: KeyboardEvent, down: boolean) {
    if (this.destroyed) return;
    if (down && e.key === 'Escape') {
      e.preventDefault();
      this.skip();
      return;
    }
    // A key still held from the flight (Space through touchdown) must not auto-repeat into the results card's button.
    if (down && e.repeat && !this.panel.hidden && (e.key === ' ' || e.key === 'Enter' || e.key === 'Spacebar')) {
      e.preventDefault();
      return;
    }
    const ctl = ctlOf(e.key);
    if (!ctl) return;
    if (!down) {
      this.keys.delete(ctl);
      this.sync();
      return;
    }
    // Only while flying (not on the how-to or results card), and never steal Space from a focused button.
    if (!this.loop || !this.panel.hidden) return;
    if (ctl === 'thrust' && e.key !== 'ArrowUp' && isInteractive(e.target)) return;
    e.preventDefault();
    this.keys.add(ctl);
    this.sync();
  }

  private pointerDown(e: PointerEvent, ctl: Ctl) {
    if (!this.loop || !this.panel.hidden) return;
    e.preventDefault();
    this.pointers.set(e.pointerId, ctl);
    try {
      (e.currentTarget as Element | null)?.setPointerCapture?.(e.pointerId);
    } catch {
      /* capture is optional */
    }
    this.sync();
  }

  private pointerUp(e: PointerEvent) {
    if (this.pointers.delete(e.pointerId)) this.sync();
  }

  private releaseAll() {
    this.keys.clear();
    this.pointers.clear();
    this.sync();
  }

  private sync() {
    const held = (c: Ctl) => this.keys.has(c) || [...this.pointers.values()].includes(c);
    this.input.thrust = held('thrust');
    this.input.left = held('left');
    this.input.right = held('right');
    for (const b of this.controls.querySelectorAll<HTMLElement>('[data-ctl]')) b.classList.toggle('pressed', held(b.dataset.ctl as Ctl));
  }

  /** Big on-screen buttons for touch screens and mice: left, right and the engine. */
  showControls(labels: { left: string; right: string; thrust: string }) {
    clear(this.controls);
    const mk = (ctl: Ctl, text: string, cls: string) => {
      const b = h('button', { class: `btn ev-flight-ctl ${cls}`, type: 'button', tabindex: '-1', 'data-ctl': ctl, 'aria-label': text }, text);
      b.addEventListener('pointerdown', (e) => this.pointerDown(e, ctl));
      // Don't move keyboard focus to the button on a mouse click.
      b.addEventListener('mousedown', (e) => e.preventDefault());
      b.addEventListener('lostpointercapture', (e) => this.pointerUp(e));
      // The keyboard has its own keys: a click (Enter on a focused button) does nothing here.
      return b;
    };
    this.controls.append(
      h('div', { class: 'ev-flight-steer' }, mk('left', labels.left, 'left'), mk('right', labels.right, 'right')),
      mk('thrust', labels.thrust, 'thrust'),
    );
    this.controls.hidden = false;
  }

  hideControls() {
    this.controls.hidden = true;
    this.releaseAll();
  }

  // ---------------------------------------------------------------- panel, caption, HUD
  setHud(content: Child) {
    clear(this.hud);
    if (content instanceof Node) this.hud.append(content);
  }

  /** Show the centered card and wait for one of its buttons (or Skip). */
  choose<T extends string>(content: Child, buttons: Array<PanelButton<T>>, label: string): Promise<T | Abort> {
    this.hideControls();
    this.unsay();
    this.engine(0);
    clear(this.panel);
    const box = h('div', { class: 'ev-flight-card', role: 'group', 'aria-label': label });
    const row = h('div', { class: 'ev-flight-actions' });
    const picked = new Promise<T>((resolve) => {
      for (const b of buttons) {
        row.append(
          h(
            'button',
            {
              class: `btn ${b.primary ? 'primary' : ''}`,
              type: 'button',
              'data-flight': b.id,
              'data-autofocus': b.primary ? true : undefined,
              onclick: () => {
                this.sfx('click');
                resolve(b.id);
              },
            },
            b.label,
            b.primary ? h('span', { class: 'arrow' }) : null,
          ),
        );
      }
    });
    if (content instanceof Node) box.append(content);
    else if (Array.isArray(content)) for (const c of content) if (c instanceof Node) box.append(c);
    box.append(row);
    this.panel.append(box);
    this.panel.hidden = false;
    this.el.classList.add('has-panel');
    const focus = box.querySelector<HTMLElement>('[data-autofocus]') ?? box.querySelector<HTMLElement>('button');
    focus?.focus();
    // The game's "Read to me" button (and auto read-aloud, if the player turned it on), for young readers.
    try {
      decorateDialog(box, { autoRead: true });
    } catch {
      /* reading aloud is optional */
    }
    return Promise.race([picked, this.aborted]).then((r) => {
      this.stopReading();
      this.panel.hidden = true;
      this.el.classList.remove('has-panel');
      clear(this.panel);
      return r;
    });
  }

  private stopReading() {
    try {
      if (reader.owner === 'dialog') reader.stop();
    } catch {
      /* nothing was reading */
    }
  }

  /** Put keyboard focus on the game itself, so Space and the arrows fly. */
  focusPlay() {
    try {
      this.el.focus({ preventScroll: true });
    } catch {
      this.el.focus();
    }
  }

  /** A big caption for a key moment, also read out by screen readers. `ms` 0 keeps it up until replaced. */
  say(text: string, opts: { ms?: number; tone?: 'good' | 'warn' | 'bad' | 'big'; speak?: string | false } = {}) {
    window.clearTimeout(this.captionTimer);
    this.caption.textContent = text;
    this.caption.className = `ev-flight-caption show ${opts.tone ?? ''}`;
    const ms = opts.ms ?? 2200;
    if (ms > 0) this.captionTimer = window.setTimeout(() => this.unsay(), ms);
    if (opts.speak !== false) this.announce(opts.speak ?? text);
  }

  unsay() {
    window.clearTimeout(this.captionTimer);
    this.caption.className = 'ev-flight-caption';
    this.caption.textContent = '';
  }

  announce(text: string) {
    this.live.textContent = '';
    // A fresh text node each time so screen readers read repeats too.
    this.live.append(document.createTextNode(text));
  }

  // ---------------------------------------------------------------- feel
  shake(px: number) {
    if (this.reduced) return;
    this.shakeAmt = Math.max(this.shakeAmt, px);
  }

  sfx(name: Sfx) {
    try {
      this.audio?.sfx(name);
    } catch {
      /* no sound: fine */
    }
  }

  /** Engine rumble volume, 0..1 (silent when the game's sound is off). */
  engine(level: number) {
    const vol = this.audio?.levels?.sfxVolume;
    this.rumble.set(this.audio && !this.audio.muted && !this.paused ? level : 0, typeof vol === 'number' && Number.isFinite(vol) ? vol / 60 : 1);
  }
}

/** A little pixel medal (ribbon, disc and letter), so the medal never relies on color alone. */
export function medalIcon(medal: 'gold' | 'silver' | 'bronze' | 'none', big = false): HTMLElement {
  const letter = medal === 'gold' ? 'G' : medal === 'silver' ? 'S' : medal === 'bronze' ? 'B' : '-';
  return h('span', { class: `ev-medal ${medal}${big ? ' big' : ''}`, 'aria-hidden': 'true' }, h('span', { class: 'ribbon' }), h('span', { class: 'disc' }, letter));
}
