// Written with AI assistance (Claude Code). See README "Use of AI tools".
// Mission Control: the pure room rules (joining, stations, legal moves, running a sol) and the
// in-memory store (limits, rate limits, reconnecting, expiry, live messages).
import { describe, it, expect } from 'vitest';
import { act, autoAssign, canRun, createRoom, isExpired, join, setOnline, teacherAct, viewOf, type Player, type Room } from './room';
import { RoomStore, RATE, type RoomSaver, type Sink } from './store';
import { checkName, isBlockedName } from './names';
import { LIMITS, STATION_IDS, STATION_OF, type PlayerAction, type StationId } from './protocol';
import { TEST_POOL } from '../sim/fixtures.test-util';
import { getBriefing, moduleCap, planFor, totalCells } from '../sim/sim';
import { builder } from '../sim/strategies';
import { MODULE_IDS, type ModuleId } from '../sim/types';

const T0 = 1_800_000_000_000;
const DATA = { status: 'archive' as const, fetchedAt: null, startDate: null, endDate: null };
let ids = 0;
const fresh = () => ({ id: `p${++ids}`, token: `tok-${ids}-${'x'.repeat(20)}` });

function room(mode: 'quick' | 'campaign' = 'quick'): Room {
  return createRoom({ code: 'K7RZQ', teacherToken: 'teacher-secret', difficulty: 'cadet', mode, now: T0, eventPool: TEST_POOL, lightTimeMin: 12, data: DATA });
}

function add(r: Room, name: string, now = T0): Player {
  const res = join(r, { name }, now, fresh());
  if (!res.ok) throw new Error(res.message);
  return res.value.player;
}

const teach = (r: Room, a: Parameters<typeof teacherAct>[2], now = T0) => teacherAct(r, 'teacher-secret', a, now);
const stationsOf = (r: Room) => r.players.map((p) => p.stations.join('+'));

function ownerOf(r: Room, id: ModuleId): Player {
  return r.players.find((p) => p.stations.includes(STATION_OF[id]))!;
}

/** A room with 4 students (one per station), started and in planning. */
function planning(mode: 'quick' | 'campaign' = 'quick') {
  const r = room(mode);
  const ps = ['Ava', 'Ben', 'Cy', 'Dee'].map((n) => add(r, n));
  expect(teach(r, { type: 'start' }).ok).toBe(true);
  expect(r.phase).toBe('briefing');
  expect(teach(r, { type: 'plan' }).ok).toBe(true);
  expect(r.phase).toBe('plan');
  return { r, ps };
}

/** Place a whole allocation the way a class would: each cell by the student who owns that module. */
function placeAll(r: Room, alloc: Record<ModuleId, number>) {
  for (const id of MODULE_IDS) {
    for (let k = 0; k < alloc[id]; k++) {
      const res = act(r, ownerOf(r, id).token, { type: 'place', module: id }, T0);
      expect(res.ok, `place ${id}: ${res.ok ? '' : res.message}`).toBe(true);
    }
  }
}

describe('names', () => {
  it('accepts first names and nicknames, tidied', () => {
    expect(checkName('  Maya  ')).toEqual({ ok: true, name: 'Maya' });
    expect(checkName('Jo   Jo 2')).toEqual({ ok: true, name: 'Jo Jo 2' });
    expect(checkName('José')).toEqual({ ok: true, name: 'José' });
    expect(checkName('Cassie').ok).toBe(true);
    expect(checkName('Killian').ok).toBe(true);
    expect(checkName('Shital').ok).toBe(true);
    expect(checkName('Bobby').ok).toBe(true);
  });
  it('rejects empty, long, symbols, emoji and blocked words', () => {
    expect(checkName('   ')).toEqual({ ok: false, problem: 'empty' });
    expect(checkName('Maximilianaaa')).toEqual({ ok: false, problem: 'long' });
    expect(checkName('<b>hi</b>')).toEqual({ ok: false, problem: 'letters' });
    expect(checkName('Ann!')).toEqual({ ok: false, problem: 'letters' });
    expect(checkName(`Rocket ${String.fromCodePoint(0x1f680)}`)).toEqual({ ok: false, problem: 'letters' });
    expect(checkName('x.com')).toEqual({ ok: false, problem: 'letters' });
    expect(isBlockedName('Poopy')).toBe(true);
    expect(isBlockedName('b u t t')).toBe(true);
    expect(isBlockedName('Sh1t')).toBe(true);
    expect(checkName('ass')).toEqual({ ok: false, problem: 'blocked' });
  });
});

describe('joining and stations', () => {
  it('splits the 4 stations between 1, 2, 3 and 4 players, then evens out bigger groups', () => {
    const r = room();
    add(r, 'Ava');
    expect(stationsOf(r)).toEqual(['o2+green+rad+shop']);
    add(r, 'Ben');
    expect(stationsOf(r)).toEqual(['o2+green', 'rad+shop']);
    add(r, 'Cy');
    expect(stationsOf(r)).toEqual(['o2', 'rad+shop', 'green']);
    add(r, 'Dee');
    expect(stationsOf(r).sort()).toEqual(['green', 'o2', 'rad', 'shop']);
    for (let i = 0; i < 21; i++) add(r, `Kid ${i}`);
    const count: Record<StationId, number> = { o2: 0, green: 0, rad: 0, shop: 0 };
    for (const p of r.players) for (const s of p.stations) count[s]++;
    // A class of 25 is about 6 per station.
    expect(Math.max(...Object.values(count)) - Math.min(...Object.values(count))).toBeLessThanOrEqual(1);
    expect(r.players.every((p) => p.stations.length === 1)).toBe(true);
  });

  it('auto-assign shares stations evenly and every station always has someone', () => {
    const r = room();
    const [a, b] = [add(r, 'Ava'), add(r, 'Ben')];
    autoAssign(r);
    expect([a.stations, b.stations]).toEqual([['o2', 'rad'], ['green', 'shop']]);
    // The teacher moves Ava to the Workshop: her old stations go to someone else.
    expect(teach(r, { type: 'assign', playerId: a.id, station: 'shop' }).ok).toBe(true);
    expect(a.stations).toEqual(['shop']);
    expect(new Set(r.players.flatMap((p) => p.stations))).toEqual(new Set(STATION_IDS));
    // Ben leaves: Ava covers everything again.
    expect(act(r, b.token, { type: 'leave' }, T0).ok).toBe(true);
    expect(a.stations).toEqual([...STATION_IDS]);
  });

  it('rejects bad, blocked, duplicate names and a full room', () => {
    const r = room();
    add(r, 'Maya');
    expect(join(r, { name: 'MAYA' }, T0, fresh())).toMatchObject({ ok: false, error: 'name-taken' });
    expect(join(r, { name: 'a$b' }, T0, fresh())).toMatchObject({ ok: false, error: 'name-letters' });
    expect(join(r, { name: 'fuuuck' }, T0, fresh())).toMatchObject({ ok: false, error: 'name-blocked' });
    expect(join(r, {}, T0, fresh())).toMatchObject({ ok: false, error: 'name-empty' });
    for (let i = 1; i < LIMITS.maxPlayers; i++) add(r, `Kid ${i}`);
    expect(r.players.length).toBe(LIMITS.maxPlayers);
    expect(join(r, { name: 'Late' }, T0, fresh())).toMatchObject({ ok: false, status: 409, error: 'room-full' });
  });

  it('rejoins the same player with their token (reconnect), even in a full room', () => {
    const r = room();
    const p = add(r, 'Maya');
    for (let i = 1; i < LIMITS.maxPlayers; i++) add(r, `Kid ${i}`);
    const back = join(r, { token: p.token, name: 'ignored' }, T0 + 5000, fresh());
    expect(back).toMatchObject({ ok: true, value: { rejoined: true } });
    expect(back.ok && back.value.player).toBe(p);
    expect(r.players.length).toBe(LIMITS.maxPlayers);
  });

  it('a removed player cannot come back under the same name', () => {
    const r = room();
    const p = add(r, 'Rex');
    add(r, 'Sam');
    const res = teach(r, { type: 'kick', playerId: p.id });
    expect(res.ok && res.value.removed).toBe(p);
    expect(r.players.map((x) => x.name)).toEqual(['Sam']);
    expect(act(r, p.token, { type: 'ping', ping: 'ready' }, T0)).toMatchObject({ ok: false, status: 403 });
    expect(join(r, { name: 'rex' }, T0, fresh())).toMatchObject({ ok: false, error: 'name-blocked' });
    expect(join(r, { token: p.token, name: 'Rex' }, T0, fresh())).toMatchObject({ ok: false, error: 'name-blocked' });
  });
});

describe('the shared plan', () => {
  it('only lets students move cells in their own station, and only while planning', () => {
    const r = room();
    const ps = ['Ava', 'Ben', 'Cy', 'Dee'].map((n) => add(r, n));
    const o2 = ps.find((p) => p.stations.includes('o2'))!;
    expect(act(r, o2.token, { type: 'place', module: 'air' }, T0)).toMatchObject({ ok: false, error: 'wrong-phase' });
    teach(r, { type: 'start' });
    expect(act(r, o2.token, { type: 'place', module: 'air' }, T0)).toMatchObject({ ok: false, error: 'wrong-phase' });
    teach(r, { type: 'plan' });
    expect(act(r, o2.token, { type: 'place', module: 'air' }, T0).ok).toBe(true);
    expect(act(r, o2.token, { type: 'place', module: 'greenhouse' }, T0)).toMatchObject({ ok: false, status: 403, error: 'not-your-station' });
    expect(act(r, o2.token, { type: 'remove', module: 'heaters' }, T0)).toMatchObject({ ok: false, error: 'not-your-station' });
    expect(act(r, o2.token, { type: 'place', module: 'nope' as ModuleId }, T0)).toMatchObject({ ok: false, error: 'bad-module' });
    expect(act(r, 'not-a-token', { type: 'place', module: 'air' }, T0)).toMatchObject({ ok: false, status: 403 });
    expect(act(r, o2.token, { type: 'fly' } as unknown as PlayerAction, T0)).toMatchObject({ ok: false, error: 'bad-action' });
    expect(r.alloc.air).toBe(1);
    expect(r.alloc.greenhouse).toBe(0);
  });

  it('enforces module caps, the shared pool, and empty modules', () => {
    const { r } = planning();
    const o2 = ownerOf(r, 'air');
    const cap = moduleCap(r.mission!, 'air');
    for (let i = 0; i < cap; i++) expect(act(r, o2.token, { type: 'place', module: 'air' }, T0).ok).toBe(true);
    expect(act(r, o2.token, { type: 'place', module: 'air' }, T0)).toMatchObject({ ok: false, error: 'module-full' });
    expect(act(r, o2.token, { type: 'move', from: 'air', to: 'fuel' }, T0).ok).toBe(true);
    expect(act(r, o2.token, { type: 'remove', module: 'fuel' }, T0).ok).toBe(true);
    expect(act(r, o2.token, { type: 'remove', module: 'fuel' }, T0)).toMatchObject({ ok: false, error: 'module-empty' });
    // Fill the pool with fuel, then the next cell anywhere is refused.
    const cells = getBriefing(r.mission!).cells;
    while (totalCells(r.alloc) < cells) expect(act(r, o2.token, { type: 'place', module: 'fuel' }, T0).ok).toBe(true);
    const green = ownerOf(r, 'heaters');
    expect(act(r, green.token, { type: 'place', module: 'heaters' }, T0)).toMatchObject({ ok: false, error: 'pool-empty' });
    // Negotiation: O2 gives one back, then Greenhouse and Heat can use it.
    expect(act(r, o2.token, { type: 'remove', module: 'fuel' }, T0).ok).toBe(true);
    expect(act(r, green.token, { type: 'place', module: 'heaters' }, T0).ok).toBe(true);
    expect(totalCells(r.alloc)).toBe(cells);
  });

  it('only the Workshop station picks the project and the crate; a new project hands its cells back', () => {
    const { r } = planning();
    const shop = ownerOf(r, 'build');
    const o2 = ownerOf(r, 'air');
    expect(act(r, o2.token, { type: 'project', project: 'monitor' }, T0)).toMatchObject({ ok: false, error: 'not-your-station' });
    expect(act(r, shop.token, { type: 'place', module: 'build' }, T0).ok).toBe(true);
    expect(act(r, shop.token, { type: 'project', project: 'monitor' }, T0).ok).toBe(true);
    expect(r.mission!.base.project).toBe('monitor');
    expect(r.alloc.build).toBe(0);
    expect(act(r, shop.token, { type: 'project', project: 'warp' as never }, T0)).toMatchObject({ ok: false, error: 'bad-project' });
    // No cargo lander on sol 1.
    expect(planFor(r.mission!).resupply).toBe(false);
    expect(act(r, shop.token, { type: 'crate', crate: 'food' }, T0)).toMatchObject({ ok: false, error: 'no-cargo' });
  });

  it('runs the sol only when every cell is placed, and only for the teacher', () => {
    const { r } = planning();
    expect(teacherAct(r, 'wrong', { type: 'run' }, T0)).toMatchObject({ ok: false, status: 403 });
    expect(teach(r, { type: 'run' })).toMatchObject({ ok: false, error: 'cannot-run' });
    expect(canRun(r).reasons[0]).toMatch(/Place every power cell/);
    const { alloc } = builder(r.mission!);
    placeAll(r, { ...alloc, build: Math.min(alloc.build, moduleCap(r.mission!, 'build')) });
    expect(canRun(r).ok).toBe(true);
    expect(teach(r, { type: 'run' }).ok).toBe(true);
    expect(r.phase).toBe('debrief');
    expect(r.mission!.sol).toBe(2);
    expect(r.report?.sol).toBe(1);
    expect(totalCells(r.alloc)).toBe(0);
    expect(teach(r, { type: 'run' })).toMatchObject({ ok: false });
    expect(teach(r, { type: 'next' }).ok).toBe(true);
    expect(r.phase).toBe('briefing');
  });

  it('auto-runs when everyone with the room open is ready', () => {
    const { r, ps } = planning();
    teach(r, { type: 'autoRun', on: true });
    for (const p of ps.slice(0, 3)) setOnline(r, p, 1, T0);
    placeAll(r, builder(r.mission!).alloc);
    act(r, ps[0].token, { type: 'ready', ready: true }, T0);
    act(r, ps[1].token, { type: 'ready', ready: true }, T0);
    expect(r.phase).toBe('plan');
    // The 4th student is offline, so they don't hold the class up.
    const res = act(r, ps[2].token, { type: 'ready', ready: true }, T0);
    expect(res).toMatchObject({ ok: true, value: { ran: true } });
    expect(r.phase).toBe('debrief');
    expect(r.players.every((p) => !p.ready)).toBe(true);
  });

  it('plays a whole quick mission together, then can start again', () => {
    const { r } = planning();
    for (let guard = 0; guard < 40 && r.phase !== 'end'; guard++) {
      if (r.phase === 'briefing') teach(r, { type: 'plan' });
      if (r.phase === 'plan') {
        const shop = ownerOf(r, 'build');
        const move = builder(r.mission!);
        if (move.project && move.project !== r.mission!.base.project) act(r, shop.token, { type: 'project', project: move.project }, T0);
        if (planFor(r.mission!).resupply) expect(act(r, shop.token, { type: 'crate', crate: move.crate ?? 'food' }, T0).ok).toBe(true);
        placeAll(r, move.alloc);
        const run = teach(r, { type: 'run' });
        expect(run.ok, run.ok ? '' : run.message).toBe(true);
      }
      if (r.phase === 'debrief') teach(r, { type: 'next' });
    }
    expect(r.phase).toBe('end');
    expect(r.mission!.status).not.toBe('playing');
    expect(r.campaign.results.length).toBe(1);
    expect(teach(r, { type: 'next' })).toMatchObject({ ok: false, error: 'done' });
    expect(teach(r, { type: 'restart' }).ok).toBe(true);
    expect(r.phase).toBe('briefing');
    expect(r.mission!.sol).toBe(1);
  });

  it('a campaign room sends the next crew to the same base', () => {
    const { r } = planning('campaign');
    r.mission = { ...r.mission!, status: 'lost', loseReason: 'air' };
    r.phase = 'debrief';
    expect(teach(r, { type: 'next' }).ok).toBe(true);
    expect(r.phase).toBe('end');
    expect(teach(r, { type: 'next' }).ok).toBe(true);
    expect(r.phase).toBe('briefing');
    expect(r.mission!.config.expedition).toBe(2);
    expect(viewOf(r, T0).expedition).toBe(2);
  });

  it('pings are preset, rate limited and fade', () => {
    const { r, ps } = planning();
    expect(act(r, ps[0].token, { type: 'ping', ping: 'cells' }, T0).ok).toBe(true);
    expect(act(r, ps[0].token, { type: 'ping', ping: 'cells' }, T0 + 500)).toMatchObject({ ok: false, status: 429 });
    expect(act(r, ps[0].token, { type: 'ping', ping: 'hello there' as never }, T0 + 5000)).toMatchObject({ ok: false, error: 'bad-ping' });
    expect(viewOf(r, T0 + 1000).pings).toEqual([{ n: 1, from: 'Ava', stations: ps[0].stations, ping: 'cells' }]);
    expect(viewOf(r, T0 + LIMITS.pingShowMs + 1).pings).toEqual([]);
  });

  it('the public view never contains a token or the event pool', () => {
    const { r } = planning();
    const json = JSON.stringify(viewOf(r, T0));
    expect(json).not.toContain('teacher-secret');
    for (const p of r.players) expect(json).not.toContain(p.token);
    expect(viewOf(r, T0).mission!.config.eventPool).toEqual([]);
    expect(r.mission!.config.eventPool.length).toBe(TEST_POOL.length);
  });

  it('expires after 3 hours with nothing happening', () => {
    const r = room();
    expect(isExpired(r, T0 + LIMITS.idleMs - 1)).toBe(false);
    add(r, 'Ava', T0 + LIMITS.idleMs - 1);
    expect(isExpired(r, T0 + LIMITS.idleMs + 10)).toBe(false);
    expect(isExpired(r, T0 + 2 * LIMITS.idleMs)).toBe(true);
  });
});

// ---------------------------------------------------------------- the store

function sinkLog() {
  const out: string[] = [];
  let ended = false;
  const sink: Sink = { write: (c) => void out.push(c), end: () => void (ended = true) };
  return { sink, out, ended: () => ended, events: (name: string) => out.filter((c) => c.includes(`event: ${name}\n`)) };
}

function store(now = { t: T0 }) {
  return new RoomStore({
    now: () => now.t,
    events: async () => ({ pool: TEST_POOL, data: DATA }),
    lightTimeMin: () => 12,
    coalesceMs: 0,
  });
}

describe('room store', () => {
  it('makes unique codes and caps the number of rooms', async () => {
    const s = store();
    const codes = new Set<string>();
    for (let i = 0; i < LIMITS.maxRooms; i++) {
      const r = await s.create(`10.0.${Math.floor(i / 10)}.${i % 10}`, {});
      expect(r.ok).toBe(true);
      if (r.ok) codes.add(r.value.code);
    }
    expect(codes.size).toBe(LIMITS.maxRooms);
    expect(await s.create('10.9.9.9', {})).toMatchObject({ ok: false, status: 503 });
  });

  it('rate limits making rooms and joining from one address', async () => {
    const clock = { t: T0 };
    const s = store(clock);
    for (let i = 0; i < RATE.create.max; i++) expect((await s.create('1.2.3.4', {})).ok).toBe(true);
    expect(await s.create('1.2.3.4', {})).toMatchObject({ ok: false, status: 429 });
    expect((await s.create('5.6.7.8', {})).ok).toBe(true);
    clock.t += RATE.create.windowMs;
    expect((await s.create('1.2.3.4', {})).ok).toBe(true);
    const code = [...s.rooms.keys()][0];
    for (let i = 0; i < RATE.join.max; i++) s.join(code, '9.9.9.9', { name: `x${i}` });
    expect(s.join(code, '9.9.9.9', { name: 'more' })).toMatchObject({ ok: false, status: 429 });
  });

  it('streams the state to every screen, marks players online, and closes kicked players', async () => {
    const s = store();
    const made = await s.create('1.1.1.1', { mode: 'campaign', difficulty: 'commander' });
    if (!made.ok) throw new Error('no room');
    const { code, teacherToken } = made.value;
    const j = s.join(code.toLowerCase(), '1.1.1.1', { name: 'Ava' });
    if (!j.ok) throw new Error(j.message);
    expect(s.subscribe(code, { token: 'nope' }, sinkLog().sink)).toMatchObject({ ok: false, status: 403 });
    const teacher = sinkLog();
    const kid = sinkLog();
    expect(s.subscribe(code, { teacher: teacherToken }, teacher.sink).ok).toBe(true);
    const sub = s.subscribe(code, { token: j.value.token }, kid.sink);
    expect(sub.ok).toBe(true);
    expect(kid.out[0]).toBe('retry: 3000\n\n');
    const first = JSON.parse(kid.events('state')[0].split('data: ')[1]);
    expect(first).toMatchObject({ code, phase: 'lobby', mode: 'campaign', difficulty: 'commander', crews: 3 });
    expect(first.players[0]).toMatchObject({ name: 'Ava', online: true, stations: ['o2', 'green', 'rad', 'shop'] });
    expect(JSON.stringify(teacher.out)).not.toContain(teacherToken);

    expect(s.teacher(code, { teacherToken, type: 'start' }).ok).toBe(true);
    s.broadcast(s.get(code)!);
    const last = JSON.parse(teacher.events('state').at(-1)!.split('data: ')[1]);
    expect(last.phase).toBe('briefing');
    expect(last.mission.sol).toBe(1);

    s.heartbeat();
    expect(kid.events('heartbeat').length).toBe(1);

    expect(s.teacher(code, { teacherToken, type: 'kick', playerId: j.value.playerId }).ok).toBe(true);
    expect(kid.events('closed')[0]).toContain('kicked');
    expect(kid.ended()).toBe(true);
    expect(teacher.ended()).toBe(false);
  });

  it('a reconnecting player keeps their place; old streams are closed', async () => {
    const s = store();
    const made = await s.create('1.1.1.1', {});
    if (!made.ok) throw new Error('no room');
    const { code } = made.value;
    const j = s.join(code, '1.1.1.1', { name: 'Ava' });
    if (!j.ok) throw new Error('join');
    const tabs = [sinkLog(), sinkLog(), sinkLog(), sinkLog()];
    for (const t of tabs) expect(s.subscribe(code, { token: j.value.token }, t.sink).ok).toBe(true);
    expect(tabs[0].ended()).toBe(true);
    expect(s.streamCount(code)).toBe(3);
    const again = s.join(code, '1.1.1.1', { token: j.value.token });
    expect(again).toMatchObject({ ok: true, value: { playerId: j.value.playerId, rejoined: true } });
    expect(s.get(code)!.players[0].conns).toBe(3);
  });

  it('closes idle rooms and tells every screen', async () => {
    const clock = { t: T0 };
    const s = store(clock);
    const made = await s.create('1.1.1.1', {});
    if (!made.ok) throw new Error('no room');
    const screen = sinkLog();
    s.subscribe(made.value.code, { teacher: made.value.teacherToken }, screen.sink);
    clock.t += LIMITS.idleMs / 2;
    s.sweep();
    expect(s.rooms.size).toBe(1);
    clock.t += LIMITS.idleMs;
    s.sweep();
    expect(s.rooms.size).toBe(0);
    expect(screen.events('closed')[0]).toContain('expired');
    expect(screen.ended()).toBe(true);
    expect(s.join(made.value.code, '1.1.1.1', { name: 'Late' })).toMatchObject({ ok: false, status: 404 });
  });

  it('the teacher can close the room', async () => {
    const s = store();
    const made = await s.create('1.1.1.1', {});
    if (!made.ok) throw new Error('no room');
    expect(s.teacher(made.value.code, { teacherToken: 'guess', type: 'end' })).toMatchObject({ ok: false, status: 403 });
    expect(s.teacher(made.value.code, { teacherToken: made.value.teacherToken, type: 'end' }).ok).toBe(true);
    expect(s.rooms.size).toBe(0);
  });
});

describe('saving rooms (Cloudflare)', () => {
  /** A saver that keeps JSON text, like Durable Object storage does. */
  function memorySaver() {
    const saved = new Map<string, string>();
    const saver: RoomSaver = {
      load: () => [...saved.values()].map((t) => JSON.parse(t) as Room),
      save: (room) => void saved.set(room.code, JSON.stringify(room)),
      remove: (code) => void saved.delete(code),
    };
    return { saver, saved };
  }
  const withSaver = (saver: RoomSaver, now = { t: T0 }) =>
    new RoomStore({ now: () => now.t, events: async () => ({ pool: TEST_POOL, data: DATA }), lightTimeMin: () => 12, coalesceMs: 0, saver, saveDelayMs: 10_000 });

  it('brings rooms back after a restart: players, plan and tokens, with nobody connected and a newer version', async () => {
    const { saver, saved } = memorySaver();
    const a = withSaver(saver);
    const made = await a.create('1.1.1.1', {});
    if (!made.ok) throw new Error(made.message);
    const { code, teacherToken } = made.value;
    const ava = a.join(code, '1.1.1.1', { name: 'Ava' });
    if (!ava.ok) throw new Error(ava.message);
    const live = a.subscribe(code, { token: ava.value.token }, sinkLog().sink);
    expect(live.ok).toBe(true);
    expect(saved.size).toBe(0); // saved a little later, not on every change
    a.saveNow();
    expect(saved.size).toBe(1);
    const before = a.get(code)!;

    const b = withSaver(saver);
    const back = b.get(code)!;
    expect(back.teacherToken).toBe(teacherToken);
    expect(back.players.map((p) => p.name)).toEqual(['Ava']);
    expect(back.players[0].conns).toBe(0);
    expect(back.v).toBeGreaterThan(before.v + 100);
    // The same student rejoins with her token, and the teacher can run the room.
    expect(b.join(code, '1.1.1.1', { token: ava.value.token })).toMatchObject({ ok: true, value: { rejoined: true } });
    expect(b.teacher(code, { teacherToken, type: 'start' }).ok).toBe(true);
  });

  it('forgets ended, expired and damaged rooms', async () => {
    const { saver, saved } = memorySaver();
    const now = { t: T0 };
    const a = withSaver(saver, now);
    const one = await a.create('1.1.1.1', {});
    const two = await a.create('1.1.1.2', {});
    if (!one.ok || !two.ok) throw new Error('no room');
    a.saveNow();
    expect(saved.size).toBe(2);
    expect(a.teacher(one.value.code, { teacherToken: one.value.teacherToken, type: 'end' }).ok).toBe(true);
    expect([...saved.keys()]).toEqual([two.value.code]);
    saved.set('JUNK1', '{"code":"JUNK1"}');
    now.t += LIMITS.idleMs + 1;
    const b = withSaver(saver, now);
    expect(b.rooms.size).toBe(0);
    expect(saved.size).toBe(0);
  });
});
