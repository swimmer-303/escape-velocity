// Written with AI assistance (Claude Code). See README "Use of AI tools".
// Daily challenge store: pool freezing (per date, across a reload), one best entry per player,
// the 500-entry and 14-day limits, rate limits, nicknames, and safe saving to daily.json.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMission } from '../sim/sim';
import { builder, playOut, pureGreed, type Strategy } from '../sim/strategies';
import { TEST_POOL } from '../sim/fixtures.test-util';
import type { SpaceWeatherEvent } from '../sim/types';
import { DailyStore, DAILY_RATE } from './store';
import type { DayEvents } from './pool';
import { dailyMissionConfig, movesFromLog } from './replay';
import { ANONYMOUS, DAILY_LIMITS, type DailyConfig, type DailyMove } from './protocol';

// Each test replays whole missions (hundreds, for the limits): allow for a busy CI machine.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

let dir: string;
let clock: number;
let calls: number;
const stores: DailyStore[] = [];
const SAT_NOON = Date.parse('2026-11-14T17:00:00Z'); // noon in Charlotte, Saturday Nov 14

function livePool(tag: string): SpaceWeatherEvent[] {
  return TEST_POOL.map((e) => ({ ...e, id: `${e.id}-${tag}`, origin: 'live' as const }));
}

function makeStore(events: (n: number) => DayEvents = (n) => ({ pool: livePool(`v${n}`), data: { status: 'live', fetchedAt: '2026-11-14T16:58:00.000Z', startDate: '2026-10-15', endDate: '2026-11-14' } })) {
  const store = new DailyStore({
    dir,
    now: () => clock,
    saveDelayMs: 5,
    events: async () => events(++calls),
  });
  stores.push(store);
  return store;
}

function movesFor(cfg: DailyConfig, strategy: Strategy): DailyMove[] {
  return movesFromLog(playOut(createMission(dailyMissionConfig(cfg)), strategy));
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ev-daily-'));
  clock = SAT_NOON;
  calls = 0;
});
afterEach(async () => {
  // Let every save finish before the folder goes.
  for (const s of stores.splice(0)) {
    await s.flush();
    s.close();
  }
  rmSync(dir, { recursive: true, force: true });
});

describe('freezing the pool', () => {
  it('freezes once per date: repeated and simultaneous requests get the same pool', async () => {
    const store = makeStore();
    const [a, b, c] = await Promise.all([store.config(), store.config(), store.config()]);
    expect(calls).toBe(1);
    expect(a).toBe(b);
    expect(b).toBe(c);
    expect(a.date).toBe('2026-11-14');
    expect(a.poolSource).toBe('live');
    expect(a.poolFetchedAt).toBe('2026-11-14T16:58:00.000Z');
    clock += 6 * 3600_000; // 6 PM: still the same day
    expect(await store.config()).toBe(a);
    expect(calls).toBe(1);
  });

  it('keeps the frozen pool across a restart, even if NASA has new storms by then', async () => {
    const store = makeStore();
    const first = await store.config();
    // Freezing starts a save at once; wait for that write (and nothing else) to land.
    await store.flush();
    const after = makeStore((n) => ({ pool: livePool(`restart${n}`), data: { status: 'live', fetchedAt: 'later', startDate: null, endDate: null } }));
    const again = await after.config();
    expect(again).toEqual(first);
    expect(calls).toBe(1);
    expect(again.eventPool.map((e) => e.id)).toEqual(first.eventPool.map((e) => e.id));
  });

  it('freezes a new pool after midnight in Charlotte, and labels an archive pool honestly', async () => {
    const store = makeStore((n) => (n === 1 ? { pool: livePool('a'), data: { status: 'live', fetchedAt: 'x', startDate: null, endDate: null } } : { pool: TEST_POOL, data: { status: 'archive', fetchedAt: 'snap', startDate: '2026-10-15', endDate: '2026-11-14' } }));
    const sat = await store.config();
    clock = Date.parse('2026-11-15T04:59:00Z'); // 11:59 PM Saturday in Charlotte
    expect((await store.config()).date).toBe('2026-11-14');
    clock = Date.parse('2026-11-15T05:01:00Z'); // 12:01 AM Sunday
    const sun = await store.config();
    expect(calls).toBe(2);
    expect(sun.date).toBe('2026-11-15');
    expect(sun.site).toBe('moon');
    expect(sun.poolSource).toBe('archive');
    expect(sat.site).toBe('mars');
  });

  it('falls back to the bundled snapshot if the data source fails', async () => {
    const store = new DailyStore({ dir, now: () => clock, events: () => Promise.reject(new Error('NASA down')) });
    stores.push(store);
    const cfg = await store.config();
    expect(cfg.poolSource).toBe('archive');
    expect(cfg.eventPool.length).toBeGreaterThan(5);
  });

  it('saves atomically (no temp files left) and sets a damaged file aside', async () => {
    const store = makeStore();
    await store.config();
    await store.flush();
    expect(readdirSync(dir)).toEqual(['daily.json']);
    const saved = JSON.parse(readFileSync(join(dir, 'daily.json'), 'utf8'));
    expect(saved.version).toBe(1);
    expect(Object.keys(saved.days)).toEqual(['2026-11-14']);
    writeFileSync(join(dir, 'daily.json'), '{"version":1,"days":{"2026-11-14":');
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const fresh = makeStore();
    await fresh.config();
    spy.mockRestore();
    expect(calls).toBe(2);
    expect(readdirSync(dir).some((f) => f.startsWith('daily.json.damaged-'))).toBe(true);
  });
});

describe('the board', () => {
  it('scores by replay, keeps one best entry per player, and never shows player ids', async () => {
    const store = makeStore();
    const cfg = await store.config();
    const win = movesFor(cfg, builder);
    const lose = movesFor(cfg, pureGreed);
    const first = store.submit(cfg.date, 'ip1', { playerId: 'player-aaaaaaaaaaaa', nickname: 'Comet', moves: lose });
    expect(first.ok && first.value.improved).toBe(true);
    expect(first.ok && first.value.score.won).toBe(false);
    // A better game replaces it...
    const better = store.submit(cfg.date, 'ip1', { playerId: 'player-aaaaaaaaaaaa', nickname: 'Comet 2', moves: win, score: { won: true, sols: 1 } });
    expect(better.ok && better.value).toMatchObject({ improved: true, total: 1, you: { rank: 1, nickname: 'Comet 2', won: true } });
    // ...the claimed score in the body is ignored: the replay decides.
    expect(better.ok && better.value.score.sols).toBeGreaterThan(5);
    // ...and a worse one does not.
    const worse = store.submit(cfg.date, 'ip1', { playerId: 'player-aaaaaaaaaaaa', nickname: 'Comet 3', moves: lose });
    expect(worse.ok && worse.value).toMatchObject({ improved: false, total: 1, you: { rank: 1, nickname: 'Comet 2' } });
    // Someone else, anonymous.
    const anon = store.submit(cfg.date, 'ip2', { playerId: 'player-bbbbbbbbbbbb', nickname: '', moves: lose });
    expect(anon.ok && anon.value.you).toMatchObject({ rank: 2, nickname: ANONYMOUS });
    const top = store.top(cfg.date, 20, 'player-bbbbbbbbbbbb');
    expect(top.ok && top.value.top.map((e) => e.nickname)).toEqual(['Comet 2', ANONYMOUS]);
    expect(top.ok && top.value.you?.rank).toBe(2);
    expect(JSON.stringify(top)).not.toMatch(/player-|"id"/);
    // Only nickname and score are stored, under a hash of the id.
    await store.flush();
    const raw = readFileSync(join(dir, 'daily.json'), 'utf8');
    expect(raw).not.toMatch(/player-aaaa|ip1|ip2/);
    const entry = JSON.parse(raw).days[cfg.date].entries[0];
    expect(Object.keys(entry).sort()).toEqual(['dose', 'fuel', 'id', 'name', 'sols', 'stars', 'won']);
  });

  it('rejects tampered or illegal games, and checks nicknames against the blocklist', async () => {
    const store = makeStore();
    const cfg = await store.config();
    const win = movesFor(cfg, builder);
    const tampered = JSON.parse(JSON.stringify(win)) as DailyMove[];
    tampered[0].a[1] += 3;
    const send = (body: Record<string, unknown>) => store.submit(cfg.date, 'ip', { playerId: 'player-cccccccccccc', moves: win, ...body });
    expect(send({ moves: tampered })).toMatchObject({ ok: false, status: 422, error: 'illegal-alloc' });
    expect(send({ moves: win.slice(0, 4) })).toMatchObject({ ok: false, status: 422, error: 'unfinished' });
    expect(send({ nickname: 'poop' })).toMatchObject({ ok: false, status: 400, error: 'bad-name', message: 'Please choose a different name.' });
    expect(send({ nickname: 'f u c k' })).toMatchObject({ ok: false, error: 'bad-name' });
    expect(send({ nickname: 'Astronaut Kid1' })).toMatchObject({ ok: false, error: 'bad-name', message: 'Use 12 letters or fewer.' });
    expect(send({ nickname: '<b>hi</b>' })).toMatchObject({ ok: false, error: 'bad-name', message: 'Use only letters, numbers and spaces.' });
    expect(send({ nickname: 42 })).toMatchObject({ ok: false, error: 'bad-name' });
    expect(send({ playerId: 'x' })).toMatchObject({ ok: false, error: 'bad-player' });
    expect(store.top(cfg.date).ok && (store.top(cfg.date) as { value: { total: number } }).value.total).toBe(0);
    expect(send({ nickname: '  Nova   Kid ' })).toMatchObject({ ok: true, value: { you: { nickname: 'Nova Kid' } } });
  });

  it('holds at most 500 entries a day: a better score pushes the last one off, a worse one is turned away', async () => {
    const store = makeStore();
    const cfg = await store.config();
    const win = movesFor(cfg, builder);
    const lose = movesFor(cfg, pureGreed);
    for (let i = 0; i < DAILY_LIMITS.maxEntriesPerDay; i++) {
      const r = store.submit(cfg.date, `10.0.${i >> 8}.${i & 255}`, { playerId: `player-${String(i).padStart(8, '0')}`, moves: lose });
      expect(r.ok).toBe(true);
    }
    const full = store.submit(cfg.date, 'late', { playerId: 'player-late-000000', moves: lose });
    expect(full).toMatchObject({ ok: false, status: 409, error: 'board-full' });
    const champ = store.submit(cfg.date, 'champ', { playerId: 'player-champ-00000', nickname: 'Champ', moves: win });
    expect(champ.ok && champ.value).toMatchObject({ total: 500, you: { rank: 1, nickname: 'Champ' } });
    const top = store.top(cfg.date, 999);
    expect(top.ok && top.value.top.length).toBe(DAILY_LIMITS.topMax);
    const last = store.top(cfg.date, 1, 'player-00000498');
    expect(last.ok && last.value.you?.rank).toBe(500);
    // The last one (P499) was pushed off.
    expect(store.top(cfg.date, 1, 'player-00000499').ok && (store.top(cfg.date, 1, 'player-00000499') as { value: { you: unknown } }).value.you).toBeNull();
  });

  it('rate-limits sending scores per address', async () => {
    const store = makeStore();
    const cfg = await store.config();
    const lose = movesFor(cfg, pureGreed);
    for (let i = 0; i < DAILY_RATE.submit.max; i++) {
      expect(store.submit(cfg.date, 'school', { playerId: `player-${String(i).padStart(8, '0')}`, moves: lose }).ok).toBe(true);
    }
    expect(store.submit(cfg.date, 'school', { playerId: 'player-one-more-00', moves: lose })).toMatchObject({ ok: false, status: 429 });
    expect(store.submit(cfg.date, 'home', { playerId: 'player-one-more-00', moves: lose }).ok).toBe(true);
    clock += DAILY_RATE.submit.windowMs;
    expect(store.submit(cfg.date, 'school', { playerId: 'player-later-0000', moves: lose }).ok).toBe(true);
  });

  it("takes yesterday's games just after midnight, turns away older days, and forgets days after 14", async () => {
    const store = makeStore();
    const sat = await store.config();
    const win = movesFor(sat, builder);
    clock = Date.parse('2026-11-15T06:00:00Z'); // 1 AM Sunday in Charlotte
    expect(store.submit(sat.date, 'ip', { playerId: 'player-night-owl00', moves: win }).ok).toBe(true);
    expect(store.submit('2026-11-16', 'ip', { playerId: 'player-night-owl00', moves: win })).toMatchObject({ ok: false, status: 404 });
    clock = Date.parse('2026-11-16T17:00:00Z'); // Monday
    expect(store.submit(sat.date, 'ip', { playerId: 'player-night-owl00', moves: win })).toMatchObject({ ok: false, status: 410 });
    await store.config(); // Monday's pool
    expect([...store.days.keys()]).toEqual(['2026-11-14', '2026-11-16']);
    clock = Date.parse('2026-11-28T17:00:00Z'); // 14 days after Saturday
    await store.config();
    expect([...store.days.keys()]).toEqual(['2026-11-16', '2026-11-28']);
    await store.flush();
    clock = Date.parse('2026-11-30T17:00:00Z'); // a restart two days later forgets Monday too
    const reloaded = makeStore().load();
    expect([...reloaded.days.keys()]).toEqual(['2026-11-28']);
  });
});
