// Written with AI assistance (Claude Code). See README "Use of AI tools".
// Checks every field of a student's result before the server keeps it. Nothing from the
// browser is trusted: unknown fields are dropped, numbers are range-checked and rounded, and
// anything that does not fit the game's rules is refused.

import { UPGRADE_IDS, type UpgradeId } from '../sim/upgrades';
import { STAR_INFO, type StarId } from '../sim/campaign';
import type { LoseReason } from '../sim/types';
import { CLASS_LIMITS, LOSE_REASONS, type CrewView } from './protocol';

export type CleanReport = Omit<CrewView, 'at'> & {
  playerId: string;
  rid: string;
  difficulty: 'cadet' | 'commander';
  fuel: number[] | null;
};

export type ReportCheck = { ok: true; report: CleanReport } | { ok: false; field: string };

const STAR_IDS = Object.keys(STAR_INFO) as StarId[];
const isInt = (x: unknown, lo: number, hi: number): x is number => typeof x === 'number' && Number.isInteger(x) && x >= lo && x <= hi;
const isNum = (x: unknown, lo: number, hi: number): x is number => typeof x === 'number' && Number.isFinite(x) && x >= lo && x <= hi;
const r1 = (x: number) => Math.round(x * 10) / 10;

/** Random ids made by the game: hex only. */
export const isPlayerId = (x: unknown): x is string => typeof x === 'string' && /^[0-9a-f]{16,40}$/.test(x);
export const isReportId = (x: unknown): x is string => typeof x === 'string' && /^[0-9a-f]{8,32}$/.test(x);

/** Check a result (the nickname is checked separately, against the blocklist). */
export function checkReport(body: Record<string, unknown>): ReportCheck {
  const bad = (field: string): ReportCheck => ({ ok: false, field });
  if (!isPlayerId(body.playerId)) return bad('playerId');
  if (!isReportId(body.rid)) return bad('rid');
  if (body.mode !== 'campaign' && body.mode !== 'quick') return bad('mode');
  if (body.site !== 'mars' && body.site !== 'moon') return bad('site');
  if (body.difficulty !== 'cadet' && body.difficulty !== 'commander') return bad('difficulty');
  if (!isInt(body.n, 1, CLASS_LIMITS.crewSlots) || (body.mode === 'quick' && body.n !== 1)) return bad('n');
  if (body.status !== 'won' && body.status !== 'lost') return bad('status');
  const won = body.status === 'won';
  let loseReason: LoseReason | undefined;
  if (won) {
    if (body.loseReason !== undefined && body.loseReason !== null) return bad('loseReason');
  } else {
    if (!(LOSE_REASONS as readonly unknown[]).includes(body.loseReason)) return bad('loseReason');
    loseReason = body.loseReason as LoseReason;
  }
  if (!isInt(body.sols, 0, CLASS_LIMITS.maxSols)) return bad('sols');
  if (!isNum(body.doseBudget, 0.1, 1000)) return bad('doseBudget');
  if (!isNum(body.dose, 0, 10_000)) return bad('dose');

  const stars = body.stars;
  if (!Array.isArray(stars) || stars.length > STAR_IDS.length || new Set(stars).size !== stars.length) return bad('stars');
  if (!stars.every((s) => (STAR_IDS as unknown[]).includes(s))) return bad('stars');
  // Launch and Safe crew are only for crews that flew home.
  if (!won && stars.some((s) => s === 'launch' || s === 'safe')) return bad('stars');

  const built = body.built;
  if (!Array.isArray(built) || built.length > 16 || !built.every((b) => (UPGRADE_IDS as readonly unknown[]).includes(b))) return bad('built');

  let fuel: number[] | null = null;
  if (body.series !== undefined && body.series !== null) {
    const s = body.series as { fuel?: unknown };
    if (typeof s !== 'object' || !Array.isArray(s.fuel)) return bad('series');
    if (s.fuel.length !== (body.sols as number) + 1 || !s.fuel.every((v) => isInt(v, 0, 100))) return bad('series');
    fuel = s.fuel as number[];
  }

  return {
    ok: true,
    report: {
      playerId: body.playerId,
      rid: body.rid,
      mode: body.mode,
      site: body.site,
      difficulty: body.difficulty,
      n: body.n,
      status: body.status,
      ...(loseReason ? { loseReason } : {}),
      sols: body.sols,
      dose: r1(body.dose),
      doseBudget: r1(body.doseBudget),
      stars: STAR_IDS.filter((s) => (stars as unknown[]).includes(s)),
      built: built as UpgradeId[],
      fuel,
    },
  };
}
