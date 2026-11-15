// @vitest-environment happy-dom
// Written with AI assistance (Claude Code). See README "Use of AI tools".
// The Settings dialog, clicked through like a player would: Music and Sound effects on their own (and saved across a
// reload), the volume sliders (heard right away, saved, labelled for screen readers), the master mute, old saves,
// 3D detail, Escape and Back, and the sections features add through the meta hooks.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { App } from './app';
import { CssStage, SwappableStage, type Detail } from '../render/stage';
import { addSettingsSection, metaContext } from '../meta/hooks';
import { h } from './dom';
import type { GameAudio } from './audio';

const PAGE = `<div id="app"><div id="stage"></div><header id="hud"></header><main id="dock"></main></div><div id="modal-root"></div>`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function button(text: RegExp, root: ParentNode = document): HTMLButtonElement | null {
  return ([...root.querySelectorAll('button')] as HTMLButtonElement[]).find((b) => text.test(b.textContent ?? '') && !b.disabled) ?? null;
}

async function waitFor<T>(fn: () => T | null | undefined, ms = 8000): Promise<T> {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const v = fn();
    if (v) return v;
    await sleep(10);
  }
  throw new Error('timed out waiting');
}

// ------------------------------------------------------------------ fake sound

/** Stands in for HTMLAudioElement: every music track the game starts. */
class FakeMusic {
  static made: FakeMusic[] = [];
  loop = false;
  volume = 1;
  paused = true;
  constructor(public src: string) {
    FakeMusic.made.push(this);
  }
  play() {
    this.paused = false;
    return Promise.resolve();
  }
  pause() {
    this.paused = true;
  }
}
const playing = () => FakeMusic.made.filter((m) => !m.paused);

/** Stands in for the Web Audio API: counts the effect notes played and keeps their loudness. */
const notes: number[] = [];
class FakeContext {
  state = 'running';
  currentTime = 0;
  destination = {};
  createOscillator() {
    return { type: '', frequency: { value: 0 }, connect: (x: unknown) => x, start() {}, stop() {} };
  }
  createGain() {
    return { gain: { setValueAtTime: (v: number) => void notes.push(v), exponentialRampToValueAtTime() {} }, connect: (x: unknown) => x };
  }
}

const realAudio = window.Audio;
/** The player's first press: browsers allow sound from then on. */
const press = () => window.dispatchEvent(new Event('pointerdown'));
const saved = () => JSON.parse(localStorage.getItem('ev-settings') ?? '{}');
const dialog = () => document.querySelector<HTMLElement>('.modal[aria-label="Settings"]');
const slider = (name: string) => dialog()!.querySelector<HTMLInputElement>(`input[type="range"][aria-valuetext^="${name}"]`)!;
function slide(input: HTMLInputElement, value: number) {
  input.value = String(value);
  input.dispatchEvent(new Event('input'));
}
async function openSettings() {
  (await waitFor(() => button(/^Settings$/))).click();
  return waitFor(dialog);
}
/** Every game started in this test: silenced afterwards, so an old one never plays into the next test. */
let apps: App[] = [];
function boot(stage: CssStage = new CssStage()) {
  const app = new App(stage);
  apps.push(app);
  return app;
}
function reload(stage = new CssStage()) {
  document.body.innerHTML = PAGE;
  FakeMusic.made = [];
  notes.length = 0;
  return boot(stage);
}

beforeEach(() => {
  document.body.innerHTML = PAGE;
  document.documentElement.className = '';
  vi.stubGlobal('fetch', () => Promise.reject(new Error('offline in tests')));
  vi.stubGlobal('AudioContext', FakeContext);
  (window as unknown as { Audio: unknown }).Audio = FakeMusic;
  FakeMusic.made = [];
  notes.length = 0;
  history.replaceState(null, '', '/');
  localStorage.clear();
});

afterEach(() => {
  for (const app of apps) (app as unknown as { audio: GameAudio }).audio.setMuted(true);
  apps = [];
  (window as unknown as { Audio: unknown }).Audio = realAudio;
  vi.unstubAllGlobals();
  history.replaceState(null, '', '/');
});

// ------------------------------------------------------------------ music

describe('Settings: music', () => {
  it('Music off stops the music at once, keeps effects, and stays off after a reload (title, mission, jingle, mini-games)', async () => {
    boot();
    press();
    expect(playing().map((m) => m.src)).toEqual(['/audio/music-title.mp3']);

    await openSettings();
    const music = button(/^Music: on$/, dialog()!)!;
    expect(music.getAttribute('aria-pressed')).toBe('true');
    music.click();
    expect(playing()).toHaveLength(0);
    expect(saved()).toMatchObject({ music: false, sfx: true, muted: false });
    // The focus stays on the switch that was pressed, which now says off; its slider is greyed out.
    expect((document.activeElement as HTMLElement).textContent).toBe('Music: off');
    expect(slider('Music volume').disabled).toBe(true);
    expect(slider('Effects volume').disabled).toBe(false);
    // Effects still play.
    notes.length = 0;
    metaContext()!.audio.sfx('good');
    expect(notes.length).toBeGreaterThan(0);

    // Reload: no music on the title screen, in a mission, at launch, or in a meta mode (they all use playMusic).
    reload();
    press();
    expect(playing()).toHaveLength(0);
    (await waitFor(() => button(/Quick mission/))).click();
    (await waitFor(() => button(/Start quick mission/))).click();
    (await waitFor(() => button(/Land the crew/))).click();
    await waitFor(() => button(/Plan the day/));
    const audio = metaContext()!.audio;
    audio.playMusic('mission');
    audio.playMusic('launch');
    audio.playMusic('title', true);
    expect(playing()).toHaveLength(0);

    // Back on: the music comes back right away.
    audio.setMusic(true);
    expect(playing()).toHaveLength(1);
  }, 30000);

  it('the music slider changes the playing track right away, says its value, and is saved', async () => {
    boot();
    press();
    await openSettings();
    const vol = slider('Music volume');
    expect(vol.getAttribute('aria-valuetext')).toBe('Music volume 60 percent');
    expect(dialog()!.querySelector(`label[for="${vol.id}"]`)?.textContent).toBe('Music volume');
    expect([vol.min, vol.max, vol.step]).toEqual(['0', '100', '10']);
    // 60 percent is exactly as loud as the game always was.
    expect(playing()[0].volume).toBeCloseTo(0.35);
    slide(vol, 100);
    expect(playing()[0].volume).toBeCloseTo(0.35 * (100 / 60));
    expect(vol.getAttribute('aria-valuetext')).toBe('Music volume 100 percent');
    expect(dialog()!.querySelector('.vol-value')?.textContent).toBe('100%');
    slide(vol, 20);
    expect(playing()[0].volume).toBeCloseTo(0.35 * (20 / 60));
    expect(saved().musicVolume).toBe(20);

    reload();
    press();
    expect(playing()[0].volume).toBeCloseTo(0.35 * (20 / 60));
    await openSettings();
    expect(slider('Music volume').value).toBe('20');
    expect(slider('Music volume').getAttribute('aria-valuetext')).toBe('Music volume 20 percent');
  }, 30000);
});

// ------------------------------------------------------------------ effects

describe('Settings: sound effects', () => {
  it('Effects off silences every effect (and the meta games’ own sounds), but not the music', async () => {
    boot();
    press();
    await openSettings();
    expect(notes.length).toBeGreaterThan(0); // the click that opened Settings
    button(/^Sound effects: on$/, dialog()!)!.click();
    expect(saved()).toMatchObject({ sfx: false, music: true });
    notes.length = 0;
    const audio = metaContext()!.audio;
    audio.sfx('win');
    audio.sfx('alarm');
    slide(slider('Music volume'), 80);
    expect(notes).toHaveLength(0);
    // The rover's motor hum and the rocket's engine rumble check this.
    expect(audio.muted).toBe(true);
    expect(playing()).toHaveLength(1);

    // Stays off after a reload.
    reload();
    press();
    (await waitFor(() => button(/Quick mission/))).click();
    await waitFor(() => button(/Start quick mission/));
    expect(notes).toHaveLength(0);
    expect(playing()).toHaveLength(1);

    // On again: a little blip says so.
    reload();
    press();
    await openSettings();
    expect(notes).toHaveLength(0);
    button(/^Sound effects: off$/, dialog()!)!.click();
    expect(notes.length).toBeGreaterThan(0);
    expect(metaContext()!.audio.muted).toBe(false);
  }, 30000);

  it('the effects slider plays a sample at the new loudness and is saved', async () => {
    boot();
    press();
    await openSettings();
    const vol = slider('Effects volume');
    expect(vol.getAttribute('aria-valuetext')).toBe('Effects volume 60 percent');
    notes.length = 0;
    slide(vol, 30);
    expect(notes.length).toBeGreaterThan(0);
    expect(notes[0]).toBeCloseTo(0.06 * (30 / 60));
    expect(saved().sfxVolume).toBe(30);
    // At 0 nothing plays at all, and the meta games' sounds count as off.
    slide(vol, 0);
    notes.length = 0;
    metaContext()!.audio.sfx('good');
    expect(notes).toHaveLength(0);
    expect(metaContext()!.audio.muted).toBe(true);

    reload();
    await openSettings();
    expect(slider('Effects volume').value).toBe('0');
  }, 30000);
});

// ------------------------------------------------------------------ master mute

describe('Settings: the master mute', () => {
  it('the HUD speaker still silences everything, and Settings shows it as All sound', async () => {
    boot();
    press();
    (await waitFor(() => document.querySelector<HTMLButtonElement>('button[aria-label^="Sound is on"]'))).click();
    expect(playing()).toHaveLength(0);
    notes.length = 0;
    metaContext()!.audio.sfx('good');
    expect(notes).toHaveLength(0);
    expect(saved()).toMatchObject({ muted: true, music: true, sfx: true });

    await openSettings();
    const all = button(/^All sound: off$/, dialog()!)!;
    expect(all.getAttribute('aria-pressed')).toBe('false');
    // Music and effects keep their own settings underneath.
    expect(button(/^Music: on$/, dialog()!)).not.toBeNull();
    all.click();
    expect(playing()).toHaveLength(1);
    expect(document.querySelector('button[aria-label^="Sound is on"]')).not.toBeNull();
    expect(saved().muted).toBe(false);
    expect((document.activeElement as HTMLElement).textContent).toBe('All sound: on');
  }, 30000);

  it('an old save keeps its mute, with music and effects on at the volume it always had', () => {
    localStorage.setItem('ev-settings', JSON.stringify({ muted: true, largeText: true, view3d: true }));
    boot();
    press();
    expect(playing()).toHaveLength(0);
    expect(document.querySelector('button[aria-label^="Sound is off"]')).not.toBeNull();
    button(/^Settings$/)!.click();
    expect(button(/^All sound: off$/, dialog()!)).not.toBeNull();
    expect(button(/^Music: on$/, dialog()!)).not.toBeNull();
    expect(button(/^Sound effects: on$/, dialog()!)).not.toBeNull();
    expect(slider('Music volume').value).toBe('60');

    // An unmuted old save plays exactly as before.
    localStorage.setItem('ev-settings', JSON.stringify({ muted: false }));
    reload();
    press();
    expect(playing()[0].volume).toBeCloseTo(0.35);
  });

  it('damaged stored values fall back to safe ones', () => {
    localStorage.setItem('ev-settings', JSON.stringify({ music: 'yes', musicVolume: 'loud', sfxVolume: 500, detail: 'ultra' }));
    boot();
    button(/^Settings$/)!.click();
    expect(button(/^Music: on$/, dialog()!)).not.toBeNull();
    expect(slider('Music volume').value).toBe('60');
    expect(slider('Effects volume').value).toBe('100');
    expect(button(/^Auto$/, dialog()!)!.getAttribute('aria-pressed')).toBe('true');
  });
});

// ------------------------------------------------------------------ the dialog

describe('Settings dialog', () => {
  it('has Sound, Display and motion, Text and voice, a NASA fact, a labelled control everywhere, and a pinned Done', async () => {
    boot();
    const box = await openSettings();
    expect([...box.querySelectorAll('h3')].map((x) => x.textContent)).toEqual(['Sound', 'Display and motion', 'Text size and contrast']);
    expect(box.querySelector('.settings-fact')?.textContent).toMatch(/Perseverance.*240 meters per second.*340 on Earth/);
    expect(box.querySelector<HTMLAnchorElement>('.settings-fact a')?.href).toMatch(/^https:\/\/science\.nasa\.gov\//);
    for (const el of box.querySelectorAll<HTMLElement>('button, select, input, a')) {
      const name = el.getAttribute('aria-label') || el.textContent?.trim() || (el.id && box.querySelector(`label[for="${el.id}"]`)?.textContent);
      expect(name, el.outerHTML.slice(0, 80)).toBeTruthy();
    }
    const done = box.querySelector(':scope > .actions.sticky button.primary')!;
    expect(done.textContent).toBe('Done');
    expect(document.activeElement).toBe(done);
    // The 3D detail choice is a group of three, one pressed.
    const group = box.querySelector('[role="group"][aria-labelledby="set-detail-h"]')!;
    expect([...group.querySelectorAll('button')].map((b) => `${b.textContent}:${b.getAttribute('aria-pressed')}`)).toEqual(['Auto:true', 'Faster:false', 'Sharper:false']);
  });

  it('Escape closes it back to the title; from the mission Menu it goes back to the Menu', async () => {
    localStorage.setItem('ev-tutorial-done', '1');
    boot();
    await openSettings();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await waitFor(() => !dialog() && document.querySelector('[aria-label="Escape Velocity title screen"]'));

    (await waitFor(() => button(/Quick mission/))).click();
    (await waitFor(() => button(/Start quick mission/))).click();
    (await waitFor(() => button(/Land the crew/))).click();
    await waitFor(() => button(/Plan the day/));
    button(/^Menu$/)!.click();
    const menu = await waitFor(() => document.querySelector<HTMLElement>('.modal[aria-label="Menu"]'));
    button(/^Settings$/, menu)!.click();
    button(/^Reduced motion: off$/, dialog()!)!.click();
    expect(document.documentElement.classList.contains('reduce-motion')).toBe(true);
    expect(saved().reducedMotion).toBe(true);
    button(/^Back to menu$/, dialog()!)!.click();
    expect(document.querySelector('.modal[aria-label="Menu"]')).not.toBeNull();
  }, 30000);

  it('3D detail goes to the 3D view right away, is saved, and comes back on load; ?quality= wins', async () => {
    class DetailStage extends CssStage {
      details: Detail[] = [];
      setDetail(d: Detail) {
        this.details.push(d);
      }
    }
    localStorage.setItem('ev-settings', JSON.stringify({ detail: 'low' }));
    const stage = new DetailStage();
    boot(stage);
    expect(stage.details).toEqual(['low']);
    await openSettings();
    expect(button(/^Faster$/, dialog()!)!.getAttribute('aria-pressed')).toBe('true');
    button(/^Sharper$/, dialog()!)!.click();
    expect(stage.details).toEqual(['low', 'high']);
    expect(saved().detail).toBe('high');
    expect(button(/^Sharper$/, dialog()!)!.getAttribute('aria-pressed')).toBe('true');
    expect(document.getElementById('set-detail-note')!.textContent).not.toMatch(/next time/);

    // The simple view can't change it live: it says when it will apply.
    reload();
    await openSettings();
    expect(document.getElementById('set-detail-note')!.textContent).toMatch(/Applies next time you open the game/);

    // The address wins, and says so.
    history.replaceState(null, '', '/?quality=low');
    reload();
    await openSettings();
    expect(document.getElementById('set-detail-note')!.textContent).toMatch(/web address picks Faster/);
  });

  it('a 3D view that loads later gets the saved detail', () => {
    const el = document.createElement('div');
    const swap = new SwappableStage(new CssStage());
    swap.mount(el);
    swap.setDetail('high');
    expect(swap.canSetDetail()).toBe(false);
    const three = Object.assign(new CssStage(), { setDetail: vi.fn() });
    swap.swap(three);
    expect(three.setDetail).toHaveBeenCalledWith('high');
    expect(swap.canSetDetail()).toBe(true);
    swap.setDetail('auto');
    expect(three.setDetail).toHaveBeenLastCalledWith('auto');
  });

  it("shows features' own sections (the Space Lab) after the game's, and redraws when they ask", async () => {
    let presses = 0;
    addSettingsSection({
      id: 'test-lab',
      order: 10,
      render: (rerender) =>
        h(
          'section',
          { class: 'test-lab' },
          h('h3', null, 'Test Lab'),
          h('button', { id: 'lab-btn', type: 'button', onclick: () => (presses++, rerender()) }, `Pressed ${presses}`),
        ),
    });
    addSettingsSection({ id: 'test-broken', order: 5, render: () => { throw new Error('boom'); } });
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      boot();
      const box = await openSettings();
      const lab = box.querySelector('.settings-features .test-lab')!;
      expect(lab).not.toBeNull();
      // After Sound, Display and Text and voice, and before Done.
      expect(box.querySelector('.access-panel')!.compareDocumentPosition(lab) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(lab.compareDocumentPosition(box.querySelector('.actions.sticky')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      // A broken section never breaks the dialog.
      expect(err).toHaveBeenCalled();

      const btn = box.querySelector<HTMLButtonElement>('#lab-btn')!;
      btn.focus();
      btn.click();
      expect(document.querySelectorAll('.modal')).toHaveLength(1);
      expect(dialog()!.querySelector('#lab-btn')!.textContent).toBe('Pressed 1');
      expect(document.activeElement?.id).toBe('lab-btn');
    } finally {
      err.mockRestore();
      addSettingsSection({ id: 'test-lab', order: 10, render: () => null });
      addSettingsSection({ id: 'test-broken', order: 5, render: () => null });
    }
  });
});
