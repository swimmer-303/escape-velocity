// Written with AI assistance (Claude Code). See README "Use of AI tools".
// The Stage shows the outpost. The game only talks to this interface, so the
// 3D diorama (Three.js) and the lightweight fallback are interchangeable.

import type { Allocation, Weather } from '../sim/types';
import type { Levels } from '../sim/upgrades';

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
}

export interface Stage {
  mount(el: HTMLElement): void;
  setScene(scene: StageScene): void;
  /** 0 = sunrise, 0.5 = sunset, 1 = next sunrise. */
  setTimeOfDay(t: number): void;
  /** Flash of a solar storm hitting. */
  storm(intensity: number): void;
  /** Launch cinematic; resolves when done. */
  launch(): Promise<void>;
  focusModule?(key: string | null): void;
  setReducedMotion(on: boolean): void;
  dispose(): void;
}

/** Fallback "stage": a flat sky with a sun arc. Used before 3D loads, or if WebGL is unavailable. */
export class CssStage implements Stage {
  private el?: HTMLElement;
  private sky = document.createElement('div');
  private sun = document.createElement('div');
  private label = document.createElement('div');
  private weather: Weather = 'clear';

  mount(el: HTMLElement) {
    this.el = el;
    this.sky.className = 'stage-css';
    const ground = document.createElement('div');
    ground.className = 'ground';
    this.sun.className = 'sunball';
    this.label.className = 'label';
    this.sky.append(this.sun, ground, this.label);
    el.append(this.sky);
    this.setTimeOfDay(0.25);
  }

  setScene(scene: StageScene) {
    this.weather = scene.weather;
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
    if (dusk) {
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
