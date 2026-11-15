// @vitest-environment happy-dom
// Written with AI assistance (Claude Code). See README "Use of AI tools".
// Sound effects wait for the player's first press: before it the browser keeps sound off, and an AudioContext
// made then only logs an autoplay warning in the console.

import { describe, it, expect, vi } from 'vitest';
import { GameAudio } from './audio';

describe('GameAudio', () => {
  it('makes no AudioContext before the first press, then plays effects', () => {
    let made = 0;
    class FakeContext {
      state = 'running';
      currentTime = 0;
      destination = {};
      constructor() {
        made++;
      }
      createOscillator() {
        return { type: '', frequency: { value: 0 }, connect: (x: unknown) => x, start() {}, stop() {} };
      }
      createGain() {
        return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect: (x: unknown) => x };
      }
    }
    vi.stubGlobal('AudioContext', FakeContext);
    const audio = new GameAudio(false);
    audio.sfx('alarm');
    expect(made).toBe(0);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    audio.sfx('click');
    expect(made).toBe(1);
    vi.unstubAllGlobals();
  });
});
