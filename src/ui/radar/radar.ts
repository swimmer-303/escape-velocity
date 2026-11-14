// Written with AI assistance (Claude Code). See README "Use of AI tools".
// Space weather radar: real NASA DONKI CMEs flying out through the solar system, seen from above.
// Sun in the middle, Earth and Mars at their real positions (JPL elements), each CME an arc whose speed,
// direction and width come from DONKI's most accurate analysis, moved by our simple constant-speed model
// (src/radar/model.ts), with NASA's own WSA-ENLIL predictions beside it. A timeline scrubber with play/pause
// covers the data window; a text summary and a list say everything the picture shows.
// Data honesty: LIVE only when the CMEs were fetched just now (our server, or DONKI directly); otherwise
// the stored snapshot, labeled ARCHIVE; the May 2024 replay is always ARCHIVE.
// Loaded lazily from src/ui/app.ts.

import { h, clear } from '../dom';
import { MAY2024_SNAPSHOT, RECENT_SNAPSHOT, type SpaceWeatherFeed } from '../../data/donki';
import { normalizeDonki, type DonkiSnapshot } from '../../data/donki-normalize';
import { heliocentric, ORBIT_DAYS, type Planet } from '../../data/lighttime';
import { REAL } from '../../sim/constants';
import { wrap180 } from '../../radar/geometry';
import {
  DAY_MS,
  SPEED_BANDS,
  buildRadar,
  calmForMars,
  countRadar,
  frontAU,
  hasCmeDirections,
  speedBand,
  timeAtAU,
  type RadarCme,
  type RadarCounts,
  type RadarData,
  type SpeedBand,
} from '../../radar/model';
import { cmeSentence, dayText, enlilText, kms, modelShort, plural, summaryLines, timeText, type RadarSource } from '../../radar/describe';

const SVG_NS = 'http://www.w3.org/2000/svg';
const DIRECT_BASE = 'https://ccmc.gsfc.nasa.gov/DONKI/WS/get';
const HOUR = 3_600_000;
const SIZE = 400;
const C = SIZE / 2;
/** The radar reaches a little past Mars' farthest distance from the Sun (1.67 AU). */
const R_MAX_AU = 1.75;
const SCALE = (C - 12) / R_MAX_AU;
/** A planet counts as "being reached" within this long of the arrival time. */
const NEAR_MS = 12 * HOUR;
/** Playback speed: one day of real time per second. */
const PLAY_RATE = DAY_MS / 1000;

const NAME: Record<Planet, string> = { earth: 'Earth', mars: 'Mars' };
const BAND_LABEL = Object.fromEntries(SPEED_BANDS.map((b) => [b.id, b.label])) as Record<SpeedBand, string>;

type Attrs = Record<string, string | number | undefined>;
function s<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Attrs = {}, ...kids: Array<SVGElement | string>): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined) el.setAttribute(k, String(v));
  for (const k of kids) el.append(k);
  return el;
}
const r1 = (n: number) => Math.round(n * 10) / 10;
/** Screen point for a distance (AU) and heliocentric ecliptic longitude: longitude 0 to the right, counterclockwise. */
function xy(rAU: number, lonDeg: number): [number, number] {
  const a = (lonDeg * Math.PI) / 180;
  return [r1(C + rAU * SCALE * Math.cos(a)), r1(C - rAU * SCALE * Math.sin(a))];
}
const link = (href: string, text: string) => h('a', { href, target: '_blank', rel: 'noopener' }, text);

/** A short sample line in a speed band's style (for the legend and the list): never color alone. */
function bandKey(band: SpeedBand | 'off'): SVGSVGElement {
  return s('svg', { class: `rd-key rd-${band}`, width: 34, height: 12, viewBox: '0 0 34 12', 'aria-hidden': 'true' }, s('path', { class: 'rd-front', d: 'M 3 6 L 31 6' }));
}

// ---------------------------------------------------------------------------- data

interface Source {
  kind: RadarSource;
  snap: DonkiSnapshot;
  data: RadarData;
  counts: RadarCounts;
  note: string;
}

function makeSource(kind: RadarSource, snap: DonkiSnapshot, note: string): Source {
  const data = buildRadar(snap);
  return { kind, snap, data, counts: countRadar(data), note };
}

const clock = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'recently';

/** The last `days` days of CMEs straight from NASA DONKI (the browser may call it: CCMC allows any origin). */
export async function fetchCmesDirect(days = 30, now = Date.now(), timeoutMs = 9000): Promise<DonkiSnapshot> {
  const ymd = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  const startDate = ymd(now - days * DAY_MS);
  const endDate = ymd(now);
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(`${DIRECT_BASE}/CME?startDate=${startDate}&endDate=${endDate}`, { signal: ctl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    const CME: unknown = text.trim() ? JSON.parse(text) : [];
    if (!Array.isArray(CME)) throw new Error('unexpected answer');
    return normalizeDonki({ CME }, { startDate, endDate, sourceUrl: DIRECT_BASE });
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------- screen

export interface RadarOptions {
  feed: SpaceWeatherFeed;
  /** Open on the May 2024 replay. */
  replay?: boolean;
  reducedMotion?: boolean;
  now?: number;
  /** Where to get live CMEs when the game's feed has none (default: NASA DONKI directly). */
  loadLive?: () => Promise<DonkiSnapshot>;
}

export function renderRadar(opts: RadarOptions): HTMLElement {
  const now = opts.now ?? Date.now();
  const feed = opts.feed;

  // ---- where the CMEs come from
  let recent: Source | null = null;
  let checking = false;
  if (feed.status === 'live' && hasCmeDirections(feed.snapshot)) {
    recent = makeSource('live', feed.snapshot, `Fetched ${clock(feed.fetchedAt)} ${feed.via === 'proxy' ? 'through our server' : 'straight from NASA'}.`);
  } else {
    if (hasCmeDirections(RECENT_SNAPSHOT)) recent = makeSource('archive', RECENT_SNAPSHOT, `Stored copy saved ${clock(RECENT_SNAPSHOT.fetchedAt)}. It is real NASA data, just not from right now.`);
    checking = true;
  }
  const replay = hasCmeDirections(MAY2024_SNAPSHOT)
    ? makeSource('replay', MAY2024_SNAPSHOT, "A replay of real NASA data from May 2024, the month of Earth's strongest geomagnetic storm in more than 20 years.")
    : null;

  let src: Source | null = opts.replay && replay ? replay : (recent ?? replay);
  let t = 0;
  let selected: string | null = null;
  let filter: 'mars' | 'earth' | 'all' = 'all';
  let playing = false;
  let rafId = 0;
  let intervalId: ReturnType<typeof setInterval> | undefined;
  let lastTs = 0;

  // ---- skeleton
  const root = h('div', { class: 'radar' });
  const sourceEl = h('p', { class: 'radar-source' });
  const recentBtn = h('button', { class: 'btn small', onclick: () => switchTo('recent') }, 'Last 30 days');
  const replayBtn = h('button', { class: 'btn small', onclick: () => switchTo('replay'), disabled: replay ? undefined : true }, 'Replay: May 2024');
  const toggles = h('div', { class: 'radar-toggle', role: 'group', 'aria-label': 'Which CMEs to show' }, recentBtn, replayBtn);
  const summaryEl = h('div', { class: 'radar-summary', id: 'radar-summary' });

  const staticLayer = s('g', { 'aria-hidden': 'true' });
  const dynLayer = s('g', { 'aria-hidden': 'true' });
  const svg = s('svg', { class: 'radar-svg', viewBox: `0 0 ${SIZE} ${SIZE}`, role: 'img', 'aria-describedby': 'radar-summary' }, staticLayer, dynLayer);
  const figure = h('figure', { class: 'radar-figure' }, svg);
  const nowEl = h('p', { class: 'radar-now' });

  const dateEl = h('output', { class: 'radar-date' });
  const ticks = s('svg', { class: 'radar-ticks', viewBox: '0 0 1000 24', preserveAspectRatio: 'none', 'aria-hidden': 'true' });
  const range = h('input', { class: 'radar-range', type: 'range', min: 0, max: 1, step: 1, value: 0, 'aria-label': 'Date shown on the radar' });
  const playBtn = h('button', { class: 'btn small primary radar-play', 'data-autofocus': true, onclick: () => (playing ? stop() : play()) }, 'Play');
  const endBtn = h('button', { class: 'btn small', onclick: () => jump(Infinity) }, 'End');
  const buttons = h(
    'div',
    { class: 'radar-buttons' },
    h('button', { class: 'btn small', onclick: () => jump(-Infinity) }, 'Start'),
    h('button', { class: 'btn small', onclick: () => jump(-DAY_MS) }, 'Back 1 day'),
    playBtn,
    h('button', { class: 'btn small', onclick: () => jump(DAY_MS) }, 'Forward 1 day'),
    endBtn,
  );
  const liveEl = h('p', { class: 'sr-only', 'aria-live': 'polite' });
  const filterEl = h('div', { class: 'radar-toggle', role: 'group', 'aria-label': 'Which CMEs to list' });
  const listHead = h('h3', null, 'CMEs on the radar');
  const listEl = h('ol', { class: 'radar-list' });
  const undirectedEl = h('div');
  const notesEl = h('div', { class: 'radar-notes' });

  root.append(
    h('div', { class: 'kicker' }, 'Space weather radar'),
    h('h2', null, 'Real solar storms flying through space'),
    sourceEl,
    toggles,
    summaryEl,
    h(
      'div',
      { class: 'radar-main' },
      h('div', null, figure, nowEl),
      legend(),
    ),
    h('div', { class: 'radar-timeline' }, h('div', { class: 'radar-when' }, dateEl, h('span', { class: 'radar-rate' }, 'Play shows 1 day every second.')), ticks, range, buttons),
    liveEl,
    listHead,
    filterEl,
    listEl,
    undirectedEl,
    notesEl,
  );

  drawStatic();

  // ---- timeline controls
  range.addEventListener('input', () => {
    stop(false);
    if (src) setTime(src.data.startMs + Number(range.value) * HOUR);
  });
  range.addEventListener('change', () => announce());
  range.addEventListener('keydown', (e) => {
    const steps: Record<string, number> = { ArrowRight: 6 * HOUR, ArrowUp: 6 * HOUR, ArrowLeft: -6 * HOUR, ArrowDown: -6 * HOUR, PageUp: DAY_MS, PageDown: -DAY_MS, Home: -Infinity, End: Infinity };
    if (e.key === ' ' || e.key === 'Spacebar') {
      e.preventDefault();
      if (playing) stop();
      else play();
    } else if (e.key in steps) {
      e.preventDefault();
      jump(steps[e.key]);
    }
  });

  function jump(by: number) {
    if (!src) return;
    stop(false);
    const d = src.data;
    setTime(by === Infinity ? d.endMs : by === -Infinity ? d.startMs : t + by);
    announce();
  }

  function play() {
    if (!src) return;
    if (t >= src.data.endMs - HOUR) setTime(src.data.startMs);
    playing = true;
    playBtn.textContent = 'Pause';
    lastTs = 0;
    if (opts.reducedMotion) {
      // Reduced motion: hop 6 hours at a time instead of a smooth animation (same overall pace).
      intervalId = setInterval(() => advance(6 * HOUR), 250);
    } else {
      const raf = window.requestAnimationFrame?.bind(window) ?? ((cb: FrameRequestCallback) => setTimeout(() => cb(performance.now()), 16) as unknown as number);
      const frame = (ts: number) => {
        if (!playing) return;
        if (lastTs) advance(Math.min(100, ts - lastTs) * PLAY_RATE);
        lastTs = ts;
        if (playing) rafId = raf(frame);
      };
      rafId = raf(frame);
    }
  }

  function advance(ms: number) {
    if (!src || !root.isConnected) return stop(false);
    setTime(t + ms);
    if (t >= src.data.endMs) stop();
  }

  function stop(say = true) {
    if (!playing) return;
    playing = false;
    if (rafId) window.cancelAnimationFrame?.(rafId);
    if (intervalId) clearInterval(intervalId);
    rafId = 0;
    intervalId = undefined;
    playBtn.textContent = 'Play';
    if (say) announce();
  }

  function setTime(ms: number) {
    if (!src) return;
    const d = src.data;
    t = Math.max(d.startMs, Math.min(d.endMs, ms));
    range.value = String(Math.round((t - d.startMs) / HOUR));
    const label = timeText(t, true) + (src.kind === 'live' && Math.abs(now - t) < HOUR ? ' (now)' : '');
    range.setAttribute('aria-valuetext', label);
    dateEl.textContent = label;
    draw();
  }

  // ---- switching data
  function switchTo(which: 'recent' | 'replay') {
    const next = which === 'replay' ? replay : recent;
    if (!next) return;
    stop(false);
    src = next;
    selected = null;
    setup();
  }

  function setup() {
    recentBtn.setAttribute('aria-pressed', String(src?.kind !== 'replay'));
    replayBtn.setAttribute('aria-pressed', String(src?.kind === 'replay'));
    recentBtn.disabled = !recent;
    renderSource();
    if (!src) {
      clear(summaryEl);
      summaryEl.append(h('p', null, 'No CME data could be loaded, live or stored.'));
      return;
    }
    const d = src.data;
    range.max = String(Math.max(1, Math.ceil((d.endMs - d.startMs) / HOUR)));
    endBtn.textContent = src.kind === 'live' ? 'Now' : 'End';
    const marsCount = d.cmes.filter(towardMars).length;
    filter = marsCount ? 'mars' : 'all';
    renderSummary();
    renderTicks();
    renderList();
    renderUndirected();
    renderNotes();
    if (src.kind === 'replay' && src.counts.fastest) {
      // Open the replay on its fastest CME (May 20, 2024: 2,678 km/s from the far side of the Sun).
      select(src.counts.fastest, false);
    } else {
      setTime(d.endMs);
    }
    announce();
  }

  function renderSource() {
    clear(sourceEl);
    if (!src) {
      sourceEl.append(h('span', { class: 'tag archive' }, 'UNAVAILABLE'), checking ? 'Checking NASA DONKI...' : 'No CME data.');
      return;
    }
    const live = src.kind === 'live';
    sourceEl.append(
      h('span', { class: `tag ${live ? 'live' : 'archive'}` }, live ? 'LIVE' : 'ARCHIVE'),
      live ? 'Real CMEs from NASA DONKI. ' : 'Real CMEs from NASA DONKI, stored. ',
      src.note,
      src.kind === 'archive' && checking ? ' Checking NASA for live data...' : '',
    );
  }

  function renderSummary() {
    clear(summaryEl);
    if (!src) return;
    for (const line of summaryLines(src.data, src.counts, src.kind)) summaryEl.append(h('p', null, line));
    if (src.kind !== 'replay' && calmForMars(src.counts) && replay) {
      summaryEl.append(
        h(
          'div',
          { class: 'card event radar-calm' },
          h('b', null, 'Want to see a stormy month? '),
          'Replay May 2024, when a CME left the far side of the Sun at 2,678 km/s.',
          h('div', null, h('button', { class: 'btn small cyan', onclick: () => switchTo('replay') }, 'Replay May 2024')),
        ),
      );
    }
  }

  function renderTicks() {
    clear(ticks);
    if (!src) return;
    const d = src.data;
    const span = d.endMs - d.startMs || 1;
    ticks.append(s('line', { x1: 0, y1: 23, x2: 1000, y2: 23, class: 'rd-tickbase' }));
    for (const c of d.cmes) {
      const x = r1(((c.startMs - d.startMs) / span) * 1000);
      if (x < 0 || x > 1000) continue;
      const band = speedBand(c.speed);
      const height = 6 + SPEED_BANDS.findIndex((b) => b.id === band) * 5;
      ticks.append(s('rect', { class: `rd-tick rd-${band}`, x: x - 1.5, y: 23 - height, width: 3, height }));
    }
  }

  const towardMars = (c: RadarCme) => c.mars.inside || !!c.enlil?.mars;
  const towardEarth = (c: RadarCme) => c.earth.inside || !!c.enlil?.earth;

  function renderList() {
    clear(listEl);
    clear(filterEl);
    if (!src) return;
    const d = src.data;
    const options: Array<[typeof filter, string, number]> = [
      ['mars', 'Headed for Mars', d.cmes.filter(towardMars).length],
      ['earth', 'Headed for Earth', d.cmes.filter(towardEarth).length],
      ['all', 'All', d.cmes.length],
    ];
    for (const [id, label, n] of options) {
      filterEl.append(
        h(
          'button',
          {
            class: 'btn small',
            'aria-pressed': String(filter === id),
            onclick: () => {
              filter = id;
              renderList();
            },
          },
          `${label} (${n})`,
        ),
      );
    }
    listHead.textContent = `CMEs on the radar: ${plural(d.cmes.length, 'CME')}`;
    const shown = d.cmes.filter(filter === 'mars' ? towardMars : filter === 'earth' ? towardEarth : () => true).slice().reverse();
    if (!shown.length) {
      listEl.append(h('li', { class: 'radar-item' }, filter === 'all' ? 'No CMEs with a measured direction in this window.' : `None in this window, by our model or by NASA's ENLIL model.`));
      return;
    }
    for (const c of shown) {
      const sel = c.id === selected;
      const band = speedBand(c.speed);
      const earthEnlil = enlilText(c, 'earth');
      listEl.append(
        h(
          'li',
          { class: `radar-item${sel ? ' sel' : ''}` },
          h(
            'button',
            { class: 'btn small radar-show', 'aria-pressed': String(sel), 'aria-label': `Show the CME of ${dayText(c.startMs)}, ${kms(c.speed)}, on the radar`, onclick: () => select(c) },
            sel ? 'Showing' : 'Show',
          ),
          h(
            'div',
            { class: 'radar-item-body' },
            h('p', null, bandKey(band), h('span', { class: 'radar-band' }, BAND_LABEL[band]), ' ', cmeSentence(c, d.endMs)),
            h('p', { class: 'radar-earth' }, h('b', null, 'At Earth: '), `${modelShort(c, 'earth', d.endMs)}.`, earthEnlil ? ` ${earthEnlil}.` : ''),
            h(
              'p',
              { class: 'radar-links' },
              c.link ? link(c.link, 'NASA DONKI record') : null,
              c.enlil?.link ? [' · ', link(c.enlil.link, "NASA's ENLIL model run")] : null,
              c.enlil ? null : ' · No NASA ENLIL run is listed for this CME.',
            ),
          ),
        ),
      );
    }
  }

  function renderUndirected() {
    clear(undirectedEl);
    if (!src || !src.data.undirected.length) return;
    const u = src.data.undirected;
    undirectedEl.append(
      h(
        'details',
        { class: 'radar-undirected' },
        h('summary', null, `${plural(u.length, 'more CME')} with no measured direction (not on the radar)`),
        h('p', null, 'DONKI measured these only as they looked from one viewpoint, so it has a speed but no direction for them.'),
        h(
          'ul',
          null,
          u.map((c) => h('li', null, `${dayText(c.startMs)}${c.speed ? `: ${kms(c.speed)}` : ''} `, c.link ? link(c.link, 'record') : null)),
        ),
      ),
    );
  }

  function renderNotes() {
    clear(notesEl);
    const may = src?.kind === 'replay';
    notesEl.append(
      h('h3', null, 'How the radar works'),
      h(
        'ul',
        null,
        h('li', null, "A view from above the Sun's north pole. Earth and Mars travel counterclockwise. Distances are to scale; the Sun and planets are drawn much bigger than real. Rings: 0.5, 1 and 1.5 AU from the Sun (1 AU = 150 million km)."),
        h('li', null, "Earth and Mars sit at their real places for each date, worked out from JPL's orbital elements (approximate: orbits drawn flat)."),
        h('li', null, "Every CME is a real one from NASA DONKI. Its speed, direction and cone width come from DONKI's most accurate analysis. The arc shows where the cone crosses the planets' flat plane; a gray dotted arc means the cone passed above or below the planets."),
        h('li', null, '"West of Earth" means ahead of Earth on its path around the Sun; "east" means behind it. DONKI measures directions this way, from the line between the Sun and Earth.'),
        h(
          'li',
          null,
          h('b', null, 'Simple model: constant speed. '),
          "We move each CME's front straight out at DONKI's measured speed, starting when it was 21.5 times the Sun's radius from the Sun. Real CMEs speed up or slow down in the solar wind, so our times and hits are estimates.",
        ),
        h(
          'li',
          null,
          h('b', null, "NASA's ENLIL model: "),
          "a computer model of the whole solar wind that NASA's space weather forecasters run for many CMEs. Its predictions are copied straight from DONKI. When the two models disagree, that's normal: forecasting CMEs is hard, and scientists compare many models.",
        ),
        h('li', null, `CMEs that left the Sun before ${src ? dayText(src.data.startMs) : 'the window'} are not shown.`),
        may
          ? h(
              'li',
              null,
              h('b', null, 'May 20, 2024: '),
              `our model and NASA's ENLIL model both say this CME's cloud passed beside Mars. But its fastest particles still reached Mars in tens of minutes, because energetic particles travel along the Sun's magnetic field, not just with the cloud. Curiosity measured ${REAL.may2024EventUgy.toLocaleString('en-US')} micrograys at Gale Crater (NASA/JPL).`,
            )
          : null,
      ),
    );
  }

  function select(c: RadarCme, scroll = true) {
    if (!src) return;
    stop(false);
    selected = c.id;
    renderList();
    // Show it just after launch, when its front is about 0.35 AU out (press Play to watch it fly).
    setTime(timeAtAU(c, 0.35));
    announce();
    if (scroll && typeof figure.scrollIntoView === 'function') figure.scrollIntoView({ block: 'nearest', behavior: opts.reducedMotion ? 'auto' : 'smooth' });
  }

  // ---- drawing
  function drawStatic() {
    const g = staticLayer;
    g.append(s('circle', { class: 'rd-bg', cx: C, cy: C, r: R_MAX_AU * SCALE + 6 }));
    for (let a = 0; a < 360; a += 30) {
      const [x, y] = xy(R_MAX_AU, a);
      g.append(s('line', { class: 'rd-spoke', x1: C, y1: C, x2: x, y2: y }));
    }
    for (const r of [0.5, 1, 1.5]) {
      g.append(s('circle', { class: 'rd-ring', cx: C, cy: C, r: r1(r * SCALE) }));
      g.append(s('text', { class: 'rd-ringlabel', x: C + 3, y: r1(C - r * SCALE - 3) }, `${r} AU`));
    }
    for (const p of ['earth', 'mars'] as const) {
      const days = ORBIT_DAYS[p];
      const pts: string[] = [];
      for (let i = 0; i <= 120; i++) {
        const pos = heliocentric(p, Date.UTC(2026, 0, 1) + (i / 120) * days * DAY_MS);
        pts.push(xy(pos.rAU, pos.lonDeg).join(','));
      }
      g.append(s('polyline', { class: `rd-orbit rd-orbit-${p}`, points: pts.join(' ') }));
    }
  }

  function draw() {
    clear(dynLayer);
    if (!src) return;
    const d = src.data;
    const earth = heliocentric('earth', t);
    const mars = heliocentric('mars', t);
    const g = dynLayer;

    // The Sun-Earth line: DONKI measures CME directions from it.
    const [lx, ly] = xy(R_MAX_AU, earth.lonDeg);
    g.append(s('line', { class: 'rd-earthline', x1: C, y1: C, x2: lx, y2: ly }));
    for (const [off, text] of [
      [90, '90° W'],
      [-90, '90° E'],
    ] as const) {
      const [x, y] = xy(R_MAX_AU - 0.08, earth.lonDeg + off);
      g.append(s('text', { class: 'rd-dirlabel', x, y, 'text-anchor': 'middle' }, text));
    }

    // CMEs in flight (the selected one on top).
    const flying = d.cmes
      .filter((c) => {
        const r = frontAU(c, t);
        return r > 0.02 && r <= R_MAX_AU;
      })
      .sort((a, b) => Number(a.id === selected) - Number(b.id === selected) || a.speed - b.speed);
    for (const c of flying) g.append(cmeShape(c, frontAU(c, t)));

    // The Sun.
    g.append(s('circle', { class: 'rd-sunglow', cx: C, cy: C, r: 13 }), s('circle', { class: 'rd-sun', cx: C, cy: C, r: 8 }));
    g.append(s('text', { class: 'rd-label', x: C, y: C + 24, 'text-anchor': 'middle' }, 'Sun'));

    // Planets, with rings when a CME front reaches them.
    for (const [p, pos] of [
      ['earth', earth],
      ['mars', mars],
    ] as const) {
      const [x, y] = xy(pos.rAU, pos.lonDeg);
      if (reachedNow(p, 'model')) g.append(s('circle', { class: 'rd-model-ring', cx: x, cy: y, r: 13 }));
      if (reachedNow(p, 'enlil')) g.append(s('circle', { class: 'rd-enlil-ring', cx: x, cy: y, r: 18 }));
      g.append(s('circle', { class: `rd-planet rd-${p}`, cx: x, cy: y, r: 7 }));
      // Earth's name goes outside its orbit, Mars' inside (Mars sits near the radar's edge).
      const [tx, ty] = xy(pos.rAU + (p === 'earth' ? 0.24 : -0.24), pos.lonDeg);
      g.append(s('text', { class: 'rd-label', x: tx, y: ty + 4, 'text-anchor': 'middle' }, NAME[p]));
    }

    nowEl.textContent = nowText(flying.length);
  }

  function cmeShape(c: RadarCme, rAU: number): SVGGElement {
    const inPlane = c.planeHalfWidth != null;
    const w = Math.min(179, inPlane ? c.planeHalfWidth! : c.halfAngle);
    const [x0, y0] = xy(rAU, c.axisLon - w);
    const [x1, y1] = xy(rAU, c.axisLon + w);
    const rp = r1(rAU * SCALE);
    const large = 2 * w > 180 ? 1 : 0;
    const arc = `A ${rp} ${rp} 0 ${large} 0 ${x1} ${y1}`;
    const sel = c.id === selected;
    const g = s('g', { class: `rd-cme rd-${inPlane ? speedBand(c.speed) : 'off'}${sel ? ' rd-sel' : ''}` });
    if (inPlane) g.append(s('path', { class: 'rd-wedge', d: `M ${C} ${C} L ${x0} ${y0} ${arc} Z` }));
    if (sel) g.append(s('path', { class: 'rd-halo', d: `M ${x0} ${y0} ${arc}` }));
    g.append(s('path', { class: 'rd-front', d: `M ${x0} ${y0} ${arc}` }));
    if (sel) {
      const [tx, ty] = xy(Math.min(R_MAX_AU - 0.05, rAU + 0.12), c.axisLon);
      g.append(s('text', { class: 'rd-label rd-speedlabel', x: tx, y: ty + 4, 'text-anchor': 'middle' }, kms(c.speed)));
    }
    return g;
  }

  function reachedNow(p: Planet, who: 'model' | 'enlil'): boolean {
    if (!src) return false;
    return src.data.cmes.some((c) => {
      const at = who === 'model' ? (c[p].inside ? c[p].atMs : NaN) : Date.parse(c.enlil?.[p]?.time ?? '');
      return Number.isFinite(at) && Math.abs(at - t) <= NEAR_MS;
    });
  }

  function nowText(inFlight: number): string {
    const parts = [`${plural(inFlight, 'CME')} on the radar right now.`];
    for (const p of ['mars', 'earth'] as const) {
      const model = reachedNow(p, 'model');
      const enlil = reachedNow(p, 'enlil');
      if (model) parts.push(`Our model: a CME front is reaching ${NAME[p]} (estimate).`);
      if (enlil) parts.push(`NASA's ENLIL model predicted a CME arriving at ${NAME[p]} around now.`);
    }
    return parts.join(' ');
  }

  function sceneText(): string {
    if (!src) return '';
    const earth = heliocentric('earth', t);
    const mars = heliocentric('mars', t);
    const ahead = Math.round(wrap180(mars.lonDeg - earth.lonDeg));
    const marsWhere = Math.abs(ahead) <= 3 ? 'in line with Earth' : `${Math.abs(ahead)}° ${ahead > 0 ? 'west of Earth (ahead of it)' : 'east of Earth (behind it)'}`;
    const flying = src.data.cmes.filter((c) => {
      const r = frontAU(c, t);
      return r > 0.02 && r <= R_MAX_AU;
    });
    return `Radar for ${timeText(t, true)}. Earth is ${earth.rAU.toFixed(2)} AU from the Sun. Mars is ${mars.rAU.toFixed(2)} AU from the Sun, ${marsWhere}. ${nowText(flying.length)}`;
  }

  function announce() {
    const text = sceneText();
    liveEl.textContent = text;
    svg.setAttribute('aria-label', text || 'Space weather radar');
  }

  // ---- go
  setup();

  // The game's feed had no live CMEs: ask NASA directly, and switch to LIVE if that works.
  if (checking) {
    const load = opts.loadLive ?? (() => fetchCmesDirect(30, now));
    load()
      .then((snap) => {
        checking = false;
        if (!hasCmeDirections(snap)) throw new Error('no CMEs');
        recent = makeSource('live', snap, `Fetched ${clock(snap.fetchedAt)} straight from NASA.`);
        if (src?.kind !== 'replay') {
          src = recent;
          selected = null;
          setup();
        } else renderSource();
      })
      .catch(() => {
        checking = false;
        renderSource();
      });
  }

  return root;
}

function legend(): HTMLElement {
  const ring = (cls: string) =>
    s('svg', { class: 'rd-key', width: 34, height: 22, viewBox: '0 0 34 22', 'aria-hidden': 'true' }, s('circle', { class: cls, cx: 17, cy: 11, r: 8 }), s('circle', { class: 'rd-planet rd-mars', cx: 17, cy: 11, r: 4 }));
  const dot = (cls: string) => s('svg', { class: 'rd-key', width: 34, height: 16, viewBox: '0 0 34 16', 'aria-hidden': 'true' }, s('circle', { class: cls, cx: 17, cy: 8, r: 6 }));
  return h(
    'div',
    { class: 'radar-legend' },
    h('div', { class: 'kicker' }, 'CME speed'),
    h(
      'ul',
      null,
      SPEED_BANDS.map((b) => h('li', null, bandKey(b.id), h('span', null, h('b', null, b.label), `: ${b.range}`))),
      h('li', null, bandKey('off'), h('span', null, 'Passed above or below the planets')),
    ),
    h('div', { class: 'kicker' }, 'On the map'),
    h(
      'ul',
      null,
      h('li', null, dot('rd-sun'), 'The Sun'),
      h('li', null, dot('rd-planet rd-earth'), 'Earth'),
      h('li', null, dot('rd-planet rd-mars'), 'Mars'),
      h('li', null, ring('rd-model-ring'), 'Our model: CME front reaching a planet (estimate)'),
      h('li', null, ring('rd-enlil-ring'), "NASA's ENLIL model: predicted arrival"),
    ),
  );
}
