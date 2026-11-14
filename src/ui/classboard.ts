// Written with AI assistance (Claude Code). See README "Use of AI tools".
// The game's side of the teacher dashboard (class board):
//  - a teacher's "Make a code" also registers the code and gets a secret dashboard key;
//  - after each crew, a game with a class code sends one small result (quietly, with retries
//    from a small outbox in localStorage; it never blocks or slows the game);
//  - the first time, the end screen asks for a nickname for the class board (or "Skip").
// What is sent: a random player id, the nickname (if given) and game numbers. Nothing else.

import { h, clear } from './dom';
import { resultFor } from '../sim/campaign';
import type { MissionState } from '../sim/types';
import { checkName } from '../room/names';
import { NAME_PROBLEM } from '../room/protocol';
import { dashboardLink, isTeacherKey, type RegisterResponse, type ReportMode, type ReportRequest, type ReportResponse } from '../class/protocol';

const ME_KEY = 'ev-class-me';
const OUTBOX_KEY = 'ev-class-outbox';
const TEACHER_KEY = 'ev-class-keys';
/** Wait this long before each retry, ms. After the last one the result is dropped. */
const RETRY_MS = [3_000, 10_000, 30_000, 60_000, 120_000, 300_000];
const MAX_OUTBOX = 12;
const MAX_CODES = 8;

// ---------------------------------------------------------------- small storage helpers

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private mode or storage full: the game still works */
  }
}
/** Keep only the newest few codes in a {code: value} record. */
function newest<T extends { at: number }>(rec: Record<string, T>): Record<string, T> {
  return Object.fromEntries(
    Object.entries(rec)
      .sort((a, b) => b[1].at - a[1].at)
      .slice(0, MAX_CODES),
  );
}

function hex(bytes: number): string {
  const a = new Uint8Array(bytes);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(a);
  else for (let i = 0; i < bytes; i++) a[i] = Math.floor(Math.random() * 256);
  return [...a].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ---------------------------------------------------------------- teachers

/** Register a class code for the dashboard. 'taken' = make a different code; null = no dashboard (offline, full...). */
export async function registerClass(code: string): Promise<RegisterResponse | 'taken' | null> {
  try {
    const res = await fetch('/api/class', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code }) });
    if (res.status === 409) return 'taken';
    if (res.status !== 201) return null;
    const json = (await res.json()) as RegisterResponse;
    if (json?.code !== code || !isTeacherKey(json.key)) return null;
    rememberTeacherKey(code, json.key);
    return json;
  } catch {
    return null;
  }
}

type KeyRecord = Record<string, { key: string; at: number }>;

/** The dashboard key for a code this device registered (so the link is not lost when the panel closes). */
export function teacherKeyFor(code: string | null | undefined): string | null {
  if (!code) return null;
  const k = readJson<KeyRecord>(TEACHER_KEY, {})[code]?.key;
  return isTeacherKey(k) ? k : null;
}
export function rememberTeacherKey(code: string, key: string) {
  writeJson(TEACHER_KEY, newest({ ...readJson<KeyRecord>(TEACHER_KEY, {}), [code]: { key, at: Date.now() } }));
}

/** The "Teacher dashboard" box: a private link with Copy and Open. */
export function dashboardBox(code: string, key: string, sfx?: () => void): HTMLElement {
  const link = dashboardLink(code, key, location.origin);
  const linkBox = h('input', { class: 'cc-link-text', type: 'text', readonly: true, value: link, 'aria-label': 'Teacher dashboard link', onfocus: (e: Event) => (e.target as HTMLInputElement).select() });
  const status = h('p', { class: 'cc-msg', role: 'status' });
  const copy = async () => {
    sfx?.();
    try {
      await navigator.clipboard.writeText(link);
      status.textContent = 'Dashboard link copied. Keep it somewhere private.';
    } catch {
      linkBox.focus();
      linkBox.select();
      status.textContent = 'The link is selected: copy it with Ctrl+C (or Cmd+C on a Mac).';
    }
  };
  return h(
    'div',
    { class: 'cc-dash' },
    h('div', { class: 'kicker' }, 'Teacher dashboard'),
    h('p', null, "See your class's results live: who launched, what went wrong, and what they built. Open it on your screen or the projector."),
    h(
      'div',
      { class: 'cc-row' },
      linkBox,
      h('button', { class: 'btn small cc-dash-copy', onclick: () => void copy() }, 'Copy'),
      h('a', { class: 'btn small cc-dash-open', href: link, target: '_blank', rel: 'noopener' }, 'Open'),
    ),
    status,
    h('p', { class: 'title-foot' }, 'Keep this link private: anyone with it can see the class board. Do not share it with students.'),
  );
}

// ---------------------------------------------------------------- students

interface Me {
  /** Random id for this class code on this device. */
  id: string;
  /** The nickname the student chose (null = skipped or not asked yet). */
  nick: string | null;
  /** The student answered the nickname question (saved a name or pressed Skip). */
  asked: boolean;
  /** Their number in the class ("Player 3"), once the server answered. */
  num?: number;
  /** The name the class board shows. */
  name?: string | null;
  at: number;
}

interface OutboxItem {
  code: string;
  body: ReportRequest;
  tries: number;
  /** Not before this time (ms). */
  next: number;
}

type CardState = { problem?: string; saved?: boolean };

export class ClassBoardClient {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private sending = false;
  /** Codes the server said have no class board (typed by students but never registered). */
  private unregistered = new Set<string>();
  /** The last result sent for each code, so a nickname can be added to it afterwards. */
  private lastBody = new Map<string, ReportRequest>();
  private cards = new Set<{ code: string; el: HTMLElement; state: CardState }>();

  constructor() {
    // Results left over from last time (offline, or the page closed before they went out).
    if (typeof window !== 'undefined') {
      setTimeout(() => void this.flush(), 4000);
      window.addEventListener?.('online', () => void this.flush());
    }
  }

  private me(code: string): Me {
    const all = readJson<Record<string, Me>>(ME_KEY, {});
    let me = all[code];
    if (!me || typeof me.id !== 'string' || !/^[0-9a-f]{24}$/.test(me.id)) {
      me = { id: hex(12), nick: null, asked: false, at: Date.now() };
      writeJson(ME_KEY, newest({ ...all, [code]: me }));
    }
    return me;
  }

  private saveMe(code: string, patch: Partial<Me>) {
    const all = readJson<Record<string, Me>>(ME_KEY, {});
    const me = { ...this.me(code), ...patch, at: Date.now() };
    writeJson(ME_KEY, newest({ ...all, [code]: me }));
  }

  /** Send one finished crew for a class code. Returns at once; sending happens in the background. */
  report(code: string | null | undefined, m: MissionState, mode: ReportMode) {
    if (!code || this.unregistered.has(code)) return;
    const me = this.me(code);
    const r = resultFor(m);
    const fuel = r.series?.fuel ?? [];
    const body: ReportRequest = {
      playerId: me.id,
      rid: hex(8),
      nickname: me.nick,
      mode,
      site: m.config.site === 'moon' ? 'moon' : 'mars',
      difficulty: m.config.difficulty,
      n: mode === 'quick' ? 1 : r.n,
      status: r.status,
      loseReason: r.status === 'lost' ? (r.loseReason ?? null) : null,
      sols: r.sols,
      dose: Math.round(r.dose * 10) / 10,
      doseBudget: r.doseBudget,
      stars: r.stars,
      built: r.built.slice(0, 16),
      series: fuel.length === r.sols + 1 ? { fuel: fuel.map((v) => Math.max(0, Math.min(100, Math.round(v)))) } : null,
    };
    this.lastBody.set(code, body);
    this.enqueue(code, body);
  }

  private outbox(): OutboxItem[] {
    const box = readJson<OutboxItem[]>(OUTBOX_KEY, []);
    return Array.isArray(box) ? box.filter((i) => i && typeof i.code === 'string' && i.body) : [];
  }

  private enqueue(code: string, body: ReportRequest) {
    const box = this.outbox().filter((i) => !(i.code === code && i.body.rid === body.rid));
    box.push({ code, body, tries: 0, next: 0 });
    writeJson(OUTBOX_KEY, box.slice(-MAX_OUTBOX));
    void this.flush();
  }

  private schedule() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const box = this.outbox();
    if (!box.length) return;
    const wait = Math.max(1000, Math.min(...box.map((i) => i.next)) - Date.now());
    this.timer = setTimeout(() => void this.flush(), wait);
  }

  /** Send everything that is due. Errors are quiet: the game never waits for this. */
  async flush(): Promise<void> {
    if (this.sending) return;
    this.sending = true;
    try {
      for (const item of this.outbox()) {
        if (item.next > Date.now()) continue;
        const outcome = this.unregistered.has(item.code) ? 'done' : await this.send(item);
        const box = this.outbox();
        const i = box.findIndex((x) => x.code === item.code && x.body.rid === item.body.rid);
        if (i < 0) continue;
        if (outcome === 'retry' && box[i].tries + 1 < RETRY_MS.length) {
          box[i] = { ...box[i], tries: box[i].tries + 1, next: Date.now() + RETRY_MS[box[i].tries] };
        } else {
          box.splice(i, 1);
        }
        writeJson(OUTBOX_KEY, box);
      }
    } finally {
      this.sending = false;
      this.schedule();
    }
  }

  private async send(item: OutboxItem): Promise<'done' | 'retry'> {
    let res: Response;
    try {
      res = await fetch(`/api/class/${encodeURIComponent(item.code)}/report`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(item.body) });
    } catch {
      return 'retry';
    }
    if (res.status === 429 || res.status >= 500) return 'retry';
    if (res.ok) {
      try {
        const json = (await res.json()) as ReportResponse;
        // A nickname the server would not use: forget it and ask again.
        this.saveMe(item.code, { num: json.num, name: json.name, ...(json.nameProblem ? { nick: null, asked: false } : {}) });
        this.update(item.code, json.nameProblem ? { problem: NAME_PROBLEM[json.nameProblem], saved: false } : undefined);
      } catch {
        /* ignore */
      }
      return 'done';
    }
    // 404: a code that was never registered (or has expired). 403/409/400: never going to work.
    if (res.status === 404 || res.status === 403) {
      this.unregistered.add(item.code);
      this.saveMe(item.code, { num: undefined });
      this.update(item.code);
    }
    return 'done';
  }

  // ------------------------------------------------------------ the nickname card

  /** The class board card for an end screen: asks for a nickname once, then says how results show up. */
  card(code: string | null | undefined): HTMLElement | null {
    if (!code) return null;
    const entry = { code, el: h('div', { class: 'cb-card-slot' }), state: {} as CardState };
    this.cards.add(entry);
    this.draw(entry);
    return entry.el;
  }

  /** Redraw this code's cards (answers arrive after the end screen is already on the page). */
  private update(code: string, state?: CardState) {
    for (const c of [...this.cards]) {
      if (!c.el.isConnected) {
        this.cards.delete(c); // that screen is gone
        continue;
      }
      if (c.code !== code) continue;
      if (state) c.state = { ...c.state, ...state };
      this.draw(c);
    }
  }

  private draw(entry: { code: string; el: HTMLElement; state: CardState }) {
    const { code, el, state } = entry;
    clear(el);
    const all = readJson<Record<string, Me>>(ME_KEY, {});
    const me = all[code];
    // Only once the server has said this class has a board.
    if (!me || me.num === undefined || this.unregistered.has(code)) return;
    const shown = me.name ?? `Player ${me.num}`;
    if (me.asked && !state.problem) {
      el.append(
        h(
          'p',
          { class: 'card cb-card cb-note', role: 'status' },
          h('b', null, 'Class board: '),
          state.saved ? `Thanks! Your results show on your teacher's class board as ${shown}.` : `your results show on your teacher's class board as ${shown}.`,
        ),
      );
      return;
    }
    const input = h('input', {
      id: 'cb-name-input',
      class: 'cc-input cb-name',
      type: 'text',
      maxlength: 12,
      autocomplete: 'off',
      spellcheck: 'false',
      value: me.nick ?? '',
      placeholder: 'Nickname',
      'aria-describedby': 'cb-msg',
      onkeydown: (e: KeyboardEvent) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          save();
        }
      },
    });
    const msg = h('p', { id: 'cb-msg', class: `cc-msg ${state.problem ? 'bad' : ''}`, role: 'status' }, state.problem ?? '');
    const save = () => {
      const res = checkName(input.value);
      if (!res.ok) {
        entry.state = { problem: NAME_PROBLEM[res.problem] };
        this.draw(entry);
        el.querySelector<HTMLElement>('#cb-name-input')?.focus();
        return;
      }
      this.setNickname(code, res.name);
      entry.state = { saved: true };
      this.draw(entry);
    };
    const skip = () => {
      this.saveMe(code, { asked: true });
      entry.state = {};
      this.draw(entry);
    };
    el.append(
      h(
        'section',
        { class: 'card cb-card', 'aria-label': 'Class board nickname' },
        h('div', { class: 'kicker' }, "Your teacher's class board"),
        h('label', { for: 'cb-name-input' }, 'Your teacher can see how your crews did. Type a nickname or your first name for the class board.'),
        h('div', { class: 'cc-row' }, input, h('button', { class: 'btn small go', onclick: save }, 'Save name'), h('button', { class: 'btn small', onclick: skip }, 'Skip')),
        msg,
        h('p', { class: 'title-foot' }, `Only your nickname and your game results are sent. Skip, and you show up as ${`Player ${me.num}`}.`),
      ),
    );
  }

  /** Save the nickname and add it to the latest result (the server updates the name, it does not count the result twice). */
  setNickname(code: string, name: string) {
    this.saveMe(code, { nick: name, asked: true, name });
    const box = this.outbox();
    const pending = box.filter((i) => i.code === code);
    if (pending.length) {
      for (const i of pending) i.body = { ...i.body, nickname: name };
      writeJson(OUTBOX_KEY, box);
      void this.flush();
      return;
    }
    const last = this.lastBody.get(code);
    if (last) this.enqueue(code, { ...last, nickname: name });
  }
}

/** One per page. */
export const classBoard = new ClassBoardClient();
