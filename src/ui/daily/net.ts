// Written with AI assistance (Claude Code). See README "Use of AI tools".
// The daily challenge in the browser: talking to our server, with an offline fallback.
// The player id is a random string kept in localStorage: it only lets the board keep one best score
// per browser per day. The nickname is remembered in this browser only, to fill in the box next time.

import { offlineDailyConfig } from '../../daily/pool';
import { PLAYER_ID_RE, easternDate, isDateKey, type DailyConfig, type DailySubmitRequest, type DailySubmitResponse, type DailyTop } from '../../daily/protocol';

export interface DailySession {
  config: DailyConfig;
  /** True when today's challenge came from our server, so scores can be sent. */
  online: boolean;
}

export class DailyFailure extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export const CANT_SEND = "Scores can't be sent right now. You can still play, and try again later.";

async function call<T>(path: string, init: RequestInit = {}, timeoutMs = 8000): Promise<T> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(path, { ...init, signal: ctl.signal });
  } catch {
    throw new DailyFailure(0, 'offline', CANT_SEND);
  } finally {
    clearTimeout(timer);
  }
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    /* not JSON: an old server or a page instead of the API */
  }
  if (res.ok && json !== null) return json as T;
  const e = json as { error?: unknown; message?: unknown } | null;
  // Our API explains itself in plain words; anything else (server down, no API here) means "not right now".
  if (!res.ok && typeof e?.error === 'string' && typeof e.message === 'string') throw new DailyFailure(res.status, e.error, e.message);
  throw new DailyFailure(res.status, 'offline', CANT_SEND);
}

function isConfig(x: unknown): x is DailyConfig {
  const c = x as DailyConfig;
  return !!c && isDateKey(c.date) && typeof c.seed === 'string' && (c.site === 'mars' || c.site === 'moon') && Array.isArray(c.eventPool) && typeof c.lightTimeMin === 'number';
}

export const dailyApi = {
  config: async (): Promise<DailyConfig> => {
    const c = await call<unknown>('/api/daily');
    if (!isConfig(c)) throw new DailyFailure(0, 'offline', CANT_SEND);
    return c;
  },
  top: (date: string, limit: number, player?: string | null) =>
    call<DailyTop>(`/api/daily/${encodeURIComponent(date)}/top?limit=${limit}${player ? `&player=${encodeURIComponent(player)}` : ''}`),
  submit: (date: string, body: DailySubmitRequest) =>
    call<DailySubmitResponse>(`/api/daily/${encodeURIComponent(date)}/submit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
};

/** Today's challenge from our server, or (if it can't be reached) from the bundled snapshot, labeled ARCHIVE. */
export async function loadDaily(now: Date = new Date()): Promise<DailySession> {
  try {
    return { config: await dailyApi.config(), online: true };
  } catch {
    return { config: offlineDailyConfig(easternDate(now)), online: false };
  }
}

// ---------------------------------------------------------------- this browser

const PLAYER_KEY = 'ev-daily-player';
const NICK_KEY = 'ev-daily-nickname';

function randomId(): string {
  const c = globalThis.crypto;
  const bytes = c?.getRandomValues ? c.getRandomValues(new Uint8Array(12)) : Uint8Array.from({ length: 12 }, () => Math.floor(Math.random() * 256));
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

let memoryId: string | null = null;

/** This browser's random player id (made once). */
export function playerId(): string {
  try {
    const have = localStorage.getItem(PLAYER_KEY);
    if (have && PLAYER_ID_RE.test(have)) return have;
    const id = randomId();
    localStorage.setItem(PLAYER_KEY, id);
    return id;
  } catch {
    // Private mode: one id for this visit.
    memoryId ??= randomId();
    return memoryId;
  }
}

/** The id only if this browser already has one (looking at the board never makes one). */
export function knownPlayerId(): string | null {
  try {
    const have = localStorage.getItem(PLAYER_KEY);
    return have && PLAYER_ID_RE.test(have) ? have : memoryId;
  } catch {
    return memoryId;
  }
}

export function savedNickname(): string {
  try {
    return localStorage.getItem(NICK_KEY) ?? '';
  } catch {
    return '';
  }
}

export function saveNickname(name: string | null) {
  try {
    if (name) localStorage.setItem(NICK_KEY, name);
    else localStorage.removeItem(NICK_KEY);
  } catch {
    /* fine */
  }
}
