// Written with AI assistance (Claude Code). See README "Use of AI tools".
// Every registered class and its students' results, on our server (Cloudflare: deploy/worker.ts).
// Kept in memory and saved as JSON to a save slot (`classes.json`: Durable Object storage on
// Cloudflare, a file in the Node test server), a couple of seconds after a change. A class and all its results
// are deleted 7 days after its last report. What is kept per student: a random player id, an
// optional nickname, and game numbers. Never an IP address, never anything typed except the name.
// The teacher key is stored only as a SHA-256 hash.
// Server-only: the game in the browser never imports this file.

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { SaveSlot } from '../server/slot';
import { checkClassCode, isClassCode, normalizeClassCode } from '../sim/classcode';
import { UPGRADE_IDS } from '../sim/upgrades';
import type { LoseReason } from '../sim/types';
import type { Fail, Result } from '../room/room';
import { RateLimiter } from '../room/store';
import { checkName } from '../room/names';
import { CLASS_LIMITS, isTeacherKey, type CrewView, type DashboardResponse, type JoinResponse, type PlayerView, type RegisterResponse, type ReportResponse, type Tally } from './protocol';
import { checkReport, isPlayerId, type CleanReport } from './validate';

export const CLASS_FILE = 'classes.json';

export const CLASS_RATE = {
  register: { max: 10, windowMs: 10 * 60 * 1000 },
  /** A whole school can share one address, and a class finishes crews at about the same time. */
  report: { max: 240, windowMs: 60 * 1000 },
  /** One student's game: a result, maybe a name update, and a few retries. */
  player: { max: 20, windowMs: 60 * 1000 },
  /** The dashboard asks every 10 seconds; a few tabs are fine. */
  view: { max: 120, windowMs: 60 * 1000 },
  teacher: { max: 30, windowMs: 60 * 1000 },
} as const;

interface StoredPlayer {
  /** The student's random id from their browser. Never sent to the dashboard. */
  id: string;
  num: number;
  name: string | null;
  difficulty: 'cadet' | 'commander';
  crews: CrewView[];
  last: CrewView;
  tally: Tally;
  fuel: number[] | null;
  seen: number;
  /** Recent result ids, so a retried send is never counted twice. */
  rids: string[];
}

/** A student who started a crew with the code but has no result yet. Becomes a StoredPlayer (same number) with their first result. */
interface StoredJoined {
  id: string;
  num: number;
  name: string | null;
  seen: number;
}

export interface StoredClass {
  code: string;
  keyHash: string;
  createdAt: number;
  lastReportAt: number | null;
  v: number;
  nextNum: number;
  players: StoredPlayer[];
  /** Students playing their first crew. Missing in a classes.json saved before joining existed. */
  joined?: StoredJoined[];
  /** Player ids the teacher removed: their results are refused. */
  removed: string[];
}

interface SaveFile {
  version: 1;
  savedAt: number;
  classes: StoredClass[];
}

export interface ClassStoreOptions {
  /** Where classes.json is saved. null = memory only (nothing saved). */
  slot: SaveSlot | null;
  now?: () => number;
  /** Wait this long after a change before saving, ms. */
  saveDelayMs?: number;
  log?: (msg: string) => void;
}

const fail = (status: number, error: string, message: string): Fail => ({ ok: false, status, error, message });
const ok = <T>(value: T): Result<T> => ({ ok: true, value });
const TOO_FAST = fail(429, 'rate-limited', 'Too many tries. Wait a minute and try again.');
const NO_CLASS = fail(404, 'no-class', 'We cannot find a class board for that code. Class boards are deleted 7 days after the last result.');
const BAD_KEY = fail(403, 'bad-key', 'This dashboard link is not right. Check the link, or make a new class code.');

const hash = (key: string) => createHash('sha256').update(key).digest('hex');
const newKey = () => randomBytes(16).toString('hex');
const emptyReasons = (): Record<LoseReason, number> => ({ air: 0, food: 0, dose: 0, window: 0 });

function sameKey(key: unknown, keyHash: string): boolean {
  if (!isTeacherKey(key)) return false;
  const a = Buffer.from(hash(key), 'hex');
  const b = Buffer.from(keyHash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

/** "Ava", or "Ava 2" when someone else in the class already has that name (still 12 letters at most). */
function uniqueName(name: string, taken: Set<string>): string {
  if (!taken.has(name.toLowerCase())) return name;
  for (let i = 2; i < 100; i++) {
    const tail = ` ${i}`;
    const cand = `${[...name].slice(0, CLASS_LIMITS.nameMax - tail.length).join('').trimEnd()}${tail}`;
    if (!taken.has(cand.toLowerCase())) return cand;
  }
  return name;
}

export class ClassStore {
  readonly classes = new Map<string, StoredClass>();
  private now: () => number;
  private slot: SaveSlot | null;
  private saveDelayMs: number;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private sweepTimer: ReturnType<typeof setInterval> | null = null;
  private dirty = false;
  private warned = false;
  private log: (msg: string) => void;
  private rate = {
    register: new RateLimiter(CLASS_RATE.register.max, CLASS_RATE.register.windowMs),
    report: new RateLimiter(CLASS_RATE.report.max, CLASS_RATE.report.windowMs),
    player: new RateLimiter(CLASS_RATE.player.max, CLASS_RATE.player.windowMs),
    view: new RateLimiter(CLASS_RATE.view.max, CLASS_RATE.view.windowMs),
    teacher: new RateLimiter(CLASS_RATE.teacher.max, CLASS_RATE.teacher.windowMs),
  };

  constructor(opts: ClassStoreOptions) {
    this.now = opts.now ?? Date.now;
    this.slot = opts.slot;
    this.saveDelayMs = opts.saveDelayMs ?? 2000;
    this.log = opts.log ?? ((m) => console.warn(m));
  }

  // ------------------------------------------------------------ lifecycle

  /** Read classes.json (if there is one), dropping anything expired or damaged. */
  load(): this {
    if (!this.slot) return this;
    let raw: string | null;
    try {
      raw = this.slot.read();
    } catch (e) {
      this.log(`class board: could not read ${this.slot.name} (${String(e)}); starting empty.`);
      return this;
    }
    if (raw === null) return this; // first run: nothing saved yet
    try {
      const data = JSON.parse(raw) as Partial<SaveFile>;
      if (data?.version !== 1 || !Array.isArray(data.classes)) throw new Error('not a class board file');
      const now = this.now();
      for (const c of data.classes) if (looksLikeClass(c) && !this.isExpired(c, now)) this.classes.set(c.code, c);
    } catch (e) {
      this.log(`class board: could not read ${this.slot.name} (${String(e)}); starting empty.`);
    }
    return this;
  }

  /** Expiry sweep every 10 minutes. Timers never keep the process alive. */
  start(): this {
    this.sweepTimer = setInterval(() => this.sweep(), 10 * 60 * 1000);
    this.sweepTimer.unref?.();
    return this;
  }

  /** Stop timers and save anything waiting. */
  stop() {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    this.sweepTimer = null;
    this.flush();
  }

  /** Save now if anything changed since the last save. */
  flush() {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = null;
    if (this.dirty) this.saveNow();
  }

  private changed(c?: StoredClass) {
    if (c) c.v++;
    this.dirty = true;
    if (!this.slot || this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.saveNow();
    }, this.saveDelayMs);
    this.saveTimer.unref?.();
  }

  /** Save classes.json (the slot replaces it all at once). */
  private saveNow() {
    if (!this.slot) {
      this.dirty = false;
      return;
    }
    const data: SaveFile = { version: 1, savedAt: this.now(), classes: [...this.classes.values()] };
    try {
      this.slot.write(JSON.stringify(data));
      this.dirty = false;
      this.warned = false;
    } catch (e) {
      // Keep going in memory; say so once (not on every change).
      if (!this.warned) this.log(`class board: could not save ${this.slot.name} (${String(e)}). Results are kept in memory only.`);
      this.warned = true;
    }
  }

  private isExpired(c: StoredClass, now: number) {
    return now >= expiresAt(c);
  }

  sweep() {
    const now = this.now();
    let gone = false;
    for (const c of [...this.classes.values()]) {
      if (this.isExpired(c, now)) {
        this.classes.delete(c.code);
        gone = true;
      }
    }
    for (const r of Object.values(this.rate)) r.sweep(now);
    if (gone) this.changed();
  }

  get(rawCode: string): StoredClass | undefined {
    const code = normalizeClassCode(String(rawCode ?? ''));
    if (!isClassCode(code)) return undefined;
    const c = this.classes.get(code);
    if (c && this.isExpired(c, this.now())) {
      this.classes.delete(code);
      this.changed();
      return undefined;
    }
    return c;
  }

  // ------------------------------------------------------------ requests

  /** A teacher registers the class code their game just made, and gets the secret dashboard key. */
  register(ip: string, body: { code?: unknown }): Result<RegisterResponse> {
    const now = this.now();
    if (!this.rate.register.allow(ip, now)) return TOO_FAST;
    const res = typeof body.code === 'string' ? checkClassCode(body.code) : null;
    if (!res?.ok) return fail(400, 'bad-code', 'That is not a class code.');
    if (this.get(res.code)) return fail(409, 'taken', 'That class code is already in use. Make a new one.');
    if (this.classes.size >= CLASS_LIMITS.maxClasses) this.sweep();
    if (this.classes.size >= CLASS_LIMITS.maxClasses) return fail(503, 'full', 'The class boards are full right now. Your class code still works.');
    const key = newKey();
    const c: StoredClass = { code: res.code, keyHash: hash(key), createdAt: now, lastReportAt: null, v: 1, nextNum: 1, players: [], removed: [] };
    this.classes.set(c.code, c);
    this.changed();
    return ok({ code: c.code, key, expiresAt: expiresAt(c) });
  }

  /** A student's game sends one finished crew. */
  report(rawCode: string, ip: string, body: Record<string, unknown>): Result<ReportResponse> {
    const now = this.now();
    if (!this.rate.report.allow(ip, now)) return TOO_FAST;
    const c = this.get(rawCode);
    if (!c) return NO_CLASS;
    if (isPlayerId(body.playerId) && !this.rate.player.allow(body.playerId, now)) return TOO_FAST;
    const checked = checkReport(body);
    if (!checked.ok) return fail(400, 'bad-report', `That result is not valid (${checked.field}).`);
    const r = checked.report;
    if (c.removed.includes(r.playerId)) return fail(403, 'removed', 'Your teacher took you off this class board.');

    let p = c.players.find((x) => x.id === r.playerId);
    if (!p) {
      // Someone who joined at the start of their crew keeps their number and name.
      const joined = c.joined ?? [];
      const j = joined.find((x) => x.id === r.playerId);
      if (!j && c.players.length + joined.length >= CLASS_LIMITS.maxPlayers) return fail(409, 'class-full', 'This class board is full.');
      if (j) c.joined = joined.filter((x) => x !== j);
      const crew = crewOf(r, now);
      p = {
        id: r.playerId,
        num: j ? j.num : c.nextNum++,
        name: j?.name ?? null,
        difficulty: r.difficulty,
        crews: [],
        last: crew,
        tally: { crews: 0, launched: 0, early: 0, reasons: emptyReasons(), stars: 0, best: null, built: [], sites: [] },
        fuel: null,
        seen: now,
        rids: [],
      };
      c.players.push(p);
    }

    const nameProblem = setName(c, p, body.nickname);

    if (p.rids.includes(r.rid)) {
      this.changed(c);
      return ok({ ok: true, num: p.num, name: p.name, duplicate: true, ...(nameProblem ? { nameProblem } : {}) });
    }
    if (p.tally.crews >= CLASS_LIMITS.maxReportsPerPlayer) {
      this.changed(c);
      return fail(409, 'player-full', 'This class board has all the results it can keep for you.');
    }

    const crew = crewOf(r, now);
    p.crews = [...p.crews.filter((x) => x.n !== crew.n), crew].sort((a, b) => a.n - b.n);
    p.last = crew;
    p.difficulty = r.difficulty;
    p.fuel = r.fuel;
    p.seen = now;
    p.rids = [...p.rids, r.rid].slice(-8);
    const t = p.tally;
    t.crews++;
    t.stars += crew.stars.length;
    if (crew.status === 'won') {
      t.launched++;
      if (!t.best || crew.sols < t.best.sols) t.best = { sols: crew.sols, site: crew.site };
    } else {
      t.early++;
      if (crew.loseReason) t.reasons[crew.loseReason]++;
    }
    t.built = UPGRADE_IDS.filter((id) => t.built.includes(id) || crew.built.includes(id));
    if (!t.sites.includes(crew.site)) t.sites = [...t.sites, crew.site].sort();
    c.lastReportAt = now;
    this.changed(c);
    return ok({ ok: true, num: p.num, name: p.name, ...(nameProblem ? { nameProblem } : {}) });
  }

  /**
   * A student's game starts a crew with this code, so the teacher sees them right away
   * ("playing their first crew") instead of only after a whole crew. Their first result keeps the same number.
   */
  join(rawCode: string, ip: string, body: Record<string, unknown>): Result<JoinResponse> {
    const now = this.now();
    if (!this.rate.report.allow(ip, now)) return TOO_FAST;
    const c = this.get(rawCode);
    if (!c) return NO_CLASS;
    const id = body.playerId;
    if (!isPlayerId(id)) return fail(400, 'bad-join', 'That is not a player id.');
    if (!this.rate.player.allow(id, now)) return TOO_FAST;
    if (c.removed.includes(id)) return fail(403, 'removed', 'Your teacher took you off this class board.');

    // Already on the board with results: only the name can change.
    const known = c.players.find((x) => x.id === id);
    if (known) {
      const before = known.name;
      const nameProblem = setName(c, known, body.nickname);
      if (known.name !== before) this.changed(c);
      return ok({ ok: true, num: known.num, name: known.name, ...(nameProblem ? { nameProblem } : {}) });
    }

    const joined = (c.joined ??= []);
    let j = joined.find((x) => x.id === id);
    if (!j) {
      if (c.players.length + joined.length >= CLASS_LIMITS.maxPlayers) return fail(409, 'class-full', 'This class board is full.');
      j = { id, num: c.nextNum++, name: null, seen: now };
      joined.push(j);
    }
    j.seen = now;
    const nameProblem = setName(c, j, body.nickname);
    this.changed(c);
    return ok({ ok: true, num: j.num, name: j.name, ...(nameProblem ? { nameProblem } : {}) });
  }

  /** The teacher's dashboard (the key is required). `since`: the version the page already has. */
  view(rawCode: string, ip: string, key: unknown, since?: number): Result<DashboardResponse> {
    const now = this.now();
    if (!this.rate.view.allow(ip, now)) return TOO_FAST;
    const c = this.get(rawCode);
    if (!c) return NO_CLASS;
    if (!sameKey(key, c.keyHash)) return BAD_KEY;
    if (since === c.v) return ok({ unchanged: true as const, v: c.v });
    const players: PlayerView[] = [...c.players]
      .sort((a, b) => a.num - b.num)
      .map((p) => ({ num: p.num, name: p.name, difficulty: p.difficulty, crews: p.crews, last: p.last, tally: p.tally, fuel: p.fuel, seen: p.seen }));
    const joined = [...(c.joined ?? [])].sort((a, b) => a.num - b.num).map((j) => ({ num: j.num, name: j.name, seen: j.seen }));
    return ok({ code: c.code, v: c.v, createdAt: c.createdAt, lastReportAt: c.lastReportAt, expiresAt: expiresAt(c), players, joined });
  }

  /** Teacher tools: take one student off the board, or delete every result now. */
  teacher(rawCode: string, ip: string, body: Record<string, unknown>): Result<{ ok: true; v: number }> {
    const now = this.now();
    if (!this.rate.teacher.allow(ip, now)) return TOO_FAST;
    const c = this.get(rawCode);
    if (!c) return NO_CLASS;
    if (!sameKey(body.key, c.keyHash)) return BAD_KEY;
    if (body.action === 'remove') {
      const p = c.players.find((x) => x.num === body.num) ?? c.joined?.find((x) => x.num === body.num);
      if (!p) return fail(404, 'no-player', 'That student is not on the board.');
      c.players = c.players.filter((x) => x !== p);
      c.joined = (c.joined ?? []).filter((x) => x !== p);
      c.removed = [...c.removed, p.id].slice(-CLASS_LIMITS.maxPlayers * 2);
    } else if (body.action === 'clear') {
      c.players = [];
      c.joined = [];
    } else {
      return fail(400, 'bad-action', 'Unknown teacher action.');
    }
    this.changed(c);
    return ok({ ok: true as const, v: c.v });
  }
}

/**
 * The nickname a report or join sent: a first name or nickname through the blocklist, made unique in the class
 * (against students with results and students still playing their first crew). Returns why a name was not used.
 */
function setName(c: StoredClass, self: { name: string | null }, nickname: unknown): ReportResponse['nameProblem'] {
  if (typeof nickname === 'string' && nickname.trim()) {
    const n = checkName(nickname);
    if (!n.ok) return n.problem;
    const others: Array<{ name: string | null }> = [...c.players, ...(c.joined ?? [])];
    const taken = new Set(others.filter((x) => x !== self && x.name).map((x) => x.name!.toLowerCase()));
    self.name = uniqueName(n.name, taken);
    return undefined;
  }
  if (nickname !== undefined && nickname !== null && typeof nickname !== 'string') return 'letters';
  return undefined;
}

function crewOf(r: CleanReport, at: number): CrewView {
  return {
    n: r.n,
    mode: r.mode,
    site: r.site,
    status: r.status,
    ...(r.loseReason ? { loseReason: r.loseReason } : {}),
    sols: r.sols,
    dose: r.dose,
    doseBudget: r.doseBudget,
    stars: r.stars,
    built: r.built,
    at,
  };
}

export function expiresAt(c: Pick<StoredClass, 'createdAt' | 'lastReportAt'>): number {
  return (c.lastReportAt ?? c.createdAt) + CLASS_LIMITS.expireMs;
}

/** A light check of a class read back from disk (we wrote it, but a damaged file must not crash the server). */
function looksLikeClass(x: unknown): x is StoredClass {
  const c = x as Partial<StoredClass> | null;
  return (
    !!c &&
    typeof c.code === 'string' &&
    isClassCode(c.code) &&
    typeof c.keyHash === 'string' &&
    /^[0-9a-f]{64}$/.test(c.keyHash) &&
    typeof c.createdAt === 'number' &&
    (c.lastReportAt === null || typeof c.lastReportAt === 'number') &&
    typeof c.v === 'number' &&
    typeof c.nextNum === 'number' &&
    Array.isArray(c.removed) &&
    Array.isArray(c.players) &&
    (c.joined === undefined || (Array.isArray(c.joined) && c.joined.every((j) => j && isPlayerId(j.id) && typeof j.num === 'number' && typeof j.seen === 'number'))) &&
    c.players.every((p) => p && isPlayerId(p.id) && typeof p.num === 'number' && Array.isArray(p.crews) && !!p.last && !!p.tally && Array.isArray(p.rids))
  );
}
