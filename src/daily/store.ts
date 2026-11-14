// Written with AI assistance (Claude Code). See README "Use of AI tools".
// Daily challenge boards, kept by the droplet's Node server (deploy/server.ts).
// - Freezes each day's pool of real DONKI events at the day's first request (live if our proxy has it,
//   else the bundled snapshot), so everyone meets the same storms, and saves it so a restart keeps it.
// - Scores a game only by replaying its moves (src/daily/replay.ts): the browser never sends a score.
// - Stores, per player per day, only a nickname (or none) and the best score, under a hash of the
//   browser's random player id. No addresses, no times, nothing else. Keeps 14 days.
// Saved as one JSON file, `daily.json` in STATE_DIR, written atomically (temp file + rename), debounced.
// The clock, the NASA data source and the folder are passed in, so tests can control them.

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { mkdir, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { RateLimiter } from '../room/store';
import { checkName } from '../room/names';
import { NAME_PROBLEM } from '../room/protocol';
import type { Fail, Result } from '../room/room';
import { archiveEvents, dailyConfigFor, type DayEvents } from './pool';
import { REPLAY_MESSAGE, replayDaily } from './replay';
import {
  DAILY_LIMITS,
  PLAYER_ID_RE,
  ANONYMOUS,
  addDays,
  checkNicknameFormat,
  compareScores,
  easternDate,
  isDateKey,
  type DailyConfig,
  type DailyEntryView,
  type DailyScore,
  type DailySubmitResponse,
  type DailyTop,
} from './protocol';

/** One player's best game today. `id` is a hash of their random player id, never the id itself. */
export interface DailyEntry extends DailyScore {
  id: string;
  /** Null: "Anonymous astronaut". */
  name: string | null;
}

export interface DayRecord {
  config: DailyConfig;
  frozenAt: string;
  /** Best first (compareScores), at most DAILY_LIMITS.maxEntriesPerDay. */
  entries: DailyEntry[];
}

export interface DailyStoreOptions {
  /** Folder for daily.json (STATE_DIR on the droplet). Created if missing. */
  dir: string;
  /** The real events to freeze for a new day (our cached NASA DONKI proxy, else the bundled snapshot). */
  events: () => Promise<DayEvents>;
  /** One-way light time for a day, minutes (default: Earth to Mars at noon in Charlotte). */
  lightTimeMin?: (date: string) => number;
  now?: () => number;
  /** Bundle saves this long, ms. */
  saveDelayMs?: number;
  maxEntriesPerDay?: number;
}

export const DAILY_RATE = {
  /** A whole school can share one address, so sending scores is generous. */
  submit: { max: 60, windowMs: 10 * 60 * 1000 },
  read: { max: 300, windowMs: 60 * 1000 },
} as const;

const FILE = 'daily.json';
const fail = (status: number, error: string, message: string): Fail => ({ ok: false, status, error, message });
const ok = <T>(value: T): Result<T> => ({ ok: true, value });
const TOO_FAST = fail(429, 'rate-limited', 'Too many tries. Wait a minute and try again.');

function hashId(playerId: string): string {
  return createHash('sha256').update(`ev-daily:${playerId}`).digest('hex').slice(0, 32);
}

function view(e: DailyEntry, i: number): DailyEntryView {
  return { rank: i + 1, nickname: e.name ?? ANONYMOUS, won: e.won, sols: e.sols, dose: e.dose, stars: e.stars, fuel: e.fuel };
}

function isEntry(x: unknown): x is DailyEntry {
  const e = x as DailyEntry;
  return (
    !!e &&
    typeof e.id === 'string' &&
    (e.name === null || typeof e.name === 'string') &&
    typeof e.won === 'boolean' &&
    [e.sols, e.dose, e.stars, e.fuel].every((n) => typeof n === 'number' && Number.isFinite(n))
  );
}

function isDayRecord(date: string, x: unknown): x is DayRecord {
  const r = x as DayRecord;
  return (
    isDateKey(date) &&
    !!r?.config &&
    r.config.date === date &&
    typeof r.config.seed === 'string' &&
    Array.isArray(r.config.eventPool) &&
    Array.isArray(r.entries) &&
    r.entries.every(isEntry)
  );
}

export class DailyStore {
  readonly days = new Map<string, DayRecord>();
  private freezing = new Map<string, Promise<DayRecord>>();
  private loaded = false;
  private dirty = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private writing: Promise<void> = Promise.resolve();
  private seq = 0;
  private warned = false;
  private now: () => number;
  private rate = {
    submit: new RateLimiter(DAILY_RATE.submit.max, DAILY_RATE.submit.windowMs),
    read: new RateLimiter(DAILY_RATE.read.max, DAILY_RATE.read.windowMs),
  };

  constructor(private opts: DailyStoreOptions) {
    this.now = opts.now ?? Date.now;
  }

  get file(): string {
    return join(this.opts.dir, FILE);
  }

  /** Today in Charlotte, NC (YYYY-MM-DD). */
  today(): string {
    return easternDate(new Date(this.now()));
  }

  /** Read daily.json (once, on first use). No file is a fresh start; a damaged one is set aside, not overwritten. */
  load(): this {
    if (this.loaded) return this;
    this.loaded = true;
    let text: string;
    try {
      text = readFileSync(this.file, 'utf8');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') console.error(`daily: could not read ${this.file}: ${(e as Error).message}`);
      return this;
    }
    try {
      const data = JSON.parse(text) as { version?: number; days?: Record<string, unknown> };
      for (const [date, rec] of Object.entries(data?.days ?? {})) if (isDayRecord(date, rec)) this.days.set(date, rec);
    } catch (e) {
      console.error(`daily: ${this.file} is damaged, starting fresh: ${(e as Error).message}`);
      try {
        renameSync(this.file, `${this.file}.damaged-${this.now()}`);
      } catch {
        /* leave it */
      }
    }
    this.prune();
    return this;
  }

  /** Forget days older than DAILY_LIMITS.keepDays (today counts as one). */
  private prune() {
    const oldest = addDays(this.today(), -(DAILY_LIMITS.keepDays - 1));
    let changed = false;
    for (const date of [...this.days.keys()]) {
      if (date < oldest) {
        this.days.delete(date);
        changed = true;
      }
    }
    if (changed) this.saveSoon();
  }

  allowRead(ip: string): boolean {
    return this.rate.read.allow(ip, this.now());
  }

  /** Today's challenge. The day's first call freezes the pool; every later call (and restart) gets the same one. */
  async config(date = this.today()): Promise<DailyConfig> {
    this.load();
    const have = this.days.get(date);
    if (have) return have.config;
    let freezing = this.freezing.get(date);
    if (!freezing) {
      freezing = this.freeze(date).finally(() => this.freezing.delete(date));
      this.freezing.set(date, freezing);
    }
    return (await freezing).config;
  }

  private async freeze(date: string): Promise<DayRecord> {
    const events = await this.opts.events().catch(() => archiveEvents());
    const have = this.days.get(date);
    if (have) return have;
    const rec: DayRecord = {
      config: dailyConfigFor(date, events, this.opts.lightTimeMin?.(date)),
      frozenAt: new Date(this.now()).toISOString(),
      entries: [],
    };
    this.days.set(date, rec);
    this.prune();
    // Save right away: a restart must never change today's storms.
    this.dirty = true;
    void this.flush();
    return rec;
  }

  /** Check, replay and score one finished game, and keep it if it is this player's best today. */
  submit(date: string, ip: string, body: Record<string, unknown>): Result<DailySubmitResponse> {
    this.load();
    if (!this.rate.submit.allow(ip, this.now())) return TOO_FAST;
    const today = this.today();
    // A game started just before midnight can still be sent the next day.
    if (!isDateKey(date) || date > today) return fail(404, 'no-day', 'That daily challenge is not open.');
    if (date < addDays(today, -1)) return fail(410, 'closed', "That day's challenge is over. Play today's challenge!");
    const rec = this.days.get(date);
    if (!rec) return fail(404, 'no-day', 'That daily challenge is not open.');

    const { playerId, nickname, moves } = body;
    if (typeof playerId !== 'string' || !PLAYER_ID_RE.test(playerId)) return fail(400, 'bad-player', 'Something went wrong. Reload the game and try again.');
    const nick = checkNicknameFormat(nickname);
    if (!nick.ok) return fail(400, 'bad-name', nick.message);
    if (nick.nickname && !checkName(nick.nickname).ok) return fail(400, 'bad-name', NAME_PROBLEM.blocked);

    const r = replayDaily(rec.config, moves);
    if (!r.ok) return fail(422, r.problem, REPLAY_MESSAGE[r.problem]);

    const id = hashId(playerId);
    const entry: DailyEntry = { id, name: nick.nickname, ...r.score };
    const list = rec.entries;
    const at = list.findIndex((e) => e.id === id);
    let improved = false;
    if (at >= 0) {
      if (compareScores(entry, list[at]) < 0) {
        list.splice(at, 1);
        improved = true;
      }
    } else {
      const max = this.opts.maxEntriesPerDay ?? DAILY_LIMITS.maxEntriesPerDay;
      if (list.length >= max) {
        if (compareScores(entry, list[list.length - 1]) >= 0) {
          return fail(409, 'board-full', "Today's board is full, and this score is not in the top " + max + '. Try again!');
        }
        list.splice(max - 1);
      }
      improved = true;
    }
    if (improved) {
      // Keep the list sorted; equal scores stay in the order they arrived.
      let i = list.findIndex((e) => compareScores(entry, e) < 0);
      if (i < 0) i = list.length;
      list.splice(i, 0, entry);
      this.saveSoon();
    }
    const mine = list.findIndex((e) => e.id === id);
    return ok({ ok: true, date, improved, score: r.score, you: view(list[mine], mine), total: list.length });
  }

  /** The best players of a day, plus the asking player's own rank. */
  top(date: string, limit: number = DAILY_LIMITS.topDefault, playerId?: string | null): Result<DailyTop> {
    this.load();
    if (!isDateKey(date)) return fail(400, 'bad-date', 'That is not a date.');
    const entries = this.days.get(date)?.entries ?? [];
    const n = Math.max(1, Math.min(DAILY_LIMITS.topMax, Number.isFinite(limit) ? Math.floor(limit) : DAILY_LIMITS.topDefault));
    let you: DailyEntryView | null = null;
    if (playerId && PLAYER_ID_RE.test(playerId)) {
      const id = hashId(playerId);
      const i = entries.findIndex((e) => e.id === id);
      if (i >= 0) you = view(entries[i], i);
    }
    return ok({ date, total: entries.length, top: entries.slice(0, n).map(view), you });
  }

  // ---------------------------------------------------------------- saving

  private serialize(): string {
    return JSON.stringify({ version: 1, days: Object.fromEntries([...this.days].sort(([a], [b]) => (a < b ? -1 : 1))) });
  }

  private saveSoon() {
    this.dirty = true;
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, this.opts.saveDelayMs ?? 1000);
    this.timer.unref?.();
  }

  /** Write daily.json now (after any write already under way). */
  flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.writing = this.writing.then(() => this.writeNow());
    return this.writing;
  }

  private async writeNow() {
    if (!this.dirty) return;
    this.dirty = false;
    const text = this.serialize();
    const tmp = `${this.file}.${process.pid}.${++this.seq}.tmp`;
    try {
      await mkdir(this.opts.dir, { recursive: true });
      await writeFile(tmp, text, 'utf8');
      await rename(tmp, this.file);
      this.warned = false;
    } catch (e) {
      this.dirty = true;
      if (!this.warned) console.error(`daily: could not save ${this.file} (boards stay in memory): ${(e as Error).message}`);
      this.warned = true;
      await unlink(tmp).catch(() => undefined);
    }
  }

  /** Write daily.json right now, synchronously (when the process is stopping). */
  flushSync() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (!this.dirty) return;
    const tmp = `${this.file}.${process.pid}.${++this.seq}.tmp`;
    try {
      mkdirSync(this.opts.dir, { recursive: true });
      writeFileSync(tmp, this.serialize(), 'utf8');
      renameSync(tmp, this.file);
      this.dirty = false;
    } catch (e) {
      console.error(`daily: could not save ${this.file}: ${(e as Error).message}`);
      try {
        unlinkSync(tmp);
      } catch {
        /* nothing to clean up */
      }
    }
  }

  /** Stop the save timer and save anything not yet written. */
  close() {
    this.flushSync();
  }
}

/** Save the boards before the process stops (systemd sends SIGTERM on every deploy). */
export function flushOnExit(store: DailyStore) {
  process.once('exit', () => store.flushSync());
  for (const sig of ['SIGTERM', 'SIGINT'] as const) {
    const onSignal = () => {
      store.flushSync();
      process.off(sig, onSignal);
      // Nobody else handles this signal: stop the way Node would have without us.
      if (process.listenerCount(sig) === 0) process.kill(process.pid, sig);
    };
    process.on(sig, onSignal);
  }
}
