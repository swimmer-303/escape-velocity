// Written with AI assistance (Claude Code). See README "Use of AI tools".
// One rover expedition: a full-screen layer with the 3D world, the HUD, keyboard + touch joystick + mouse controls, a
// fixed-step loop, captions for key moments (also read out by screen readers), and the results card after each
// banked haul or tow. Skip (Esc, or "End trip") is always available. Everything it starts (listeners, the animation
// frame, sounds, the WebGL context) is undone before it resolves.

import { h, clear, prefersReducedMotion } from '../../ui/dom';
import type { Sfx } from '../../ui/audio';
import { decorateDialog, speakButton } from '../../ui/access';
import { reader } from '../../ui/voice';
import { toast } from '../toast';
import { bankHaul, towHaul, type AboardSample } from './bank';
import { RoverHud, nearestOpen, type HudTarget } from './hud';
import {
  BATTERY,
  NO_INPUT,
  SCAN_RANGE,
  bearingTo,
  devilPush,
  dustDevils,
  homeAlert,
  HOME_ALERT_TEXT,
  newRover,
  onPad,
  returnCost,
  scanStep,
  stepRover,
  type HomeAlert,
  type RoverInput,
} from './physics';
import { RARITY_WORD, sampleKind } from './samples';
import { GRAVITY, SITE_INFO, type RoverSite } from './sites';
import { gotToday, loadStore, saveStore } from './store';
import { dailyTargets, todayKey } from './targets';
import { RoverSound } from './sound';
import { museumView, resultsCard } from './ui';
import { RoverWorld } from './world';

export interface RoverAudio {
  sfx(name: Sfx): void;
  muted?: boolean;
  playMusic?(track: 'title' | 'mission' | 'launch'): void;
}

export interface RoverEnv {
  root: HTMLElement;
  audio: RoverAudio | null;
  reducedMotion: boolean;
  /** Parts of the page behind the game to make inert while it is open. */
  inert?: Array<HTMLElement | null>;
}

const ABORT = Symbol('rover-abort');
type Abort = typeof ABORT;
const STEP = 1 / 60;
/** How close the rover can get to a sample rock, m. */
const ROCK_RADIUS = 3.2;

function reducedWanted(flag: boolean): boolean {
  try {
    return flag || prefersReducedMotion() || document.documentElement.classList.contains('reduce-motion');
  } catch {
    return flag;
  }
}

type Key = 'up' | 'down' | 'left' | 'right' | 'boost' | 'scan';
const KEYMAP: Record<string, Key> = {
  ArrowUp: 'up', w: 'up', W: 'up',
  ArrowDown: 'down', s: 'down', S: 'down',
  ArrowLeft: 'left', a: 'left', A: 'left',
  ArrowRight: 'right', d: 'right', D: 'right',
  Shift: 'boost',
  ' ': 'scan', Spacebar: 'scan', e: 'scan', E: 'scan',
};

const isButtonLike = (t: EventTarget | null) => t instanceof HTMLElement && !!t.closest('button:not(.ev-rover-hold), a, input, select, textarea, summary, [contenteditable="true"]');

/** The full-screen layer: canvas host, HUD, controls, captions and the card panel. */
/** Exported for tests. */
export class RoverShell {
  readonly el: HTMLElement;
  readonly view: HTMLElement;
  readonly top: HTMLElement;
  readonly caption: HTMLElement;
  readonly panel: HTMLElement;
  readonly controls: HTMLElement;
  readonly live: HTMLElement;
  readonly reduced: boolean;
  readonly aborted: Promise<Abort>;
  lights = false;
  destroyed = false;
  paused = false;
  onLights?: () => void;
  onFrame?: (dt: number) => void;
  onResize?: (w: number, h: number) => void;
  private abortFn: (a: Abort) => void = () => {};
  private cleanups: Array<() => void> = [];
  private keys = new Set<Key>();
  private holds = new Map<number, 'boost' | 'scan'>();
  private joy = { x: 0, y: 0, id: -1 };
  private knob: HTMLElement;
  private joyEl: HTMLElement;
  private raf = 0;
  private last = -1;
  private captionTimer = 0;
  private inertEls: Array<{ el: HTMLElement; had: boolean }> = [];
  private lightsBtn: HTMLButtonElement;

  constructor(private readonly env: RoverEnv, label: string) {
    this.reduced = reducedWanted(env.reducedMotion);
    this.aborted = new Promise<Abort>((res) => (this.abortFn = res));
    this.view = h('div', { class: 'ev-rover-view' });
    this.caption = h('div', { class: 'ev-rover-caption', 'aria-hidden': 'true' });
    this.panel = h('div', { class: 'ev-rover-panel', hidden: true });
    this.live = h('div', { class: 'sr-only', role: 'status', 'aria-live': 'polite' });
    const end = h('button', { class: 'btn small ev-rover-end', type: 'button', 'aria-label': 'End trip (Escape key)', 'aria-keyshortcuts': 'Escape', 'data-rover': 'end' }, 'End trip', h('span', { class: 'ev-rover-key', 'aria-hidden': 'true' }, 'Esc'));
    end.addEventListener('click', () => this.skip());
    this.lightsBtn = h('button', { class: 'btn small ev-rover-lights', type: 'button', 'aria-pressed': 'false', 'aria-keyshortcuts': 'L', 'data-rover': 'lights' }, 'Lights', h('span', { class: 'ev-rover-key', 'aria-hidden': 'true' }, 'L'));
    this.lightsBtn.addEventListener('click', () => this.toggleLights());
    this.top = h('div', { class: 'ev-rover-top' });
    this.top.append(h('div', { class: 'ev-rover-buttons' }, this.lightsBtn, end));

    // Touch / mouse controls: a joystick on the left, hold buttons on the right.
    this.knob = h('span', { class: 'ev-rover-knob' });
    this.joyEl = h('div', { class: 'ev-rover-joy', 'aria-hidden': 'true' }, this.knob);
    const hold = (what: 'boost' | 'scan', text: string) => {
      const b = h('button', { class: `btn ev-rover-hold ${what}`, type: 'button', tabindex: '-1', 'aria-hidden': 'true', 'data-hold': what }, text);
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        this.holds.set(e.pointerId, what);
        try {
          b.setPointerCapture(e.pointerId);
        } catch {
          /* optional */
        }
        b.classList.add('pressed');
      });
      const up = (e: PointerEvent) => {
        if (this.holds.get(e.pointerId) === what) this.holds.delete(e.pointerId);
        if (![...this.holds.values()].includes(what)) b.classList.remove('pressed');
      };
      b.addEventListener('pointerup', up);
      b.addEventListener('pointercancel', up);
      b.addEventListener('lostpointercapture', up);
      b.addEventListener('mousedown', (e) => e.preventDefault());
      return b;
    };
    this.controls = h('div', { class: 'ev-rover-controls' }, this.joyEl, h('div', { class: 'ev-rover-holds' }, hold('boost', 'BOOST'), hold('scan', 'SCAN')));
    this.joyEl.addEventListener('pointerdown', (e) => this.joyDown(e));
    this.joyEl.addEventListener('pointermove', (e) => this.joyMove(e));
    this.joyEl.addEventListener('pointerup', (e) => this.joyUp(e));
    this.joyEl.addEventListener('pointercancel', (e) => this.joyUp(e));

    this.el = h(
      'div',
      { class: `ev-rover${this.reduced ? ' calm' : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': label, tabindex: '-1' },
      this.view,
      this.top,
      this.caption,
      this.controls,
      this.panel,
      this.live,
    );
    clear(env.root);
    env.root.append(this.el);
    for (const el of env.inert ?? []) {
      if (!el || el === env.root || el.contains(env.root)) continue;
      this.inertEls.push({ el, had: el.hasAttribute('inert') });
      el.setAttribute('inert', '');
    }
    this.listen(window, 'keydown', (e) => this.onKey(e as KeyboardEvent, true));
    this.listen(window, 'keyup', (e) => this.onKey(e as KeyboardEvent, false));
    this.listen(window, 'blur', () => this.releaseAll());
    this.listen(window, 'resize', () => this.resize());
    this.listen(document, 'visibilitychange', () => {
      this.paused = document.visibilityState === 'hidden';
      this.last = -1;
      if (this.paused) this.releaseAll();
    });
    this.listen(this.el, 'contextmenu', (e) => e.preventDefault());
  }

  private listen(t: EventTarget, type: string, fn: (e: Event) => void) {
    t.addEventListener(type, fn);
    this.cleanups.push(() => t.removeEventListener(type, fn));
  }

  // ---------------------------------------------------------------- input
  input(): Omit<RoverInput, 'lights'> {
    const held = (k: Key) => this.keys.has(k);
    const holding = (k: 'boost' | 'scan') => [...this.holds.values()].includes(k);
    const throttle = Math.max(-1, Math.min(1, (held('up') ? 1 : 0) - (held('down') ? 1 : 0) + this.joy.y));
    const steer = Math.max(-1, Math.min(1, (held('right') ? 1 : 0) - (held('left') ? 1 : 0) + this.joy.x));
    return { throttle, steer, boost: held('boost') || holding('boost'), scan: held('scan') || holding('scan') };
  }

  private onKey(e: KeyboardEvent, down: boolean) {
    if (this.destroyed) return;
    if (down && e.key === 'Escape') {
      e.preventDefault();
      this.skip();
      return;
    }
    const k = KEYMAP[e.key];
    const panelOpen = !this.panel.hidden;
    if (down && !panelOpen && (e.key === 'l' || e.key === 'L') && !isButtonLike(e.target)) {
      e.preventDefault();
      if (!e.repeat) this.toggleLights();
      return;
    }
    if (!k) return;
    if (!down) {
      this.keys.delete(k);
      return;
    }
    if (panelOpen) {
      // A key still held from driving must not auto-repeat into the results card's buttons.
      if (e.repeat && (e.key === ' ' || e.key === 'Enter')) e.preventDefault();
      return;
    }
    // Never steal Space or Enter from a focused button (Lights, End trip, Read to me).
    if (k === 'scan' && isButtonLike(e.target)) return;
    e.preventDefault();
    this.keys.add(k);
  }

  private joyDown(e: PointerEvent) {
    if (!this.panel.hidden) return;
    e.preventDefault();
    this.joy.id = e.pointerId;
    try {
      this.joyEl.setPointerCapture(e.pointerId);
    } catch {
      /* optional */
    }
    this.joyMove(e);
  }

  private joyMove(e: PointerEvent) {
    if (e.pointerId !== this.joy.id) return;
    const r = this.joyEl.getBoundingClientRect();
    const rad = Math.max(1, r.width / 2);
    let dx = (e.clientX - (r.left + r.width / 2)) / rad;
    let dy = (e.clientY - (r.top + r.height / 2)) / rad;
    const len = Math.hypot(dx, dy);
    if (len > 1) {
      dx /= len;
      dy /= len;
    }
    const dead = (v: number) => (Math.abs(v) < 0.15 ? 0 : v);
    this.joy.x = dead(dx);
    this.joy.y = dead(-dy);
    this.knob.style.transform = `translate(${Math.round(dx * rad * 0.6)}px, ${Math.round(dy * rad * 0.6)}px)`;
  }

  private joyUp(e: PointerEvent) {
    if (e.pointerId !== this.joy.id) return;
    this.joy = { x: 0, y: 0, id: -1 };
    this.knob.style.transform = '';
  }

  releaseAll() {
    this.keys.clear();
    this.holds.clear();
    this.joy = { x: 0, y: 0, id: -1 };
    this.knob.style.transform = '';
    for (const b of this.controls.querySelectorAll('.pressed')) b.classList.remove('pressed');
  }

  toggleLights() {
    this.lights = !this.lights;
    this.lightsBtn.setAttribute('aria-pressed', this.lights ? 'true' : 'false');
    this.lightsBtn.classList.toggle('on', this.lights);
    this.sfx('click');
    this.onLights?.();
  }

  // ---------------------------------------------------------------- loop
  start() {
    this.last = -1;
    this.schedule();
  }

  private schedule() {
    if (this.destroyed || this.raf) return;
    if (typeof window.requestAnimationFrame === 'function') this.raf = window.requestAnimationFrame(this.frame);
  }

  private frame = (now: number) => {
    this.raf = 0;
    if (this.destroyed) return;
    let dt = this.last < 0 ? 0 : (now - this.last) / 1000;
    this.last = now;
    dt = Math.max(0, Math.min(0.1, dt));
    try {
      if (!this.paused) this.onFrame?.(dt);
    } catch (e) {
      console.error('[rover] frame failed', e);
      this.abortFn(ABORT);
      return;
    }
    this.schedule();
  };

  resize() {
    const w = this.view.clientWidth || window.innerWidth || 960;
    const hh = this.view.clientHeight || window.innerHeight || 540;
    this.onResize?.(w, hh);
  }

  // ---------------------------------------------------------------- panels and captions
  skip() {
    if (this.destroyed) return;
    this.sfx('click');
    this.abortFn(ABORT);
  }

  /**
   * Show a card with buttons and wait for a pick. `fromTop` is for long cards (the Sample Museum): focus goes to the
   * heading and the card starts scrolled to the top, instead of jumping down to the button at the bottom.
   */
  choose<T extends string>(content: Node, buttons: Array<{ id: T; label: string; primary?: boolean }>, label: string, opts: { fromTop?: boolean } = {}): Promise<T | Abort> {
    this.releaseAll();
    this.unsay();
    clear(this.panel);
    const box = h('div', { class: 'ev-rover-card', role: 'group', 'aria-label': label });
    const row = h('div', { class: 'actions' });
    const picked = new Promise<T>((resolve) => {
      for (const b of buttons) {
        row.append(
          h(
            'button',
            {
              class: `btn ${b.primary ? 'primary' : ''}`,
              type: 'button',
              'data-rover-choice': b.id,
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
    box.append(content, row);
    this.panel.append(box);
    this.panel.hidden = false;
    this.el.classList.add('has-panel');
    const heading = opts.fromTop ? box.querySelector<HTMLElement>('h2, h3') : null;
    if (heading) {
      heading.tabIndex = -1;
      heading.focus({ preventScroll: true });
    } else (row.querySelector<HTMLElement>('.primary') ?? row.querySelector<HTMLElement>('button'))?.focus();
    try {
      decorateDialog(box, { autoRead: true });
    } catch {
      /* reading aloud is optional */
    }
    if (heading) {
      box.scrollTop = 0;
      this.panel.scrollTop = 0;
    }
    return Promise.race([picked, this.aborted]).then((r) => {
      this.stopReading();
      this.panel.hidden = true;
      this.el.classList.remove('has-panel');
      clear(this.panel);
      this.focusPlay();
      return r;
    });
  }

  focusPlay() {
    try {
      this.el.focus({ preventScroll: true });
    } catch {
      /* focus is best effort */
    }
  }

  say(text: string, opts: { ms?: number; tone?: 'good' | 'warn' | 'bad' | 'big' | 'gold' } = {}) {
    window.clearTimeout(this.captionTimer);
    this.caption.textContent = text;
    this.caption.className = `ev-rover-caption show ${opts.tone ?? ''}`;
    const ms = opts.ms ?? 2400;
    if (ms > 0) this.captionTimer = window.setTimeout(() => this.unsay(), ms);
    this.announce(text);
  }

  unsay() {
    window.clearTimeout(this.captionTimer);
    this.caption.className = 'ev-rover-caption';
    this.caption.textContent = '';
  }

  announce(text: string) {
    this.live.textContent = '';
    this.live.append(document.createTextNode(text));
  }

  sfx(name: Sfx) {
    try {
      this.env.audio?.sfx(name);
    } catch {
      /* no sound: fine */
    }
  }

  private stopReading() {
    try {
      if (reader.owner === 'dialog' || reader.owner === 'rover-hud') reader.stop();
    } catch {
      /* nothing was reading */
    }
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.raf) window.cancelAnimationFrame?.(this.raf);
    this.raf = 0;
    for (const fn of this.cleanups.splice(0)) {
      try {
        fn();
      } catch {
        /* keep cleaning */
      }
    }
    window.clearTimeout(this.captionTimer);
    this.stopReading();
    for (const { el, had } of this.inertEls) if (!had) el.removeAttribute('inert');
    this.inertEls = [];
    this.el.remove();
    clear(this.env.root);
    this.abortFn(ABORT);
  }
}

// ------------------------------------------------------------------ the expedition

function noWebglCard(): HTMLElement {
  return h(
    'div',
    null,
    h('div', { class: 'kicker' }, 'Rover Expeditions'),
    h('h2', null, 'This device cannot draw the 3D drive'),
    h('p', null, 'The rover needs WebGL 2, which this browser or computer has turned off. Try another browser, or keep playing the base game.'),
  );
}

/** Play one visit: drive, bank, maybe drive again. Never throws; clears `env.root` before it resolves. */
export async function runExpedition(site: RoverSite, env: RoverEnv): Promise<void> {
  const info = SITE_INFO[site];
  const shell = new RoverShell(env, `Rover expedition: ${info.name}`);
  let world: RoverWorld | null = null;
  const sound = new RoverSound(env.audio);
  try {
    if (!RoverWorld.supported()) {
      await shell.choose(noWebglCard(), [{ id: 'ok', label: 'Close', primary: true }], 'No 3D');
      return;
    }
    const date = todayKey();
    const plans = dailyTargets(site, date);
    const devils = dustDevils(site, date);
    try {
      world = new RoverWorld(site, plans, devils, shell.reduced);
    } catch (e) {
      console.error('[rover] 3D world failed', e);
      await shell.choose(noWebglCard(), [{ id: 'ok', label: 'Close', primary: true }], 'No 3D');
      return;
    }
    const w = world;
    const g = GRAVITY[site];
    shell.view.append(w.canvas);
    const banked = gotToday(loadStore(), site, date);
    const states: HudTarget[] = w.targets.map((t) => ({ x: t.x, z: t.z, kind: t.kind, rarity: t.rarity, state: banked.has(t.id) ? 'banked' : 'open' }));
    states.forEach((t, i) => w.setTarget(i, t.state));

    const hud = new RoverHud(site, w.field);
    const read = speakButton(() => [hud.summary()], 'rover-hud', { text: 'Read to me', label: 'Read to me: the rover status' });
    if (read) shell.top.querySelector('.ev-rover-buttons')?.prepend(read);
    shell.top.prepend(hud.el);
    shell.el.append(hud.compassEl, hud.mapEl, hud.warn, hud.prompt);
    shell.onResize = (ww, hh) => w.resize(ww, hh);
    shell.resize();
    env.audio?.playMusic?.('mission');

    // Start facing the nearest open target (or Mount Sharp's way at Gale when nothing is left).
    const first = nearestOpen({ x: 0, z: 0, targets: states });
    const s = newRover(w.field, first ? bearingTo(0, 0, states[first.index].x, states[first.index].z) : (150 * Math.PI) / 180);
    let aboard: AboardSample[] = [];
    let mode: 'drive' | 'tow' | 'panel' = 'drive';
    let time = 0;
    let acc = 0;
    let scan = 0;
    let scanIdx = -1;
    let towTimer = 0;
    let alert: HomeAlert = 'ok';
    let hudTimer = 0;
    let boosting = false;
    const cooldown = new Map<string, number>();
    const once = (key: string, secs: number) => {
      const t = cooldown.get(key) ?? -1e9;
      if (time - t < secs) return false;
      cooldown.set(key, time);
      return true;
    };
    const open = () => states.filter((t) => t.state === 'open').length;
    const paneled = () => mode === 'panel';

    let finish: () => void = () => {};
    const finished = new Promise<void>((res) => (finish = res));

    const view = () => ({
      x: s.x,
      z: s.z,
      heading: s.heading,
      battery: s.battery,
      alert,
      aboard: aboard.map((a) => a.kind),
      targets: states,
      devils,
      time,
      lights: shell.lights,
    });

    const showResults = async (towed: boolean, lost: number, result: ReturnType<typeof bankHaul>, distance: number) => {
      mode = 'panel';
      sound.motor(0, false);
      sound.scan(null);
      for (;;) {
        const left = open();
        const card = resultsCard({ site, result, distance, towed, lost, left });
        const buttons: Array<{ id: 'again' | 'museum' | 'done'; label: string; primary?: boolean }> = [];
        if (left > 0) buttons.push({ id: 'again', label: 'Keep exploring', primary: true });
        buttons.push({ id: 'museum', label: 'Sample Museum' });
        buttons.push({ id: 'done', label: 'Done', primary: left === 0 });
        const pick = await shell.choose(card, buttons, 'Expedition results');
        if (pick === ABORT || pick === 'done') {
          finish();
          return;
        }
        if (pick === 'museum') {
          const back = await shell.choose(museumView(), [{ id: 'back', label: 'Back to results', primary: true }], 'Sample Museum', { fromTop: true });
          if (back === ABORT) {
            finish();
            return;
          }
          continue;
        }
        // A fresh charge and an empty rover, right on the pad.
        s.battery = BATTERY.full;
        s.odometer = 0;
        s.speed = 0;
        aboard = [];
        alert = 'ok';
        mode = 'drive';
        shell.say('Fully charged. Off you go!', { tone: 'good' });
        return;
      }
    };

    const bank = (towed: boolean) => {
      const store = loadStore();
      const kept = towed ? towHaul(aboard) : aboard;
      const keptIds = new Set(kept.map((k) => k.targetId));
      const lost = aboard.length - kept.length;
      const distance = s.odometer;
      const result = bankHaul(store, site, date, kept, distance);
      saveStore(store);
      for (const a of aboard) {
        const i = w.targets.findIndex((t) => t.id === a.targetId);
        if (i < 0) continue;
        states[i].state = keptIds.has(a.targetId) ? 'banked' : 'open';
        w.setTarget(i, states[i].state);
      }
      aboard = [];
      shell.sfx(result.total ? 'win' : 'place');
      if (result.newEntries.length) shell.announce(`${result.newEntries.length} new ${result.newEntries.length === 1 ? 'sample' : 'samples'} in the Museum!`);
      void showResults(towed, lost, result, distance);
    };

    const collect = (i: number) => {
      const t = w.targets[i];
      const kind = sampleKind(t.kind);
      states[i].state = 'aboard';
      w.setTarget(i, 'aboard');
      aboard.push({ targetId: t.id, kind: t.kind });
      s.battery = Math.max(0, s.battery - BATTERY.scan);
      const rare = t.rarity === 'rare' || t.rarity === 'legendary';
      w.burst(t.x, t.y, t.z, kind?.accent ?? '#ffffff', rare);
      if (t.rarity === 'legendary') {
        shell.sfx('win');
        shell.say(`LEGENDARY FIND! ${kind?.name ?? ''}`, { tone: 'gold', ms: 3200 });
      } else if (t.rarity === 'rare') {
        shell.sfx('win');
        shell.say(`Rare find! ${kind?.name ?? ''}`, { tone: 'big', ms: 2800 });
      } else {
        shell.sfx('good');
        shell.say(`Sample collected: ${kind?.name ?? ''} (${RARITY_WORD[t.rarity]})`, { tone: 'good' });
      }
      if (open() === 0) window.setTimeout(() => mode === 'drive' && shell.say('All targets aboard. Drive home to bank them!', { tone: 'big', ms: 3200 }), 2900);
    };

    const update = (dt: number) => {
      time += dt;
      if (mode === 'tow') {
        towTimer -= dt;
        if (towTimer <= 0) {
          // The tow rover brings you home.
          s.x = 0;
          s.z = 0;
          s.y = w.field.height(0, 0);
          s.vy = 0;
          s.speed = 0;
          s.grounded = true;
          s.pushX = 0;
          s.pushZ = 0;
          shell.el.classList.remove('towing');
          bank(true);
        }
        return;
      }
      if (mode !== 'drive') return;
      const raw = shell.input();
      const inp: RoverInput = { ...raw, lights: shell.lights };
      // Dust devils push the rover (Mars only).
      for (const d of devils) {
        const p = devilPush(d, time, s.x, s.z);
        if (p.x || p.z) {
          s.pushX += p.x * dt;
          s.pushZ += p.z * dt;
          if (once('devil', 8)) {
            shell.say('Dust devil! These whirlwinds are real on Mars.', { tone: 'warn' });
            shell.sfx('storm');
          }
        }
      }
      const step = stepRover(s, s.battery > 0 ? inp : { ...NO_INPUT, lights: inp.lights }, dt, w.field, g);
      // Sample rocks are solid: the rover stops beside them instead of driving over them.
      for (const t of states) {
        if (t.state !== 'open') continue;
        const dx = s.x - t.x;
        const dz = s.z - t.z;
        const d = Math.hypot(dx, dz);
        if (d < ROCK_RADIUS && d > 1e-6) {
          s.x = t.x + (dx / d) * ROCK_RADIUS;
          s.z = t.z + (dz / d) * ROCK_RADIUS;
          s.y = w.field.height(s.x, s.z);
          s.speed *= 0.3;
          if (once('bump-rock', 1.5)) shell.sfx('deny');
        }
      }
      boosting = step.boosting;
      if (step.steep && once('steep', 6)) shell.say('Too steep! The wheels slip. Find a gentler way.', { tone: 'warn' });
      if (step.edge && once('edge', 6)) shell.say('Edge of the map. Turn back!', { tone: 'warn' });
      if (step.jump > 0.9 && once('air', 3)) shell.say(site === 'moon' ? 'Floating in low gravity!' : 'Big air!', { tone: 'big', ms: 1500 });
      if (step.landed > 3) {
        w.bump(step.landed * 0.05);
        if (once('land', 0.6)) shell.sfx('place');
      }

      // Scanning.
      let best = -1;
      let bestD = SCAN_RANGE;
      states.forEach((t, i) => {
        if (t.state !== 'open') return;
        const d = Math.hypot(t.x - s.x, t.z - s.z);
        if (d <= bestD) {
          bestD = d;
          best = i;
        }
      });
      scanIdx = best;
      const prev = scan;
      scan = scanStep(scan, inp.scan, best >= 0, s.speed, dt);
      if (best < 0) scan = 0;
      if (scan > 0 && prev === 0 && inp.scan) shell.announce('Scanning...');
      if (scan >= 1 && best >= 0) {
        scan = 0;
        collect(best);
      }

      // Back at the pad: bank the haul, or top up the battery.
      if (onPad(s.x, s.z)) {
        if (aboard.length && s.grounded) {
          s.speed = 0;
          bank(false);
          return;
        }
        if (s.battery < BATTERY.full) {
          s.battery = Math.min(BATTERY.full, s.battery + BATTERY.charge * dt);
          if (once('charge', 8)) shell.say('Charging...', { tone: 'good', ms: 1400 });
        }
      }

      // The battery: plan the way home.
      const next = homeAlert(s.battery, returnCost(Math.hypot(s.x, s.z), w.field.height(0, 0) - s.y, g));
      if (next !== alert) {
        if (next === 'now' && aboard.length + open() > 0) {
          shell.say(HOME_ALERT_TEXT.now, { tone: 'bad', ms: 3000 });
          shell.sfx('alarm');
        } else if (next === 'soon' && alert === 'ok') shell.say(HOME_ALERT_TEXT.soon, { tone: 'warn' });
        alert = next;
      }
      if (step.emptied) {
        mode = 'tow';
        s.speed = 0;
        shell.el.classList.add('towing');
        towTimer = shell.reduced ? 1.2 : 2.6;
        shell.sfx('bad');
        shell.say('Battery empty! A friendly tow rover is on its way.', { tone: 'bad', ms: 0 });
      }
    };

    shell.onFrame = (dt) => {
      if (mode !== 'panel') {
        acc += dt;
        while (acc >= STEP - 1e-9) {
          acc -= STEP;
          update(STEP);
          if (paneled()) break;
        }
      }
      if (mode === 'panel') acc = 0;
      const scanning = mode === 'drive' && scan > 0 ? scanIdx : -1;
      w.frame({ rover: s, dt, time, lights: shell.lights, boosting, scanning, scanProgress: scan, devils });
      hudTimer -= dt;
      if (hudTimer <= 0) {
        hudTimer = 0.1;
        hud.update(view());
      }
      const t = scanIdx >= 0 ? states[scanIdx] : null;
      if (mode === 'drive' && t) hud.setPrompt(scan > 0 ? `Scanning: ${sampleKind(t.kind)?.name ?? 'sample'}` : 'Hold SCAN (Space) to collect', scan);
      else hud.setPrompt(null);
      sound.motor(mode === 'drive' ? Math.min(1, Math.abs(s.speed) / 20) : 0, boosting);
      sound.scan(mode === 'drive' && scan > 0 ? scan : null);
    };

    shell.start();
    shell.focusPlay();
    shell.say(open() ? 'Follow a beacon to a science target!' : 'Every target here is found today. Take a drive!', { tone: 'big', ms: 3000 });
    if (site === 'moon') window.setTimeout(() => !shell.destroyed && mode === 'drive' && shell.say('Low gravity! Bumps send you floating.', { tone: 'good' }), 3300);

    await Promise.race([finished, shell.aborted]);
    if (aboard.length) toast('Trip ended', 'Samples you had not banked are still out there today.', { tone: 'cyan' });
  } catch (e) {
    console.error('[rover] expedition failed', e);
  } finally {
    sound.stop();
    try {
      world?.dispose();
    } catch (e) {
      console.error('[rover] dispose failed', e);
    }
    shell.destroy();
  }
}
