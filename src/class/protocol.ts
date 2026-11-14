// Written with AI assistance (Claude Code). See README "Use of AI tools".
// The teacher dashboard (class board): what the browser and the server agree on.
// A teacher registers a class code and gets a secret key for the dashboard. Students who play
// with that code send a small result after each crew: a random player id, an optional nickname,
// and game numbers only. No accounts, no free text, nothing else about the student.
// Imported by the game (src/ui) and by the droplet's server (src/class/http.ts, store.ts).

import type { Difficulty, Site } from '../sim/constants';
import type { StarId } from '../sim/campaign';
import type { LoseReason } from '../sim/types';
import type { UpgradeId } from '../sim/upgrades';
import type { NameProblem } from '../room/protocol';
import { checkClassCode } from '../sim/classcode';

export const CLASS_LIMITS = {
  maxClasses: 500,
  maxPlayers: 60,
  /** Each player keeps the latest result for each of the 3 crews (plus running totals). */
  crewSlots: 3,
  /** After this many results from one player, more are ignored. */
  maxReportsPerPlayer: 100,
  /** Largest request body the server reads, bytes. */
  maxBody: 2048,
  /** A class (and every result in it) is deleted this long after its last report. */
  expireMs: 7 * 24 * 60 * 60 * 1000,
  /** How often the dashboard page asks for new results. */
  refreshMs: 10_000,
  /** Longest mission a report can describe, sols. */
  maxSols: 60,
  nameMax: 12,
} as const;

export type ReportMode = 'campaign' | 'quick';
export const LOSE_REASONS: readonly LoseReason[] = ['air', 'food', 'dose', 'window'];

// ---------------------------------------------------------------- requests

export interface RegisterRequest {
  code: string;
}
export interface RegisterResponse {
  code: string;
  /** Secret: only the teacher's dashboard link carries it. Never sent to students. */
  key: string;
  expiresAt: number;
}

/** One finished crew, as a student's game sends it. */
export interface ReportRequest {
  /** Random id made by the student's browser (kept in localStorage). Never shown to anyone. */
  playerId: string;
  /** Random id for this one result, so a retried send is never counted twice. */
  rid: string;
  /** First name or nickname for the class board, or null to show as "Player 3". */
  nickname?: string | null;
  mode: ReportMode;
  site: Site;
  difficulty: Difficulty;
  /** Which crew: 1 to 3 (a quick mission is crew 1). */
  n: number;
  status: 'won' | 'lost';
  loseReason?: LoseReason | null;
  sols: number;
  dose: number;
  doseBudget: number;
  stars: StarId[];
  built: UpgradeId[];
  /** Compact chart series: fuel tank % (whole numbers) at landing and at the end of every sol. */
  series?: { fuel: number[] } | null;
}

export interface ReportResponse {
  ok: true;
  /** "Player 3": the student's number in this class. */
  num: number;
  /** The name the class board shows, or null for "Player <num>". */
  name: string | null;
  /** Set when the nickname sent was not used. */
  nameProblem?: NameProblem;
  /** This result had already arrived (only the name was updated). */
  duplicate?: boolean;
}

export type TeacherRequest = { key: string; action: 'remove'; num: number } | { key: string; action: 'clear' };

// ---------------------------------------------------------------- what the dashboard gets

export interface CrewView {
  n: number;
  mode: ReportMode;
  site: Site;
  status: 'won' | 'lost';
  loseReason?: LoseReason;
  sols: number;
  dose: number;
  doseBudget: number;
  stars: StarId[];
  built: UpgradeId[];
  at: number;
}

/** Running totals over every crew a player reported (not only the latest per crew). */
export interface Tally {
  crews: number;
  launched: number;
  early: number;
  reasons: Record<LoseReason, number>;
  stars: number;
  /** The fewest sols (or Moon days) any of their crews needed to launch. */
  best: { sols: number; site: Site } | null;
  /** Every upgrade any of their crews finished. */
  built: UpgradeId[];
  sites: Site[];
}

export interface PlayerView {
  num: number;
  name: string | null;
  difficulty: Difficulty;
  /** The latest result for each crew number, by crew. */
  crews: CrewView[];
  /** The most recent result. */
  last: CrewView;
  tally: Tally;
  /** Fuel line of the most recent crew, if the game sent one. */
  fuel: number[] | null;
  seen: number;
}

export interface DashboardView {
  code: string;
  /** Goes up by one with every change. */
  v: number;
  createdAt: number;
  lastReportAt: number | null;
  expiresAt: number;
  players: PlayerView[];
}

export type DashboardResponse = DashboardView | { unchanged: true; v: number };

// ---------------------------------------------------------------- links

/** Teacher keys are 32 hex characters. */
export function isTeacherKey(x: unknown): x is string {
  return typeof x === 'string' && /^[0-9a-f]{32}$/.test(x);
}

export interface DashboardLink {
  code: string;
  key: string | null;
}

/** `?dashboard=K7RZQ&key=...` in a page address, or null. The key may be missing (it is then looked up on this device). */
export function dashboardParams(search: string): DashboardLink | null {
  const q = new URLSearchParams(search);
  const raw = q.get('dashboard');
  if (raw === null) return null;
  const res = checkClassCode(raw);
  if (!res.ok) return null;
  const key = q.get('key');
  return { code: res.code, key: isTeacherKey(key) ? key : null };
}

/** The teacher's private dashboard link. */
export function dashboardLink(code: string, key: string, origin: string): string {
  return `${origin}/?dashboard=${code}&key=${key}`;
}
