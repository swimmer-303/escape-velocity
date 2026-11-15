// Written with AI assistance (Claude Code). See README "Use of AI tools".
// The teacher dashboard's parts, drawn from one DashboardView: class summary tiles, the most
// common trouble (with a question to ask the class), upgrade popularity, a sortable table of
// students, and small fuel charts of each student's last crew.
// Built for a projector at 1280x720 and a laptop: big type, one chart hue (the game's fuel
// cyan, checked on the card surface), every number also printed as text.

import { h } from '../dom';
import { UPGRADES } from '../../sim/upgrades';
import type { LoseReason } from '../../sim/types';
import type { CrewView, DashboardView, JoinedView, PlayerView } from '../../class/protocol';
import { latestStars, summarize, type ClassSummary } from '../../class/summary';

/** Plain words for why a crew came home early, and a question for the class. */
export const TROUBLE: Record<LoseReason, { label: string; what: string; ask: string }> = {
  air: { label: 'Ran out of air', what: 'ran out of air', ask: 'Why do you think that happened?' },
  food: { label: 'Ran out of food', what: 'ran out of food', ask: 'What could the crew have done to grow more food?' },
  dose: { label: 'Too much radiation', what: 'took too much radiation', ask: 'When is the storm shelter worth its power?' },
  window: { label: 'Out of time', what: 'ran out of time before the tank was full', ask: 'What slowed their fuel down?' },
};

/** "Many crews ran out of air. Why do you think that happened?" */
export function troublePrompt(reason: LoseReason, count: number): string {
  const who = count === 1 ? 'One crew' : count === 2 ? 'Two crews' : 'Many crews';
  return `${who} ${TROUBLE[reason].what}. ${TROUBLE[reason].ask}`;
}

export interface ViewState {
  hideNames: boolean;
  /** Show the teacher's Remove buttons. */
  manage: boolean;
  sort: SortKey;
  dir: 1 | -1;
  /** The student whose Remove button is waiting for a second press. */
  confirm: number | null;
}

export type SortKey = 'name' | 'site' | 'crews' | 'stars' | 'best' | 'built' | 'last';

const turn = (site: 'mars' | 'moon', n: number) => (site === 'moon' ? (n === 1 ? 'day' : 'days') : n === 1 ? 'sol' : 'sols');

export function displayName(p: PlayerView, hide: boolean): string {
  return !hide && p.name ? p.name : `Player ${p.num}`;
}

/** "Launched home" or "Ran out of air", for the last crew. */
export function outcome(c: CrewView): string {
  return c.status === 'won' ? 'Launched home' : c.loseReason ? TROUBLE[c.loseReason].label : 'Came home early';
}

function crewName(c: CrewView): string {
  return c.mode === 'quick' ? 'Quick mission' : `Crew ${c.n}`;
}

const siteName = (s: 'mars' | 'moon') => (s === 'moon' ? 'Moon' : 'Mars');

// ------------------------------------------------------------------ summary

function tile(value: string, label: string, sub?: string): HTMLElement {
  return h('div', { class: 'db-tile' }, h('div', { class: 'db-tile-value' }, value), h('div', { class: 'db-tile-label' }, label), sub ? h('div', { class: 'db-tile-sub' }, sub) : null);
}

/** `playing`: students who started their first crew and have no result yet (they count as students too). */
export function summaryTiles(s: ClassSummary, playing = 0): HTMLElement {
  const total = s.players + playing;
  return h(
    'section',
    { class: 'db-tiles', 'aria-label': 'Class summary' },
    tile(String(total), total === 1 ? 'Student' : 'Students', playing ? `${playing} playing their first crew` : undefined),
    tile(String(s.launched), 'Crews launched', s.crews ? `of ${s.crews} crews` : undefined),
    tile(String(s.early), 'Sent home early', s.crews ? `of ${s.crews} crews` : undefined),
    tile(s.avgStars === null ? '-' : s.avgStars.toFixed(1), 'Average stars', 'per crew, out of 3'),
  );
}

/** A labeled horizontal bar: the number is always written next to it. */
function barRow(label: string, count: number, max: number, countText: string, extra?: HTMLElement | null): HTMLElement {
  const pct = max > 0 ? Math.max(4, Math.round((count / max) * 100)) : 0;
  return h(
    'li',
    { class: 'db-bar-row' },
    h('div', { class: 'db-bar-head' }, h('span', { class: 'db-bar-label' }, label), h('span', { class: 'db-bar-count' }, countText)),
    h('div', { class: 'db-bar', 'aria-hidden': 'true', title: `${label}: ${countText}` }, h('span', { style: `width:${pct}%` })),
    extra ?? null,
  );
}

export function troubleSection(s: ClassSummary): HTMLElement {
  const head = h('h2', null, 'Most common trouble');
  if (!s.crews) return h('section', { class: 'db-card' }, head, h('p', { class: 'db-empty' }, 'No crews have finished yet.'));
  if (!s.trouble.length)
    return h(
      'section',
      { class: 'db-card' },
      head,
      h('p', { class: 'db-empty' }, 'No crew has been sent home early yet.'),
      h('p', { class: 'db-ask' }, h('b', null, 'Ask: '), 'What did your crew do to keep everyone safe?'),
    );
  const max = s.trouble[0].count;
  return h(
    'section',
    { class: 'db-card' },
    head,
    h(
      'ul',
      { class: 'db-bars' },
      s.trouble.map((t) => barRow(TROUBLE[t.reason].label, t.count, max, `${t.count} ${t.count === 1 ? 'crew' : 'crews'}`, h('p', { class: 'db-ask' }, h('b', null, 'Ask: '), troublePrompt(t.reason, t.count)))),
    ),
  );
}

export function upgradeSection(s: ClassSummary): HTMLElement {
  const head = h('h2', null, 'Most built upgrades');
  if (!s.upgrades.length)
    return h(
      'section',
      { class: 'db-card' },
      head,
      h('p', { class: 'db-empty' }, 'No upgrades built yet.'),
      s.crews ? h('p', { class: 'db-ask' }, h('b', null, 'Ask: '), 'Why might a crew skip the Workshop? What does that cost the next crew?') : null,
    );
  const max = Math.max(...s.upgrades.map((u) => u.players));
  return h(
    'section',
    { class: 'db-card' },
    head,
    h('p', { class: 'db-note' }, 'How many students finished each upgrade at least once.'),
    h(
      'ul',
      { class: 'db-bars' },
      s.upgrades.map((u) => barRow(UPGRADES[u.id].name, u.players, max, `${u.players} ${u.players === 1 ? 'student' : 'students'}`)),
    ),
  );
}

// ------------------------------------------------------------------ the table

const COLUMNS: Array<{ key: SortKey; label: string; numeric?: boolean }> = [
  { key: 'name', label: 'Student' },
  { key: 'site', label: 'Site' },
  { key: 'crews', label: 'Crews', numeric: true },
  { key: 'stars', label: 'Stars', numeric: true },
  { key: 'best', label: 'Fastest launch', numeric: true },
  { key: 'built', label: 'What they built' },
  { key: 'last', label: 'Last crew' },
];

const OUTCOME_RANK: Record<string, number> = { won: 0, air: 1, food: 2, dose: 3, window: 4 };

/** Sort students by one column. Missing values (no launch yet) always go last. */
export function sortPlayers(players: PlayerView[], key: SortKey, dir: 1 | -1, hideNames = false): PlayerView[] {
  const val = (p: PlayerView): string | number | null => {
    switch (key) {
      case 'name':
        return displayName(p, hideNames);
      case 'site':
        return p.tally.sites.map(siteName).join(' and ');
      case 'crews':
        return p.tally.crews;
      case 'stars':
        return latestStars(p).stars;
      case 'best':
        return p.tally.best?.sols ?? null;
      case 'built':
        return p.tally.built.length;
      case 'last':
        return OUTCOME_RANK[p.last.status === 'won' ? 'won' : (p.last.loseReason ?? 'window')] ?? 9;
    }
  };
  const byName = (a: PlayerView, b: PlayerView) => displayName(a, hideNames).localeCompare(displayName(b, hideNames), undefined, { numeric: true, sensitivity: 'base' });
  return [...players].sort((a, b) => {
    const va = val(a);
    const vb = val(b);
    if (va === null || vb === null) return va === vb ? byName(a, b) : va === null ? 1 : -1;
    const c = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb), undefined, { numeric: true, sensitivity: 'base' });
    return c !== 0 ? c * dir : byName(a, b);
  });
}

export interface TableHandlers {
  onSort: (key: SortKey) => void;
  onRemove: (p: PlayerView) => void;
}

/** "Playing their first crew: Ava, Player 4." Students who joined with the code and have no result yet. */
function playingLine(joined: JoinedView[], hide: boolean): HTMLElement | null {
  if (!joined.length) return null;
  const names = joined.map((j) => (!hide && j.name ? j.name : `Player ${j.num}`));
  return h('p', { class: 'db-playing' }, h('b', null, 'Playing their first crew: '), `${names.join(', ')}. Their results show here when the crew ends.`);
}

export function studentTable(players: PlayerView[], st: ViewState, on: TableHandlers, joined: JoinedView[] = []): HTMLElement {
  const head = h('h2', { id: 'db-students' }, 'Students');
  const playing = playingLine(joined, st.hideNames);
  if (!players.length)
    return h(
      'section',
      { class: 'db-card' },
      head,
      playing ?? h('p', { class: 'db-empty' }, 'Nobody has joined yet. Students show up here as soon as they start a crew with the class code.'),
    );
  const rows = sortPlayers(players, st.sort, st.dir, st.hideNames).map((p) => {
    const { stars, max } = latestStars(p);
    const best = p.tally.best;
    return h(
      'tr',
      null,
      h('th', { scope: 'row' }, displayName(p, st.hideNames)),
      h('td', null, p.tally.sites.map(siteName).join(', ')),
      h('td', { class: 'num' }, String(p.tally.crews)),
      h('td', { class: 'num' }, `${stars} of ${max}`),
      h('td', { class: 'num' }, best ? `${best.sols} ${turn(best.site, best.sols)}` : '-'),
      h('td', null, p.tally.built.length ? p.tally.built.map((id) => UPGRADES[id].name).join(', ') : 'Nothing yet'),
      h('td', null, h('span', { class: `db-outcome ${p.last.status}` }, `${crewName(p.last)}: ${outcome(p.last)}`)),
      st.manage
        ? h(
            'td',
            null,
            h(
              'button',
              { class: `btn small db-remove ${st.confirm === p.num ? 'primary' : ''}`, 'data-fk': `remove-${p.num}`, 'aria-label': `${st.confirm === p.num ? 'Press again to remove' : 'Remove'} ${displayName(p, st.hideNames)} from the board`, onclick: () => on.onRemove(p) },
              st.confirm === p.num ? 'Sure? Remove' : 'Remove',
            ),
          )
        : null,
    );
  });
  const th = (c: (typeof COLUMNS)[number]) => {
    const active = st.sort === c.key;
    return h(
      'th',
      { scope: 'col', class: c.numeric ? 'num' : undefined, 'aria-sort': active ? (st.dir === 1 ? 'ascending' : 'descending') : 'none' },
      h(
        'button',
        { class: 'db-sort', 'data-fk': `sort-${c.key}`, onclick: () => on.onSort(c.key) },
        c.label,
        h('span', { class: `db-sort-arrow ${active ? (st.dir === 1 ? 'up' : 'down') : ''}`, 'aria-hidden': 'true' }),
      ),
    );
  };
  return h(
    'section',
    { class: 'db-card', 'aria-labelledby': 'db-students' },
    head,
    playing,
    h(
      'div',
      { class: 'db-table-wrap' },
      h(
        'table',
        { class: 'log db-table' },
        h('caption', { class: 'sr-only' }, 'Each student: site, crews played, stars (the latest result for each crew), fastest launch, upgrades built and how their last crew ended. Press a column heading to sort.'),
        h('thead', null, h('tr', null, COLUMNS.map(th), st.manage ? h('th', { scope: 'col' }, h('span', { class: 'sr-only' }, 'Remove')) : null)),
        h('tbody', null, rows),
      ),
    ),
  );
}

// ------------------------------------------------------------------ fuel lines

const SVG_NS = 'http://www.w3.org/2000/svg';
function s(tag: string, attrs: Record<string, string | number>, ...kids: SVGElement[]): SVGElement {
  const el = document.createElementNS(SVG_NS, tag) as SVGElement;
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  el.append(...kids);
  return el;
}

/** A small fuel-tank line: 0 to 100%, one point per sol, with the "full" line on top. */
export function fuelSpark(fuel: number[], label: string): SVGElement {
  const W = 200;
  const H = 64;
  const top = 6;
  const bottom = H - 4;
  const n = Math.max(1, fuel.length - 1);
  const x = (i: number) => 2 + (i / n) * (W - 4);
  const y = (v: number) => bottom - (Math.max(0, Math.min(100, v)) / 100) * (bottom - top);
  const line = fuel.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join('');
  const area = `${line}L${x(fuel.length - 1).toFixed(1)} ${bottom}L${x(0)} ${bottom}Z`;
  const svg = s(
    'svg',
    { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': label, class: 'db-spark-svg', preserveAspectRatio: 'none' },
    s('line', { x1: 0, x2: W, y1: top, y2: top, class: 'db-spark-full', 'vector-effect': 'non-scaling-stroke' }),
    s('line', { x1: 0, x2: W, y1: bottom, y2: bottom, class: 'db-spark-base', 'vector-effect': 'non-scaling-stroke' }),
    s('path', { d: area, class: 'mc-area fuel' }),
    s('path', { d: line, class: 'mc-line fuel', 'vector-effect': 'non-scaling-stroke' }),
  );
  const title = document.createElementNS(SVG_NS, 'title');
  title.textContent = label;
  svg.prepend(title);
  return svg;
}

export function fuelSection(players: PlayerView[], st: ViewState): HTMLElement | null {
  const withFuel = sortPlayers(
    players.filter((p) => p.fuel && p.fuel.length >= 2),
    'name',
    1,
    st.hideNames,
  );
  if (!withFuel.length) return null;
  return h(
    'section',
    { class: 'db-card mchart-crews', 'aria-labelledby': 'db-fuel' },
    h('h2', { id: 'db-fuel' }, 'Fuel tank: each student’s last crew'),
    h('p', { class: 'db-note' }, 'Each line is the rocket tank, from landing to the last sol. The top line is full: time to launch.'),
    h(
      'div',
      { class: 'db-sparks' },
      withFuel.map((p) => {
        const fuel = p.fuel!;
        const c = p.last;
        const name = displayName(p, st.hideNames);
        const sols = fuel.length - 1;
        const end = c.status === 'won' ? `Launched after ${sols} ${turn(c.site, sols)}` : `${TROUBLE[c.loseReason ?? 'window'].label} on ${turn(c.site, 1)} ${sols}`;
        const label = `${name}, ${crewName(c).toLowerCase()}: the fuel tank went from ${fuel[0]}% to ${fuel[fuel.length - 1]}% in ${sols} ${turn(c.site, sols)}. ${outcome(c)}.`;
        return h(
          'figure',
          { class: 'db-spark' },
          h('figcaption', null, h('b', null, name), h('span', null, `${crewName(c)} · ${end}`)),
          fuelSpark(fuel, label),
        );
      }),
    ),
  );
}

// ------------------------------------------------------------------ everything

export function dashboardBody(view: DashboardView, st: ViewState, on: TableHandlers): HTMLElement[] {
  const sum = summarize(view.players);
  const joined = view.joined ?? [];
  return [
    summaryTiles(sum, joined.length),
    h('div', { class: 'db-grid' }, troubleSection(sum), upgradeSection(sum)),
    studentTable(view.players, st, on, joined),
    fuelSection(view.players, st),
  ].filter((x): x is HTMLElement => !!x);
}
