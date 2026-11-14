// Written with AI assistance (Claude Code). See README "Use of AI tools".
// Daily challenge: the mission and its replay check. Pure (no I/O), shared by the game and the server.
// The game turns its finished mission log into a list of moves. The server replays those moves on a
// fresh mission built from the frozen config, with the same simulation every game uses, and scores the
// result itself. A move the real game could never make (too many cells, a crate on the wrong day, a
// project that can't be built, turns after the mission ended) rejects the whole list.

import { newCampaign, missionConfigFor, starsFor } from '../sim/campaign';
import { checkAlloc, createMission, planFor, runSol, setProject } from '../sim/sim';
import { MODULE_IDS, type Allocation, type CrateId, type MissionConfig, type MissionState } from '../sim/types';
import { UPGRADE_IDS, type UpgradeId } from '../sim/upgrades';
import { DAILY_LIMITS, type DailyConfig, type DailyMove, type DailyScore } from './protocol';

const CRATES: readonly CrateId[] = ['food', 'parts', 'panel'];

/** Quick-mission rules: one crew of 4 on Cadet, a brand-new base, an empty tank. */
export function dailyMissionConfig(cfg: DailyConfig): MissionConfig {
  return missionConfigFor(newCampaign(cfg.seed, 'cadet', cfg.site), cfg.lightTimeMin, cfg.eventPool);
}

/** The moves a finished (or unfinished) mission made, in the compact form the server replays. */
export function movesFromLog(m: Pick<MissionState, 'log'>): DailyMove[] {
  return m.log.map((r) => {
    const move: DailyMove = { a: MODULE_IDS.map((id) => r.alloc[id]) };
    if (r.crate) move.c = r.crate;
    move.p = r.buildProject ?? null;
    return move;
  });
}

export function scoreOf(end: MissionState): DailyScore {
  return {
    won: end.status === 'won',
    sols: end.log.length,
    dose: Math.round(end.dose * 10) / 10,
    stars: starsFor(end).length,
    fuel: Math.max(0, Math.min(100, Math.floor(end.fuel + 1e-9))),
  };
}

export type ReplayProblem = 'bad-moves' | 'too-many' | 'illegal-project' | 'illegal-crate' | 'illegal-alloc' | 'extra-moves' | 'unfinished';

export const REPLAY_MESSAGE: Record<ReplayProblem, string> = {
  'bad-moves': 'That game could not be read.',
  'too-many': 'That game is too long to be a real one.',
  'illegal-project': 'That game picked a Workshop project the base could not build.',
  'illegal-crate': 'That game picked a cargo crate on a day with no cargo lander.',
  'illegal-alloc': 'That game placed power cells the base did not have.',
  'extra-moves': 'That game kept going after the mission ended.',
  'unfinished': 'That mission is not finished yet.',
};

export type ReplayResult = { ok: true; end: MissionState; score: DailyScore } | { ok: false; problem: ReplayProblem; turn?: number };

function isCount(x: unknown): x is number {
  return typeof x === 'number' && Number.isInteger(x) && x >= 0 && x <= 99;
}

/** Read one move from untrusted JSON, or null if it isn't one. */
function parseMove(raw: unknown): { alloc: Allocation; crate?: CrateId; project?: UpgradeId | null } | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const { a, c, p } = raw as Record<string, unknown>;
  if (!Array.isArray(a) || a.length !== MODULE_IDS.length || !a.every(isCount)) return null;
  if (c !== undefined && !(CRATES as readonly unknown[]).includes(c)) return null;
  if (p !== undefined && p !== null && !(UPGRADE_IDS as readonly unknown[]).includes(p)) return null;
  const alloc = Object.fromEntries(MODULE_IDS.map((id, i) => [id, a[i] as number])) as Allocation;
  return { alloc, crate: c as CrateId | undefined, project: p as UpgradeId | null | undefined };
}

/** Replay a move list on today's mission. Never throws: anything the real game could not do is a problem. */
export function replayDaily(cfg: DailyConfig, moves: unknown): ReplayResult {
  if (!Array.isArray(moves) || moves.length === 0) return { ok: false, problem: 'bad-moves' };
  if (moves.length > DAILY_LIMITS.maxMoves) return { ok: false, problem: 'too-many' };
  let s = createMission(dailyMissionConfig(cfg));
  for (let i = 0; i < moves.length; i++) {
    const turn = i + 1;
    if (s.status !== 'playing') return { ok: false, problem: 'extra-moves', turn };
    const mv = parseMove(moves[i]);
    if (!mv) return { ok: false, problem: 'bad-moves', turn };
    if (mv.project !== undefined && mv.project !== s.base.project) {
      s = setProject(s, mv.project);
      if (s.base.project !== mv.project) return { ok: false, problem: 'illegal-project', turn };
    }
    if (mv.crate && !planFor(s).resupply) return { ok: false, problem: 'illegal-crate', turn };
    if (!checkAlloc(s, mv.alloc).ok) return { ok: false, problem: 'illegal-alloc', turn };
    try {
      s = runSol(s, mv.alloc, mv.crate).next;
    } catch {
      return { ok: false, problem: 'illegal-alloc', turn };
    }
  }
  if (s.status === 'playing') return { ok: false, problem: 'unfinished' };
  return { ok: true, end: s, score: scoreOf(s) };
}
