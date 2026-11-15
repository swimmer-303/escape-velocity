// Written with AI assistance (Claude Code). See README "Use of AI tools".
// The cold open: the first thing a new player sees. The camera swoops low over the real terrain and around to the
// outpost (the 3D stage's flyIn), the title slams in, and "Press any key or tap to start" waits. Any key or tap skips
// it at any moment, and that first press also starts the music with a hit (browsers keep sound off until a press).
// Return visits get a short camera dolly instead, with no screen in the way.
// The App only runs this from main.ts's normal start (never in tests with the simple stage, the self-playing demo,
// /demo, Mission Control or the teacher dashboard) and never with reduced motion.

import { h } from './dom';
import type { GameAudio } from './audio';
import type { Stage } from '../render/stage';

export interface ColdOpenDeps {
  stage: Stage & { canFlyIn?(): boolean };
  audio: GameAudio;
  /** True on the first visit: the full cold open. False: the short dolly. */
  full: boolean;
  /** Still on the title screen? (The short version gives up if the player has already moved on.) */
  onTitle(): boolean;
  /** Show the lobby (it is already drawn underneath) and put focus on PLAY. */
  reveal(): void;
}

const SWOOP_S = 7;
const WAIT_3D_MS = 2500;

/** Wait for the 3D stage (it loads in the background). Resolves false if it does not arrive in time. */
function when3d(stage: ColdOpenDeps['stage'], ms: number): Promise<boolean> {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const check = () => {
      if (stage.canFlyIn?.()) return resolve(true);
      if (performance.now() - t0 > ms) return resolve(false);
      window.setTimeout(check, 100);
    };
    check();
  });
}

export function runColdOpen(d: ColdOpenDeps): void {
  if (!d.full) {
    // Return visit: a short dolly in once the 3D stage is ready.
    void when3d(d.stage, 4000).then((ok) => {
      if (ok && d.onTitle()) d.stage.flyIn?.(1.8);
    });
    lobbyEnter();
    return;
  }

  const root = document.documentElement;
  root.classList.add('ev-cold');
  const black = h('div', { class: 'cold-black' });
  // The team logo slams in at the end of the swoop.
  const title = h('div', { class: 'cold-title', 'aria-hidden': 'true' }, h('img', { class: 'cold-logo', src: '/art/logo.png', alt: '', width: 413, height: 424 }));
  const prompt = h('button', { class: 'cold-prompt', type: 'button' }, 'Press any key or tap to start');
  const hint = h('div', { class: 'cold-hint' }, 'Loading the outpost...');
  const overlay = h(
    'div',
    { class: 'cold-open', role: 'region', 'aria-label': 'Intro. Press any key or tap to skip.' },
    black,
    h('div', { class: 'cold-bar top' }),
    h('div', { class: 'cold-bar bottom' }),
    title,
    prompt,
    hint,
  );
  document.body.append(overlay);
  const app = document.getElementById('app');
  const modalRoot = document.getElementById('modal-root');
  app?.setAttribute('inert', '');
  modalRoot?.setAttribute('inert', '');

  let finished = false;
  let slammed = false;
  /** The music hit already played (only possible if the player had pressed something before). */
  let hit = false;
  const timers: number[] = [];
  const later = (ms: number, fn: () => void) => timers.push(window.setTimeout(() => !finished && fn(), ms));

  const slam = () => {
    if (slammed) return;
    slammed = true;
    overlay.classList.add('slammed');
    if (d.audio.ready) {
      d.audio.sfx('slam');
      hit = true;
    }
    hint.textContent = '';
    later(900, () => {
      overlay.classList.add('prompting');
      prompt.focus({ preventScroll: true });
    });
  };

  const finish = (byPlayer: boolean) => {
    if (finished) return;
    finished = true;
    timers.forEach((t) => window.clearTimeout(t));
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('pointerdown', onPointer, true);
    // The first press of the page: sound may start now. The music hit lands as the lobby appears.
    if (byPlayer) {
      d.audio.unlockNow();
      d.audio.sfx(hit ? 'whoosh' : 'slam');
    }
    d.stage.flyIn?.(0);
    app?.removeAttribute('inert');
    modalRoot?.removeAttribute('inert');
    overlay.classList.add('leaving');
    root.classList.remove('ev-cold');
    window.setTimeout(() => overlay.remove(), 350);
    lobbyEnter();
    d.reveal();
  };

  const onKey = (e: KeyboardEvent) => {
    if (['Shift', 'Control', 'Alt', 'Meta', 'CapsLock'].includes(e.key)) return;
    e.preventDefault();
    e.stopPropagation();
    finish(true);
  };
  // The click that follows the skipping tap must not land on the lobby underneath (it would open a tile).
  const swallowClick = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };
  const onPointer = (e: PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    window.addEventListener('click', swallowClick, true);
    window.setTimeout(() => window.removeEventListener('click', swallowClick, true), 700);
    finish(true);
  };
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('pointerdown', onPointer, true);
  prompt.addEventListener('click', () => finish(true));

  void when3d(d.stage, WAIT_3D_MS).then((ok) => {
    if (finished) return;
    hint.textContent = 'Tap or press any key to skip';
    overlay.classList.add('rolling');
    if (ok) {
      d.stage.flyIn?.(SWOOP_S);
      later((SWOOP_S - 1.4) * 1000, slam);
    } else {
      // No 3D view (or it is slow to load): just the title, over the simple view.
      later(400, slam);
    }
  });
  // Never leave anyone stuck on a black screen.
  later(30_000, () => finish(false));
}

/** The lobby tiles slide in, one after another (once, when the title first appears). */
function lobbyEnter() {
  const root = document.documentElement;
  root.classList.add('ev-lobby-enter');
  window.setTimeout(() => root.classList.remove('ev-lobby-enter'), 1600);
}
