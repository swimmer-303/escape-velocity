// Written with AI assistance (Claude Code). See README "Use of AI tools".
// The class board's numbers, worked out from the students' results (pure: used by the
// dashboard page and its tests).

import { UPGRADE_IDS, type UpgradeId } from '../sim/upgrades';
import type { LoseReason } from '../sim/types';
import { LOSE_REASONS, type PlayerView } from './protocol';

export interface ClassSummary {
  players: number;
  /** Every crew any student reported (retries included). */
  crews: number;
  launched: number;
  early: number;
  /** Stars per crew (0 to 3), or null before any results. */
  avgStars: number | null;
  /** Why crews were sent home early, most common first (only reasons that happened). */
  trouble: Array<{ reason: LoseReason; count: number }>;
  /** How many students finished each upgrade at least once, most popular first (only ones built). */
  upgrades: Array<{ id: UpgradeId; players: number }>;
}

export function summarize(players: PlayerView[]): ClassSummary {
  let crews = 0;
  let launched = 0;
  let early = 0;
  let stars = 0;
  const reasons: Record<LoseReason, number> = { air: 0, food: 0, dose: 0, window: 0 };
  const built = new Map<UpgradeId, number>();
  for (const p of players) {
    const t = p.tally;
    crews += t.crews;
    launched += t.launched;
    early += t.early;
    stars += t.stars;
    for (const r of LOSE_REASONS) reasons[r] += t.reasons[r] ?? 0;
    for (const id of t.built) built.set(id, (built.get(id) ?? 0) + 1);
  }
  const order = (a: number, b: number) => b - a;
  return {
    players: players.length,
    crews,
    launched,
    early,
    avgStars: crews ? stars / crews : null,
    trouble: LOSE_REASONS.map((reason) => ({ reason, count: reasons[reason] }))
      .filter((x) => x.count > 0)
      .sort((a, b) => order(a.count, b.count)),
    upgrades: UPGRADE_IDS.map((id) => ({ id, players: built.get(id) ?? 0 }))
      .filter((x) => x.players > 0)
      .sort((a, b) => order(a.players, b.players)),
  };
}

/** Stars from each student's latest result per crew (what the table shows), and the most they could have. */
export function latestStars(p: PlayerView): { stars: number; max: number } {
  return { stars: p.crews.reduce((s, c) => s + c.stars.length, 0), max: p.crews.length * 3 };
}
