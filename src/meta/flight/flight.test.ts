// @vitest-environment happy-dom
// Written with AI assistance (Claude Code). See README "Use of AI tools".
// The flight interstitials end-to-end in a headless DOM (no real canvas here, so nothing is drawn, but everything
// else runs): Skip, finishing, XP, best medals, cleanup, and the Flight school row on the title screen.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { onGame, runInterstitial, renderTitleExtras, type InterstitialContext } from '../hooks';
import { createMission } from '../../sim/sim';
import { testConfig } from '../../sim/fixtures.test-util';
import type { Stage } from '../../render/stage';
import type { GameAudio } from '../../ui/audio';
import { STORE_KEY, bestFor, recordFlight } from './store';
import { MEDAL_XP } from './physics';
import './index';

// ------------------------------------------------------------------ a hand-cranked animation clock
let queue: Array<{ id: number; cb: FrameRequestCallback }> = [];
let nextId = 1;
let now = 0;

function tick(frames = 1, ms = 100) {
  for (let i = 0; i < frames; i++) {
    now += ms;
    const due = queue.splice(0);
    for (const f of due) f.cb(now);
  }
}

async function until(cond: () => boolean, maxFrames = 2000) {
  for (let i = 0; i < maxFrames && !cond(); i++) {
    tick(1);
    if (i % 50 === 0) await Promise.resolve();
  }
  await flush();
  if (!cond()) throw new Error('condition never became true');
}

async function flush() {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

const btn = (re: RegExp) => [...document.querySelectorAll<HTMLButtonElement>('button')].find((b) => re.test(b.textContent ?? '')) ?? null;
const key = (type: 'keydown' | 'keyup', k: string, target: EventTarget = document.querySelector('.ev-flight') ?? document.body) =>
  target.dispatchEvent(new KeyboardEvent(type, { key: k, bubbles: true, cancelable: true }));

let root: HTMLElement;
const audio = { sfx: vi.fn(), muted: true } as unknown as GameAudio;

function ctx(site: 'mars' | 'moon' = 'mars'): InterstitialContext {
  const mission = createMission(testConfig('flight', 'cadet', 1, undefined, 0, site));
  return { mission, mode: 'quick', site, root, stage: {} as Stage, audio, reducedMotion: false };
}

beforeEach(() => {
  document.body.innerHTML = '<div id="app"></div><div id="modal-root"></div>';
  root = document.getElementById('modal-root')!;
  localStorage.clear();
  queue = [];
  now = 0;
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    const id = nextId++;
    queue.push({ id, cb });
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => {
    queue = queue.filter((f) => f.id !== id);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('flight interstitials', () => {
  it('Skip on the how-to card ends the landing right away, clears the screen and gives no XP', async () => {
    const xp: number[] = [];
    const stop = onGame('xp', (p) => xp.push(p.amount));
    const done = runInterstitial('landing', ctx());
    expect(root.querySelector('.ev-flight')).not.toBeNull();
    expect(root.textContent).toContain('3.71 m/s²');
    expect(root.textContent).toContain('seven minutes of terror');
    expect(root.textContent).toContain('12 minutes'); // the mission's light time
    expect(document.getElementById('app')!.hasAttribute('inert')).toBe(true);
    btn(/^Skip/)!.click();
    await done;
    expect(root.childElementCount).toBe(0);
    expect(document.getElementById('app')!.hasAttribute('inert')).toBe(false);
    expect(xp).toEqual([]);
    stop();
  });

  it('Escape skips in the middle of a flight, and every listener and frame is cleaned up', async () => {
    const added: Array<[EventTarget, string, unknown]> = [];
    const removed: Array<[EventTarget, string, unknown]> = [];
    for (const target of [window, document] as EventTarget[]) {
      const add = target.addEventListener.bind(target);
      const rem = target.removeEventListener.bind(target);
      vi.spyOn(target, 'addEventListener').mockImplementation((t: string, fn: unknown, o?: unknown) => {
        added.push([target, t, fn]);
        add(t, fn as EventListener, o as AddEventListenerOptions);
      });
      vi.spyOn(target, 'removeEventListener').mockImplementation((t: string, fn: unknown, o?: unknown) => {
        removed.push([target, t, fn]);
        rem(t, fn as EventListener, o as EventListenerOptions);
      });
    }
    const done = runInterstitial('launch', ctx('moon'));
    btn(/Start launch/)!.click();
    await flush();
    tick(5);
    expect(queue.length).toBe(1);
    key('keydown', 'Escape');
    await done;
    expect(root.childElementCount).toBe(0);
    expect(queue.length).toBe(0);
    expect(added.length).toBeGreaterThan(0);
    for (const [target, type, fn] of added) expect(removed.some(([t, ty, f]) => t === target && ty === type && f === fn), `${type} listener removed`).toBe(true);
  });

  it('a crash never hurts: rewind, or let the autopilot land (10 XP), then Continue hands back to the game', async () => {
    const xp: Array<{ amount: number; reason: string }> = [];
    const stop = onGame('xp', (p) => xp.push(p));
    const done = runInterstitial('landing', ctx());
    btn(/Start landing/)!.click();
    await flush();
    // Nobody touches the controls: the lander falls too fast.
    await until(() => !!btn(/Let the autopilot land/));
    expect(root.textContent).toContain('Too fast!');
    expect(btn(/Try again/)).not.toBeNull();
    btn(/Let the autopilot land/)!.click();
    await flush();
    await until(() => !!btn(/^Continue/));
    expect(root.textContent).toContain('The autopilot landed');
    expect(xp).toEqual([{ amount: 10, reason: expect.stringContaining('Autopilot') }]);
    // Autopilot landings don't count as a medal.
    expect(bestFor('landing', 'mars')).toBeNull();
    btn(/^Continue/)!.click();
    await done;
    expect(root.childElementCount).toBe(0);
    expect(queue.length).toBe(0);
    stop();
  });

  it('the launch always reaches escape velocity, awards medal XP, saves the best medal and resolves on Continue', async () => {
    const xp: number[] = [];
    const stop = onGame('xp', (p) => xp.push(p.amount));
    const done = runInterstitial('launch', ctx());
    btn(/Start launch/)!.click();
    await flush();
    // Hold full power and steer right now and then (keyboard), then let the computer help.
    key('keydown', ' ');
    tick(10);
    expect(root.querySelector('.ev-fhud')!.textContent).toMatch(/km\/s/);
    let said = '';
    const live = root.querySelector('[aria-live]')!;
    const watch = new MutationObserver(() => (said += ` ${live.textContent}`));
    watch.observe(live, { childList: true, subtree: true, characterData: true });
    await until(() => !!btn(/^Continue/), 3000);
    watch.disconnect();
    key('keyup', ' ');
    expect(said).toMatch(/Escape velocity!/);
    expect(said).toMatch(/Orbit speed/);
    const medalText = root.querySelector('.ev-flight-medal b')!.textContent!;
    const medal = /Gold/.test(medalText) ? 'gold' : /Silver/.test(medalText) ? 'silver' : 'bronze';
    expect(xp).toEqual([MEDAL_XP[medal]]);
    expect(root.textContent).toContain('New best!');
    expect(JSON.parse(localStorage.getItem(STORE_KEY)!).best['launch-mars'].medal).toBe(medal);
    btn(/^Continue/)!.click();
    await done;
    expect(root.childElementCount).toBe(0);
    stop();
  });

  it('flying again in the same visit can only top XP up to the better medal', async () => {
    const xp: number[] = [];
    const stop = onGame('xp', (p) => xp.push(p.amount));
    const done = runInterstitial('launch', ctx('moon'));
    btn(/Start launch/)!.click();
    await flush();
    await until(() => !!btn(/^Continue/), 3000); // nobody flies: the computer does, bronze
    expect(xp).toEqual([MEDAL_XP.bronze]);
    btn(/Fly again/)!.click();
    await flush();
    await until(() => !!btn(/^Continue/), 3000);
    expect(xp).toEqual([MEDAL_XP.bronze]); // same medal again: nothing more
    btn(/^Continue/)!.click();
    await done;
    stop();
  });

  it('still works (and is skippable) when the canvas cannot draw at all', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => {
      throw new Error('no canvas');
    });
    const done = runInterstitial('landing', ctx('moon'));
    btn(/Start landing/)!.click();
    await flush();
    tick(20);
    expect(root.querySelector('.ev-fhud')!.textContent).toContain('m/s');
    btn(/^Skip/)!.click();
    await done;
    expect(root.childElementCount).toBe(0);
  });

  it('keyboard and touch both fire the engine', async () => {
    const done = runInterstitial('landing', ctx('moon'));
    btn(/Start landing/)!.click();
    await flush();
    tick(2);
    const fuel = () => Number(root.querySelector('.ev-gauge.fuel b')!.textContent);
    expect(fuel()).toBe(100);
    key('keydown', 'ArrowUp');
    tick(20);
    key('keyup', 'ArrowUp');
    const afterKeys = fuel();
    expect(afterKeys).toBeLessThan(100);
    const thrust = root.querySelector<HTMLButtonElement>('.ev-flight-ctl.thrust')!;
    thrust.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 7, bubbles: true, cancelable: true }));
    expect(thrust.classList.contains('pressed')).toBe(true);
    tick(20);
    window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 7, bubbles: true }));
    expect(thrust.classList.contains('pressed')).toBe(false);
    expect(fuel()).toBeLessThan(afterKeys);
    btn(/^Skip/)!.click();
    await done;
  });
});

describe('Flight school', () => {
  it('adds a row to the title screen with all four flights and the best medals', () => {
    recordFlight('landing', 'moon', 'gold', 0.9);
    const el = renderTitleExtras().find((e) => e.classList.contains('ev-flight-school'))!;
    expect(el).toBeTruthy();
    const buttons = [...el.querySelectorAll('button')].map((b) => b.textContent);
    // Each button: the medal's letter (G, S, B, or - for none), then the flight.
    expect(buttons).toEqual(['-Land on Mars', 'GLand on the Moon', '-Launch from Mars', '-Launch from the Moon']);
    expect(el.querySelector('[data-flight-school="landing-moon"]')!.getAttribute('aria-label')).toContain('Best medal: Gold');
  });

  it('opens a practice flight over the title screen, gives XP only for beating your best, then puts the title back', async () => {
    recordFlight('launch', 'moon', 'gold', 0.95);
    const xp: number[] = [];
    const stop = onGame('xp', (p) => xp.push(p.amount));
    const title = document.getElementById('modal-root')!;
    title.append(Object.assign(document.createElement('div'), { textContent: 'Title screen' }));
    const el = renderTitleExtras().find((e) => e.classList.contains('ev-flight-school'))!;
    title.append(el);
    el.querySelector<HTMLButtonElement>('[data-flight-school="launch-moon"]')!.click();
    const host = document.querySelector('.ev-flight-host')!;
    expect(host).not.toBeNull();
    expect(title.hasAttribute('inert')).toBe(true);
    expect(host.textContent).toContain('Flight school');
    btn(/Start launch/)!.click();
    await flush();
    await until(() => !!btn(/^Done/), 3000);
    expect(host.textContent).toContain('Beat your best medal to earn XP.');
    expect(xp).toEqual([]);
    btn(/^Done/)!.click();
    await flush();
    expect(document.querySelector('.ev-flight-host')).toBeNull();
    expect(title.hasAttribute('inert')).toBe(false);
    expect(title.textContent).toContain('Title screen');
    stop();
  });
});

describe('drawing', () => {
  it('draws every scene (Gale, Arcadia, the Moon; landing and launch) without errors on a 2D canvas', async () => {
    // A stand-in 2D context: counts drawing calls, rejects NaN or Infinity, accepts everything else.
    const calls: Record<string, number> = {};
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
      const base: Record<string, unknown> = {
        canvas: this,
        createImageData: (w: number, h: number) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
      };
      return new Proxy(base, {
        get: (t, k: string) =>
          k in t
            ? t[k]
            : (...args: unknown[]) => {
                for (const a of args) if (typeof a === 'number' && !Number.isFinite(a)) throw new Error(`${k} got ${a}`);
                calls[k] = (calls[k] ?? 0) + 1;
              },
        set: (t, k: string, v) => ((t[k] = v), true),
      }) as unknown as CanvasRenderingContext2D;
    } as never);
    const errors = vi.spyOn(console, 'error');
    for (const [site, landing] of [
      ['mars', undefined],
      ['mars', 'arcadia'],
      ['moon', undefined],
    ] as const) {
      const c = ctx(site);
      if (landing) c.mission = createMission(testConfig('flight', 'cadet', 1, undefined, 0, site, landing));
      let done = runInterstitial('landing', c);
      btn(/Start landing/)!.click();
      await flush();
      await until(() => !!btn(/Let the autopilot land/));
      btn(/Let the autopilot land/)!.click();
      await flush();
      await until(() => !!btn(/^Continue/));
      btn(/^Continue/)!.click();
      await done;
      done = runInterstitial('launch', c);
      btn(/Start launch/)!.click();
      await flush();
      key('keydown', 'ArrowUp');
      await until(() => !!btn(/^Continue/), 3000);
      key('keyup', 'ArrowUp');
      btn(/^Continue/)!.click();
      await done;
    }
    expect(errors).not.toHaveBeenCalled();
    expect(calls.fillRect).toBeGreaterThan(1000);
    expect(calls.drawImage).toBeGreaterThan(100);
    expect(calls.putImageData).toBeGreaterThan(0);
  });
});
