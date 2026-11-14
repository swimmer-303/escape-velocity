// Written with AI assistance (Claude Code). See README "Use of AI tools".
// Mission Control in the browser: talking to the room server.
// Moves go out as small JSON POSTs (one at a time, in order); the room comes back over one
// Server-Sent Events stream that reconnects by itself. Tokens live in sessionStorage only,
// so a refresh rejoins the same player and closing the tab forgets them.

import type {
  ApiError,
  ClosedReason,
  CreateRoomRequest,
  CreateRoomResponse,
  JoinRequest,
  JoinResponse,
  PlayerAction,
  RoomView,
  TeacherAction,
} from '../../room/protocol';

export class ApiFailure extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

async function post<T>(path: string, body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  } catch {
    throw new ApiFailure(0, 'offline', 'Could not reach Mission Control. Check the internet connection and try again.');
  }
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    /* not JSON */
  }
  if (!res.ok) {
    const e = (json ?? {}) as Partial<ApiError>;
    const fallback = res.status === 404 ? "We can't find that room. Check the code on the board." : 'Something went wrong. Try again.';
    throw new ApiFailure(res.status, e.error ?? 'error', e.message ?? fallback);
  }
  return json as T;
}

const enc = encodeURIComponent;

export const api = {
  create: (req: CreateRoomRequest) => post<CreateRoomResponse>('/api/rooms', req),
  join: (code: string, req: JoinRequest) => post<JoinResponse>(`/api/rooms/${enc(code)}/join`, req),
  action: (code: string, token: string, a: PlayerAction) => post<{ ok: true; v: number }>(`/api/rooms/${enc(code)}/action`, { ...a, token }),
  teacher: (code: string, teacherToken: string, a: TeacherAction) => post<{ ok: true; v: number }>(`/api/rooms/${enc(code)}/teacher`, { ...a, teacherToken }),
  async exists(code: string): Promise<boolean | null> {
    try {
      const res = await fetch(`/api/rooms/${enc(code)}`);
      return res.ok ? true : res.status === 404 ? false : null;
    } catch {
      return null;
    }
  },
};

/** Sends moves one at a time, in order, so the server sees them exactly as the player made them. */
export class ActionQueue {
  private chain: Promise<unknown> = Promise.resolve();
  pending = 0;
  push<T>(job: () => Promise<T>): Promise<T> {
    this.pending++;
    const run = this.chain.then(job, job).finally(() => this.pending--);
    this.chain = run.catch(() => undefined);
    return run;
  }
}

// ---------------------------------------------------------------- saved seats

export interface Seat {
  playerId: string;
  token: string;
  name: string;
}

function read<T>(key: string): T | null {
  try {
    const raw = sessionStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}
function write(key: string, v: unknown) {
  try {
    if (v === null) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* private mode: reconnecting after a refresh just won't work */
  }
}

export const seats = {
  player: (code: string) => read<Seat>(`ev-room-player:${code}`),
  setPlayer: (code: string, s: Seat | null) => write(`ev-room-player:${code}`, s),
  teacher: (code: string) => read<string>(`ev-room-teacher:${code}`),
  setTeacher: (code: string, t: string | null) => write(`ev-room-teacher:${code}`, t),
};

// ---------------------------------------------------------------- the live stream

export type LinkStatus = 'live' | 'reconnecting';

export interface LiveHandlers {
  state(v: RoomView): void;
  closed(reason: ClosedReason | 'gone'): void;
  status(s: LinkStatus): void;
}

/** No message (state or heartbeat) for this long means the link is dead: reconnect. */
const STALE_MS = 50_000;

export function openLive(code: string, auth: { token: string } | { teacher: string }, on: LiveHandlers): { close(): void } {
  const q = 'token' in auth ? `token=${enc(auth.token)}` : `teacher=${enc(auth.teacher)}`;
  const url = `/api/rooms/${enc(code)}/events?${q}`;
  let es: EventSource | null = null;
  let last = Date.now();
  let stopped = false;
  let lastV = 0;
  let retry: ReturnType<typeof setTimeout> | undefined;

  const finish = (reason: ClosedReason | 'gone') => {
    if (stopped) return;
    stop();
    on.closed(reason);
  };

  const connect = () => {
    if (stopped) return;
    es?.close();
    es = new EventSource(url);
    last = Date.now();
    es.addEventListener('open', () => on.status('live'));
    es.addEventListener('state', (e) => {
      last = Date.now();
      on.status('live');
      try {
        const v = JSON.parse((e as MessageEvent<string>).data) as RoomView;
        if (v.v >= lastV) {
          lastV = v.v;
          on.state(v);
        }
      } catch {
        /* ignore a broken message */
      }
    });
    es.addEventListener('heartbeat', () => {
      last = Date.now();
    });
    es.addEventListener('closed', (e) => {
      let reason: ClosedReason | 'gone' = 'gone';
      try {
        reason = (JSON.parse((e as MessageEvent<string>).data) as { reason: ClosedReason }).reason;
      } catch {
        /* keep 'gone' */
      }
      finish(reason);
    });
    es.addEventListener('error', () => {
      if (stopped) return;
      on.status('reconnecting');
      // CONNECTING: the browser retries by itself. CLOSED: the server said no (room gone, or we were removed).
      if (es?.readyState === EventSource.CLOSED) {
        void api.exists(code).then((exists) => {
          if (stopped) return;
          if (exists === false) finish('ended');
          else if (exists === true) finish('gone');
          else retry = setTimeout(connect, 3000);
        });
      }
    });
  };

  const watchdog = setInterval(() => {
    if (!stopped && Date.now() - last > STALE_MS) {
      on.status('reconnecting');
      connect();
    }
  }, 10_000);

  function stop() {
    stopped = true;
    clearInterval(watchdog);
    if (retry) clearTimeout(retry);
    es?.close();
    es = null;
  }

  connect();
  return { close: stop };
}
