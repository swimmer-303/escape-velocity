// Written with AI assistance (Claude Code). See README "Use of AI tools".
// "Plan the trip home": an interactive porkchop plot of real trips from Mars to Earth.
//
// x = the day you leave Mars, y = how many days the trip takes, color = the total speed change the ship needs
// (leave a low orbit around Mars + slow into a low orbit around Earth). Every cell is a real Lambert solution
// between the real positions of Mars and Earth (src/orbits). Pick a trip with the mouse, a finger or the arrow keys.
//
// Chart notes (dataviz method): one blue ramp in six steps, validated as an ordinal ramp (monotone lightness,
// adjacent steps >= 0.06 apart, darkest step >= 2:1 on the panel #15122b). It runs bright = cheap, the reverse of
// the usual "more is darker" on a dark surface, because the reader's job is to find the cheap trips: the legend
// says so in words. Contour lines separate the bands, the crosshair has a dark outline so it shows on every step,
// and a table lists every number.

import { h } from '../dom';
import { emptyPorkchop, fillColumns, refine, trip, windowMinima, cellDepart, cellTof, escapeSpeed, type Porkchop, type PorkchopSpec, type Trip } from '../../orbits/transfer';
import { daysSinceJ2000, msFromJ2000Days, planetState, longitudeDeg } from '../../orbits/ephemeris';
import { MARS } from '../../orbits/constants';
import { contourSegments } from './contours';
import { orbitView } from './orbitview';

/** Color bands of total speed change, km/s. Blue ramp steps 100, 200, 300, 400, 500, 600 of the dataviz palette. */
export const BANDS = [
  { max: 6, color: '#cde2fb', label: 'under 6', word: 'Cheapest' },
  { max: 7, color: '#9ec5f4', label: '6 to 7', word: 'Cheap' },
  { max: 8, color: '#6da7ec', label: '7 to 8', word: 'OK' },
  { max: 10, color: '#3987e5', label: '8 to 10', word: 'Costly' },
  { max: 12, color: '#256abf', label: '10 to 12', word: 'Very costly' },
  { max: Infinity, color: '#184f95', label: 'over 12', word: 'Way too costly' },
] as const;
const LEVELS = [6, 7, 8, 10, 12];

export const bandOf = (dv: number) => {
  if (!Number.isFinite(dv)) return BANDS.length - 1;
  const k = BANDS.findIndex((b) => dv < b.max);
  return k < 0 ? BANDS.length - 1 : k;
};

const MONTH_DAYS = 30.4375;

const fmtDate = (d: number) => new Date(msFromJ2000Days(d)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const fmtMonth = (d: number) => new Date(msFromJ2000Days(d)).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
const kms = (v: number) => `${v.toFixed(1)} km/s`;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** The chart's range: departures from January 1 of this year for 7.5 years (three or four launch windows). */
export function plannerSpec(now: Date): PorkchopSpec {
  // JPL's elements are fit for 1800-2050, so the chart never runs past mid-2049.
  const year = clamp(now.getUTCFullYear(), 1801, 2042);
  const start = daysSinceJ2000(Date.UTC(year, 0, 1));
  const end = daysSinceJ2000(Date.UTC(year + 7, 6, 1));
  return { from: 'mars', to: 'earth', departStart: start, departStep: 5, departCount: Math.floor((end - start) / 5) + 1, tofStart: 80, tofStep: 5, tofCount: 69 };
}

/** The grid survives closing the planner, so opening it again is instant. */
let cache: { key: string; grid: Porkchop; cols: number } | null = null;

export interface PlannerOptions {
  reducedMotion: boolean;
  back: () => void;
  backLabel?: string;
  /** "Today" (tests pin it). */
  now?: Date;
  /** Override the grid (tests use a coarser one). */
  spec?: PorkchopSpec;
}

export interface Planner {
  el: HTMLElement;
  /** Resolves when every trip in the chart has been worked out and the best one is selected. */
  ready: Promise<void>;
}

interface Geo {
  W: number;
  H: number;
  left: number;
  top: number;
  pw: number;
  ph: number;
  x: (dep: number) => number;
  y: (tof: number) => number;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
function s<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}, ...kids: Array<SVGElement | string>): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, typeof v === 'number' ? String(Math.round(v * 10) / 10) : v);
  for (const c of kids) el.append(c);
  return el;
}

export function renderPlanner(opts: PlannerOptions): Planner {
  const now = opts.now ?? new Date();
  const today = daysSinceJ2000(now.getTime());
  const spec = opts.spec ?? plannerSpec(now);
  const key = JSON.stringify(spec);
  if (!cache || cache.key !== key) cache = { key, grid: emptyPorkchop(spec), cols: 0 };
  const store = cache;
  const grid = store.grid;
  const nx = grid.departCount;
  const ny = grid.tofCount;
  const depEnd = cellDepart(grid, nx - 1);
  const tofEnd = cellTof(grid, ny - 1);

  // ------------------------------------------------------------------ state
  let sel = { depart: grid.departStart + Math.round((Math.min(Math.max(today, grid.departStart), depEnd) - grid.departStart) / grid.departStep) * grid.departStep, tof: 260 };
  let windows: Trip[] = [];
  let best: Trip | null = null;
  let done = false;
  let geo: Geo | null = null;

  // ------------------------------------------------------------------ elements
  const takeaway = h('p', { class: 'tp-takeaway' }, 'Working out every trip...');
  const summary = h('p', { class: 'sr-only', id: 'tp-summary' });
  const canvas = h('canvas', { class: 'tp-canvas', 'aria-hidden': 'true' });
  const overlay = s('svg', { class: 'tp-overlay', 'aria-hidden': 'true' });
  const tip = h('div', { class: 'tp-tip', hidden: true });
  const plot = h(
    'div',
    {
      class: 'tp-plot',
      tabindex: '0',
      'data-autofocus': true,
      role: 'group',
      'aria-roledescription': 'porkchop plot',
      'aria-label': 'Trip chart. Left and right arrows change the day you leave Mars, up and down change the trip length. Hold Shift for bigger steps. B jumps to the best trip, N and P to the next or previous launch window.',
      'aria-describedby': 'tp-summary',
    },
    canvas,
    overlay,
    tip,
  );
  const legend = h(
    'ul',
    { class: 'tp-legend', 'aria-label': 'Color key: speed change needed, km/s' },
    BANDS.map((b) => h('li', null, h('span', { class: 'tp-swatch', style: `background:${b.color}` }), b.label)),
  );
  const live = h('p', { class: 'sr-only', 'aria-live': 'polite' });
  const details = h('div', { class: 'tp-trip' });
  const view = orbitView(opts.reducedMotion);
  const tables = h('div', { class: 'tp-tables' });
  const bestBtn = h('button', { class: 'btn small primary', disabled: true, onclick: () => best && select(best.depart, best.tof, true) }, 'Best trip');
  const prevBtn = h('button', { class: 'btn small', disabled: true, onclick: () => hopWindow(-1) }, 'Earlier window');
  const nextBtn = h('button', { class: 'btn small', disabled: true, onclick: () => hopWindow(1) }, 'Later window');

  const el = h(
    'div',
    { class: 'planner' },
    h('div', { class: 'kicker' }, 'Trip planner'),
    h('h2', null, 'Plan the trip home'),
    h('p', { class: 'tp-why' }, 'The cheapest trips happen when Mars is ahead of Earth just right; that lines up about every 26 months.'),
    h('div', { class: 'tp-tools' }, bestBtn, prevBtn, nextBtn),
    h(
      'figure',
      { class: 'tp-fig' },
      h('figcaption', null, h('span', { class: 'kicker' }, 'Speed change needed for each trip from Mars to Earth (km/s): brighter is cheaper'), takeaway, legend),
      plot,
      summary,
    ),
    live,
    h('div', { class: 'tp-bottom' }, details, view.el),
    h('details', { class: 'tp-numbers' }, h('summary', null, 'See the numbers'), tables),
    h(
      'p',
      { class: 'title-foot' },
      "Every spot on the chart is a real path between the real positions of Mars and Earth (JPL orbit data, solved with Lambert's problem). Speed change counts one push to leave a low orbit around Mars and one to slow into a low orbit around Earth. Real ships also carry extra fuel for steering. Details are in the Science Log.",
    ),
    h('div', { class: 'actions end' }, h('button', { class: 'btn', onclick: () => opts.back() }, opts.backLabel ?? 'Back')),
  );

  // ------------------------------------------------------------------ drawing
  const layout = (W: number): Geo => {
    const left = 46;
    const right = 12;
    const top = 40;
    const bottom = 42;
    const ph = clamp(Math.round(W * 0.36), 200, 320);
    const pw = Math.max(80, W - left - right);
    return {
      W,
      H: top + ph + bottom,
      left,
      top,
      pw,
      ph,
      x: (dep: number) => left + ((dep - grid.departStart) / (depEnd - grid.departStart)) * pw,
      y: (tof: number) => top + ph - ((tof - grid.tofStart) / (tofEnd - grid.tofStart)) * ph,
    };
  };

  const rgb = BANDS.map((b) => [parseInt(b.color.slice(1, 3), 16), parseInt(b.color.slice(3, 5), 16), parseInt(b.color.slice(5, 7), 16)]);
  const paint = (data: Uint8ClampedArray, o: number, v: number) => {
    let k = 0;
    while (k < LEVELS.length && !(v < LEVELS[k])) k++; // NaN falls through to the last band
    const c = rgb[k];
    data[o] = c[0];
    data[o + 1] = c[1];
    data[o + 2] = c[2];
    data[o + 3] = 255;
  };
  /** One pixel per trip, for the quick picture while the chart is still being worked out. */
  let blocks: HTMLCanvasElement | null = null;

  /** Heatmap: while working, one block per trip (fast, scaled up); when done, smooth bilinear bands plus contour lines. */
  const drawHeat = () => {
    if (!geo) return;
    const ctx = canvas.getContext?.('2d');
    canvas.style.left = `${geo.left}px`;
    canvas.style.top = `${geo.top}px`;
    canvas.style.width = `${geo.pw}px`;
    canvas.style.height = `${geo.ph}px`;
    if (!ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const cw = Math.round(geo.pw * dpr);
    const ch = Math.round(geo.ph * dpr);
    if (canvas.width !== cw || canvas.height !== ch) {
      canvas.width = cw;
      canvas.height = ch;
    }
    if (!done) {
      blocks ??= h('canvas', { width: String(nx), height: String(ny) });
      const bctx = blocks.getContext('2d');
      if (!bctx) return;
      const img = bctx.createImageData(nx, ny);
      for (let j = 0; j < ny; j++) for (let i = 0; i < store.cols; i++) paint(img.data, ((ny - 1 - j) * nx + i) * 4, grid.dvTotal[j * nx + i]);
      bctx.putImageData(img, 0, 0);
      ctx.clearRect(0, 0, cw, ch);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(blocks, 0, 0, cw, ch);
      return;
    }
    const img = ctx.createImageData(cw, ch);
    const val = (i: number, j: number) => {
      const v = grid.dvTotal[j * nx + i];
      return Number.isNaN(v) ? 99 : v;
    };
    for (let py = 0; py < ch; py++) {
      const gj = (1 - (py + 0.5) / ch) * (ny - 1);
      const j0 = Math.min(ny - 2, Math.floor(gj));
      const fy = gj - j0;
      for (let pxl = 0; pxl < cw; pxl++) {
        const gi = ((pxl + 0.5) / cw) * (nx - 1);
        const i0 = Math.min(nx - 2, Math.floor(gi));
        const fx = gi - i0;
        const v = (val(i0, j0) * (1 - fx) + val(i0 + 1, j0) * fx) * (1 - fy) + (val(i0, j0 + 1) * (1 - fx) + val(i0 + 1, j0 + 1) * fx) * fy;
        paint(img.data, (py * cw + pxl) * 4, v);
      }
    }
    ctx.putImageData(img, 0, 0);
    // Contour lines between the bands, a hairline of the page color.
    ctx.strokeStyle = 'rgba(11, 10, 24, 0.7)';
    ctx.lineWidth = Math.max(1, dpr);
    ctx.beginPath();
    const sx = cw / (nx - 1);
    const sy = ch / (ny - 1);
    for (const level of LEVELS) {
      for (const [x1, y1, x2, y2] of contourSegments(grid.dvTotal, nx, ny, level)) {
        ctx.moveTo(x1 * sx, ch - y1 * sy);
        ctx.lineTo(x2 * sx, ch - y2 * sy);
      }
    }
    ctx.stroke();
  };

  const crossG = s('g', { class: 'tp-cross' });

  /** Axes, today, launch windows and contour labels: everything in the SVG except the crosshair. */
  const drawOverlay = () => {
    if (!geo) return;
    const g = geo;
    overlay.setAttribute('viewBox', `0 0 ${g.W} ${g.H}`);
    overlay.setAttribute('width', String(g.W));
    overlay.setAttribute('height', String(g.H));
    overlay.replaceChildren();
    const back = s('g');
    overlay.append(back);
    const bottomY = g.top + g.ph;
    // The past: dimmed, because nobody can leave then any more.
    if (today > grid.departStart) {
      const xt = Math.min(g.x(today), g.left + g.pw);
      back.append(s('rect', { x: g.left, y: g.top, width: xt - g.left, height: g.ph, class: 'tp-past' }));
      if (xt - g.left > 44) back.append(s('text', { x: g.left + 6, y: g.top + 14, class: 'tp-mark' }, 'PAST'));
      if (today < depEnd) {
        back.append(s('line', { x1: xt, x2: xt, y1: g.top, y2: bottomY, class: 'tp-today' }));
        back.append(s('text', { x: xt + 4, y: bottomY - 6, class: 'tp-mark' }, 'TODAY'));
      }
    }
    // Frame and y axis: trip length.
    back.append(s('rect', { x: g.left, y: g.top, width: g.pw, height: g.ph, class: 'tp-frame' }));
    for (let tof = 100; tof <= tofEnd; tof += 100) {
      const yy = Math.round(g.y(tof)) + 0.5;
      back.append(s('line', { x1: g.left - 4, x2: g.left, y1: yy, y2: yy, class: 'tp-tick' }));
      back.append(s('text', { x: g.left - 7, y: yy + 4, 'text-anchor': 'end', class: 'tp-num' }, String(tof)));
    }
    back.append(s('text', { x: 0, y: 0, transform: `translate(12 ${g.top + g.ph / 2}) rotate(-90)`, 'text-anchor': 'middle', class: 'tp-axis' }, 'Trip length (days)'));
    // x axis: the day you leave Mars, a tick at each new year.
    const y0 = new Date(msFromJ2000Days(grid.departStart)).getUTCFullYear();
    const narrow = g.pw < 420;
    for (let yr = y0; ; yr++) {
      const d = daysSinceJ2000(Date.UTC(yr, 0, 1));
      if (d > depEnd) break;
      if (d < grid.departStart) continue;
      const xx = Math.round(g.x(d)) + 0.5;
      back.append(s('line', { x1: xx, x2: xx, y1: bottomY, y2: bottomY + 5, class: 'tp-tick' }));
      if (!narrow || yr % 2 === 0) back.append(s('text', { x: xx, y: bottomY + 18, 'text-anchor': 'middle', class: 'tp-num' }, String(yr)));
    }
    back.append(s('text', { x: g.left + g.pw / 2, y: bottomY + 36, 'text-anchor': 'middle', class: 'tp-axis' }, 'The day you leave Mars'));
    if (!done) {
      overlay.append(crossG);
      return;
    }
    // Launch windows: a marker at each window's cheapest trip, its month above, and the months between windows.
    const front = s('g');
    overlay.append(front);
    windows.forEach((w, k) => {
      const wx = g.x(w.depart);
      const wy = g.y(w.tof);
      front.append(s('path', { d: `M${wx} ${wy - 6}L${wx + 6} ${wy}L${wx} ${wy + 6}L${wx - 6} ${wy}Z`, class: 'tp-win' }));
      front.append(s('line', { x1: wx, x2: wx, y1: g.top - 12, y2: g.top, class: 'tp-tick' }));
      const label = narrow ? String(new Date(msFromJ2000Days(w.depart)).getUTCFullYear()) : fmtMonth(w.depart);
      front.append(s('text', { x: wx, y: g.top - 15, 'text-anchor': 'middle', class: 'tp-wlabel' }, label));
      if (k > 0) {
        const px0 = g.x(windows[k - 1].depart);
        const months = Math.round((w.depart - windows[k - 1].depart) / MONTH_DAYS);
        const mid = (px0 + wx) / 2;
        const text = narrow ? `${months} mo` : `${months} months`;
        const half = text.length * 3.4 + 6;
        if (wx - px0 > 2 * half + 70) {
          front.append(s('line', { x1: px0 + 34, x2: mid - half, y1: g.top - 30, y2: g.top - 30, class: 'tp-gap' }));
          front.append(s('line', { x1: mid + half, x2: wx - 34, y1: g.top - 30, y2: g.top - 30, class: 'tp-gap' }));
        }
        front.append(s('text', { x: mid, y: g.top - 26, 'text-anchor': 'middle', class: 'tp-gaplabel' }, text));
      }
    });
    // Contour labels: walk up from each window's best trip and name the lines it crosses.
    for (const w of windows) {
      const i = Math.round((w.depart - grid.departStart) / grid.departStep);
      let lastY = Infinity;
      let lvl = 0;
      for (let j = Math.max(0, Math.round((w.tof - grid.tofStart) / grid.tofStep)); j < ny - 1 && lvl < LEVELS.length; j++) {
        const a = grid.dvTotal[j * nx + i];
        const b = grid.dvTotal[(j + 1) * nx + i];
        while (lvl < LEVELS.length && LEVELS[lvl] <= a) lvl++;
        if (lvl >= LEVELS.length || !(b >= LEVELS[lvl])) continue;
        const t = (LEVELS[lvl] - a) / (b - a);
        const yy = g.y(cellTof(grid, j + t));
        if (lastY - yy >= 14 && yy > g.top + 8) {
          front.append(s('text', { x: g.x(w.depart) + 5, y: yy + 4, class: 'tp-clabel' }, String(LEVELS[lvl])));
          lastY = yy;
        }
        lvl++;
      }
    }
    overlay.append(crossG);
  };

  const drawCross = () => {
    crossG.replaceChildren();
    if (!geo || !done) return;
    const xx = geo.x(sel.depart);
    const yy = geo.y(sel.tof);
    const bottomY = geo.top + geo.ph;
    for (const cls of ['tp-hair-under', 'tp-hair']) {
      crossG.append(s('line', { x1: xx, x2: xx, y1: geo.top, y2: bottomY, class: cls }));
      crossG.append(s('line', { x1: geo.left, x2: geo.left + geo.pw, y1: yy, y2: yy, class: cls }));
    }
    // A dark ring under the amber one, so the marker shows on the palest band too.
    crossG.append(s('circle', { cx: xx, cy: yy, r: 7, class: 'tp-ring-under' }));
    crossG.append(s('circle', { cx: xx, cy: yy, r: 7, class: 'tp-ring' }));
  };

  // ------------------------------------------------------------------ the selected trip
  const describe = (t: Trip | null) => {
    if (!t) {
      details.replaceChildren(h('p', null, 'No path works for exactly these two dates (Earth and Mars are on opposite sides of the Sun). Try a spot nearby.'));
      live.textContent = 'No path for these dates.';
      view.show(null);
      return;
    }
    const band = bandOf(t.dvTotal);
    const arrive = t.depart + t.tof;
    const marsLead = (((longitudeDeg(t.start.r) - longitudeDeg(planetState('earth', t.depart).r) + 540) % 360) - 180) | 0;
    const months = Math.round(t.tof / MONTH_DAYS);
    details.replaceChildren(
      h(
        'div',
        { class: 'tp-dates' },
        h('div', null, h('span', { class: 'kicker' }, 'Leave Mars'), h('b', null, fmtDate(t.depart))),
        h('span', { class: 'arrow', 'aria-hidden': 'true' }),
        h('div', null, h('span', { class: 'kicker' }, 'Reach Earth'), h('b', null, fmtDate(arrive))),
        h('div', null, h('span', { class: 'kicker' }, 'Trip'), h('b', null, `${Math.round(t.tof)} days`), h('small', null, `about ${months} month${months === 1 ? '' : 's'}`)),
      ),
      h(
        'p',
        { class: 'tp-speed' },
        h('span', { class: 'kicker' }, 'Speed change needed'),
        h('b', null, kms(t.dvTotal)),
        h('span', { class: `tp-rate b${band}` }, h('span', { class: 'tp-swatch', style: `background:${BANDS[band].color}` }), BANDS[band].word),
      ),
      h(
        'ul',
        { class: 'clean tp-more' },
        h('li', null, `${kms(t.dvDepart)} to leave orbit around Mars, then ${kms(t.dvArrive)} to slow into orbit around Earth.`),
        h('li', null, `From the ground, the rocket must reach ${kms(t.surfaceSpeed)}: Mars' escape speed (${escapeSpeed('mars').toFixed(1)}) plus the push toward Earth.`),
        h('li', null, `Or skip the last push: the ship hits Earth's air at ${kms(t.entrySpeed)}, and a heat shield slows it down.`),
        h('li', null, marsLead >= 0 ? `On launch day, Mars is ${marsLead} degrees ahead of Earth around the Sun.` : `On launch day, Mars is ${-marsLead} degrees behind Earth around the Sun.`),
      ),
    );
    live.textContent = `Leave Mars ${fmtDate(t.depart)}, reach Earth ${fmtDate(arrive)}: ${Math.round(t.tof)} days, ${kms(t.dvTotal)}, ${BANDS[band].word.toLowerCase()}.`;
    view.show(t);
  };

  let lastKey = '';
  function select(depart: number, tof: number, exact = false) {
    if (!exact) {
      depart = grid.departStart + clamp(Math.round((depart - grid.departStart) / grid.departStep), 0, nx - 1) * grid.departStep;
      tof = grid.tofStart + clamp(Math.round((tof - grid.tofStart) / grid.tofStep), 0, ny - 1) * grid.tofStep;
    }
    const k = `${depart.toFixed(3)}:${tof.toFixed(3)}`;
    sel = { depart, tof };
    drawCross();
    if (k === lastKey) return;
    lastKey = k;
    describe(trip('mars', 'earth', depart, tof));
  }

  function hopWindow(dir: 1 | -1) {
    if (!windows.length) return;
    const list = dir > 0 ? windows.filter((w) => w.depart > sel.depart + 1) : windows.filter((w) => w.depart < sel.depart - 1).reverse();
    const w = list[0] ?? (dir > 0 ? windows[0] : windows[windows.length - 1]);
    select(w.depart, w.tof, true);
  }

  // ------------------------------------------------------------------ input
  const cellAt = (clientX: number, clientY: number) => {
    const box = plot.getBoundingClientRect();
    if (!geo) return null;
    const px = clientX - box.left;
    const py = clientY - box.top;
    const fx = clamp((px - geo.left) / geo.pw, 0, 1);
    const fy = clamp(1 - (py - geo.top) / geo.ph, 0, 1);
    return { depart: grid.departStart + fx * (depEnd - grid.departStart), tof: grid.tofStart + fy * (tofEnd - grid.tofStart), px, py };
  };
  let dragging = false;
  plot.addEventListener('pointerdown', (e) => {
    if (!done) return;
    const c = cellAt(e.clientX, e.clientY);
    if (!c) return;
    dragging = true;
    plot.setPointerCapture?.(e.pointerId);
    tip.hidden = true;
    select(c.depart, c.tof);
  });
  plot.addEventListener('pointermove', (e) => {
    if (!done) return;
    const c = cellAt(e.clientX, e.clientY);
    if (!c || !geo) return;
    if (dragging) {
      select(c.depart, c.tof);
      return;
    }
    if (e.pointerType !== 'mouse') return;
    // Hover: a small tip with the numbers under the pointer (the click keeps its trip).
    const i = clamp(Math.round((c.depart - grid.departStart) / grid.departStep), 0, nx - 1);
    const j = clamp(Math.round((c.tof - grid.tofStart) / grid.tofStep), 0, ny - 1);
    const v = grid.dvTotal[j * nx + i];
    tip.textContent = `Leave ${fmtDate(cellDepart(grid, i))} · ${cellTof(grid, j)} days · ${Number.isNaN(v) ? 'no path' : kms(v)}`;
    tip.hidden = false;
    const flip = c.px > geo.W * 0.6;
    tip.style.left = flip ? '' : `${c.px + 14}px`;
    tip.style.right = flip ? `${geo.W - c.px + 14}px` : '';
    tip.style.top = `${clamp(c.py - 34, 0, geo.H - 30)}px`;
  });
  const endDrag = () => (dragging = false);
  plot.addEventListener('pointerup', endDrag);
  plot.addEventListener('pointercancel', endDrag);
  plot.addEventListener('pointerleave', () => (tip.hidden = true));
  plot.addEventListener('keydown', (e) => {
    if (!done) return;
    const big = e.shiftKey ? 6 : 1;
    const dStep = grid.departStep * big;
    const tStep = grid.tofStep * big;
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [sel.depart - dStep, sel.tof],
      ArrowRight: [sel.depart + dStep, sel.tof],
      ArrowUp: [sel.depart, sel.tof + tStep],
      ArrowDown: [sel.depart, sel.tof - tStep],
      Home: [grid.departStart, sel.tof],
      End: [depEnd, sel.tof],
    };
    if (e.key in moves) {
      e.preventDefault();
      const [d, t] = moves[e.key];
      select(d, t);
    } else if (e.key === 'b' || e.key === 'B') {
      e.preventDefault();
      if (best) select(best.depart, best.tof, true);
    } else if (e.key === 'n' || e.key === 'N') {
      e.preventDefault();
      hopWindow(1);
    } else if (e.key === 'p' || e.key === 'P') {
      e.preventDefault();
      hopWindow(-1);
    }
  });

  // Redraw at the real width (text stays a real 11px, never scaled).
  const relayout = () => {
    const W = Math.round(plot.clientWidth || 860);
    if (W < 200 || (geo && geo.W === W)) return;
    geo = layout(W);
    plot.style.height = `${geo.H}px`;
    drawHeat();
    drawOverlay();
    drawCross();
  };

  // ------------------------------------------------------------------ the numbers
  const buildTables = () => {
    const winRows = windows.map((w, k) =>
      h(
        'tr',
        null,
        h('th', { scope: 'row' }, fmtDate(w.depart)),
        h('td', null, fmtDate(w.depart + w.tof)),
        h('td', null, String(Math.round(w.tof))),
        h('td', null, w.dvTotal.toFixed(2)),
        h('td', null, w.surfaceSpeed.toFixed(2)),
        h('td', null, w.entrySpeed.toFixed(2)),
        h('td', null, k ? String(Math.round((w.depart - windows[k - 1].depart) / MONTH_DAYS)) : '-'),
      ),
    );
    const monthRows: HTMLElement[] = [];
    const first = new Date(msFromJ2000Days(grid.departStart));
    for (let m = 0; ; m++) {
      const a = daysSinceJ2000(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + m, 1));
      const b = daysSinceJ2000(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + m + 1, 1));
      if (a > depEnd) break;
      let bi = -1;
      let bj = -1;
      let bv = Infinity;
      for (let i = 0; i < nx; i++) {
        const d = cellDepart(grid, i);
        if (d < a || d >= b) continue;
        for (let j = 0; j < ny; j++) {
          const v = grid.dvTotal[j * nx + i];
          if (v < bv) {
            bv = v;
            bi = i;
            bj = j;
          }
        }
      }
      if (bi < 0) continue;
      monthRows.push(
        h(
          'tr',
          null,
          h('th', { scope: 'row' }, fmtMonth(a)),
          h('td', null, fmtDate(cellDepart(grid, bi))),
          h('td', null, String(cellTof(grid, bj))),
          h('td', null, bv.toFixed(1)),
          h('td', null, BANDS[bandOf(bv)].word),
        ),
      );
    }
    const table = (caption: string, head: string[], rows: HTMLElement[]) =>
      h('div', { class: 'tp-scroll' }, h('table', { class: 'log' }, h('caption', null, caption), h('thead', null, h('tr', null, head.map((t) => h('th', { scope: 'col' }, t)))), h('tbody', null, rows)));
    tables.replaceChildren(
      table('Best trip of each launch window (speeds in km/s)', ['Leave Mars', 'Reach Earth', 'Days', 'Speed change', 'From the ground', "Hits Earth's air", 'Months since last window'], winRows),
      table('Best trip for each month you could leave', ['Month', 'Leave Mars', 'Days', 'Speed change (km/s)', 'Rating'], monthRows),
    );
  };

  // ------------------------------------------------------------------ work it all out
  const finish = () => {
    done = true;
    windows = windowMinima(grid)
      .map((c) => refine('mars', 'earth', cellDepart(grid, c.i), cellTof(grid, c.j), 'dvTotal'))
      .filter((t): t is Trip => !!t && t.depart >= grid.departStart && t.depart <= depEnd && t.tof >= grid.tofStart && t.tof <= tofEnd);
    const future = windows.filter((w) => w.depart >= today);
    best = (future.length ? future : windows).reduce<Trip | null>((a, w) => (!a || w.dvTotal < a.dvTotal ? w : a), null);
    const next = future[0] ?? best;
    const list = windows.map((w) => fmtMonth(w.depart));
    const said = list.length > 1 ? `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}` : list.join('');
    takeaway.textContent = windows.length
      ? `Bright spots are cheap trips. They come in launch windows: ${said}. The gaps differ a little because Mars' orbit is an oval, but they average about ${Math.round(MARS.synodicDays / MONTH_DAYS)} months.`
      : 'Bright spots are cheap trips.';
    summary.textContent =
      `Porkchop plot of ${(nx * ny).toLocaleString('en-US')} possible trips from Mars to Earth, leaving between ${fmtMonth(grid.departStart)} and ${fmtMonth(depEnd)}, taking ${grid.tofStart} to ${tofEnd} days. ` +
      (windows.length ? `The cheapest trips come in ${windows.length} launch windows: ${windows.map((w) => `${fmtMonth(w.depart)} (${kms(w.dvTotal)}, ${Math.round(w.tof)} days)`).join(', ')}. ` : '') +
      'Away from the windows, most trips need more than 12 km/s.';
    for (const b of [bestBtn, prevBtn, nextBtn]) b.disabled = !windows.length;
    buildTables();
    geo = null;
    relayout();
    if (next) select(next.depart, next.tof, true);
    else select(sel.depart, sel.tof);
  };

  const ready = new Promise<void>((resolve) => {
    const step = () => {
      if (!el.isConnected && store.cols > 0) return resolve(); // closed: the rest is worked out next time
      const t0 = performance.now();
      while (store.cols < nx && performance.now() - t0 < 14) {
        fillColumns(grid, store.cols, store.cols + 4);
        store.cols = Math.min(nx, store.cols + 4);
      }
      if (store.cols < nx) {
        takeaway.textContent = `Working out every trip... ${Math.round((store.cols / nx) * 100)}%`;
        if (geo) drawHeat();
        setTimeout(step, 0);
        return;
      }
      finish();
      resolve();
    };
    setTimeout(() => {
      relayout();
      step();
    }, 0);
  });

  if (typeof ResizeObserver === 'function') {
    let seen = false;
    const ro = new ResizeObserver(() => {
      if (plot.isConnected) {
        seen = true;
        relayout();
      } else if (seen) ro.disconnect();
    });
    ro.observe(plot);
  }

  return { el, ready };
}
