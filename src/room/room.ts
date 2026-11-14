// Written with AI assistance (Claude Code). See README "Use of AI tools".
// Mission Control rooms: the pure, server-side rules for one class playing one shared base.
// No I/O and no clocks here: the caller passes `now` and fresh ids, so every rule is easy to test.
// The server holds the mission and the shared plan; every move is checked with the same sim
// functions the single-player game uses (moduleCap, checkAlloc, runSol, setProject).

import { checkAlloc, createMission, emptyAlloc, getBriefing, isModuleId, moduleCap, planFor, runSol, setProject, totalCells } from '../sim/sim';
import { campaignDone, finishExpedition, missionConfigFor, type Campaign } from '../sim/campaign';
import { campaignWithCode } from '../sim/classcode';
import { EXPEDITIONS, type Difficulty } from '../sim/constants';
import { nextCost, UPGRADE_IDS, type UpgradeId } from '../sim/upgrades';
import type { Allocation, CrateId, MissionState, ModuleId, SolReport, SpaceWeatherEvent } from '../sim/types';
import { checkName } from './names';
import {
  LIMITS,
  NAME_PROBLEM,
  STATION_IDS,
  STATION_OF,
  STATIONS,
  isPingId,
  isStationId,
  type ClosedReason,
  type PingView,
  type PlayerAction,
  type RoomMode,
  type RoomPhase,
  type RoomView,
  type StationId,
  type TeacherAction,
} from './protocol';

export interface Player {
  id: string;
  token: string;
  name: string;
  stations: StationId[];
  ready: boolean;
  joinedAt: number;
  lastSeen: number;
  /** Open live streams (the server keeps this up to date). */
  conns: number;
  lastPingAt: number;
}

export interface Room {
  code: string;
  teacherToken: string;
  createdAt: number;
  lastActive: number;
  difficulty: Difficulty;
  mode: RoomMode;
  phase: RoomPhase;
  players: Player[];
  /** Names the teacher removed (lowercase): they can't join again under that name. */
  blockedNames: string[];
  campaign: Campaign;
  mission: MissionState | null;
  alloc: Allocation;
  crate: CrateId | null;
  report: SolReport | null;
  pings: Array<PingView & { at: number }>;
  pingCount: number;
  autoRun: boolean;
  /** Real DONKI events for this room (fixed when it opens, so the whole class shares one Mars). */
  eventPool: SpaceWeatherEvent[];
  lightTimeMin: number;
  data: RoomView['data'];
  v: number;
  closed: ClosedReason | null;
  teacherConns: number;
}

export interface RoomInit {
  code: string;
  teacherToken: string;
  difficulty: Difficulty;
  mode: RoomMode;
  now: number;
  eventPool: SpaceWeatherEvent[];
  lightTimeMin: number;
  data: RoomView['data'];
}

export type Fail = { ok: false; status: number; error: string; message: string };
export type Result<T = undefined> = { ok: true; value: T } | Fail;

const ok = <T>(value: T): Result<T> => ({ ok: true, value });
const fail = (status: number, error: string, message: string): Fail => ({ ok: false, status, error, message });

const WAIT = 'Not right now. Wait for your teacher.';

export function createRoom(init: RoomInit): Room {
  return {
    code: init.code,
    teacherToken: init.teacherToken,
    createdAt: init.now,
    lastActive: init.now,
    difficulty: init.difficulty,
    mode: init.mode,
    phase: 'lobby',
    players: [],
    blockedNames: [],
    // The room code is also the seed: the same code gives the same Mars as a class code would.
    campaign: campaignWithCode(init.code, init.code, init.difficulty),
    mission: null,
    alloc: emptyAlloc(),
    crate: null,
    report: null,
    pings: [],
    pingCount: 0,
    autoRun: false,
    eventPool: init.eventPool,
    lightTimeMin: init.lightTimeMin,
    data: init.data,
    v: 1,
    closed: null,
    teacherConns: 0,
  };
}

/** Record a change: bump the version (screens redraw) and reset the idle timer. */
export function touch(room: Room, now: number) {
  room.v++;
  room.lastActive = now;
}

export function isExpired(room: Room, now: number): boolean {
  return now - room.lastActive > LIMITS.idleMs;
}

export function crewsFor(mode: RoomMode): number {
  return mode === 'campaign' ? EXPEDITIONS.length : 1;
}

// ---------------------------------------------------------------- stations

function byJoin(a: Player, b: Player) {
  return a.joinedAt - b.joinedAt || a.id.localeCompare(b.id);
}

function sortStations(list: StationId[]): StationId[] {
  return STATION_IDS.filter((s) => list.includes(s));
}

export function stationHeadcount(room: Room): Record<StationId, number> {
  const out = { o2: 0, green: 0, rad: 0, shop: 0 };
  for (const p of room.players) for (const s of p.stations) out[s]++;
  return out;
}

/**
 * A new player takes any station nobody has, then stations from players who hold more than
 * one (until it is even), and otherwise joins the station with the fewest players.
 * 1 player: all 4 stations. 2 players: 2 each. 4 or more: one station each, about evenly.
 */
function placeNewPlayer(room: Room, p: Player) {
  const others = room.players.filter((o) => o !== p).sort(byJoin);
  if (!others.length) {
    p.stations = [...STATION_IDS];
    return;
  }
  const taken = new Set(others.flatMap((o) => o.stations));
  const mine: StationId[] = STATION_IDS.filter((s) => !taken.has(s));
  for (;;) {
    const rich = others.filter((o) => o.stations.length >= 2).sort((a, b) => b.stations.length - a.stations.length || byJoin(a, b))[0];
    if (!rich || rich.stations.length < mine.length + 2) break;
    mine.push(rich.stations.pop()!);
  }
  if (!mine.length) {
    const count = stationHeadcount(room);
    mine.push([...STATION_IDS].sort((a, b) => count[a] - count[b] || STATION_IDS.indexOf(a) - STATION_IDS.indexOf(b))[0]);
  }
  p.stations = sortStations(mine);
}

/** Give every station nobody holds to the player with the fewest stations. */
function coverStations(room: Room, notTo?: Player) {
  if (!room.players.length) return;
  for (const s of STATION_IDS) {
    if (room.players.some((p) => p.stations.includes(s))) continue;
    const pool = room.players.length > 1 && notTo ? room.players.filter((p) => p !== notTo) : room.players;
    const to = [...pool].sort((a, b) => a.stations.length - b.stations.length || byJoin(a, b))[0];
    to.stations = sortStations([...to.stations, s]);
  }
}

/** Teacher's "Auto-assign": share the stations out evenly, in the order players joined. */
export function autoAssign(room: Room) {
  const ps = [...room.players].sort(byJoin);
  const n = ps.length;
  if (!n) return;
  for (const p of ps) p.stations = [];
  if (n < STATION_IDS.length) STATION_IDS.forEach((s, j) => ps[j % n].stations.push(s));
  else ps.forEach((p, i) => p.stations.push(STATION_IDS[i % STATION_IDS.length]));
  for (const p of ps) p.stations = sortStations(p.stations);
}

export function canUseModule(p: Player, id: ModuleId): boolean {
  return p.stations.includes(STATION_OF[id]);
}

// ---------------------------------------------------------------- players

export function findPlayer(room: Room, token: unknown): Player | undefined {
  if (typeof token !== 'string' || !token) return undefined;
  return room.players.find((p) => p.token === token);
}

export function join(
  room: Room,
  input: { name?: unknown; token?: unknown },
  now: number,
  fresh: { id: string; token: string },
): Result<{ player: Player; rejoined: boolean }> {
  if (room.closed) return fail(410, 'closed', 'This room has closed.');
  const back = findPlayer(room, input.token);
  if (back) {
    back.lastSeen = now;
    return ok({ player: back, rejoined: true });
  }
  const check = checkName(typeof input.name === 'string' ? input.name : '');
  if (!check.ok) return fail(400, `name-${check.problem}`, NAME_PROBLEM[check.problem]);
  const lower = check.name.toLowerCase();
  if (room.blockedNames.includes(lower)) return fail(400, 'name-blocked', NAME_PROBLEM.blocked);
  if (room.players.some((p) => p.name.toLowerCase() === lower)) return fail(409, 'name-taken', NAME_PROBLEM.taken);
  if (room.players.length >= LIMITS.maxPlayers) return fail(409, 'room-full', `This room is full (${LIMITS.maxPlayers} players). Ask your teacher.`);
  const player: Player = { id: fresh.id, token: fresh.token, name: check.name, stations: [], ready: false, joinedAt: now, lastSeen: now, conns: 0, lastPingAt: 0 };
  room.players.push(player);
  placeNewPlayer(room, player);
  touch(room, now);
  return ok({ player, rejoined: false });
}

function removePlayer(room: Room, p: Player, now: number) {
  room.players = room.players.filter((o) => o !== p);
  coverStations(room);
  touch(room, now);
  maybeAutoRun(room, now);
}

// ---------------------------------------------------------------- the shared plan

export interface RunCheck {
  ok: boolean;
  /** Plain reasons the sol can't run yet. */
  reasons: string[];
}

export function canRun(room: Room): RunCheck {
  const m = room.mission;
  if (room.phase !== 'plan' || !m || m.status !== 'playing') return { ok: false, reasons: ['Start planning first.'] };
  const reasons: string[] = [];
  const check = checkAlloc(m, room.alloc);
  if (check.remaining > 0) reasons.push(`Place every power cell (${check.remaining} left).`);
  else if (!check.ok) reasons.push(...check.problems);
  if (planFor(m).resupply && !room.crate) reasons.push(`The ${STATIONS.shop.name} station must choose a cargo crate.`);
  return { ok: reasons.length === 0, reasons };
}

function cellsLeft(room: Room): number {
  return room.mission ? getBriefing(room.mission).cells - totalCells(room.alloc) : 0;
}

function doRun(room: Room, now: number) {
  const m = room.mission!;
  const { next, report } = runSol(m, room.alloc, room.crate ?? undefined);
  room.mission = next;
  room.report = report;
  room.alloc = emptyAlloc();
  room.crate = null;
  for (const p of room.players) p.ready = false;
  room.phase = 'debrief';
  touch(room, now);
}

/** With auto-run on: run the sol as soon as everyone with the room open is ready and the plan is valid. */
export function maybeAutoRun(room: Room, now: number): boolean {
  if (!room.autoRun || room.phase !== 'plan') return false;
  const online = room.players.filter((p) => p.conns > 0);
  if (!online.length || !online.every((p) => p.ready)) return false;
  if (!canRun(room).ok) return false;
  doRun(room, now);
  return true;
}

function newMission(room: Room) {
  room.mission = createMission(missionConfigFor(room.campaign, room.lightTimeMin, room.eventPool));
  room.alloc = emptyAlloc();
  room.crate = null;
  room.report = null;
  for (const p of room.players) p.ready = false;
  room.phase = 'briefing';
}

const isUpgrade = (x: unknown): x is UpgradeId => typeof x === 'string' && (UPGRADE_IDS as readonly string[]).includes(x);
const isCrate = (x: unknown): x is CrateId => x === 'food' || x === 'parts' || x === 'panel';

/** A student's move. Every move is checked here; the screen's own checks are only for speed. */
export function act(room: Room, token: unknown, action: PlayerAction, now: number): Result<{ ran: boolean }> {
  if (room.closed) return fail(410, 'closed', 'This room has closed.');
  const p = findPlayer(room, token);
  if (!p) return fail(403, 'not-a-player', 'You are not in this room. Join again with your name.');
  p.lastSeen = now;
  const m = room.mission;
  const planning = room.phase === 'plan' && !!m && m.status === 'playing';
  switch (action?.type) {
    case 'place': {
      if (!isModuleId(String(action.module))) return fail(400, 'bad-module', 'That module does not exist.');
      if (!planning) return fail(409, 'wrong-phase', WAIT);
      if (!canUseModule(p, action.module)) return fail(403, 'not-your-station', 'That module belongs to another station. Send them a ping!');
      if (room.alloc[action.module] >= moduleCap(m!, action.module)) return fail(409, 'module-full', 'That module is full.');
      if (cellsLeft(room) <= 0) return fail(409, 'pool-empty', 'No power cells left. Ask another station to give one back.');
      room.alloc = { ...room.alloc, [action.module]: room.alloc[action.module] + 1 };
      p.ready = false;
      break;
    }
    case 'remove': {
      if (!isModuleId(String(action.module))) return fail(400, 'bad-module', 'That module does not exist.');
      if (!planning) return fail(409, 'wrong-phase', WAIT);
      if (!canUseModule(p, action.module)) return fail(403, 'not-your-station', 'That module belongs to another station. Send them a ping!');
      if (room.alloc[action.module] <= 0) return fail(409, 'module-empty', 'There is no cell there to take back.');
      room.alloc = { ...room.alloc, [action.module]: room.alloc[action.module] - 1 };
      p.ready = false;
      break;
    }
    case 'move': {
      const { from, to } = action;
      if (!isModuleId(String(from)) || !isModuleId(String(to)) || from === to) return fail(400, 'bad-module', 'That module does not exist.');
      if (!planning) return fail(409, 'wrong-phase', WAIT);
      if (!canUseModule(p, from) || !canUseModule(p, to)) return fail(403, 'not-your-station', 'That module belongs to another station. Send them a ping!');
      if (room.alloc[from] <= 0) return fail(409, 'module-empty', 'There is no cell there to take back.');
      if (room.alloc[to] >= moduleCap(m!, to)) return fail(409, 'module-full', 'That module is full.');
      room.alloc = { ...room.alloc, [from]: room.alloc[from] - 1, [to]: room.alloc[to] + 1 };
      p.ready = false;
      break;
    }
    case 'project': {
      if (!isUpgrade(action.project)) return fail(400, 'bad-project', 'That upgrade does not exist.');
      if (!m || m.status !== 'playing' || (room.phase !== 'plan' && room.phase !== 'briefing')) return fail(409, 'wrong-phase', WAIT);
      if (!p.stations.includes('shop')) return fail(403, 'not-your-station', `Only the ${STATIONS.shop.name} station picks the Workshop project.`);
      if (nextCost(action.project, m.base.levels) === null) return fail(409, 'built', 'That upgrade is already fully built.');
      if (m.base.project !== action.project) {
        room.mission = setProject(m, action.project);
        // A new project can take a different number of cells: hand the Workshop's cells back to the pool.
        room.alloc = { ...room.alloc, build: 0 };
      }
      break;
    }
    case 'crate': {
      if (!isCrate(action.crate)) return fail(400, 'bad-crate', 'That crate does not exist.');
      if (!m || m.status !== 'playing' || (room.phase !== 'plan' && room.phase !== 'briefing')) return fail(409, 'wrong-phase', WAIT);
      if (!planFor(m).resupply) return fail(409, 'no-cargo', 'No cargo lander today.');
      if (!p.stations.includes('shop')) return fail(403, 'not-your-station', `Only the ${STATIONS.shop.name} station chooses the crate.`);
      room.crate = action.crate;
      break;
    }
    case 'ready': {
      if (room.phase !== 'plan') return fail(409, 'wrong-phase', WAIT);
      p.ready = !!action.ready;
      break;
    }
    case 'ping': {
      if (!isPingId(action.ping)) return fail(400, 'bad-ping', 'That message does not exist.');
      if (now - p.lastPingAt < LIMITS.pingGapMs) return fail(429, 'slow-down', 'Wait a moment before sending another message.');
      p.lastPingAt = now;
      room.pings = [...room.pings.filter((x) => now - x.at < LIMITS.pingShowMs), { n: ++room.pingCount, from: p.name, stations: [...p.stations], ping: action.ping, at: now }].slice(-8);
      break;
    }
    case 'leave':
      removePlayer(room, p, now);
      return ok({ ran: false });
    default:
      return fail(400, 'bad-action', 'Unknown action.');
  }
  touch(room, now);
  return ok({ ran: maybeAutoRun(room, now) });
}

/** The teacher's controls. */
export function teacherAct(room: Room, teacherToken: unknown, action: TeacherAction, now: number): Result<{ removed?: Player }> {
  if (room.closed) return fail(410, 'closed', 'This room has closed.');
  if (typeof teacherToken !== 'string' || teacherToken !== room.teacherToken) return fail(403, 'not-teacher', 'Only the teacher can do that.');
  let removed: Player | undefined;
  switch (action?.type) {
    case 'start':
      if (room.phase !== 'lobby') return fail(409, 'wrong-phase', 'The mission has already started.');
      if (!room.players.length) return fail(409, 'no-players', 'Wait for at least one student to join.');
      newMission(room);
      break;
    case 'plan':
      if (room.phase !== 'briefing') return fail(409, 'wrong-phase', 'Planning has already started.');
      room.phase = 'plan';
      break;
    case 'run': {
      const check = canRun(room);
      if (!check.ok) return fail(409, 'cannot-run', check.reasons.join(' '));
      doRun(room, now);
      return ok({});
    }
    case 'next': {
      if (room.phase === 'debrief') {
        if (room.mission!.status === 'playing') {
          room.phase = 'briefing';
        } else {
          room.campaign = finishExpedition(room.campaign, room.mission!);
          room.phase = 'end';
        }
      } else if (room.phase === 'end') {
        if (room.mode !== 'campaign' || campaignDone(room.campaign)) return fail(409, 'done', 'This mission is over. Start it again or close the room.');
        newMission(room);
      } else return fail(409, 'wrong-phase', 'Run the sol first.');
      break;
    }
    case 'restart':
      if (room.phase === 'lobby') return fail(409, 'wrong-phase', 'Start the mission first.');
      room.campaign = campaignWithCode(room.code, room.code, room.difficulty);
      newMission(room);
      break;
    case 'assign': {
      const p = room.players.find((x) => x.id === action.playerId);
      if (!p) return fail(404, 'no-player', 'That player has left.');
      if (!isStationId(action.station)) return fail(400, 'bad-station', 'That station does not exist.');
      p.stations = [action.station];
      coverStations(room, p);
      break;
    }
    case 'autoAssign':
      autoAssign(room);
      break;
    case 'autoRun':
      room.autoRun = !!action.on;
      break;
    case 'kick': {
      const p = room.players.find((x) => x.id === action.playerId);
      if (!p) return fail(404, 'no-player', 'That player has already left.');
      room.blockedNames.push(p.name.toLowerCase());
      removed = p;
      removePlayer(room, p, now);
      return ok({ removed });
    }
    case 'end':
      room.closed = 'ended';
      touch(room, now);
      return ok({});
    default:
      return fail(400, 'bad-action', 'Unknown action.');
  }
  touch(room, now);
  maybeAutoRun(room, now);
  return ok({});
}

/** A live stream opened or closed for a player. Returns true if that made the sol run (auto-run). */
export function setOnline(room: Room, p: Player, delta: 1 | -1, now: number): boolean {
  const was = p.conns > 0;
  p.conns = Math.max(0, p.conns + delta);
  p.lastSeen = now;
  if (was !== p.conns > 0) {
    room.v++;
    return maybeAutoRun(room, now);
  }
  return false;
}

/**
 * What every screen sees. No tokens, and the mission without its (large) pool of events.
 * The sol-by-sol log is only needed for the end screen's charts, so it is sent only then.
 */
export function viewOf(room: Room, now: number): RoomView {
  const m = room.mission;
  return {
    code: room.code,
    v: room.v,
    phase: room.phase,
    difficulty: room.difficulty,
    mode: room.mode,
    expedition: m?.config.expedition ?? room.campaign.expedition,
    crews: crewsFor(room.mode),
    players: [...room.players].sort(byJoin).map((p) => ({ id: p.id, name: p.name, stations: [...p.stations], ready: p.ready, online: p.conns > 0 })),
    mission: m ? { ...m, config: { ...m.config, eventPool: [] }, log: room.phase === 'end' ? m.log : [] } : null,
    alloc: { ...room.alloc },
    crate: room.crate,
    report: room.report,
    results: room.campaign.results,
    pings: room.pings.filter((x) => now - x.at < LIMITS.pingShowMs).map((x) => ({ n: x.n, from: x.from, stations: x.stations, ping: x.ping })),
    autoRun: room.autoRun,
    data: room.data,
  };
}
