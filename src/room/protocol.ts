// Written with AI assistance (Claude Code). See README "Use of AI tools".
// Mission Control (class team play): what the browser and the server agree on.
// One shared Mars base for the whole class. The modules are split between up to 4 stations;
// everyone sees the whole plan and the shared pool of power cells, but each student can only
// move cells in their own station's modules. No free-text chat: only preset "pings".
// Imported by the game (src/ui/room) and by the droplet's server (src/room/http.ts).

import type { Difficulty } from '../sim/constants';
import type { ExpeditionResult } from '../sim/campaign';
import type { Allocation, CrateId, MissionState, ModuleId, SolReport } from '../sim/types';
import type { UpgradeId } from '../sim/upgrades';

export type StationId = 'o2' | 'green' | 'rad' | 'shop';
export const STATION_IDS: readonly StationId[] = ['o2', 'green', 'rad', 'shop'];

export interface StationDef {
  id: StationId;
  name: string;
  modules: readonly ModuleId[];
  /** One plain sentence: what this station does. */
  job: string;
}

export const STATIONS: Record<StationId, StationDef> = {
  o2: { id: 'o2', name: 'O2 Plant', modules: ['air', 'fuel'], job: 'You make AIR for the crew and FUEL for the rocket home. Same machine, two jobs.' },
  green: { id: 'green', name: 'Greenhouse and Heat', modules: ['greenhouse', 'heaters'], job: 'You grow food and keep the batteries warm through the freezing night.' },
  rad: { id: 'rad', name: 'Radiation', modules: ['shelter', 'monitor'], job: 'You power the storm shelter and the radiation monitor. Watch out for solar storms.' },
  shop: {
    id: 'shop',
    name: 'Workshop and Battery',
    modules: ['build', 'battery'],
    job: 'You build upgrades for the base, store power in the battery, and choose the cargo crate.',
  },
};

export const STATION_OF: Record<ModuleId, StationId> = {
  air: 'o2',
  fuel: 'o2',
  greenhouse: 'green',
  heaters: 'green',
  shelter: 'rad',
  monitor: 'rad',
  build: 'shop',
  battery: 'shop',
};

/** The room code in a join link like `?room=K7RZQ` (as typed; checked when joining), or null. */
export function roomParam(search: string): string | null {
  const raw = new URLSearchParams(search).get('room');
  return raw ? raw.trim().slice(0, 12) : null;
}

export function isStationId(x: unknown): x is StationId {
  return typeof x === 'string' && (STATION_IDS as readonly string[]).includes(x);
}

/** Preset messages instead of chat: shown with the sender's name and station for a few seconds. */
export type PingId = 'cells' | 'spare' | 'storm' | 'low' | 'wait' | 'ready';
export const PINGS: Record<PingId, string> = {
  cells: 'I need more cells!',
  spare: 'I can give a cell back.',
  storm: 'Storm warning: shelter!',
  low: 'Air or food is low!',
  wait: "Wait, let's talk!",
  ready: 'Ready!',
};
export const PING_IDS = Object.keys(PINGS) as PingId[];
export function isPingId(x: unknown): x is PingId {
  return typeof x === 'string' && x in PINGS;
}

export type RoomPhase = 'lobby' | 'briefing' | 'plan' | 'debrief' | 'end';
/** quick = one crew; campaign = three crews, the base carries over. */
export type RoomMode = 'quick' | 'campaign';

export const LIMITS = {
  maxRooms: 200,
  maxPlayers: 40,
  /** Rooms close after this long with nothing happening. */
  idleMs: 3 * 60 * 60 * 1000,
  nameMax: 12,
  /** Largest request body the server reads, bytes. */
  maxBody: 2048,
  /** Pings stay on screen this long. */
  pingShowMs: 6000,
  /** One ping per player this often. */
  pingGapMs: 2000,
  heartbeatMs: 20_000,
} as const;

// ---------------------------------------------------------------- names

export type NameProblem = 'empty' | 'long' | 'letters' | 'blocked' | 'taken';
export const NAME_PROBLEM: Record<NameProblem, string> = {
  empty: 'Type your first name or a nickname.',
  long: `Use ${LIMITS.nameMax} letters or fewer.`,
  letters: 'Use only letters, numbers and spaces.',
  blocked: 'Please choose a different name.',
  taken: 'Someone in this room already has that name. Add a letter or a number.',
};

/** Tidy a typed name: trim, and squeeze runs of spaces. */
export function tidyName(raw: string): string {
  return String(raw ?? '')
    .normalize('NFC')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Letters (including accented Latin letters), numbers and single spaces only. */
const NAME_RE = /^[A-Za-z0-9\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u017F ]+$/;

/** Format check only (the server also checks a small blocklist). */
export function checkNameFormat(raw: string): { ok: true; name: string } | { ok: false; problem: NameProblem } {
  const name = tidyName(raw);
  if (!name) return { ok: false, problem: 'empty' };
  if ([...name].length > LIMITS.nameMax) return { ok: false, problem: 'long' };
  if (!NAME_RE.test(name)) return { ok: false, problem: 'letters' };
  return { ok: true, name };
}

// ---------------------------------------------------------------- what the server sends

export interface PlayerView {
  id: string;
  name: string;
  stations: StationId[];
  ready: boolean;
  /** Has the room open right now. */
  online: boolean;
}

export interface PingView {
  /** Increasing number: show each ping once. */
  n: number;
  from: string;
  stations: StationId[];
  ping: PingId;
}

/** The public room state, pushed to every screen on every change. Never contains a token. */
export interface RoomView {
  code: string;
  /** Goes up by one on every change. */
  v: number;
  phase: RoomPhase;
  difficulty: Difficulty;
  mode: RoomMode;
  /** Crew number (1-based) and how many crews this room plays. */
  expedition: number;
  crews: number;
  players: PlayerView[];
  /** The shared mission (null in the lobby). Its config.eventPool is left out to keep messages small. */
  mission: MissionState | null;
  alloc: Allocation;
  crate: CrateId | null;
  /** The last sol's report, for the shared debrief. */
  report: SolReport | null;
  /** Finished crews so far (campaign). */
  results: ExpeditionResult[];
  pings: PingView[];
  autoRun: boolean;
  /** Where the solar storms come from. */
  data: { status: 'live' | 'archive'; fetchedAt: string | null; startDate: string | null; endDate: string | null };
}

// ---------------------------------------------------------------- what the browser sends

export type PlayerAction =
  | { type: 'place'; module: ModuleId }
  | { type: 'remove'; module: ModuleId }
  | { type: 'move'; from: ModuleId; to: ModuleId }
  | { type: 'project'; project: UpgradeId }
  | { type: 'crate'; crate: CrateId }
  | { type: 'ready'; ready: boolean }
  | { type: 'ping'; ping: PingId }
  | { type: 'leave' };

export type TeacherAction =
  | { type: 'start' }
  | { type: 'plan' }
  | { type: 'run' }
  | { type: 'next' }
  | { type: 'restart' }
  | { type: 'assign'; playerId: string; station: StationId }
  | { type: 'autoAssign' }
  | { type: 'autoRun'; on: boolean }
  | { type: 'kick'; playerId: string }
  | { type: 'end' };

export interface CreateRoomRequest {
  difficulty?: Difficulty;
  mode?: RoomMode;
}
export interface CreateRoomResponse {
  code: string;
  teacherToken: string;
}
export interface JoinRequest {
  name?: string;
  /** A player token from an earlier join: rejoin as the same player. */
  token?: string;
}
export interface JoinResponse {
  playerId: string;
  token: string;
  name: string;
  rejoined: boolean;
}
export interface ApiError {
  error: string;
  /** Plain words a student can read. */
  message: string;
}

/** Why a room's live stream ended. */
export type ClosedReason = 'ended' | 'expired' | 'kicked' | 'left';
