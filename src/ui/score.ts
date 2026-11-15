// Written with AI assistance (Claude Code). See README "Use of AI tools".
// Game-feel scoring, kept apart from the rules in src/sim (it never changes what happens in a mission):
// - "Perfect sol": nothing dropped below safe and the fuel tank is on pace. Perfect sols in a row build a streak.
// - The mission score and letter grade on the end screen, built from the same stars and stats the game already shows.
// - Personal bests, kept in this browser (localStorage).

import type { MissionState, SolReport } from '../sim/types';
import { starsFor } from '../sim/campaign';

/** Life support below this many days is shown in red on the HUD (see hud.ts). */
export const SAFE_LIFE_DAYS = 1.5;
/** The HUD turns the dose meter red above this share of the budget. */
export const SAFE_DOSE_SHARE = 0.75;
/** "On pace": at least this share of the straight line from the starting fuel to a full tank on the last sol. */
const PACE_SLACK = 0.85;

/** The fuel the tank should hold after `sol` to be on pace for launch by `windowSol` (percent). */
export function fuelPace(startFuel: number, sol: number, windowSol: number): number {
  const k = Math.min(1, Math.max(0, sol / Math.max(1, windowSol)));
  return startFuel + (100 - startFuel) * k * PACE_SLACK;
}

/**
 * A perfect sol: air, food and dose all stayed in the safe zone, the heaters had enough power, nothing broke,
 * the crew was in the shelter if a storm hit, and the fuel is on pace (or the rocket is full).
 */
export function isPerfectSol(report: SolReport, after: MissionState, windowSol: number): boolean {
  const a = report.after;
  if (after.status === 'lost') return false;
  if (a.air < SAFE_LIFE_DAYS || a.food < SAFE_LIFE_DAYS) return false;
  if (a.dose > after.doseBudget * SAFE_DOSE_SHARE) return false;
  if (report.heaterShortfall > 0 || report.newDamage) return false;
  if (report.storm && report.storm.shelterCells <= 0) return false;
  if (after.status === 'won' || a.fuel >= 100) return true;
  const start = after.log[0]?.before.fuel ?? report.before.fuel;
  return a.fuel >= fuelPace(start, report.sol, windowSol);
}

/** XP for a streak of perfect sols: nothing for the first, then a little more each sol (capped). */
export function streakXp(streak: number): number {
  return streak >= 2 ? 5 * Math.min(streak, 4) : 0;
}

// ------------------------------------------------------------------ the end screen
export type Grade = 'S' | 'A' | 'B' | 'C';

export interface ScorePart {
  label: string;
  points: number;
}

export interface MissionScore {
  score: number;
  grade: Grade;
  parts: ScorePart[];
}

export const GRADE_WORDS: Record<Grade, string> = {
  S: 'Superstar commander!',
  A: 'Ace mission!',
  B: 'Good flying!',
  C: 'Keep training!',
};

/**
 * Score: launching home, the fuel made, keeping the dose low, upgrades built, and launching early.
 * Grade (from the stars on the end screen): S = all 3 stars with a very low dose, A = 2 or 3 stars with a launch,
 * B = launched, C = came home early.
 */
export function scoreMission(m: MissionState, windowSol: number, turns = 'Sols'): MissionScore {
  const won = m.status === 'won';
  const stars = starsFor(m);
  const parts: ScorePart[] = [
    { label: 'Launched home', points: won ? 1000 : 0 },
    { label: 'Rocket fuel', points: Math.round(Math.min(100, Math.max(0, m.fuel)) * 5) },
    { label: 'Crew safety', points: Math.round(Math.max(0, 1 - m.dose / Math.max(1e-6, m.doseBudget)) * 1000) },
    { label: 'Upgrades built', points: 250 * m.builtThisExpedition.length },
    { label: `${turns} to spare`, points: won ? Math.max(0, windowSol - m.log.length) * 100 : 0 },
  ];
  const score = parts.reduce((s, p) => s + p.points, 0);
  const grade: Grade = !won ? 'C' : stars.length === 3 && m.dose <= m.doseBudget * 0.4 ? 'S' : stars.length >= 2 ? 'A' : 'B';
  return { score, grade, parts };
}

// ------------------------------------------------------------------ personal bests
const BEST_KEY = 'ev-best-v1';

function readBests(): Record<string, number> {
  try {
    const raw = localStorage.getItem(BEST_KEY);
    const v = raw ? (JSON.parse(raw) as unknown) : null;
    return v && typeof v === 'object' ? (v as Record<string, number>) : {};
  } catch {
    return {};
  }
}

export function bestScore(key: string): number | null {
  const v = readBests()[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** Save a score if it beats the best for `key` (e.g. "quick-mars"). Returns whether it is a new personal best. */
export function recordBest(key: string, score: number): { isNew: boolean; previous: number | null } {
  const previous = bestScore(key);
  const isNew = score > 0 && (previous === null || score > previous);
  if (isNew) {
    try {
      const all = readBests();
      all[key] = score;
      localStorage.setItem(BEST_KEY, JSON.stringify(all));
    } catch {
      /* private mode: no saved bests, the game still works */
    }
  }
  return { isNew, previous };
}
