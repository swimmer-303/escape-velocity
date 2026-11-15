// Written with AI assistance (Claude Code). See README "Use of AI tools".
// @vitest-environment happy-dom
// Headless test of the daily challenge screens. The real daily store (in a temp folder) sits behind a
// fake fetch, like deploy/server.ts would serve it, and the test plays today's mission like a kid would:
// title -> Daily challenge -> crew intro -> every sol with "Suggest a plan" -> end screen -> nickname -> board.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { App } from '../app';
import { CssStage } from '../../render/stage';
import { DailyStore } from '../../daily/store';
import { archiveEvents } from '../../daily/pool';
import { createMission } from '../../sim/sim';
import { builder, playOut } from '../../sim/strategies';
import { dailyMissionConfig, scoreOf } from '../../daily/replay';
import { offlineDailyConfig } from '../../daily/pool';
import { dailyEndPanel, todaysBest } from './screens';
import type { MissionState } from '../../sim/types';

// Each test replays whole missions (hundreds, for the limits): allow for a busy CI machine.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitFor<T>(fn: () => T | null | undefined | false, ms = 4000): Promise<T> {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const v = fn();
    if (v) return v;
    await sleep(10);
  }
  throw new Error('timed out waiting');
}
const button = (text: RegExp) => ([...document.querySelectorAll('button')] as HTMLButtonElement[]).find((b) => text.test(b.textContent ?? '') && !b.disabled) ?? null;
const text = () => document.body.textContent ?? '';

const NOW = Date.parse('2026-11-14T17:00:00Z'); // Saturday Nov 14, noon in Charlotte: a Mars day
let dir: string;
let store: DailyStore;
let calls: string[];

/** Routes the game's /api/daily calls to the real store; everything else is offline. */
async function fakeFetch(input: string, init?: { method?: string; body?: string }) {
  const url = new URL(input, 'http://test');
  const reply = (status: number, json: unknown) => new Response(JSON.stringify(json), { status, headers: { 'content-type': 'application/json' } });
  const m = /^\/api\/daily(?:\/([^/]+)\/(top|submit))?$/.exec(url.pathname);
  if (!m) throw new Error('offline in tests');
  calls.push(`${init?.method ?? 'GET'} ${url.pathname}`);
  const [, date, sub] = m;
  if (!sub) return reply(200, await store.config());
  const r = sub === 'top' ? store.top(date, Number(url.searchParams.get('limit')), url.searchParams.get('player')) : store.submit(date, '10.1.2.3', JSON.parse(init?.body ?? '{}'));
  return r.ok ? reply(200, r.value) : reply(r.status, { error: r.error, message: r.message });
}

function freshPage() {
  document.body.innerHTML = `<div id="app"><div id="stage"></div><header id="hud"></header><main id="dock"></main></div><div id="modal-root"></div>`;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ev-daily-ui-'));
  store = new DailyStore({ dir, now: () => NOW, events: async () => archiveEvents(), saveDelayMs: 5 });
  calls = [];
  freshPage();
  vi.stubGlobal('fetch', fakeFetch);
  localStorage.clear();
  localStorage.setItem('ev-tutorial-done', '1');
});
afterEach(async () => {
  await store.flush();
  store.close();
  vi.unstubAllGlobals();
  rmSync(dir, { recursive: true, force: true });
});

/** Plays the current mission through the UI with "Suggest a plan" until the end screen shows. */
async function playToEnd() {
  for (let guard = 0; guard < 400; guard++) {
    if (document.querySelector('[aria-label="Mission complete"], [aria-label="Mission over"]')) return;
    if (document.querySelector('.crates .crate') && !button(/Plan the day/)) {
      document.querySelector<HTMLButtonElement>('.crates .crate')!.click();
      continue;
    }
    const plan = button(/Plan the day/);
    if (plan) {
      plan.click();
      button(/Suggest a plan/)!.click();
      (await waitFor(() => button(/^Run (sol|day)/))).click();
      (await waitFor(() => button(/^Skip$/))).click();
      continue;
    }
    const next = button(/Start (sol|day)|Launch!|See what happened|Land the crew/);
    if (next) {
      next.click();
      await sleep(0);
      continue;
    }
    await sleep(20);
  }
  throw new Error('the mission never ended');
}

describe('daily challenge screens', () => {
  it('plays today\'s challenge from the title, sends the score with a nickname and shows the board', async () => {
    const app = new App(new CssStage());
    (await waitFor(() => button(/^Daily challenge/))).click();
    await waitFor(() => button(/Land the crew/));
    const intro = document.querySelector('[role="dialog"]')!.textContent ?? '';
    expect(intro).toMatch(/Daily challenge · Nov 14/);
    expect(intro).toMatch(/Mars on most days, the Moon on Sundays/);
    expect(intro).toMatch(/ARCHIVE/);
    expect(intro).not.toMatch(/can't reach the scoreboard/);
    button(/Land the crew/)!.click();
    await waitFor(() => button(/Plan the day/));
    expect(document.querySelector('.sol-chip, #hud')!.textContent).toMatch(/DAILY · NOV 14/);
    expect(document.querySelector('.data-badge')!.textContent).toMatch(/ARCHIVE · real DONKI data/);
    const m = (app as unknown as { mission: MissionState }).mission;
    expect(m.config.seed).toBe('2026-11-14');
    expect(m.config.eventPool).toEqual((await store.config()).eventPool);

    await playToEnd();
    const panel = await waitFor(() => document.querySelector<HTMLElement>('.daily-board'));
    expect(panel.textContent).toMatch(/Today's board/);
    expect(panel.textContent).toMatch(/Your crew (launched|came home early)/);

    // A blocked nickname is turned away by the server, in plain words.
    const name = panel.querySelector<HTMLInputElement>('#daily-name')!;
    name.value = 'poop';
    panel.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    await waitFor(() => /choose a different name/.test(panel.textContent ?? ''));
    // Symbols are caught before anything is sent.
    const sent = calls.filter((c) => c.startsWith('POST')).length;
    panel.querySelector<HTMLInputElement>('#daily-name')!.value = 'Kid!';
    panel.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    await waitFor(() => /only letters, numbers and spaces/.test(panel.textContent ?? ''));
    expect(calls.filter((c) => c.startsWith('POST')).length).toBe(sent);

    panel.querySelector<HTMLInputElement>('#daily-name')!.value = 'Rocket Kid';
    panel.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    const rank = await waitFor(() => panel.querySelector('.daily-rank'));
    expect(rank.textContent).toMatch(/You are number 1 of 1 today, as Rocket Kid\./);
    const row = panel.querySelector('table.daily-table tr.you')!;
    expect(row.textContent).toMatch(/Rocket Kid \(you\)/);
    // The server replayed the moves itself and agrees with the game.
    const top = store.top('2026-11-14');
    const finished = (app as unknown as { mission: MissionState }).mission;
    expect(finished.status).not.toBe('playing');
    expect(top.ok && top.value.top[0]).toEqual({ rank: 1, nickname: 'Rocket Kid', ...scoreOf(finished) });
    expect(localStorage.getItem('ev-daily-nickname')).toBe('Rocket Kid');

    // Opening the menu and coming back redraws the end screen without sending the score again.
    const posts = calls.filter((c) => c.startsWith('POST')).length;
    button(/^Menu$/)!.click();
    button(/^Resume$/)!.click();
    await waitFor(() => document.querySelector('.daily-board .daily-rank'));
    expect(calls.filter((c) => c.startsWith('POST')).length).toBe(posts);

    // "Today's best" from the title shows the board and this browser's rank.
    button(/Title screen/)!.click();
    (await waitFor(() => button(/^Today's best/))).click();
    await waitFor(() => /Your best game today is number 1 of 1/.test(text()));
    expect(document.querySelector('[aria-label="Today\'s best"]')!.textContent).toMatch(/Daily challenge · Nov 14/);
  }, 60000);

  it('still plays without our server, labeled ARCHIVE, and says scores cannot be sent', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')));
    const app = new App(new CssStage());
    (await waitFor(() => button(/^Daily challenge/))).click();
    await waitFor(() => button(/Land the crew/));
    expect(text()).toMatch(/can't reach the scoreboard/);
    // The pool also holds the real May 2024 storms (their cards show 2024 dates): the intro says so.
    expect(document.querySelector('.daily-pool')!.textContent).toMatch(/plus the real storms of May 2024/);
    button(/Land the crew/)!.click();
    await waitFor(() => button(/Plan the day/));
    expect(document.querySelector('.data-badge')!.textContent).toMatch(/^ARCHIVE/);
    const m = (app as unknown as { mission: MissionState }).mission;
    expect(m.config.eventPool.every((e) => e.origin === 'archive')).toBe(true);

    // The end screen of an offline game: no form, just the plain note.
    const cfg = offlineDailyConfig(m.config.seed);
    const end = playOut(createMission(dailyMissionConfig(cfg)), builder);
    freshPage();
    const panel = dailyEndPanel({ config: cfg, online: false }, end);
    document.body.append(panel);
    expect(panel.textContent).toMatch(/scores can't be sent right now/);
    expect(panel.querySelector('form')).toBeNull();
  }, 30000);

  it('says so plainly when the score cannot be sent, and lets the player try again', async () => {
    const cfg = await store.config();
    const end = playOut(createMission(dailyMissionConfig(cfg)), builder);
    let fail = true;
    const api = {
      config: () => store.config(),
      top: async (date: string, limit: number, player?: string | null) => {
        const r = store.top(date, limit, player);
        if (!r.ok) throw new Error(r.message);
        return r.value;
      },
      submit: async (date: string, body: Parameters<DailyStore['submit']>[2]) => {
        if (fail) throw new Error("Scores can't be sent right now. You can still play, and try again later.");
        const r = store.submit(date, 'ip', body);
        if (!r.ok) throw new Error(r.message);
        return r.value;
      },
    };
    const panel = dailyEndPanel({ config: cfg, online: true }, end, api as never);
    document.body.append(panel);
    panel.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    await waitFor(() => /can't be sent right now/.test(panel.textContent ?? ''));
    expect(panel.querySelector('form')).not.toBeNull();
    fail = false;
    panel.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    await waitFor(() => panel.querySelector('.daily-rank'));
    expect(panel.textContent).toMatch(/as Anonymous astronaut\./);
  });

  it("\"Today's best\" says so when the scoreboard can't be reached", async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')));
    const root = document.getElementById('modal-root')!;
    for (const el of todaysBest({ back: () => undefined, play: () => undefined }).flat()) if (el instanceof Node) root.append(el);
    await waitFor(() => /can't reach the scoreboard right now/.test(root.textContent ?? ''));
    expect(root.textContent).toMatch(/Play today's challenge/);
  });
});
