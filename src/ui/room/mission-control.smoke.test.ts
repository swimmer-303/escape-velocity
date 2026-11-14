// Written with AI assistance (Claude Code). See README "Use of AI tools".
// @vitest-environment happy-dom
// Headless smoke test of the Mission Control screens: the real room store sits behind a fake
// fetch and a fake EventSource, and the test clicks through like a teacher and a student would.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { openMissionControl, type MissionControl } from './mission-control';
import { RoomStore, type Sink } from '../../room/store';
import { CssStage } from '../../render/stage';
import { GameAudio } from '../audio';
import { TEST_POOL } from '../../sim/fixtures.test-util';
import { getBriefing } from '../../sim/sim';
import { MODULE_IDS } from '../../sim/types';
import { MODULE_LABEL } from '../budget';
import { STATION_OF } from '../../room/protocol';

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
const button = (text: RegExp) => ([...document.querySelectorAll('button')] as HTMLButtonElement[]).find((b) => text.test(b.textContent ?? '') && !b.disabled) ?? null;
const text = () => document.body.textContent ?? '';

let store: RoomStore;

/** Routes the game's fetch calls to the in-memory store, like deploy/server.ts does over HTTP. */
async function fakeFetch(input: string, init?: { method?: string; body?: string }) {
  const url = new URL(input, 'http://test');
  const body = init?.body ? JSON.parse(init.body) : {};
  const m = /^\/api\/rooms(?:\/([^/]+)(?:\/(join|action|teacher))?)?$/.exec(url.pathname);
  const reply = (status: number, json: unknown) => new Response(JSON.stringify(json), { status, headers: { 'content-type': 'application/json' } });
  if (!m) return reply(404, { error: 'not found' });
  const [, code, sub] = m;
  const r = !code ? await store.create('1.1.1.1', body) : !sub ? store.info(code) : sub === 'join' ? store.join(code, '1.1.1.1', body) : sub === 'action' ? store.action(code, body) : store.teacher(code, body);
  return r.ok ? reply(200, { ok: true, ...r.value }) : reply(r.status, { error: r.error, message: r.message });
}

/** A stand-in EventSource that subscribes straight to the store and parses its SSE text. */
class FakeEventSource {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 2;
  readyState = 0;
  private listeners = new Map<string, Array<(e: { data: string }) => void>>();
  private unsubscribe?: () => void;
  constructor(url: string) {
    const u = new URL(url, 'http://test');
    const code = u.pathname.split('/')[3];
    const sink: Sink = {
      write: (chunk: string) => {
        for (const frame of chunk.split('\n\n')) {
          const ev = /^event: (.+)$/m.exec(frame)?.[1];
          const data = /^data: (.+)$/m.exec(frame)?.[1];
          if (ev && data) setTimeout(() => this.emit(ev, data), 0);
        }
      },
      end: () => (this.readyState = 2),
    };
    setTimeout(() => {
      const r = store.subscribe(code, { token: u.searchParams.get('token'), teacher: u.searchParams.get('teacher') }, sink);
      if (r.ok) {
        this.readyState = 1;
        this.unsubscribe = r.value;
        this.emit('open', '');
      } else {
        this.readyState = 2;
        this.emit('error', '');
      }
    }, 0);
  }
  addEventListener(name: string, fn: (e: { data: string }) => void) {
    this.listeners.set(name, [...(this.listeners.get(name) ?? []), fn]);
  }
  private emit(name: string, data: string) {
    for (const fn of this.listeners.get(name) ?? []) fn({ data });
  }
  close() {
    this.readyState = 2;
    this.unsubscribe?.();
  }
}

let open: MissionControl | null = null;
let exited = false;

function mount(code: string | null = null) {
  document.body.innerHTML = `<div id="app"><div id="stage"></div><header id="hud"></header><main id="dock"></main></div><div id="modal-root"></div>`;
  const stage = new CssStage();
  stage.mount(document.getElementById('stage')!);
  exited = false;
  open = openMissionControl(
    {
      stage,
      hud: document.getElementById('hud')!,
      dock: document.getElementById('dock')!,
      modalRoot: document.getElementById('modal-root')!,
      audio: new GameAudio(true),
      reducedMotion: true,
      exit: () => (exited = true),
    },
    code,
  );
  return open;
}

beforeEach(() => {
  store = new RoomStore({ events: async () => ({ pool: TEST_POOL, data: { status: 'archive', fetchedAt: null, startDate: null, endDate: null } }), lightTimeMin: () => 12, coalesceMs: 0 });
  vi.stubGlobal('fetch', fakeFetch);
  vi.stubGlobal('EventSource', FakeEventSource);
  sessionStorage.clear();
});
afterEach(() => {
  open?.exit();
  store.stop();
  vi.unstubAllGlobals();
});

describe('Mission Control screens', () => {
  it('a student joins with a code and a name, plans only their station, pings, and sees the sol', async () => {
    const made = await store.create('1.1.1.1', {});
    if (!made.ok) throw new Error('no room');
    const { code, teacherToken } = made.value;
    // Three classmates are already in, so the new student gets one station.
    for (const n of ['Ben', 'Cy', 'Dee']) store.join(code, '1.1.1.1', { name: n });

    mount(code.toLowerCase());
    const name = await waitFor(() => document.querySelector<HTMLInputElement>('#mc-name'));
    expect(document.querySelector<HTMLInputElement>('#mc-code')!.value).toBe(code);
    name.value = 'Ava!';
    button(/Join the mission/)!.click();
    expect(document.querySelector('#mc-join-msg')!.textContent).toMatch(/letters, numbers and spaces/);
    name.value = 'Ava';
    button(/Join the mission/)!.click();
    await waitFor(() => text().includes("You're in, Ava!"));
    expect(location.search).toContain(`room=${code}`);
    const ava = store.get(code)!.players.find((p) => p.name === 'Ava')!;
    expect(ava.stations.length).toBe(1);
    expect(ava.conns).toBe(1);

    expect(store.teacher(code, { teacherToken, type: 'start' }).ok).toBe(true);
    await waitFor(() => document.querySelector('[aria-label="Sol 1 morning briefing"]'));
    // Pings from the briefing screen.
    button(/Storm warning: shelter!/)!.click();
    await waitFor(() => document.querySelector('.mc-ping')?.textContent?.includes('Storm warning'));

    store.teacher(code, { teacherToken, type: 'plan' });
    await waitFor(() => document.querySelector('.dock'));
    const mine = MODULE_IDS.filter((id) => ava.stations.includes(STATION_OF[id]) && getBriefing(store.get(code)!.mission!).cells > 0);
    const others = MODULE_IDS.filter((id) => !ava.stations.includes(STATION_OF[id]));
    // Other stations' modules are shown, but locked.
    const lockedBox = document.querySelector<HTMLButtonElement>(`button[aria-label^="${MODULE_LABEL[others[0]]}: "]`);
    expect(lockedBox?.disabled).toBe(true);
    expect(document.querySelectorAll('.module.locked').length).toBeGreaterThan(0);
    // Place a cell in our own station, through the server.
    const target = mine.find((id) => document.querySelector(`button[aria-label="Add a cell to ${MODULE_LABEL[id]}"]`))!;
    document.querySelector<HTMLButtonElement>(`button[aria-label="Add a cell to ${MODULE_LABEL[target]}"]`)!.click();
    await waitFor(() => store.get(code)!.alloc[target] === 1);
    await waitFor(() => document.querySelector(`button[aria-label="Remove a cell from ${MODULE_LABEL[target]}"]`));

    button(/I'm ready/)!.click();
    await waitFor(() => store.get(code)!.players.find((p) => p.name === 'Ava')!.ready);
    await waitFor(() => button(/^Ready!$/));

    // The class fills the rest of the pool (any station will do here), and the teacher runs the sol.
    const room = store.get(code)!;
    const cells = getBriefing(room.mission!).cells;
    for (const p of room.players) {
      for (const id of MODULE_IDS.filter((x) => p.stations.includes(STATION_OF[x]))) {
        while (Object.values(room.alloc).reduce((a, b) => a + b, 0) < cells && store.action(code, { token: p.token, type: 'place', module: id }).ok) {
          /* keep placing */
        }
      }
    }
    expect(store.teacher(code, { teacherToken, type: 'run' }).ok).toBe(true);
    await waitFor(() => button(/^Skip/) || document.querySelector('[aria-label="Sol 1 debrief"]'));
    button(/^Skip/)?.click();
    await waitFor(() => document.querySelector('[aria-label="Sol 1 debrief"]'));
    expect(text()).toMatch(/where the class put its/);

    // The teacher closes the room.
    store.teacher(code, { teacherToken, type: 'end' });
    await waitFor(() => text().includes('Your teacher closed the room'));
    button(/Back to the title screen/)!.click();
    expect(exited).toBe(true);
  }, 20000);

  it('the teacher opens a room, sees students join, starts, and runs a sol', async () => {
    mount();
    (await waitFor(() => button(/Start a room for my class/))).click();
    (await waitFor(() => button(/Three crews/))).click();
    (await waitFor(() => button(/Open the room/))).click();
    const codeEl = await waitFor(() => document.querySelector('.mc-code'));
    const code = codeEl.textContent!;
    expect(store.get(code)!.mode).toBe('campaign');
    expect(button(/Start the mission/)).toBeNull();

    const kids = ['Ava', 'Ben'].map((n) => store.join(code, '1.1.1.1', { name: n }));
    await waitFor(() => text().includes('Ben'));
    (await waitFor(() => button(/Start the mission/))).click();
    await waitFor(() => document.querySelector('[aria-label="Sol 1 morning briefing"]'));
    expect(text()).toMatch(/Crew 1 of 3/);
    button(/Start planning/)!.click();
    const run = await waitFor(() => document.querySelector<HTMLButtonElement>('button.mc-run'));
    expect(run.disabled).toBe(true);
    expect(text()).toMatch(/Place every power cell/);

    // Teacher's plan board: read-only.
    expect(document.querySelector('button[aria-label^="Add a cell"]')).toBeNull();

    const room = store.get(code)!;
    const cells = getBriefing(room.mission!).cells;
    for (const k of kids) {
      if (!k.ok) throw new Error('join');
      const p = room.players.find((x) => x.id === k.value.playerId)!;
      for (const id of MODULE_IDS.filter((x) => p.stations.includes(STATION_OF[x]))) {
        while (Object.values(room.alloc).reduce((a, b) => a + b, 0) < cells && store.action(code, { token: p.token, type: 'place', module: id }).ok) {
          /* keep placing */
        }
      }
    }
    (await waitFor(() => button(/^Run sol 1/))).click();
    await waitFor(() => room.phase === 'debrief');
    await waitFor(() => button(/^Skip/) || document.querySelector('[aria-label="Sol 1 debrief"]'));
    button(/^Skip/)?.click();
    (await waitFor(() => button(/Start sol 2/))).click();
    await waitFor(() => document.querySelector('[aria-label="Sol 2 morning briefing"]'));

    // Manage players: move Ava, then remove Ben (two taps).
    button(/^Players$/)!.click();
    await waitFor(() => document.querySelector('[aria-label="Players"]'));
    document.querySelector<HTMLButtonElement>('button[aria-label="Remove Ben"]')!.click();
    document.querySelector<HTMLButtonElement>('button[aria-label="Tap again to remove Ben"]')!.click();
    await waitFor(() => room.players.length === 1);
    expect(room.players[0].stations.length).toBe(4);
  }, 20000);
});
