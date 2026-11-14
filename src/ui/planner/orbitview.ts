// Written with AI assistance (Claude Code). See README "Use of AI tools".
// A small top-down view of one trip: the Sun, Earth and Mars at their real positions (JPL elements), and the
// ship's path from the Lambert solution, flown forward with two-body motion. Retro pixel squares, no textures.
// Seen from above the Sun's north pole, so everything goes around counterclockwise. Planet sizes are not to scale.

import { h } from '../dom';
import { planetState } from '../../orbits/ephemeris';
import { propagate } from '../../orbits/kepler';
import { MU_SUN, AU_KM, DAY_S } from '../../orbits/constants';
import type { Trip } from '../../orbits/transfer';
import type { Vec3 } from '../../orbits/vec';

const SVG_NS = 'http://www.w3.org/2000/svg';
function s<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}, ...kids: Array<SVGElement | string>): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  for (const c of kids) el.append(c);
  return el;
}

/** Hundredths of an AU (so SVG text sizes stay in normal units), y flipped so the planets go counterclockwise on screen. */
const U = 100;
const P = (r: Vec3): [number, number] => [(r[0] / AU_KM) * U, (-r[1] / AU_KM) * U];
const f3 = (v: number) => (Math.round(v * 10) / 10).toString();
const pts = (list: Array<[number, number]>) => list.map(([x, y]) => `${f3(x)},${f3(y)}`).join(' ');

const FRAMES = 120;
const LOOP_MS = 6000;
const HOLD_MS = 1200;

export interface OrbitView {
  el: HTMLElement;
  show(t: Trip | null): void;
}

export function orbitView(reducedMotion: boolean): OrbitView {
  const SIZE = 2 * U; // Mars never goes past 1.67 AU, so this leaves room for its label
  const orbitE = s('polyline', { class: 'tp-orbit earth', points: '' });
  const orbitM = s('polyline', { class: 'tp-orbit mars', points: '' });
  const pathAll = s('polyline', { class: 'tp-path-all', points: '' });
  const pathDone = s('polyline', { class: 'tp-path', points: '' });
  const px = (cls: string, size: number) => s('rect', { class: cls, width: size, height: size, x: 0, y: 0 });
  const sun = s('rect', { class: 'tp-sun', x: -7, y: -7, width: 14, height: 14 });
  const earthEnd = px('tp-ghost earth', 10);
  const marsStart = px('tp-ghost mars', 10);
  const earth = px('tp-planet earth', 10);
  const mars = px('tp-planet mars', 10);
  const ship = px('tp-ship', 6);
  const label = (text: string, cls: string) => s('text', { class: `tp-label ${cls}`, x: 0, y: 0 }, text);
  const earthLabel = label('Earth', 'earth');
  const marsLabel = label('Mars', 'mars');
  const sunLabel = s('text', { class: 'tp-label sun', x: 0, y: 20, 'text-anchor': 'middle' }, 'Sun');
  const dayText = s('text', { class: 'tp-day', x: -SIZE + 8, y: SIZE - 10 }, '');
  const svg = s(
    'svg',
    { viewBox: `${-SIZE} ${-SIZE} ${2 * SIZE} ${2 * SIZE}`, class: 'tp-orbits', role: 'img', 'aria-label': 'Top-down view of the trip' },
    orbitE,
    orbitM,
    pathAll,
    pathDone,
    sun,
    sunLabel,
    marsStart,
    earthEnd,
    mars,
    earth,
    ship,
    marsLabel,
    earthLabel,
    dayText,
  );
  const desc = h('p', { class: 'tp-orbit-desc' });
  let playing = !reducedMotion;
  const playBtn = h('button', { class: 'btn small', 'aria-pressed': String(playing), onclick: () => setPlaying(!playing) }, playing ? 'Pause' : 'Play the trip');
  const el = h(
    'figure',
    { class: 'tp-view' },
    h('div', { class: 'tp-view-box' }, svg),
    h('figcaption', null, desc, h('div', { class: 'tp-view-row' }, playBtn, h('span', { class: 'tp-note' }, 'Seen from above. Planets not to scale.'))),
  );

  let frames: { e: Array<[number, number]>; m: Array<[number, number]>; ship: Array<[number, number]> } | null = null;
  let trip: Trip | null = null;
  let t0 = 0;
  let raf = 0;

  const place = (r: SVGRectElement, [x, y]: [number, number]) => {
    const w = Number(r.getAttribute('width'));
    r.setAttribute('x', f3(x - w / 2));
    r.setAttribute('y', f3(y - w / 2));
  };
  const placeLabel = (t: SVGTextElement, [x, y]: [number, number]) => {
    // Push the label outward from the Sun so it never sits on the orbit lines inside.
    const d = Math.hypot(x, y) || 1;
    const anchor = x / d > 0.4 ? 'start' : x / d < -0.4 ? 'end' : 'middle';
    const halfW = 18; // about half of "Earth" at this size
    let lx = x + (x / d) * 16;
    if (anchor === 'start') lx = Math.min(lx, SIZE - 2 * halfW);
    else if (anchor === 'end') lx = Math.max(lx, -SIZE + 2 * halfW);
    else lx = Math.max(-SIZE + halfW, Math.min(SIZE - halfW, lx));
    t.setAttribute('x', f3(lx));
    t.setAttribute('y', f3(Math.max(-SIZE + 12, Math.min(SIZE - 4, y + (y / d) * 16 + 4))));
    t.setAttribute('text-anchor', anchor);
  };

  /** Draw frame k (0..FRAMES), or the whole trip at once when k is null. */
  const draw = (k: number | null) => {
    if (!frames || !trip) return;
    const whole = k === null;
    const kk = whole ? FRAMES : k;
    const e = whole ? frames.e[0] : frames.e[kk];
    const m = whole ? frames.m[0] : frames.m[kk];
    place(earth, e);
    place(mars, m);
    place(ship, frames.ship[kk]);
    placeLabel(earthLabel, e);
    placeLabel(marsLabel, m);
    pathDone.setAttribute('points', pts(frames.ship.slice(0, kk + 1)));
    // The still picture shows where Earth will be when the ship arrives; the animation shows where Mars was.
    earthEnd.style.display = whole ? '' : 'none';
    marsStart.style.display = whole ? 'none' : '';
    const day = Math.round((kk / FRAMES) * trip.tof);
    dayText.textContent = whole ? `Whole trip: ${Math.round(trip.tof)} days` : `Day ${day} of ${Math.round(trip.tof)}`;
  };

  const tick = (now: number) => {
    raf = 0;
    if (!svg.isConnected || !playing) return;
    const t = (now - t0) % (LOOP_MS + HOLD_MS);
    draw(Math.min(FRAMES, Math.floor((t / LOOP_MS) * FRAMES)));
    raf = requestAnimationFrame(tick);
  };
  const start = () => {
    if (raf || typeof requestAnimationFrame !== 'function') return;
    t0 = performance.now();
    raf = requestAnimationFrame(tick);
  };
  function setPlaying(on: boolean) {
    playing = on;
    playBtn.setAttribute('aria-pressed', String(on));
    playBtn.textContent = on ? 'Pause' : 'Play the trip';
    if (on) start();
    else {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      draw(null);
    }
  }

  function show(t: Trip | null) {
    trip = t;
    if (!t) {
      frames = null;
      desc.textContent = 'No path for these dates.';
      return;
    }
    const e: Array<[number, number]> = [];
    const m: Array<[number, number]> = [];
    const sh: Array<[number, number]> = [];
    for (let k = 0; k <= FRAMES; k++) {
      const d = t.depart + (k / FRAMES) * t.tof;
      e.push(P(planetState('earth', d).r));
      m.push(P(planetState('mars', d).r));
      sh.push(P(k === 0 ? t.start.r : k === FRAMES ? t.end.r : propagate(t.start.r, t.shipV1, (k / FRAMES) * t.tof * DAY_S, MU_SUN).r));
    }
    frames = { e, m, ship: sh };
    const ring = (planet: 'earth' | 'mars', days: number) => Array.from({ length: 97 }, (_, k) => P(planetState(planet, t.depart + (k / 96) * days).r));
    orbitE.setAttribute('points', pts(ring('earth', 365.26)));
    orbitM.setAttribute('points', pts(ring('mars', 686.98)));
    pathAll.setAttribute('points', pts(sh));
    place(earthEnd, e[FRAMES]);
    place(marsStart, m[0]);
    desc.textContent = `The ship (white) leaves Mars (red) and meets Earth (blue) ${Math.round(t.tof)} days later, after going ${Math.round(t.sweepDeg)} degrees around the Sun.`;
    if (playing) {
      t0 = performance.now();
      draw(0);
      start();
    } else draw(null);
  }

  return { el, show };
}
