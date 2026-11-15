// Written with AI assistance (Claude Code). See README "Use of AI tools".
// The Stage shows the outpost. The game only talks to this interface, so the
// 3D diorama (Three.js) and the lightweight fallback are interchangeable.

import type { Allocation, CrateId, Weather } from '../sim/types';
import type { Levels, UpgradeId } from '../sim/upgrades';

/**
 * The parts of the base you can tap in 3D (or pick from the "Look at" menu). Where a part has a card in the
 * planning dock, the key is that card's key ('heaters' is the habitat with its heater vents, 'build' the Workshop).
 */
export type FocusKey = 'o2' | 'greenhouse' | 'heaters' | 'shelter' | 'monitor' | 'battery' | 'build' | 'rocket' | 'panels' | 'reactor';

/** A moment of the sol for the stage to act out (the 3D stage animates it; the simple stage ignores it). */
export type StageCue =
  /** Resupply: a cargo lander comes down on its retro-rockets, then the crate appears beside it. */
  | { kind: 'lander'; crate?: CrateId }
  /** A solar storm is about to hit and the shelter is powered: the crew runs inside. */
  | { kind: 'shelter' };

export interface StageScene {
  sol: number;
  weather: Weather;
  alloc: Allocation;
  fuel: number;
  sheltered: boolean;
  /** Upgrades built: the diorama grows with them. */
  levels: Levels;
  /** Astronauts walking around (0 while the base is empty between crews). */
  crew: number;
  /** The Workshop's current project and how far along it is (0..1), shown as a blueprint. */
  project?: UpgradeId | null;
  projectProgress?: number;
  /** Which world the base is on (default 'mars'). The stage switches scenery whenever it changes. */
  site?: 'mars' | 'moon';
  /** Mars only: the landing site ('gale', the default, or 'arcadia', the ice-rich plains). Ignored on the Moon. */
  landing?: string;
  /** Space Lab, Mars only: sunlight compared with normal (Mars nearer or farther from the Sun). Missing = 1. */
  labSun?: number;
  /** A storm warning is in today, from Earth (radio) or from the base's own radiation monitor. The 3D stage shows a comms beam. */
  warning?: 'monitor' | 'earth' | null;
}

/** Rocket paint patterns (render/paint.ts draws them, for the 3D rocket and for the Hangar's previews). */
export type RocketPattern = 'solid' | 'stripes' | 'checker' | 'gradient' | 'flames' | 'dots' | 'stars' | 'bolt';

/**
 * How the crew, the rocket and the base look: the player's Hangar choices, unlocked by playing. The 3D stage
 * paints them; the simple stage ignores them. Colors are CSS hex strings ('#5ef2e6').
 */
export interface Cosmetics {
  /** Every astronaut's suit: the main color and the trim (backpack, belt, gloves, boots). `glow`: it glows in the dark. */
  suit: { body: string; trim: string; glow?: boolean };
  /**
   * The rocket's paint: a pattern and its colors (bottom to top for 'gradient'), the fins' color, an optional
   * nose cone color, and `shiny` for a polished metal look.
   */
  rocket: { pattern: RocketPattern; colors: string[]; fins: string; nose?: string; shiny?: boolean };
  /** A little robot rover that trundles after the crew (null: no pet). `glow`: it glows in the dark. */
  pet: { body: string; trim: string; eyes: string; glow?: boolean } | null;
  /** The color of the base's lights: habitat windows, the shelter door and the battery lamps (amber by default). */
  lights: string;
}

/**
 * The player's "3D detail" choice (Settings): 'auto' lets the 3D stage pick for the device (and drop to 'low' by
 * itself if frames come in slow); 'low' (Faster) and 'high' (Sharper) pick a tier for good. `?quality=low|high` in
 * the address wins over it.
 */
export type Detail = 'auto' | 'low' | 'high';

export interface Stage {
  mount(el: HTMLElement): void;
  setScene(scene: StageScene): void;
  /** 0 = sunrise, 0.5 = sunset, 1 = next sunrise. */
  setTimeOfDay(t: number): void;
  /** Flash of a solar storm hitting. */
  storm(intensity: number): void;
  /** Launch cinematic; resolves when done. */
  launch(): Promise<void>;
  /** Point the camera at a part of the base (null = back to the whole base). Does not call onPick. */
  focusModule?(key: FocusKey | null): void;
  /** Act out a moment of the sol (see StageCue). */
  cue?(cue: StageCue): void;
  /** Set by the game: the player tapped a part of the base in 3D or picked one from the "Look at" menu (null = whole base). */
  onPick?: (key: FocusKey | null) => void;
  /** Suit colors, rocket paint, rover pet and base lights from the Hangar. */
  setCosmetics?(c: Cosmetics): void;
  /**
   * The cold open (src/ui/coldopen.ts): swoop the camera low over the real terrain and around to the opening view of
   * the base, over `seconds` (0 = cut straight to the opening view). Only the 3D stage has it; never with reduced motion.
   */
  flyIn?(seconds: number): void;
  setReducedMotion(on: boolean): void;
  /** The 3D detail (see Detail). Only the 3D stage has it, and it changes right away. */
  setDetail?(d: Detail): void;
  dispose(): void;
}

/** Fallback "stage": a flat sky with a sun arc. Used before 3D loads, or if WebGL is unavailable. */
export class CssStage implements Stage {
  private el?: HTMLElement;
  private sky = document.createElement('div');
  private sun = document.createElement('div');
  private label = document.createElement('div');
  private ground = document.createElement('div');
  private weather: Weather = 'clear';
  private moon = false;
  private ice = false;
  /** Never called: there is nothing to tap in the flat view. */
  onPick?: (key: FocusKey | null) => void;

  mount(el: HTMLElement) {
    this.el = el;
    this.sky.className = 'stage-css';
    this.ground.className = 'ground';
    this.sun.className = 'sunball';
    this.label.className = 'label';
    this.sky.append(this.sun, this.ground, this.label);
    el.append(this.sky);
    this.setTimeOfDay(0.25);
  }

  setScene(scene: StageScene) {
    this.weather = scene.weather;
    this.moon = scene.site === 'moon';
    this.ice = !this.moon && scene.landing === 'arcadia';
    // Moon: gray ground and a white Sun (inline styles; empty strings fall back to the Mars CSS).
    // Arcadia Planitia: paler, frosty plains.
    this.ground.style.background = this.moon ? 'linear-gradient(#8d8b87, #4f4f52)' : this.ice ? 'linear-gradient(#c9b4a4, #8a5a40)' : '';
    this.sun.style.background = this.moon ? '#ffffff' : '';
    this.sun.style.boxShadow = this.moon ? 'none' : '';
    this.label.textContent = '';
    this.setTimeOfDay(0.25);
  }

  setTimeOfDay(t: number) {
    const day = t < 0.5;
    const k = day ? Math.sin((t / 0.5) * Math.PI) : 0;
    const dusk = Math.abs(t - 0.5) < 0.06 || t > 0.97 || t < 0.03;
    const dust = this.weather === 'clear' ? 0 : this.weather === 'dusty' ? 0.35 : 0.6;
    let top: string;
    let bottom: string;
    if (this.moon) {
      top = '#000000'; // no air: the sky stays black, day and night
      bottom = '#07070c';
    } else if (dusk) {
      top = '#2b3a6b';
      bottom = '#5b7bb5'; // Mars sunsets are blue
    } else if (day) {
      top = mix('#5a3a2a', '#d9a066', k * (1 - dust * 0.6));
      bottom = mix('#7a4a30', '#ecc98f', k * (1 - dust * 0.5));
    } else {
      top = '#0b0a18';
      bottom = '#1a1530';
    }
    this.sky.style.background = `linear-gradient(${top}, ${bottom} 58%)`;
    const ang = (day ? t / 0.5 : 1) * Math.PI;
    this.sun.style.display = day ? 'block' : 'none';
    this.sun.style.left = `calc(${50 - Math.cos(ang) * 40}% - 18px)`;
    this.sun.style.top = `calc(${58 - Math.sin(ang) * 45}% - 18px)`;
  }

  storm(intensity: number) {
    if (!this.el) return;
    this.el.animate?.([{ filter: `brightness(${1 + intensity})` }, { filter: 'brightness(1)' }], { duration: 600 });
  }

  async launch() {
    /* the 3D stage has the real cinematic */
  }

  /* Nothing to look at, act out or paint in the flat view. */
  focusModule() {}
  cue() {}
  setCosmetics() {}

  setReducedMotion() {}
  dispose() {
    this.sky.remove();
  }
}

function mix(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ch = (s: number) => Math.round(((pa >> s) & 255) * (1 - t) + ((pb >> s) & 255) * t);
  return `#${((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, '0')}`;
}

/**
 * Starts with a lightweight stage and swaps in the 3D one once it has loaded,
 * replaying the latest scene (and the Hangar's cosmetics) so nothing is lost.
 */
export class SwappableStage implements Stage {
  private inner: Stage;
  private el?: HTMLElement;
  private last?: StageScene;
  private looks?: Cosmetics;
  private t = 0.25;
  private reduced = false;
  private detail: Detail = 'auto';
  /** The game's pick handler; whichever stage is inside reports to it. */
  onPick?: (key: FocusKey | null) => void;

  constructor(initial: Stage) {
    this.inner = initial;
    this.listen(initial);
  }

  private listen(s: Stage) {
    s.onPick = (key) => this.onPick?.(key);
  }

  swap(next: Stage) {
    if (!this.el) return;
    const prev = this.inner;
    try {
      next.mount(this.el);
    } catch (e) {
      console.warn('3D view failed to start; keeping the simple view.', e);
      next.dispose();
      return;
    }
    prev.dispose();
    this.inner = next;
    this.listen(next);
    next.setReducedMotion(this.reduced);
    next.setDetail?.(this.detail);
    if (this.last) next.setScene(this.last);
    next.setTimeOfDay(this.t);
    if (this.looks) next.setCosmetics?.(this.looks);
  }

  mount(el: HTMLElement) {
    this.el = el;
    this.inner.mount(el);
  }
  setScene(scene: StageScene) {
    this.last = scene;
    this.inner.setScene(scene);
  }
  setTimeOfDay(t: number) {
    this.t = t;
    this.inner.setTimeOfDay(t);
  }
  storm(intensity: number) {
    this.inner.storm(intensity);
  }
  launch() {
    return this.inner.launch();
  }
  focusModule(key: FocusKey | null) {
    this.inner.focusModule?.(key);
  }
  cue(cue: StageCue) {
    this.inner.cue?.(cue);
  }
  setCosmetics(c: Cosmetics) {
    this.looks = c;
    this.inner.setCosmetics?.(c);
  }
  flyIn(seconds: number) {
    this.inner.flyIn?.(seconds);
  }
  /** True once a stage that can fly the cold open (the 3D one) is inside. */
  canFlyIn(): boolean {
    return typeof this.inner.flyIn === 'function';
  }
  setReducedMotion(on: boolean) {
    this.reduced = on;
    this.inner.setReducedMotion(on);
  }
  /** Kept for a stage swapped in later (the 3D view loads after the title screen). */
  setDetail(d: Detail) {
    this.detail = d;
    this.inner.setDetail?.(d);
  }
  /** True when the stage inside can change its 3D detail right away (the 3D view is showing). */
  canSetDetail(): boolean {
    return typeof this.inner.setDetail === 'function';
  }
  dispose() {
    this.inner.dispose();
  }
}
