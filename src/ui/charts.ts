// Written with AI assistance (Claude Code). See README "Use of AI tools".
// "How your mission went": small-multiple line charts drawn as inline SVG (no chart library).
// Every strip shares one sol axis, so no chart ever needs two y-scales:
//   WHAT HAPPENED  solar storms (sheltered or not), upgrades finished, heaters skipped
//   FUEL TANK      % full: the goal
//   AIR AND FOOD   days left (solid line = air, dashed line = food)
//   RADIATION      dose as % of the limit, with the 60% "Safe crew" star line
// Dust-storm sols are shaded across every strip. Nothing relies on color alone: every strip has a
// title, the two life-support lines differ in dash pattern and carry direct labels, events are
// distinct pixel icons with a key, and a table lists every number.
// Line colors are the HUD's hues (fuel cyan, air blue, food green, dose amber) stepped into the
// dark-mode chart band and checked with the dataviz palette validator on the card surface (#211b40).

import { h, fmt1 } from './dom';
import { iconSvg, type IconName } from './icons';
import { UPGRADES } from '../sim/upgrades';
import { EXPEDITIONS } from '../sim/constants';
import { missionSeries, runsOf, seriesSols, seriesTakeaway, solSpan, upgradePhrase, type MissionSeries, type SeriesOutcome } from '../sim/series';
import type { ExpeditionResult } from '../sim/campaign';
import type { MissionState } from '../sim/types';

// ------------------------------------------------------------------ small helpers

const SVG_NS = 'http://www.w3.org/2000/svg';
type SvgKid = SVGElement | string | null | undefined | false;

function s<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number | undefined> = {}, ...kids: SvgKid[]): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined) el.setAttribute(k, typeof v === 'number' ? n1(v) : v);
  for (const c of kids) if (c) el.append(typeof c === 'string' ? document.createTextNode(c) : c);
  return el;
}

/** Round to 0.1 px so the markup stays small. */
const n1 = (v: number) => String(Math.round(v * 10) / 10);
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const pctOf = (dose: number, budget: number) => Math.round((dose / budget) * 100);
const days = (v: number) => `${fmt1(Math.max(0, v))} day${Math.abs(Math.max(0, v) - 1) < 0.05 ? '' : 's'}`;
const fuelPct = (v: number) => `${Math.floor(v + 1e-6)}%`;

/** One of the game's pixel icons, placed inside the chart. */
function pxIcon(name: IconName, x: number, y: number, size: number): SVGElement {
  const tmp = document.createElement('div');
  tmp.innerHTML = iconSvg(name, size);
  const el = tmp.firstElementChild as SVGElement;
  el.setAttribute('x', n1(x));
  el.setAttribute('y', n1(y));
  return el;
}

/** A snowflake for "heaters skipped" (the game has no cold icon), drawn the same pixel way. */
const SNOW = ['...B....', '.B.B.B..', '..BBB...', 'BBBWBBB.', '..BBB...', '.B.B.B..', '...B....', '........'];
const SNOW_COLORS: Record<string, string> = { B: '#8fd3ff', W: '#f4ead8' };
function snowIcon(x: number, y: number, size: number): SVGSVGElement {
  const svg = s('svg', { x, y, width: size, height: size, viewBox: '0 0 8 8', 'shape-rendering': 'crispEdges', 'aria-hidden': 'true', class: 'px-icon' });
  SNOW.forEach((row, ry) => [...row].forEach((c, rx) => SNOW_COLORS[c] && svg.append(s('rect', { x: rx, y: ry, width: 1.02, height: 1.02, fill: SNOW_COLORS[c] }))));
  return svg;
}

type EventKind = 'safe' | 'hit' | 'built' | 'cold';
const EVENT_KEY: Record<EventKind, string> = {
  safe: 'Storm: crew in the shelter',
  hit: 'Storm hit the crew',
  built: 'Upgrade finished',
  cold: 'Heaters skipped',
};

function eventGlyph(kind: EventKind, x: number, y: number, size: number): SVGElement {
  if (kind === 'cold') return snowIcon(x, y, size);
  return pxIcon(kind === 'safe' ? 'shelter' : kind === 'hit' ? 'radiation' : 'crate', x, y, size);
}

/** What happened on sol k, in words (for the readout and the table). */
function solEvents(sr: MissionSeries, k: number): string[] {
  const out: string[] = [];
  for (const st of sr.storms.filter((t) => t.sol === k)) {
    out.push(st.shelter === 'full' ? 'Solar storm: crew safe in the shelter.' : st.shelter === 'part' ? 'Solar storm: shelter only half on.' : 'Solar storm: no shelter.');
  }
  for (const b of sr.built.filter((t) => t.sol === k)) out.push(`Finished ${upgradePhrase(b.id)}.`);
  if (sr.dust.includes(k)) out.push('Dust storm: less solar power.');
  if (sr.cold.includes(k)) out.push('Heaters skipped: cold batteries.');
  return out;
}

/** A sentence-by-sentence description of the whole chart for screen readers. */
export function seriesSummary(sr: MissionSeries): string {
  const n = seriesSols(sr);
  const parts = [
    `Chart of ${n} sol${n === 1 ? '' : 's'}.`,
    `The fuel tank went from ${fuelPct(sr.fuel[0])} to ${fuelPct(sr.fuel[n])}.`,
    `Air was lowest at ${days(Math.min(...sr.air))} and food at ${days(Math.min(...sr.food))}.`,
    `The radiation dose ended at ${pctOf(sr.dose[n], sr.doseBudget)}% of the limit.`,
  ];
  if (sr.storms.length) {
    const safe = sr.storms.filter((t) => t.shelter === 'full').length;
    parts.push(`${sr.storms.length} solar storm${sr.storms.length === 1 ? '' : 's'}, ${safe} with the crew in the shelter.`);
  }
  if (sr.built.length) parts.push(`Built: ${sr.built.map((b) => `${UPGRADES[b.id].name} on sol ${b.sol}`).join(', ')}.`);
  if (sr.dust.length) parts.push(`Dust storm on ${runsOf(sr.dust).map(solSpan).join(' and ')}.`);
  if (sr.cold.length) parts.push(`Heaters skipped on ${sr.cold.length} sol${sr.cold.length === 1 ? '' : 's'}.`);
  return parts.join(' ');
}

// ------------------------------------------------------------------ drawing

interface Geometry {
  width: number;
  n: number;
  left: number;
  step: number;
  x: (t: number) => number;
  /** Plot rectangles (top, bottom) of the three data strips, for the hover column. */
  bands: Array<[number, number]>;
  /** Where each line sits at sol k. */
  points: (k: number) => Array<{ cls: string; y: number }>;
}

interface Strip {
  top: number;
  bottom: number;
  y: (v: number) => number;
}

function niceDaysMax(v: number): number {
  for (const c of [2, 4, 6, 8, 10, 12, 16, 20, 24, 30, 40, 50, 60, 80, 100, 150, 200]) if (c >= v * 1.05) return c;
  return Math.ceil(v / 100) * 100;
}

function path(values: number[], x: (t: number) => number, y: (v: number) => number): string {
  return values.map((v, i) => `${i ? 'L' : 'M'}${n1(x(i))} ${n1(y(v))}`).join('');
}

/** Builds the chart SVG at a given pixel width. */
function drawChart(sr: MissionSeries, width: number, compact: boolean, label: string): { svg: SVGSVGElement; geo: Geometry } {
  const n = seriesSols(sr);
  const left = compact ? 30 : 36;
  const right = width - 8;
  const step = (right - left) / n;
  const x = (t: number) => left + t * step;
  const plotH = compact ? 30 : width < 420 ? 58 : 66;
  const titleH = compact ? 15 : 20;
  const gap = compact ? 8 : 12;
  const g = s('g');
  const back = s('g'); // shading and gridlines sit behind the lines
  const front = s('g');
  g.append(back, front);
  let y = 2;

  const title = (text: string, at: number) => s('text', { x: 0, y: at + (compact ? 10 : 13), class: 'mc-title' }, text);

  // ---- WHAT HAPPENED: one row per kind of event that actually happened
  const kinds: Array<{ kind: EventKind; sols: number[] }> = [
    { kind: 'safe' as const, sols: sr.storms.filter((t) => t.shelter === 'full').map((t) => t.sol) },
    { kind: 'hit' as const, sols: sr.storms.filter((t) => t.shelter !== 'full').map((t) => t.sol) },
    { kind: 'built' as const, sols: sr.built.map((b) => b.sol) },
    { kind: 'cold' as const, sols: sr.cold },
  ].filter((r) => r.sols.length);
  // Storms share a row: sheltered and unsheltered icons look different.
  const rows: Array<Array<{ kind: EventKind; sols: number[] }>> = [];
  const stormRow = kinds.filter((r) => r.kind === 'safe' || r.kind === 'hit');
  if (stormRow.length) rows.push(stormRow);
  for (const r of kinds) if (r.kind === 'built' || r.kind === 'cold') rows.push([r]);
  const iconSize = clamp(Math.floor(step), 8, compact ? 10 : 16);
  const laneTop = y;
  if (rows.length) {
    if (!compact) {
      front.append(title('What happened', y));
      y += titleH;
    }
    const rowH = iconSize + (compact ? 3 : 6);
    rows.forEach((row, i) => {
      for (const r of row) for (const k of r.sols) front.append(eventGlyph(r.kind, x(k - 0.5) - iconSize / 2, y + i * rowH + (rowH - iconSize) / 2, iconSize));
    });
    y += rows.length * rowH + (compact ? 4 : 6);
  }
  const laneBottom = y;

  // ---- the three data strips
  const strip = (name: string, top: number, ymax: number): Strip => {
    if (name) front.append(title(name, top));
    const t = top + titleH;
    const b = t + plotH;
    return { top: t, bottom: b, y: (v: number) => b - (clamp(v, 0, ymax) / ymax) * plotH };
  };
  const gridAt = (st: Strip, v: number, text: string | null, base = false) => {
    const yy = Math.round(st.y(v)) + 0.5;
    back.append(s('line', { x1: left, x2: right, y1: yy, y2: yy, class: base ? 'mc-base' : 'mc-grid' }));
    if (text !== null) back.append(s('text', { x: left - 5, y: yy + 3.5, 'text-anchor': 'end', class: 'mc-tick' }, text));
  };
  /** Highest and lowest pixel the data line reaches between two x positions. */
  const lineSpan = (values: number[], st: Strip, xa: number, xb: number): [number, number] => {
    const at = (t: number) => {
      const i = Math.min(n - 1, Math.floor(t));
      return values[i] + (values[i + 1] - values[i]) * (t - i);
    };
    const t0 = clamp((xa - left) / step, 0, n);
    const t1 = clamp((xb - left) / step, 0, n);
    const ys = [at(t0), at(t1)];
    for (let k = Math.ceil(t0); k <= Math.floor(t1); k++) ys.push(values[k]);
    const px = ys.map(st.y);
    return [Math.min(...px), Math.max(...px)];
  };
  // Text inside a plot never sits on a data line or on other text: each spot is checked first,
  // and a label with no free spot is left out (the key, ticks and table still carry it).
  type Box = [number, number, number, number];
  const placed: Box[] = [];
  const textBox = (tx: number, base: number, text: string, size: number, anchor: 'start' | 'middle' | 'end'): Box => {
    const w = text.length * size * 0.58;
    const x0 = anchor === 'start' ? tx : anchor === 'middle' ? tx - w / 2 : tx - w;
    return [x0 - 2, base - size * 0.78 - 1, x0 + w + 2, base + size * 0.22 + 1];
  };
  const fits = (b: Box, st: Strip, lines: number[][]) => {
    if (b[0] < left - 1 || b[2] > right + 1 || b[1] < st.top - 1 || b[3] > st.bottom + 1) return false;
    for (const vals of lines) {
      const [hi, lo] = lineSpan(vals, st, b[0], b[2]);
      if (lo >= b[1] && hi <= b[3]) return false;
    }
    return !placed.some((p) => b[0] < p[2] && p[0] < b[2] && b[1] < p[3] && p[1] < b[3]);
  };
  /** A note on a reference line, just under it (or just over it). */
  const refLabel = (st: Strip, lines: number[][], v: number, text: string) => {
    if (compact) return;
    for (const base of [st.y(v) + 11, st.y(v) - 4]) {
      const b = textBox(left + 4, base, text, 10.5, 'start');
      if (fits(b, st, lines)) {
        placed.push(b);
        back.append(s('text', { x: left + 4, y: base, class: 'mc-ref' }, text));
        return;
      }
    }
  };

  const fuel = strip(compact ? 'Fuel tank %' : 'Fuel tank (% full)', y, 100);
  y = fuel.bottom + gap;
  const lifeMax = niceDaysMax(Math.max(1, ...sr.air, ...sr.food));
  const life = strip(compact ? 'Air and food (days)' : 'Air and food (days left)', y, lifeMax);
  y = life.bottom + gap;
  const dosePcts = sr.dose.map((d) => (d / sr.doseBudget) * 100);
  const doseMax = Math.max(100, Math.ceil(Math.max(...dosePcts) / 25) * 25);
  const dose = strip(compact ? 'Dose (% of limit)' : 'Radiation dose (% of limit)', y, doseMax);
  y = dose.bottom;
  const strips = [fuel, life, dose];

  // Dust storms: shade those sols in every strip (and the event rows).
  for (const [a, b] of runsOf(sr.dust)) {
    const x0 = x(a - 1);
    const w = x(b) - x0;
    if (laneBottom > laneTop && rows.length) back.append(s('rect', { x: x0, y: laneTop + (compact ? 0 : titleH), width: w, height: laneBottom - laneTop - (compact ? 0 : titleH), class: 'mc-dust' }));
    for (const st of strips) back.append(s('rect', { x: x0, y: st.top, width: w, height: st.bottom - st.top, class: 'mc-dust' }));
  }

  // Gridlines and y ticks.
  gridAt(fuel, 0, compact ? '0' : '0%', true);
  if (!compact) gridAt(fuel, 50, '50%');
  gridAt(fuel, 100, '100%');
  refLabel(fuel, [sr.fuel], 100, 'Full: time to launch');
  gridAt(life, 0, '0', true);
  if (!compact) gridAt(life, lifeMax / 2, String(lifeMax / 2));
  gridAt(life, lifeMax, String(lifeMax));
  gridAt(dose, 0, compact ? '0' : '0%', true);
  gridAt(dose, 60, compact ? null : '60%');
  gridAt(dose, 100, '100%');
  if (doseMax > 100) gridAt(dose, doseMax, null);
  refLabel(dose, [dosePcts], 100, 'Limit: the crew must go home');
  refLabel(dose, [dosePcts], 60, 'Under 60%: Safe crew star');

  // Upgrades start working at the end of the sol they were finished.
  for (const b of sr.built) {
    const gx = Math.round(x(b.sol)) + 0.5;
    for (const st of strips) back.append(s('line', { x1: gx, x2: gx, y1: st.top, y2: st.bottom, class: 'mc-guide' }));
  }

  // The data.
  front.append(s('path', { d: `${path(sr.fuel, x, fuel.y)}L${n1(x(n))} ${n1(fuel.bottom)}L${n1(x(0))} ${n1(fuel.bottom)}Z`, class: 'mc-area fuel' }));
  front.append(s('path', { d: path(sr.fuel, x, fuel.y), class: 'mc-line fuel' }));
  front.append(s('path', { d: path(sr.air, x, life.y), class: 'mc-line air' }));
  front.append(s('path', { d: path(sr.food, x, life.y), class: 'mc-line food' }));
  front.append(s('path', { d: `${path(dosePcts, x, dose.y)}L${n1(x(n))} ${n1(dose.bottom)}L${n1(x(0))} ${n1(dose.bottom)}Z`, class: 'mc-area dose' }));
  front.append(s('path', { d: path(dosePcts, x, dose.y), class: 'mc-line dose' }));

  // Direct labels for air and food, where the two lines are far enough apart to name each one
  // (the full chart only: in the small finale charts the shared key does this job).
  if (!compact) {
    const order = Array.from({ length: n + 1 }, (_, k) => k).sort(
      (a, b) => Math.abs(life.y(sr.air[b]) - life.y(sr.food[b])) - Math.abs(life.y(sr.air[a]) - life.y(sr.food[a])),
    );
    const lines = [sr.air, sr.food];
    for (const k of order) {
      const anchor = x(k) < left + 24 ? 'start' : x(k) > right - 24 ? 'end' : 'middle';
      const lx = anchor === 'end' ? x(k) - 8 : anchor === 'start' ? x(k) + 2 : x(k); // clear of the end dots
      const airHigh = sr.air[k] >= sr.food[k];
      const spot = (name: 'Air' | 'Food', high: boolean): { b: Box; base: number } | null => {
        const ly = life.y(name === 'Air' ? sr.air[k] : sr.food[k]);
        // Outside the pair first (above the top line, below the bottom one), then between them.
        for (const base of high ? [ly - 5, ly + 13] : [ly + 13, ly - 5]) {
          const b = textBox(lx, base, name, 11.5, anchor);
          if (fits(b, life, lines)) return { b, base };
        }
        return null;
      };
      const first = spot(airHigh ? 'Air' : 'Food', true);
      if (!first) continue;
      placed.push(first.b);
      const second = spot(airHigh ? 'Food' : 'Air', false);
      if (!second) {
        placed.pop();
        continue;
      }
      placed.push(second.b);
      front.append(s('text', { x: lx, y: first.base, 'text-anchor': anchor, class: 'mc-label' }, airHigh ? 'Air' : 'Food'));
      front.append(s('text', { x: lx, y: second.base, 'text-anchor': anchor, class: 'mc-label' }, airHigh ? 'Food' : 'Air'));
      break;
    }
  }

  // End dots.
  const points = (k: number) => [
    { cls: 'fuel', y: fuel.y(sr.fuel[k]) },
    { cls: 'air', y: life.y(sr.air[k]) },
    { cls: 'food', y: life.y(sr.food[k]) },
    { cls: 'dose', y: dose.y(dosePcts[k]) },
  ];
  for (const p of points(n)) front.append(s('circle', { cx: x(n), cy: p.y, r: 4, class: `mc-dot ${p.cls}` }));

  // Sol axis: labels sit in the middle of each sol.
  const minGap = n >= 10 ? 20 : 14;
  const every = [1, 2, 5, 10, 20].find((e) => e * step >= minGap) ?? 50;
  const axisY = y + (compact ? 13 : 15);
  for (let k = every; k <= n; k += every) back.append(s('text', { x: x(k - 0.5), y: axisY, 'text-anchor': 'middle', class: 'mc-tick' }, String(k)));
  if (compact) {
    back.append(s('text', { x: left - 5, y: axisY, 'text-anchor': 'end', class: 'mc-tick' }, 'Sol'));
    y = axisY + 4;
  } else {
    back.append(s('text', { x: left + (right - left) / 2, y: axisY + 17, 'text-anchor': 'middle', class: 'mc-axis-title' }, 'Sol (one Mars day each)'));
    y = axisY + 22;
  }

  const height = Math.ceil(y);
  const svg = s('svg', { viewBox: `0 0 ${width} ${height}`, width, height, role: 'img', 'aria-label': label, class: 'mc-svg' }, g, s('g', { class: 'mc-hl' }));
  return { svg, geo: { width, n, left, step, x, bands: strips.map((st) => [st.top, st.bottom]), points } };
}

/** Redraw at the container's real width whenever it changes (text stays a real 11px, never scaled). */
function responsive(el: HTMLElement, fallback: number, render: (width: number) => void) {
  let last = 0;
  const go = (w: number) => {
    const W = Math.round(w);
    if (W < 160 || W === last) return;
    last = W;
    render(W);
  };
  go(el.clientWidth || fallback);
  if (typeof ResizeObserver !== 'function') return;
  let seen = false;
  const ro = new ResizeObserver(() => {
    if (el.isConnected) {
      seen = true;
      go(el.clientWidth);
    } else if (seen) ro.disconnect();
  });
  ro.observe(el);
}

// ------------------------------------------------------------------ legend and table

function lineKey(cls: 'air' | 'food'): SVGSVGElement {
  return s('svg', { width: 26, height: 10, viewBox: '0 0 26 10', 'aria-hidden': 'true', class: 'mc-key' }, s('line', { x1: 1, x2: 25, y1: 5, y2: 5, class: `mc-line ${cls}` }));
}

function iconKey(kind: EventKind): SVGSVGElement {
  const svg = s('svg', { width: 16, height: 16, viewBox: '0 0 16 16', 'aria-hidden': 'true', class: 'mc-key' });
  svg.append(eventGlyph(kind, 0, 0, 16));
  return svg;
}

function legend(sr: MissionSeries): HTMLElement {
  const item = (key: Element, text: string) => h('li', null, key, h('span', null, text));
  const has = {
    safe: sr.storms.some((t) => t.shelter === 'full'),
    hit: sr.storms.some((t) => t.shelter !== 'full'),
    built: sr.built.length > 0,
    cold: sr.cold.length > 0,
  };
  return h(
    'ul',
    { class: 'mchart-legend', 'aria-label': 'Chart key' },
    item(lineKey('air'), 'Air'),
    item(lineKey('food'), 'Food'),
    (Object.keys(has) as EventKind[]).filter((k) => has[k]).map((k) => item(iconKey(k), EVENT_KEY[k])),
    sr.dust.length ? item(h('span', { class: 'mc-dust-key', 'aria-hidden': 'true' }), 'Dust storm (shaded)') : null,
  );
}

function table(sr: MissionSeries): HTMLElement {
  const n = seriesSols(sr);
  const rows = [];
  for (let k = 0; k <= n; k++) {
    rows.push(
      h(
        'tr',
        null,
        h('th', { scope: 'row' }, k === 0 ? 'Landed' : String(k)),
        h('td', null, fuelPct(sr.fuel[k])),
        h('td', null, fmt1(Math.max(0, sr.air[k]))),
        h('td', null, fmt1(Math.max(0, sr.food[k]))),
        h('td', null, `${pctOf(sr.dose[k], sr.doseBudget)}%`),
        h('td', null, k === 0 ? 'The crew lands.' : solEvents(sr, k).join(' ')),
      ),
    );
  }
  return h(
    'details',
    { class: 'mchart-table' },
    h('summary', null, 'See the numbers'),
    h(
      'div',
      { class: 'mchart-scroll' },
      h(
        'table',
        { class: 'log' },
        h('thead', null, h('tr', null, ['Sol', 'Fuel', 'Air (days)', 'Food (days)', 'Dose', 'What happened'].map((t) => h('th', { scope: 'col' }, t)))),
        h('tbody', null, rows),
      ),
    ),
  );
}

// ------------------------------------------------------------------ public charts

/** The full chart for the end-of-expedition screen. */
export function missionChart(sr: MissionSeries, outcome: SeriesOutcome): HTMLElement {
  const n = seriesSols(sr);
  const caption = h('figcaption', { class: 'kicker' }, 'How your mission went');
  if (n < 1) return h('figure', { class: 'card mchart' }, caption, h('p', { class: 'mchart-none' }, 'No sols to chart yet.'));

  const summary = seriesSummary(sr);
  const readout = h('p', { class: 'mchart-readout', 'aria-live': 'polite' });
  const plot = h('div', {
    class: 'mchart-plot',
    tabindex: '0',
    role: 'group',
    'aria-label': 'Mission chart. Use the left and right arrow keys to step through the sols.',
  });
  let geo: Geometry | null = null;
  let sel = n;
  let active = false;

  const showReadout = () => {
    const k = sel;
    const head = k === 0 ? 'Landing day' : `End of sol ${k}`;
    const values = `Fuel ${fuelPct(sr.fuel[k])} · Air ${days(sr.air[k])} · Food ${days(sr.food[k])} · Dose ${pctOf(sr.dose[k], sr.doseBudget)}% of the limit`;
    const ev = k === 0 ? [] : solEvents(sr, k);
    readout.replaceChildren(h('b', null, `${head}: `), values, h('br'), h('span', { class: 'mchart-events' }, k === 0 ? 'The crew lands at the base.' : ev.length ? ev.join(' ') : 'A quiet sol.'));
  };
  const highlight = () => {
    const hl = plot.querySelector('.mc-hl');
    if (!hl || !geo) return;
    hl.replaceChildren();
    if (!active) return;
    const k = sel;
    if (k > 0) for (const [t, b] of geo.bands) hl.append(s('rect', { x: geo.x(k - 1), y: t, width: geo.step, height: b - t, class: 'mc-col' }));
    for (const p of geo.points(k)) hl.append(s('circle', { cx: geo.x(k), cy: p.y, r: 4, class: `mc-dot ${p.cls}` }));
  };
  const select = (k: number) => {
    sel = clamp(k, 0, n);
    active = true;
    showReadout();
    highlight();
  };
  const solAt = (clientX: number) => {
    const svg = plot.querySelector('svg');
    if (!svg || !geo) return sel;
    const box = svg.getBoundingClientRect();
    const px = box.width ? ((clientX - box.left) * geo.width) / box.width : 0;
    const t = (px - geo.left) / geo.step;
    return t <= 0 ? 0 : Math.ceil(t);
  };

  plot.addEventListener('pointermove', (e) => select(solAt(e.clientX)));
  plot.addEventListener('pointerdown', (e) => select(solAt(e.clientX)));
  plot.addEventListener('keydown', (e) => {
    const moves: Record<string, number> = { ArrowLeft: sel - 1, ArrowRight: sel + 1, Home: 0, End: n };
    if (e.key in moves) {
      e.preventDefault();
      select(moves[e.key]);
    }
  });

  responsive(plot, 600, (w) => {
    const out = drawChart(sr, w, false, summary);
    geo = out.geo;
    plot.replaceChildren(out.svg);
    highlight();
  });
  showReadout();

  return h(
    'figure',
    { class: 'card mchart' },
    caption,
    h('p', { class: 'mchart-takeaway' }, seriesTakeaway(sr, outcome)),
    legend(sr),
    plot,
    readout,
    table(sr),
  );
}

/** The end screen's chart, straight from the mission log. */
export function missionChartFor(m: MissionState): HTMLElement {
  return missionChart(missionSeries(m), { status: m.status, loseReason: m.loseReason });
}

/** A small chart of one crew, for the campaign finale. */
function crewChart(r: ExpeditionResult): HTMLElement {
  const spec = EXPEDITIONS[r.n - 1];
  const name = spec ? `Crew ${r.n}: ${spec.name}` : `Crew ${r.n}`;
  const result = r.status === 'won' ? 'Launched home' : 'Came home early';
  const head = h('figcaption', null, h('b', null, name), h('span', { class: 'mchart-result' }, result));
  const sr = r.series;
  if (!sr || seriesSols(sr) < 1) return h('figure', { class: 'card mchart compact' }, head, h('p', { class: 'mchart-none' }, 'No chart for this crew: this game was saved before the charts were added.'));
  const plot = h('div', { class: 'mchart-plot' });
  const label = `${name}. ${result}. ${seriesSummary(sr)}`;
  responsive(plot, 300, (w) => plot.replaceChildren(drawChart(sr, w, true, label).svg));
  return h('figure', { class: 'card mchart compact' }, head, h('p', { class: 'mchart-takeaway' }, seriesTakeaway(sr, { status: r.status, loseReason: r.loseReason })), plot);
}

/** The finale's row of crew charts, with one shared key. */
export function crewCharts(results: ExpeditionResult[]): HTMLElement {
  const withSeries = results.map((r) => r.series).filter((x): x is MissionSeries => !!x && seriesSols(x) > 0);
  const merged: MissionSeries | null = withSeries.length
    ? {
        ...withSeries[0],
        storms: withSeries.flatMap((x) => x.storms),
        built: withSeries.flatMap((x) => x.built),
        cold: withSeries.flatMap((x) => x.cold),
        dust: withSeries.flatMap((x) => x.dust),
      }
    : null;
  return h(
    'section',
    { class: 'mchart-crews' },
    h('h3', null, 'How each crew did'),
    merged ? legend(merged) : null,
    h('div', { class: 'mchart-grid' }, results.map(crewChart)),
  );
}
