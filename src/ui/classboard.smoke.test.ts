// @vitest-environment happy-dom
// Written with AI assistance (Claude Code). See README "Use of AI tools".
// Headless test of the game's side of the class board, with the real class store behind a fake
// fetch: a teacher's new code is registered and comes with a private dashboard link; a student's
// quick mission with that code sends its result, and the end screen asks once for a nickname.
// A code that was never registered sends nothing more and asks nothing.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { App } from './app';
import { CssStage } from '../render/stage';
import { balanced, builder, playOut } from '../sim/strategies';
import { createMission } from '../sim/sim';
import { testConfig } from '../sim/fixtures.test-util';
import { MODULE_LABEL } from './budget';
import { MODULE_IDS, type MissionState } from '../sim/types';
import { ClassStore } from '../class/store';
import type { DashboardView } from '../class/protocol';
import { classBoard } from './classboard';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitFor<T>(fn: () => T | null | undefined | false, ms = 3000): Promise<T> {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const v = fn();
    if (v) return v;
    await sleep(10);
  }
  throw new Error('timed out waiting');
}
const button = (text: RegExp) => ([...document.querySelectorAll('button')] as HTMLButtonElement[]).find((b) => text.test(b.textContent ?? '') && !b.disabled) ?? null;
const modalText = () => document.querySelector('#modal-root')?.textContent ?? '';
/** The title screen redraws once the space-weather data has loaded: wait for that first. */
const titleReady = () => waitFor(() => !/Checking NASA/.test(document.querySelector('#hud')?.textContent ?? 'Checking NASA') && button(/Quick mission/));

let store: ClassStore;
let posts: Array<{ path: string; body: Record<string, unknown> }> = [];

/** Routes /api/class calls to the in-memory store, like deploy/server.ts does over HTTP. Everything else is offline. */
async function fakeFetch(input: string, init?: { method?: string; body?: string }) {
  const url = new URL(input, 'http://test');
  const m = /^\/api\/class(?:\/([^/]+)(?:\/(report|teacher))?)?$/.exec(url.pathname);
  if (!m) throw new Error('offline in tests');
  const body = init?.body ? JSON.parse(init.body) : {};
  if (init?.method === 'POST') posts.push({ path: url.pathname, body });
  const reply = (status: number, json: unknown) => new Response(JSON.stringify(json), { status, headers: { 'content-type': 'application/json' } });
  const [, code, sub] = m;
  const r = !code ? store.register('1.1.1.1', body) : !sub ? store.view(code, '1.1.1.1', url.searchParams.get('key')) : store.report(code, '1.1.1.1', body);
  return r.ok ? reply(code ? 200 : 201, r.value) : reply(r.status, { error: r.error, message: r.message });
}

function freshPage() {
  document.body.innerHTML = `<div id="app"><div id="stage"></div><header id="hud"></header><main id="dock"></main></div><div id="modal-root"></div>`;
}

beforeEach(() => {
  freshPage();
  store = new ClassStore({ dir: null });
  posts = [];
  vi.stubGlobal('fetch', fakeFetch);
  try {
    localStorage.clear();
    localStorage.setItem('ev-tutorial-done', '1');
  } catch {
    /* ignore */
  }
});
afterEach(() => {
  history.replaceState(null, '', '/');
});

async function playQuickMission(app: App) {
  const mission = () => (app as unknown as { mission: MissionState }).mission;
  for (let guard = 0; guard < 300 && !button(/Play again/); guard++) {
    if (document.querySelector('.crates .crate') && !button(/Plan the day/)) {
      document.querySelector<HTMLButtonElement>('.crates .crate')!.click();
      continue;
    }
    const plan = button(/Plan the day/);
    if (plan) {
      plan.click();
      const { alloc } = balanced(mission());
      for (const id of MODULE_IDS) for (let k = 0; k < alloc[id]; k++) document.querySelector<HTMLButtonElement>(`button[aria-label="Add a cell to ${MODULE_LABEL[id]}"]`)?.click();
      (await waitFor(() => button(/^Run sol/))).click();
      (await waitFor(() => button(/^Skip$/))).click();
      continue;
    }
    const next = button(/Start sol|Launch!|See what happened|Land the crew/);
    if (next) {
      next.click();
      await sleep(0);
      continue;
    }
    await sleep(20);
  }
  expect(mission().status).not.toBe('playing');
  return mission();
}

describe('class board in the game', () => {
  it("a teacher's new code is registered and comes with a private dashboard link", async () => {
    new App(new CssStage());
    await titleReady();
    button(/New campaign/)!.click();
    button(/Make a code for my class/)!.click();
    const code = document.querySelector('.cc-big')!.textContent!;
    const link = await waitFor(() => document.querySelector<HTMLInputElement>('.cc-dash .cc-link-text')?.value);
    expect(link).toMatch(new RegExp(`/\\?dashboard=${code}&key=[0-9a-f]{32}$`));
    expect(modalText()).toMatch(/Keep this link private/);
    expect(store.classes.has(code)).toBe(true);
    // The student link never carries the key.
    expect(document.querySelector<HTMLInputElement>('.cc-link-text')!.value).toBe(`${location.origin}/?code=${code}`);

    // After "Play with this code", this device still shows the dashboard link for it.
    button(/Play with this code/)!.click();
    const again = document.querySelector<HTMLAnchorElement>('.cc-dash-note a')!;
    expect(again.href).toBe(link);
  }, 20000);

  it("a student's quick mission sends its result, and the end screen asks once for a nickname", async () => {
    const reg = store.register('9.9.9.9', { code: 'B4XN9' });
    if (!reg.ok) throw new Error('register failed');
    history.replaceState(null, '', '/?code=B4XN9');
    const app = new App(new CssStage());
    (await titleReady()).click();
    (await waitFor(() => button(/Start quick mission/))).click();
    const m = await playQuickMission(app);

    const sent = await waitFor(() => posts.find((p) => p.path === '/api/class/B4XN9/report'));
    expect(sent.body).toMatchObject({ mode: 'quick', n: 1, site: 'mars', difficulty: 'cadet', status: m.status, sols: m.log.length, nickname: null });
    expect(Object.keys(sent.body).sort()).toEqual(
      ['playerId', 'rid', 'nickname', 'mode', 'site', 'difficulty', 'n', 'status', 'loseReason', 'sols', 'dose', 'doseBudget', 'stars', 'built', 'series'].sort(),
    );
    expect((sent.body.series as { fuel: number[] }).fuel).toHaveLength(m.log.length + 1);

    // The nickname card shows up once the server confirms the class board.
    const input = await waitFor(() => document.querySelector<HTMLInputElement>('#cb-name-input'));
    expect(modalText()).toMatch(/Skip, and you show up as Player 1/);
    input.value = 'Fuuck';
    button(/^Save name$/)!.click();
    expect(document.querySelector('#cb-msg')!.textContent).toMatch(/different name/);
    document.querySelector<HTMLInputElement>('#cb-name-input')!.value = 'Ava';
    button(/^Save name$/)!.click();
    await waitFor(() => modalText().includes("Thanks! Your results show on your teacher's class board as Ava."));

    const view = store.view('B4XN9', 'x', reg.value.key);
    const players = view.ok ? (view.value as DashboardView).players : [];
    expect(players.map((p) => [p.name, p.tally.crews])).toEqual([['Ava', 1]]);

    // The next result goes out with the name, and nobody asks again.
    classBoard.report('B4XN9', m, 'quick');
    await waitFor(() => posts.filter((p) => p.path.endsWith('/report')).length === 3);
    expect(posts.at(-1)!.body).toMatchObject({ nickname: 'Ava', playerId: sent.body.playerId });
    expect(posts.at(-1)!.body.rid).not.toBe(sent.body.rid);
    const card = classBoard.card('B4XN9')!;
    document.body.append(card);
    expect(card.querySelector('input')).toBeNull();
    expect(card.textContent).toMatch(/class board as Ava/);
    const after = store.view('B4XN9', 'x', reg.value.key);
    expect(after.ok && (after.value as DashboardView).players[0].tally.crews).toBe(2);
  }, 60000);

  it('a code that was never registered: no nickname question, and nothing more is sent', async () => {
    const m = playOut(createMission(testConfig('Q9MTK')), builder);
    classBoard.report('Q9MTK', m, 'quick');
    await waitFor(() => posts.length === 1);
    expect(posts[0].path).toBe('/api/class/Q9MTK/report');
    await sleep(20);
    const card = classBoard.card('Q9MTK')!;
    document.body.append(card);
    expect(card.textContent).toBe('');
    classBoard.report('Q9MTK', m, 'quick');
    await sleep(50);
    expect(posts).toHaveLength(1);
  }, 10000);
});
