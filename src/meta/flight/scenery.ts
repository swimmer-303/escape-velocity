// Written with AI assistance (Claude Code). See README "Use of AI tools".
// Pixel-art scenery for the flight mini-games, all drawn in code: a dithered butterscotch Mars sky with the blue glow
// of a Martian sunset and the rim of Gale Crater (or the flat icy plains of Arcadia Planitia), a black Moon sky with
// Earth low over the south-pole horizon, the base, the landing pad, the lander and the crew's rocket.

import type { FlightSite } from './physics';

export type Rgb = [number, number, number];
export type Scenery = 'gale' | 'arcadia' | 'moon';

export function sceneryOf(site: FlightSite, landing?: string): Scenery {
  return site === 'moon' ? 'moon' : landing === 'arcadia' ? 'arcadia' : 'gale';
}

const hex = (s: string): Rgb => [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];
const css = (c: Rgb) => `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;
const mix = (a: Rgb, b: Rgb, t: number): Rgb => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const bayer = (x: number, y: number) => (BAYER[(y & 3) * 4 + (x & 3)] + 0.5) / 16;

/** A tiny repeatable random number generator, so the scenery is the same every time. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeCanvas(w: number, h: number): { c: HTMLCanvasElement; g: CanvasRenderingContext2D } | null {
  try {
    const c = document.createElement('canvas');
    c.width = Math.max(1, w);
    c.height = Math.max(1, h);
    const g = c.getContext('2d');
    if (!g) return null;
    g.imageSmoothingEnabled = false;
    return { c, g };
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------ palettes
export const PAL = {
  marsSky: [hex('#8f6a5e'), hex('#c99466'), hex('#e3b37f'), hex('#efcf98')] as Rgb[],
  marsHalo: hex('#9cbde6'),
  marsHaloDeep: hex('#5b7bb5'),
  marsRim: hex('#b27a5c'),
  marsSharp: hex('#a86f55'),
  marsRidge: hex('#93482b'),
  marsGround: [hex('#c2562a'), hex('#a8461f'), hex('#8c391a'), hex('#6e2b14')] as Rgb[],
  marsRock: '#5a2312',
  marsRockLit: '#d9774a',
  frost: '#e6eefa',
  moonGround: [hex('#8c8c94'), hex('#76767e'), hex('#5c5c64'), hex('#44444c')] as Rgb[],
  moonHill: hex('#2c2c34'),
  moonHillLit: '#9a9aa4',
  moonRock: '#2a2a32',
  moonRockLit: '#b4b4bc',
  silhouette: { gale: '#3a1f1c', arcadia: '#3a1f1c', moon: '#18181f' } as Record<Scenery, string>,
  window: '#ffb627',
  glass: '#7ddc5a',
  panel: '#2b3a6b',
  panelLit: '#5b7bb5',
  rocket: '#ece6da',
  rocketShade: '#b9b1a3',
  nose: '#c2562a',
  outline: '#140f1a',
};

export function groundColors(sc: Scenery): Rgb[] {
  return sc === 'moon' ? PAL.moonGround : PAL.marsGround;
}

// ------------------------------------------------------------------ dithered sky
interface Halo {
  x: number;
  y: number;
  r: number;
}

/** Paint a dithered vertical gradient (stops top to bottom) into [0, height) rows, with an optional blue sun halo. */
function paintGradient(img: ImageData, height: number, stops: Rgb[], halo?: Halo) {
  const { width, data } = img;
  const bands = 9;
  for (let y = 0; y < height; y++) {
    const t = Math.min(0.9999, y / Math.max(1, height - 1)) * (stops.length - 1);
    const i = Math.floor(t);
    for (let x = 0; x < width; x++) {
      // Quantize the in-between amount to a few bands, choosing between neighbors with an ordered dither.
      const q = (t - i) * bands;
      const band = Math.floor(q) + (q - Math.floor(q) > bayer(x, y) ? 1 : 0);
      let c = mix(stops[i], stops[i + 1] ?? stops[i], band / bands);
      if (halo) {
        const d = Math.hypot(x - halo.x, (y - halo.y) * 1.25) / halo.r;
        if (d < 1) {
          const w = (1 - d) * (1 - d);
          const steps = 6;
          const qw = w * steps;
          const level = (Math.floor(qw) + (qw - Math.floor(qw) > bayer(x + 1, y + 2) ? 1 : 0)) / steps;
          c = mix(c, level > 0.55 ? PAL.marsHalo : PAL.marsHaloDeep, Math.min(0.8, level * 1.05));
        }
      }
      const k = (y * width + x) * 4;
      data[k] = c[0];
      data[k + 1] = c[1];
      data[k + 2] = c[2];
      data[k + 3] = 255;
    }
  }
}

function stars(g: CanvasRenderingContext2D, W: number, H: number, seed: number, count: number) {
  const r = rng(seed);
  for (let i = 0; i < count; i++) {
    const x = Math.floor(r() * W);
    const y = Math.floor(r() * H);
    g.fillStyle = r() < 0.2 ? '#ffffff' : r() < 0.5 ? '#c8cce0' : '#7a7f99';
    g.fillRect(x, y, 1, 1);
  }
}

/** Earth seen from the Moon: a small blue disc with land and clouds, half lit. */
export function drawEarth(g: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  const ocean = hex('#2a63c9');
  const land = hex('#6f8f4a');
  const cloud = hex('#f4f6ff');
  const night = hex('#0d1d44');
  for (let y = -r; y <= r; y++) {
    for (let x = -r; x <= r; x++) {
      if (x * x + y * y > r * r + 0.5) continue;
      const n = Math.sin(x * 1.3 + y * 0.7) + Math.cos(y * 1.1 - x * 0.4);
      let c = n > 1.1 ? land : ocean;
      if (Math.sin(y * 2.1 + x * 0.3) > 0.85 || Math.cos(x * 1.7 - y) > 0.93) c = cloud;
      // Lit from the left (the Sun is low on the same side as Earth's bright half).
      if (x > r * 0.25) c = mix(c, night, 0.85);
      g.fillStyle = css(c);
      g.fillRect(Math.round(cx + x), Math.round(cy + y), 1, 1);
    }
  }
}

/** Distant skyline heights for one pixel column: crater rim and Mount Sharp at Gale, low swells at Arcadia, hills on the Moon. */
function farHeight(sc: Scenery, x: number, W: number, H: number): { rim: number; hill: number } {
  const u = x / W;
  if (sc === 'gale') {
    const rim = H * (0.07 + 0.02 * Math.sin(u * 9.1) + 0.012 * Math.sin(u * 23 + 1) + 0.006 * Math.sin(u * 61));
    // Mount Sharp (Aeolis Mons) rises from the crater floor: a broad, layered mound.
    const d = (u - 0.7) / 0.22;
    const hill = d * d < 1 ? H * 0.15 * (1 - d * d) ** 1.4 + H * 0.004 * Math.sin(u * 80) : 0;
    return { rim, hill };
  }
  if (sc === 'arcadia') return { rim: H * (0.018 + 0.006 * Math.sin(u * 7) + 0.004 * Math.sin(u * 19 + 2)), hill: 0 };
  const rim = H * (0.05 + 0.025 * Math.abs(Math.sin(u * 5.3)) + 0.01 * Math.sin(u * 17 + 0.5));
  return { rim, hill: 0 };
}

/** The far skyline (crater rim and Mount Sharp, icy plains, or lunar hills) sitting on the ground row `groundY`. */
function drawSkyline(g: CanvasRenderingContext2D, W: number, H: number, groundY: number, sc: Scenery) {
  for (let x = 0; x < W; x++) {
    const { rim, hill } = farHeight(sc, x, W, H);
    const top = Math.round(groundY - Math.max(rim, hill));
    if (sc === 'moon') {
      g.fillStyle = css(PAL.moonHill);
      g.fillRect(x, top, 1, groundY - top);
      // Sunlit peaks: the Sun is always low near the lunar south pole.
      if ((x + top) % 3 === 0) {
        g.fillStyle = PAL.moonHillLit;
        g.fillRect(x, top, 1, 1);
      }
    } else {
      g.fillStyle = css(hill > rim ? PAL.marsSharp : PAL.marsRim);
      g.fillRect(x, top, 1, groundY - top);
      if (hill > rim) {
        // Mount Sharp's layers.
        g.fillStyle = css(mix(PAL.marsSharp, PAL.marsRim, 0.6));
        for (let y = top + 3; y < groundY; y += 4) g.fillRect(x, y, 1, 1);
      }
    }
  }
}

/** A low Mars Sun: small, because Mars is farther from the Sun than Earth. */
function drawSun(g: CanvasRenderingContext2D, x: number, y: number) {
  g.fillStyle = '#f6f8ff';
  g.fillRect(Math.round(x) - 2, Math.round(y) - 1, 5, 3);
  g.fillRect(Math.round(x) - 1, Math.round(y) - 2, 3, 5);
}

/**
 * The sky and far skyline for the landing (cached: they never move). `groundY` is the screen row of the ground.
 */
export function landingBackdrop(W: number, H: number, groundY: number, sc: Scenery): HTMLCanvasElement | null {
  const cv = makeCanvas(W, H);
  if (!cv) return null;
  const { c, g } = cv;
  if (sc === 'moon') {
    g.fillStyle = '#000';
    g.fillRect(0, 0, W, H);
    stars(g, W, groundY, 7, Math.round((W * H) / 260));
    drawEarth(g, Math.round(W * 0.74), Math.round(groundY - H * 0.2), Math.max(4, Math.round(H * 0.035)));
  } else {
    const img = g.createImageData(W, H);
    // A late-afternoon sky: butterscotch overhead, with the blue glow Mars gets around a low Sun.
    paintGradient(img, groundY, PAL.marsSky, { x: W * 0.2, y: groundY - H * 0.13, r: H * 0.34 });
    g.putImageData(img, 0, 0);
    drawSun(g, W * 0.2, groundY - H * 0.13);
  }
  drawSkyline(g, W, H, groundY, sc);
  return c;
}

/** The far skyline alone (transparent above it), bottom row = the ground, for the launch's first moments. */
export function launchSkyline(W: number, H: number, sc: Scenery): HTMLCanvasElement | null {
  const cv = makeCanvas(W, H);
  if (!cv) return null;
  drawSkyline(cv.g, W, H, H, sc);
  return cv.c;
}

/** Sky for the launch at a given height fraction (0 = ground, 1 = space). Cached by the caller. */
export function launchSky(W: number, H: number, sc: Scenery, k: number): HTMLCanvasElement | null {
  const cv = makeCanvas(W, H);
  if (!cv) return null;
  const { c, g } = cv;
  if (sc === 'moon') {
    g.fillStyle = '#000';
    g.fillRect(0, 0, W, H);
    stars(g, W, H, 11, Math.round((W * H) / 200));
    // Earth: home, where the crew is heading.
    drawEarth(g, Math.round(W * 0.76), Math.round(H * 0.4), Math.max(4, Math.round(H * 0.035)));
    return c;
  }
  const space = hex('#06050f');
  const img = g.createImageData(W, H);
  const stops = PAL.marsSky.map((s, i) => mix(s, i < 2 ? space : hex('#1b1530'), Math.min(1, k * (i < 2 ? 1.25 : 1))));
  const sun = { x: W * 0.2, y: H * 0.5 };
  paintGradient(img, H, stops, k === 0 ? { ...sun, r: H * 0.3 } : undefined);
  g.putImageData(img, 0, 0);
  if (k === 0) drawSun(g, sun.x, sun.y);
  if (k > 0.35) {
    g.globalAlpha = Math.min(1, (k - 0.35) / 0.5);
    stars(g, W, H, 11, Math.round((W * H) / 220));
    g.globalAlpha = 1;
  }
  return c;
}

// ------------------------------------------------------------------ ground, base and pad
export interface View {
  /** Screen x of world x = 0 is W/2 - camX * ppm. */
  W: number;
  H: number;
  groundY: number;
  ppm: number;
  camX: number;
}
export const sx = (v: View, x: number) => Math.round(v.W / 2 + (x - v.camX) * v.ppm);
export const sy = (v: View, y: number) => Math.round(v.groundY - y * v.ppm);

const ROCKS = (() => {
  const r = rng(42);
  return Array.from({ length: 70 }, () => ({ x: (r() - 0.5) * 520, size: 0.4 + r() * 1.6, depth: r() }));
})();

/** The ground strip: banded color, rocks (or craters and frost) that slide with the camera. */
export function drawGround(g: CanvasRenderingContext2D, v: View, sc: Scenery) {
  const cols = groundColors(sc);
  const h = v.H - v.groundY;
  for (let i = 0; i < cols.length; i++) {
    const y0 = v.groundY + Math.floor((h * i) / cols.length) - (i ? 0 : 0);
    const y1 = v.groundY + Math.floor((h * (i + 1)) / cols.length);
    g.fillStyle = css(cols[i]);
    g.fillRect(0, y0, v.W, y1 - y0);
    // Dithered seams between bands.
    if (i > 0) {
      g.fillStyle = css(cols[i - 1]);
      for (let x = (i & 1) * 2; x < v.W; x += 4) g.fillRect(x, y0, 2, 1);
    }
  }
  for (const rock of ROCKS) {
    // Rocks farther back (depth) sit higher on the strip and move less (parallax).
    const par = 0.55 + 0.45 * rock.depth;
    const x = Math.round(v.W / 2 + (rock.x - v.camX * par) * v.ppm * par);
    if (x < -6 || x > v.W + 6) continue;
    const y = Math.round(v.groundY + 2 + rock.depth * (h - 5));
    const s = Math.max(1, Math.min(5, Math.round(rock.size * v.ppm * par)));
    if (sc === 'arcadia' && rock.depth < 0.5) {
      // Frost and ice patches.
      g.fillStyle = PAL.frost;
      g.fillRect(x - s, y, s * 3, 1);
      continue;
    }
    if (sc === 'moon' && rock.depth > 0.6) {
      // A small crater: dark bowl, bright far rim.
      g.fillStyle = PAL.moonRock;
      g.fillRect(x - s, y, s * 2 + 1, 1);
      g.fillStyle = PAL.moonRockLit;
      g.fillRect(x + s, y - 1, 1, 1);
      continue;
    }
    g.fillStyle = sc === 'moon' ? PAL.moonRock : PAL.marsRock;
    g.fillRect(x, y - s + 1, s, s);
    g.fillStyle = sc === 'moon' ? PAL.moonRockLit : PAL.marsRockLit;
    g.fillRect(x, y - s + 1, Math.max(1, s - 1), 1);
  }
}

/** World-space rectangle from (x0, y0) to (x1, y1) meters, at least one pixel. */
function rect(g: CanvasRenderingContext2D, v: View, x0: number, y0: number, x1: number, y1: number) {
  const a = sx(v, x0);
  const b = sx(v, x1);
  const top = sy(v, y1);
  const bot = sy(v, y0);
  g.fillRect(Math.min(a, b), Math.min(top, bot), Math.max(1, Math.abs(b - a)), Math.max(1, Math.abs(bot - top)));
}

function dome(g: CanvasRenderingContext2D, v: View, cx: number, r: number) {
  const steps = Math.max(2, Math.round(r * v.ppm));
  for (let i = 0; i < steps; i++) {
    const yy = (i / steps) * r;
    const half = Math.sqrt(Math.max(0, r * r - yy * yy));
    rect(g, v, cx - half, yy, cx + half, yy + r / steps);
  }
}

/** The base beside the pad, as a dark silhouette with lit windows, plus the crew's rocket home standing on its own pad. */
export function drawBase(g: CanvasRenderingContext2D, v: View, sc: Scenery, opts: { rocket?: boolean; blink?: boolean } = {}) {
  const dark = PAL.silhouette[sc];
  g.fillStyle = dark;
  dome(g, v, 36, 7);
  dome(g, v, 51, 5);
  rect(g, v, 36, 0, 51, 3.2); // tunnel between domes
  // Greenhouse: a long low hall with green-lit glass.
  rect(g, v, 58, 0, 74, 4.5);
  // Antenna mast and dish.
  rect(g, v, 44.6, 0, 45.4, 17);
  rect(g, v, 42.5, 16, 47.5, 17.2);
  // Solar panel rows.
  g.fillStyle = PAL.panel;
  for (const x0 of [80, 88, 96]) rect(g, v, x0, 1, x0 + 6, 2.6);
  g.fillStyle = PAL.panelLit;
  for (const x0 of [80, 88, 96]) rect(g, v, x0, 2.4, x0 + 6, 2.6);
  g.fillStyle = dark;
  for (const x0 of [82.5, 90.5, 98.5]) rect(g, v, x0, 0, x0 + 1, 1);
  // Windows and glass.
  g.fillStyle = PAL.window;
  rect(g, v, 33, 2, 34.2, 3.2);
  rect(g, v, 38, 2, 39.2, 3.2);
  rect(g, v, 50.4, 1.8, 51.6, 3);
  g.fillStyle = PAL.glass;
  for (let x = 59.5; x < 73; x += 3) rect(g, v, x, 1.5, x + 1.5, 3.5);
  // A beacon on the mast (steady light under reduced motion).
  if (opts.blink !== false) {
    g.fillStyle = '#ff5a4f';
    rect(g, v, 44.5, 17.2, 45.5, 18.2);
  }
  if (opts.rocket) drawStandingRocket(g, v, -78);
}

/** The crew's rocket home, standing on its pad (drawn to scale: about 26 m tall). */
export function drawStandingRocket(g: CanvasRenderingContext2D, v: View, x: number) {
  g.fillStyle = PAL.silhouette.moon;
  rect(g, v, x - 6, 0, x + 6, 1.2);
  g.fillStyle = PAL.rocket;
  rect(g, v, x - 2, 1.2, x + 2, 22);
  g.fillStyle = PAL.rocketShade;
  rect(g, v, x + 1, 1.2, x + 2, 22);
  g.fillStyle = PAL.nose;
  rect(g, v, x - 1.6, 22, x + 1.6, 24.5);
  rect(g, v, x - 0.8, 24.5, x + 0.8, 26);
  rect(g, v, x - 3.2, 1.2, x - 2, 5);
  rect(g, v, x + 2, 1.2, x + 3.2, 5);
}

/** The landing pad: a slab with yellow-and-black edge stripes and a light at each end. */
export function drawPad(g: CanvasRenderingContext2D, v: View, half: number, lightsOn: boolean) {
  const x0 = sx(v, -half);
  const x1 = sx(v, half);
  const y = v.groundY;
  const w = Math.max(3, x1 - x0);
  g.fillStyle = '#2e2654';
  g.fillRect(x0, y - 1, w, 3);
  for (let x = x0; x < x0 + w; x += 4) {
    g.fillStyle = '#ffb627';
    g.fillRect(x, y - 1, 2, 1);
    g.fillStyle = '#140f1a';
    g.fillRect(x + 2, y - 1, 2, 1);
  }
  // A big H in the middle, readable even zoomed out.
  if (w >= 12) {
    const cx = Math.round((x0 + x1) / 2);
    g.fillStyle = '#f4ead8';
    g.fillRect(cx - 2, y, 1, 2);
    g.fillRect(cx + 2, y, 1, 2);
    g.fillRect(cx - 1, y + 1, 3, 1);
  }
  g.fillStyle = lightsOn ? '#5ef2e6' : '#1f6f6a';
  g.fillRect(x0 - 1, y - 3, 2, 2);
  g.fillRect(x0 + w - 1, y - 3, 2, 2);
}

// ------------------------------------------------------------------ sprites
const SPRITE_COLORS: Record<string, string> = {
  k: PAL.outline,
  w: PAL.rocket,
  s: PAL.rocketShade,
  c: '#5ef2e6',
  a: '#ffb627',
  f: '#d9a63a',
  g: '#8a8a96',
  r: PAL.nose,
};

const LANDER = [
  '....kkkkk....',
  '...kwwwwsk...',
  '..kwwcccwsk..',
  '..kwwcccwsk..',
  '.kkwwwwwwskk.',
  '.kaaaaaaaaak.',
  '.kfffffffffk.',
  '..kk.kkk.kk..',
  '.k...kgk...k.',
  'k.....k.....k',
  'k...........k',
  'kk.........kk',
];

const ROCKET = [
  '....k....',
  '...krk...',
  '...krk...',
  '..krrrk..',
  '..kwwsk..',
  '..kwcsk..',
  '..kwwsk..',
  '..kwwsk..',
  '..kwwsk..',
  '..kaask..',
  '..kwwsk..',
  '..kwwsk..',
  '..kwwsk..',
  '..kwwsk..',
  '..kwwsk..',
  '..kaask..',
  '.kkwwskk.',
  '.krkwskrk',
  'krrkwskrr',
  'krk.kk.rk',
  'kk..gg..k',
];

const spriteCache = new Map<string, HTMLCanvasElement | null>();
function sprite(name: string, rows: string[]): HTMLCanvasElement | null {
  if (spriteCache.has(name)) return spriteCache.get(name)!;
  const cv = makeCanvas(rows[0].length, rows.length);
  if (cv) {
    rows.forEach((row, y) =>
      [...row].forEach((ch, x) => {
        const col = SPRITE_COLORS[ch];
        if (!col) return;
        cv.g.fillStyle = col;
        cv.g.fillRect(x, y, 1, 1);
      }),
    );
  }
  spriteCache.set(name, cv?.c ?? null);
  return cv?.c ?? null;
}

export const LANDER_SIZE = { w: LANDER[0].length, h: LANDER.length };
export const ROCKET_SIZE = { w: ROCKET[0].length, h: ROCKET.length };

/** Draw a sprite centered at (x, y), turned by `angle` radians, at a whole-number zoom. */
function drawSprite(g: CanvasRenderingContext2D, img: HTMLCanvasElement | null, x: number, y: number, angle: number, zoom = 1) {
  if (!img) return;
  g.save();
  g.translate(Math.round(x), Math.round(y));
  if (angle) g.rotate(angle);
  g.drawImage(img, Math.round((-img.width * zoom) / 2), Math.round((-img.height * zoom) / 2), img.width * zoom, img.height * zoom);
  g.restore();
}

/** The lander; (x, y) is the middle of its feet. */
export function drawLander(g: CanvasRenderingContext2D, x: number, y: number, tilt: number, zoom: number) {
  drawSprite(g, sprite('lander', LANDER), x, y - (LANDER.length * zoom) / 2, tilt, zoom);
}

/** The Mars parachute: an orange-and-white canopy above the lander, with lines down to it. */
export function drawChute(g: CanvasRenderingContext2D, x: number, topOfLander: number, zoom: number, flutter: number) {
  const w = 21 * zoom;
  const cy = topOfLander - 16 * zoom + flutter;
  g.fillStyle = '#e8e4da';
  for (let i = 0; i <= 4; i++) {
    const t = i / 4;
    g.fillRect(Math.round(x - w / 2 + t * w * 0.98), Math.round(cy + 3 * zoom), 1, Math.round(topOfLander - cy - 3 * zoom));
  }
  for (let row = 0; row < 4 * zoom; row++) {
    const half = Math.round((w / 2) * Math.sqrt(1 - ((4 * zoom - row) / (4 * zoom + 1)) ** 2));
    for (let px = -half; px < half; px++) {
      g.fillStyle = Math.floor((px + 50 * zoom) / (3 * zoom)) % 2 ? '#c2562a' : '#f4ead8';
      g.fillRect(Math.round(x + px), Math.round(cy + row), 1, 1);
    }
  }
}

/** A blocky flame, `len` pixels long, pointing down from (x, y) in the sprite's frame. */
export function drawFlame(g: CanvasRenderingContext2D, x: number, y: number, angle: number, len: number, width: number, flicker: number) {
  if (len <= 0) return;
  g.save();
  g.translate(Math.round(x), Math.round(y));
  if (angle) g.rotate(angle);
  const L = Math.max(2, Math.round(len + flicker));
  g.fillStyle = '#ff5a4f';
  g.fillRect(-Math.ceil(width / 2), 0, width, L);
  g.fillStyle = '#ffb627';
  g.fillRect(-Math.ceil(width / 2) + 1, 0, Math.max(1, width - 2), Math.round(L * 0.7));
  g.fillStyle = '#fff3d1';
  g.fillRect(-Math.ceil(width / 2) + Math.max(1, Math.floor(width / 3)), 0, Math.max(1, width - 2 * Math.max(1, Math.floor(width / 3))), Math.round(L * 0.4));
  g.restore();
}

/** The rocket, centered at (x, y), nose turned `pitch` radians from straight up. */
export function drawRocket(g: CanvasRenderingContext2D, x: number, y: number, pitch: number, zoom: number) {
  drawSprite(g, sprite('rocket', ROCKET), x, y, pitch, zoom);
}

/**
 * The planet below the climbing rocket, as seen from height `h`: a curved limb drawn one pixel column at a time
 * (crisp edges at any size), with a thin band of haze above it on Mars.
 */
export function drawPlanet(g: CanvasRenderingContext2D, W: number, H: number, cx: number, cy: number, radiusPx: number, sc: Scenery) {
  const cols = groundColors(sc);
  const top = cols[0];
  const deep = cols[cols.length - 1];
  // Nearly flat (curving less than 2 pixels across the screen): draw it flat, so it doesn't show one-pixel steps.
  const edge = Math.max(Math.abs(cx), Math.abs(W - cx));
  const flat = (edge * edge) / (2 * radiusPx) < 2;
  for (let x = 0; x < W; x++) {
    const dx = flat ? 0 : x + 0.5 - cx;
    if (Math.abs(dx) >= radiusPx) continue;
    const yTop = cy - Math.sqrt(radiusPx * radiusPx - dx * dx);
    if (yTop >= H) continue;
    const y0 = Math.max(0, Math.round(yTop));
    if (sc !== 'moon') {
      g.fillStyle = 'rgba(217,160,102,0.6)';
      g.fillRect(x, y0 - 2, 1, 2);
    }
    g.fillStyle = css(top);
    g.fillRect(x, y0, 1, H - y0);
    // Shade toward the bottom of the screen, with a dithered edge.
    const shadeFrom = y0 + 4 + ((x * 7) % 3);
    if (shadeFrom < H) {
      g.fillStyle = css(mix(top, deep, 0.6));
      g.fillRect(x, shadeFrom, 1, H - shadeFrom);
    }
  }
}
