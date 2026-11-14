// Written with AI assistance (Claude Code). See README "Use of AI tools".
// Every open Mission Control room, in server memory only (nothing is written to disk).
// Makes codes and secret tokens, enforces the limits (rooms, players, rate limits), expires idle
// rooms, and pushes the public room state to every open live stream (Server-Sent Events).
// The clock, the randomness and the NASA data source are passed in, so tests can control them.

import { isClassCode, makeClassCode, normalizeClassCode } from '../sim/classcode';
import type { Difficulty } from '../sim/constants';
import type { SpaceWeatherEvent } from '../sim/types';
import { LIMITS, type ClosedReason, type CreateRoomResponse, type JoinResponse, type PlayerAction, type RoomMode, type RoomView, type TeacherAction } from './protocol';
import { act, createRoom, findPlayer, isExpired, join, setOnline, teacherAct, viewOf, type Fail, type Player, type Result, type Room } from './room';

/** Where a stream's text goes (a Node response in the server, an array in tests). */
export interface Sink {
  write(chunk: string): unknown;
  end(): void;
  /** Bytes waiting to be sent: a stream that falls far behind is closed (the browser reconnects). */
  backlog?(): number;
}

interface Stream {
  sink: Sink;
  playerId: string | null;
  openedAt: number;
}

export interface RoomEvents {
  pool: SpaceWeatherEvent[];
  data: RoomView['data'];
}

export interface StoreOptions {
  now?: () => number;
  random?: () => number;
  /** The real space-weather events for a new room. */
  events: () => Promise<RoomEvents>;
  /** One-way Earth to Mars light time today, minutes. */
  lightTimeMin: () => number;
  /** Wait this long to bundle quick changes into one message, ms. */
  coalesceMs?: number;
}

export const RATE = {
  create: { max: 10, windowMs: 10 * 60 * 1000 },
  /** A whole school can share one address, so joining is generous. */
  join: { max: 120, windowMs: 60 * 1000 },
  action: { max: 60, windowMs: 10 * 1000 },
  teacher: { max: 60, windowMs: 10 * 1000 },
} as const;

const MAX_STREAMS_PER_ROOM = 150;
const MAX_STREAMS_PER_PLAYER = 3;
const MAX_STREAMS_TEACHER = 4;
const MAX_BACKLOG = 512 * 1024;

export class RateLimiter {
  private hits = new Map<string, { n: number; reset: number }>();
  constructor(
    private max: number,
    private windowMs: number,
  ) {}
  allow(key: string, now: number): boolean {
    if (this.hits.size > 20_000) this.sweep(now);
    const h = this.hits.get(key);
    if (!h || now >= h.reset) {
      this.hits.set(key, { n: 1, reset: now + this.windowMs });
      return true;
    }
    if (h.n >= this.max) return false;
    h.n++;
    return true;
  }
  sweep(now: number) {
    for (const [k, h] of this.hits) if (now >= h.reset) this.hits.delete(k);
    if (this.hits.size > 20_000) this.hits.clear();
  }
}

const fail = (status: number, error: string, message: string): Fail => ({ ok: false, status, error, message });
const TOO_FAST = fail(429, 'rate-limited', 'Too many tries. Wait a minute and try again.');
const NO_ROOM = fail(404, 'no-room', "We can't find that room. Check the code on the board.");

function secureRandom(): number {
  return globalThis.crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296;
}

function token(bytes = 18): string {
  return [...globalThis.crypto.getRandomValues(new Uint8Array(bytes))].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function sse(event: string, data: unknown, id?: number): string {
  return `${id !== undefined ? `id: ${id}\n` : ''}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export class RoomStore {
  readonly rooms = new Map<string, Room>();
  private streams = new Map<string, Set<Stream>>();
  private pending = new Map<string, ReturnType<typeof setTimeout>>();
  private timers: Array<ReturnType<typeof setInterval>> = [];
  private now: () => number;
  private random: () => number;
  private rate = {
    create: new RateLimiter(RATE.create.max, RATE.create.windowMs),
    join: new RateLimiter(RATE.join.max, RATE.join.windowMs),
    action: new RateLimiter(RATE.action.max, RATE.action.windowMs),
    teacher: new RateLimiter(RATE.teacher.max, RATE.teacher.windowMs),
  };

  constructor(private opts: StoreOptions) {
    this.now = opts.now ?? Date.now;
    this.random = opts.random ?? secureRandom;
  }

  /** Heartbeats every ~20 s and an expiry sweep every minute. Timers never keep the process alive. */
  start() {
    const hb = setInterval(() => this.heartbeat(), LIMITS.heartbeatMs);
    const sweep = setInterval(() => this.sweep(), 60_000);
    hb.unref?.();
    sweep.unref?.();
    this.timers.push(hb, sweep);
    return this;
  }

  stop() {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
    for (const t of this.pending.values()) clearTimeout(t);
    this.pending.clear();
    for (const room of [...this.rooms.values()]) this.closeRoom(room, 'ended');
  }

  get(rawCode: string): Room | undefined {
    const code = normalizeClassCode(rawCode);
    return isClassCode(code) ? this.rooms.get(code) : undefined;
  }

  streamCount(code: string): number {
    return this.streams.get(code)?.size ?? 0;
  }

  // ------------------------------------------------------------ requests

  async create(ip: string, body: { difficulty?: unknown; mode?: unknown }): Promise<Result<CreateRoomResponse>> {
    const now = this.now();
    if (!this.rate.create.allow(ip, now)) return TOO_FAST;
    if (this.rooms.size >= LIMITS.maxRooms) return fail(503, 'too-many-rooms', 'Mission Control is full right now. Try again in a few minutes.');
    const difficulty: Difficulty = body.difficulty === 'commander' ? 'commander' : 'cadet';
    const mode: RoomMode = body.mode === 'campaign' ? 'campaign' : 'quick';
    const events = await this.opts.events();
    if (this.rooms.size >= LIMITS.maxRooms) return fail(503, 'too-many-rooms', 'Mission Control is full right now. Try again in a few minutes.');
    let code = '';
    for (let i = 0; i < 100 && (!code || this.rooms.has(code)); i++) code = makeClassCode(this.random);
    if (!isClassCode(code) || this.rooms.has(code)) return fail(503, 'no-code', 'Could not make a room code. Try again.');
    const room = createRoom({
      code,
      teacherToken: token(24),
      difficulty,
      mode,
      now: this.now(),
      eventPool: events.pool,
      lightTimeMin: this.opts.lightTimeMin(),
      data: events.data,
    });
    this.rooms.set(code, room);
    return { ok: true, value: { code, teacherToken: room.teacherToken } };
  }

  /** Small public facts for "is this a real room?" (no names). */
  info(rawCode: string) {
    const room = this.get(rawCode);
    if (!room) return NO_ROOM;
    return {
      ok: true as const,
      value: { code: room.code, phase: room.phase, mode: room.mode, difficulty: room.difficulty, players: room.players.length, full: room.players.length >= LIMITS.maxPlayers },
    };
  }

  join(rawCode: string, ip: string, body: { name?: unknown; token?: unknown }): Result<JoinResponse> {
    const now = this.now();
    if (!this.rate.join.allow(ip, now)) return TOO_FAST;
    const room = this.get(rawCode);
    if (!room) return NO_ROOM;
    const res = join(room, body, now, { id: token(6), token: token(18) });
    if (!res.ok) return res;
    if (!res.value.rejoined) this.changed(room);
    const p = res.value.player;
    return { ok: true, value: { playerId: p.id, token: p.token, name: p.name, rejoined: res.value.rejoined } };
  }

  action(rawCode: string, body: { token?: unknown } & Record<string, unknown>): Result<{ v: number }> {
    const now = this.now();
    const room = this.get(rawCode);
    if (!room) return NO_ROOM;
    const p = findPlayer(room, body.token);
    if (p && !this.rate.action.allow(p.id, now)) return TOO_FAST;
    const res = act(room, body.token, body as unknown as PlayerAction, now);
    if (!res.ok) return res;
    if (body.type === 'leave' && p) this.closePlayerStreams(room, p, 'left');
    this.changed(room);
    return { ok: true, value: { v: room.v } };
  }

  teacher(rawCode: string, body: { teacherToken?: unknown } & Record<string, unknown>): Result<{ v: number }> {
    const now = this.now();
    const room = this.get(rawCode);
    if (!room) return NO_ROOM;
    if (!this.rate.teacher.allow(room.code, now)) return TOO_FAST;
    const res = teacherAct(room, body.teacherToken, body as unknown as TeacherAction, now);
    if (!res.ok) return res;
    if (res.value.removed) this.closePlayerStreams(room, res.value.removed, 'kicked');
    if (room.closed) {
      this.closeRoom(room, room.closed);
      return { ok: true, value: { v: room.v } };
    }
    this.changed(room);
    return { ok: true, value: { v: room.v } };
  }

  // ------------------------------------------------------------ live streams

  /** Open a live stream for a player (token) or the teacher (teacher token). Returns a function to close it. */
  subscribe(rawCode: string, auth: { token?: string | null; teacher?: string | null }, sink: Sink): Result<() => void> {
    const now = this.now();
    const room = this.get(rawCode);
    if (!room) return NO_ROOM;
    const isTeacher = !!auth.teacher && auth.teacher === room.teacherToken;
    const player = isTeacher ? undefined : findPlayer(room, auth.token);
    if (!isTeacher && !player) return fail(403, 'not-a-player', 'You are not in this room. Join again with your name.');
    let set = this.streams.get(room.code);
    if (!set) this.streams.set(room.code, (set = new Set()));
    if (set.size >= MAX_STREAMS_PER_ROOM) return fail(429, 'too-many-screens', 'Too many screens are open in this room.');
    // Old tabs and dropped connections: keep only the newest few streams per person.
    const mine = [...set].filter((s) => s.playerId === (player?.id ?? null)).sort((a, b) => a.openedAt - b.openedAt);
    const max = isTeacher ? MAX_STREAMS_TEACHER : MAX_STREAMS_PER_PLAYER;
    for (const old of mine.slice(0, Math.max(0, mine.length - max + 1))) this.drop(room, old);

    const stream: Stream = { sink, playerId: player?.id ?? null, openedAt: now };
    set.add(stream);
    room.lastActive = now;
    sink.write(`retry: 3000\n\n`);
    if (player) {
      setOnline(room, player, 1, now);
      this.changed(room);
    } else room.teacherConns++;
    sink.write(sse('state', viewOf(room, now), room.v));
    let open = true;
    return {
      ok: true,
      value: () => {
        if (!open) return;
        open = false;
        this.detach(room, stream);
      },
    };
  }

  /** Forget a stream (it closed). */
  private detach(room: Room, stream: Stream) {
    const set = this.streams.get(room.code);
    if (!set?.delete(stream)) return;
    if (!set.size) this.streams.delete(room.code);
    if (stream.playerId === null) {
      room.teacherConns = Math.max(0, room.teacherConns - 1);
      return;
    }
    const p = room.players.find((x) => x.id === stream.playerId);
    if (p && this.rooms.has(room.code)) {
      setOnline(room, p, -1, this.now());
      this.changed(room);
    }
  }

  private drop(room: Room, stream: Stream) {
    this.detach(room, stream);
    try {
      stream.sink.end();
    } catch {
      /* already gone */
    }
  }

  private closePlayerStreams(room: Room, p: Player, reason: ClosedReason) {
    for (const s of [...(this.streams.get(room.code) ?? [])]) {
      if (s.playerId !== p.id) continue;
      try {
        s.sink.write(sse('closed', { reason }));
      } catch {
        /* gone */
      }
      this.drop(room, s);
    }
  }

  /** Bundle quick changes (a class tapping at once) into one message. */
  changed(room: Room) {
    if (this.pending.has(room.code) || !this.rooms.has(room.code)) return;
    const t = setTimeout(() => {
      this.pending.delete(room.code);
      this.broadcast(room);
    }, this.opts.coalesceMs ?? 80);
    this.pending.set(room.code, t);
  }

  /** Send the full public state to every open screen in the room. */
  broadcast(room: Room) {
    const set = this.streams.get(room.code);
    if (!set?.size) return;
    const msg = sse('state', viewOf(room, this.now()), room.v);
    for (const s of [...set]) this.send(room, s, msg);
  }

  private send(room: Room, s: Stream, msg: string) {
    if ((s.sink.backlog?.() ?? 0) > MAX_BACKLOG) {
      this.drop(room, s);
      return;
    }
    try {
      s.sink.write(msg);
    } catch {
      this.drop(room, s);
    }
  }

  heartbeat() {
    const now = this.now();
    for (const room of this.rooms.values()) {
      const set = this.streams.get(room.code);
      if (!set) continue;
      const msg = sse('heartbeat', { v: room.v, t: now });
      for (const s of [...set]) {
        if (s.playerId) {
          const p = room.players.find((x) => x.id === s.playerId);
          if (p) p.lastSeen = now;
        }
        this.send(room, s, msg);
      }
    }
  }

  closeRoom(room: Room, reason: ClosedReason) {
    room.closed = reason;
    const t = this.pending.get(room.code);
    if (t) clearTimeout(t);
    this.pending.delete(room.code);
    this.rooms.delete(room.code);
    const set = this.streams.get(room.code);
    this.streams.delete(room.code);
    for (const s of set ?? []) {
      try {
        s.sink.write(sse('closed', { reason }));
        s.sink.end();
      } catch {
        /* gone */
      }
    }
  }

  /** Close rooms idle for 3 hours. */
  sweep() {
    const now = this.now();
    for (const room of [...this.rooms.values()]) if (isExpired(room, now)) this.closeRoom(room, 'expired');
    for (const r of Object.values(this.rate)) r.sweep(now);
  }
}
