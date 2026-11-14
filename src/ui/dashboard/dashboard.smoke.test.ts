// @vitest-environment happy-dom
// Written with AI assistance (Claude Code). See README "Use of AI tools".
// Headless test of the teacher dashboard page: it renders the class summary, the most common
// trouble with a question for the class, upgrade popularity, a sortable table and the fuel lines
// from a fixture response; hides names; keeps the key out of the address bar; and explains errors.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { openDashboard, type DashboardPage } from './page';
import { App } from '../app';
import { CssStage } from '../../render/stage';
import type { CrewView, DashboardView, PlayerView } from '../../class/protocol';

const KEY = 'c0ffee'.padEnd(32, '0');
const T0 = Date.UTC(2026, 10, 14, 15, 0);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitFor<T>(fn: () => T | null | undefined | false, ms = 3000): Promise<T> {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const v = fn();
    if (v) return v;
    await sleep(5);
  }
  throw new Error('timed out waiting');
}
const button = (text: RegExp) => ([...document.querySelectorAll('button')] as HTMLButtonElement[]).find((b) => text.test(b.textContent ?? '')) ?? null;

function crew(over: Partial<CrewView>): CrewView {
  return { n: 1, mode: 'campaign', site: 'mars', status: 'won', sols: 10, dose: 9, doseBudget: 27, stars: ['launch', 'safe'], built: [], at: T0, ...over };
}
function player(num: number, name: string | null, crews: CrewView[], over: Partial<PlayerView['tally']> = {}, fuel: number[] | null = null): PlayerView {
  const last = crews[crews.length - 1];
  const won = crews.filter((c) => c.status === 'won');
  const reasons = { air: 0, food: 0, dose: 0, window: 0 };
  for (const c of crews) if (c.loseReason) reasons[c.loseReason]++;
  return {
    num,
    name,
    difficulty: 'cadet',
    crews,
    last,
    tally: {
      crews: crews.length,
      launched: won.length,
      early: crews.length - won.length,
      reasons,
      stars: crews.reduce((s, c) => s + c.stars.length, 0),
      best: won.length ? { sols: Math.min(...won.map((c) => c.sols)), site: won[0].site } : null,
      built: [...new Set(crews.flatMap((c) => c.built))],
      sites: [...new Set(crews.map((c) => c.site))].sort(),
      ...over,
    },
    fuel,
    seen: T0,
  };
}

const FIXTURE: DashboardView = {
  code: 'K7RZQ',
  v: 7,
  createdAt: T0 - 3600_000,
  lastReportAt: T0,
  expiresAt: T0 + 7 * 86_400_000,
  players: [
    player(1, 'Ava', [crew({ n: 1, sols: 12, built: ['panel'], stars: ['launch', 'safe', 'builder'] }), crew({ n: 2, status: 'lost', loseReason: 'air', stars: [], sols: 6 })], {}, [30, 40, 35, 30, 25, 20, 15]),
    player(2, 'Ben', [crew({ n: 1, status: 'lost', loseReason: 'air', stars: ['builder'], built: ['panel', 'battery'], sols: 8 })], {}, [10, 20, 30, 35, 40, 45, 50, 55, 60]),
    player(3, null, [crew({ n: 1, mode: 'quick', site: 'moon', status: 'lost', loseReason: 'air', stars: [], sols: 5 })]),
    player(4, 'Cy', [crew({ n: 1, sols: 9, stars: ['launch'] }), crew({ n: 2, sols: 11 }), crew({ n: 3, status: 'lost', loseReason: 'dose', stars: ['builder'], built: ['reactor'] })], {}, [20, 50, 100]),
  ],
};

let calls: string[] = [];
let respond: (url: string) => { status: number; json: unknown } = () => ({ status: 200, json: FIXTURE });
let page: DashboardPage | null = null;

beforeEach(() => {
  document.body.innerHTML = `<div id="app"><div id="stage"></div><header id="hud"></header><main id="dock"></main></div><div id="modal-root"></div><main id="db-root"></main>`;
  calls = [];
  respond = (url) => (url.includes('since=7') ? { status: 200, json: { unchanged: true, v: 7 } } : { status: 200, json: FIXTURE });
  vi.stubGlobal('fetch', async (input: string) => {
    if (!String(input).startsWith('/api/class')) return new Response('{}', { status: 404 });
    calls.push(input);
    const r = respond(input);
    return new Response(JSON.stringify(r.json), { status: r.status, headers: { 'content-type': 'application/json' } });
  });
  try {
    sessionStorage.clear();
    localStorage.clear();
    localStorage.setItem('ev-tutorial-done', '1');
  } catch {
    /* ignore */
  }
});
afterEach(() => {
  page?.stop();
  page = null;
  history.replaceState(null, '', '/');
  document.documentElement.classList.remove('dash-mode');
});

const root = () => document.querySelector<HTMLElement>('#db-root')!;
const rowNames = () => [...root().querySelectorAll('.db-table tbody th')].map((th) => th.textContent);

describe('teacher dashboard page', () => {
  it('renders the class summary, trouble, upgrades, a sortable table and fuel lines', async () => {
    history.replaceState(null, '', `/?dashboard=K7RZQ&key=${KEY}`);
    page = openDashboard({ code: 'K7RZQ', key: KEY }, { root: root(), refreshMs: 30 });
    await waitFor(() => root().querySelector('.db-table'));
    expect(calls[0]).toBe(`/api/class/K7RZQ?key=${KEY}`);
    // The key leaves the address bar (it would be on the projector) but stays for this tab.
    expect(location.search).toBe('?dashboard=K7RZQ');
    expect(sessionStorage.getItem('ev-dash-key-K7RZQ')).toBe(KEY);
    expect(document.title).toMatch(/Class board K7RZQ/);

    const tiles = [...root().querySelectorAll('.db-tile')].map((t) => t.textContent);
    expect(tiles).toEqual(['4Students', '3Crews launchedof 7 crews', '4Sent home earlyof 7 crews', `${(8 / 7).toFixed(1)}Average starsper crew, out of 3`]);
    const text = root().textContent ?? '';
    expect(text).toContain('Most common trouble');
    expect(text).toContain('Many crews ran out of air. Why do you think that happened?');
    expect(text).toContain('One crew took too much radiation. When is the storm shelter worth its power?');
    const bars = [...root().querySelectorAll('.db-bar-row')].map((r) => r.querySelector('.db-bar-head')!.textContent);
    expect(bars).toEqual(['Ran out of air3 crews', 'Too much radiation1 crew', 'Solar panel row2 students', 'Battery bank1 student', 'Fission reactor1 student']);
    expect(text).toContain('Students: open');

    // The table: accessible headers, one row per student, sorted by name (Player 3 has no nickname).
    const table = root().querySelector('table')!;
    expect(table.querySelector('caption')).not.toBeNull();
    expect([...table.querySelectorAll('thead th')].every((th) => th.getAttribute('scope') === 'col')).toBe(true);
    expect(rowNames()).toEqual(['Ava', 'Ben', 'Cy', 'Player 3']);
    const ava = [...table.querySelectorAll('tbody tr')][0].textContent;
    expect(ava).toContain('Mars');
    expect(ava).toContain('3 of 6');
    expect(ava).toContain('12 sols');
    expect(ava).toContain('Solar panel row');
    expect(ava).toContain('Crew 2: Ran out of air');
    expect([...table.querySelectorAll('tbody tr')][3].textContent).toContain('Quick mission: Ran out of air');
    expect(table.querySelector('th[aria-sort="ascending"]')!.textContent).toContain('Student');

    // Sort by stars (most first), then flip it.
    button(/^Stars/)!.click();
    expect(rowNames()).toEqual(['Cy', 'Ava', 'Ben', 'Player 3']);
    expect(root().querySelector('th[aria-sort="descending"]')!.textContent).toContain('Stars');
    expect((document.activeElement as HTMLElement).dataset.fk).toBe('sort-stars');
    button(/^Stars/)!.click();
    expect(rowNames()).toEqual(['Player 3', 'Ben', 'Ava', 'Cy']);
    // Fastest launch: students who never launched go last.
    button(/^Fastest launch/)!.click();
    expect(rowNames()).toEqual(['Cy', 'Ava', 'Ben', 'Player 3']);

    // Fuel lines for the students whose game sent one.
    const sparks = [...root().querySelectorAll('.db-spark')];
    expect(sparks.map((s) => s.querySelector('figcaption b')!.textContent)).toEqual(['Ava', 'Ben', 'Cy']);
    expect(sparks[2].querySelector('svg')!.getAttribute('aria-label')).toMatch(/Cy, crew 3: the fuel tank went from 20% to 100% in 2 sols/);

    // Hide names for the projector.
    button(/^Hide names$/)!.click();
    expect(rowNames()).not.toContain('Ava');
    expect(root().textContent).not.toContain('Ava');

    // It keeps checking, and asks only "anything new?" once it has the board.
    await waitFor(() => calls.length >= 3);
    expect(calls[1]).toBe(`/api/class/K7RZQ?key=${KEY}&since=7`);
    expect(root().querySelector('.db-table')).not.toBeNull();
  });

  it('teacher tools: remove a student after a second press', async () => {
    const posts: Array<Record<string, unknown>> = [];
    vi.stubGlobal('fetch', async (input: string, init?: { method?: string; body?: string }) => {
      if (init?.method === 'POST') posts.push({ url: input, ...JSON.parse(init.body!) });
      return new Response(JSON.stringify(init?.method === 'POST' ? { ok: true, v: 8 } : FIXTURE), { status: 200 });
    });
    page = openDashboard({ code: 'K7RZQ', key: KEY }, { root: root(), refreshMs: 60_000 });
    await waitFor(() => root().querySelector('.db-table'));
    expect(root().querySelector('.db-remove')).toBeNull();
    button(/^Manage$/)!.click();
    const removeBen = () => root().querySelector<HTMLButtonElement>('button[aria-label*="Ben"]')!;
    removeBen().click();
    expect(posts).toEqual([]);
    expect(removeBen().textContent).toBe('Sure? Remove');
    removeBen().click();
    await waitFor(() => posts.length === 1);
    expect(posts[0]).toEqual({ url: '/api/class/K7RZQ/teacher', action: 'remove', num: 2, key: KEY });
  });

  it('explains a missing key, a wrong key, and a board that is gone', async () => {
    page = openDashboard({ code: 'K7RZQ', key: null }, { root: root() });
    await waitFor(() => root().querySelector('.db-problem'));
    expect(root().textContent).toContain('missing its key');
    expect(calls).toEqual([]);
    page.stop();

    respond = () => ({ status: 403, json: { error: 'bad-key' } });
    page = openDashboard({ code: 'K7RZQ', key: KEY }, { root: root() });
    await waitFor(() => root().textContent?.includes('not right'));
    page.stop();

    respond = () => ({ status: 404, json: { error: 'no-class' } });
    page = openDashboard({ code: 'K7RZQ', key: KEY }, { root: root() });
    await waitFor(() => root().textContent?.includes('There is no class board for K7RZQ'));
    page.stop();

    // Offline after a good load: the last results stay up, with a note.
    let up = true;
    respond = () => (up ? { status: 200, json: FIXTURE } : { status: 502, json: {} });
    page = openDashboard({ code: 'K7RZQ', key: KEY }, { root: root(), refreshMs: 20 });
    await waitFor(() => root().querySelector('.db-table'));
    up = false;
    await waitFor(() => root().querySelector('.db-status.offline'));
    expect(root().querySelector('.db-table')).not.toBeNull();
  });

  it('the game opens the dashboard for a ?dashboard= link, with the game hidden', async () => {
    history.replaceState(null, '', `/?dashboard=k7rzq&key=${KEY}`);
    new App(new CssStage());
    const main = await waitFor(() => document.querySelector<HTMLElement>('main#dashboard .db-table'));
    expect(main).not.toBeNull();
    expect(document.documentElement.classList.contains('dash-mode')).toBe(true);
    expect(document.querySelector('#modal-root')!.textContent).toBe('');
  });
});
