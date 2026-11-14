// Written with AI assistance (Claude Code). See README "Use of AI tools".
// The generational campaign: each expedition is a new crew that inherits the base.
// Between crews, Earth and Mars swing apart and back (about 26 months), while the
// robot O2 plant keeps working and pre-fills the next crew's rocket.

import { EXPEDITIONS, PREFILL_MAX_PCT, PREFILL_PCT_PER_CELL, TUNING, type Difficulty } from './constants';
import { REACTOR_CELLS, UPGRADE_BOOST } from './sim';
import { freshBase, type BaseState, type UpgradeId } from './upgrades';
import type { LoseReason, MissionConfig, MissionState, SpaceWeatherEvent } from './types';

export type StarId = 'launch' | 'safe' | 'builder';

export const STAR_INFO: Record<StarId, { name: string; how: string }> = {
  launch: { name: 'Launch', how: 'Fill the tank and fly home.' },
  safe: { name: 'Safe crew', how: 'Launch with a dose under 60% of the budget.' },
  builder: { name: 'Builder', how: 'Finish at least one base upgrade for the next crew.' },
};

export interface ExpeditionResult {
  n: number;
  status: 'won' | 'lost';
  loseReason?: LoseReason;
  sols: number;
  dose: number;
  doseBudget: number;
  stars: StarId[];
  built: UpgradeId[];
}

export interface Campaign {
  version: 1;
  seed: string;
  /** The class code this campaign started with (it is also the seed). See classcode.ts. */
  classCode?: string;
  difficulty: Difficulty;
  /** Current expedition, 1-based. Past the last one = campaign complete. */
  expedition: number;
  /** The base when the current expedition started (used for retries). */
  base: BaseState;
  prefillPct: number;
  results: ExpeditionResult[];
  usedEventIds: string[];
}

export function newCampaign(seed: string, difficulty: Difficulty): Campaign {
  const base = freshBase();
  return { version: 1, seed, difficulty, expedition: 1, base, prefillPct: 0, results: [], usedEventIds: [] };
}

export function campaignDone(c: Campaign): boolean {
  return c.expedition > EXPEDITIONS.length;
}

export function missionConfigFor(c: Campaign, lightTimeMin: number, eventPool: SpaceWeatherEvent[]): MissionConfig {
  return {
    seed: c.seed,
    difficulty: c.difficulty,
    lightTimeMin,
    eventPool,
    expedition: c.expedition,
    base: c.base,
    prefillPct: c.prefillPct,
    usedEventIds: c.usedEventIds,
  };
}

/** How full the robot O2 plant gets the next crew's tank during the ~26 months the base is empty. */
export function prefillFor(base: BaseState, difficulty: Difficulty): number {
  const cells = TUNING[difficulty].baseCells + base.levels.panel + (base.levels.reactor ? REACTOR_CELLS : 0);
  const boost = base.levels.moxie2 ? UPGRADE_BOOST : 1;
  return Math.min(PREFILL_MAX_PCT, Math.round(cells * PREFILL_PCT_PER_CELL * boost));
}

export function starsFor(end: MissionState): StarId[] {
  const stars: StarId[] = [];
  if (end.status === 'won') stars.push('launch');
  if (end.status === 'won' && end.dose <= end.doseBudget * 0.6) stars.push('safe');
  if (end.builtThisExpedition.length > 0) stars.push('builder');
  return stars;
}

export function resultFor(end: MissionState): ExpeditionResult {
  return {
    n: end.config.expedition,
    status: end.status === 'won' ? 'won' : 'lost',
    loseReason: end.loseReason,
    sols: end.log.length,
    dose: end.dose,
    doseBudget: end.doseBudget,
    stars: starsFor(end),
    built: end.builtThisExpedition,
  };
}

/**
 * Close out an expedition. The base (and Workshop progress) passes to the next crew whether
 * this crew launched or came home early: the outpost is still there.
 */
export function finishExpedition(c: Campaign, end: MissionState): Campaign {
  const used = new Set(c.usedEventIds);
  for (const r of end.log) if (r.storm) used.add(r.storm.event.id);
  const results = c.results.filter((r) => r.n !== end.config.expedition);
  results.push(resultFor(end));
  results.sort((a, b) => a.n - b.n);
  return {
    ...c,
    expedition: c.expedition + 1,
    base: { levels: { ...end.base.levels }, progress: { ...end.base.progress }, project: end.base.project },
    prefillPct: prefillFor(end.base, c.difficulty),
    results,
    usedEventIds: [...used],
  };
}

export function totalStars(c: Campaign): number {
  return c.results.reduce((s, r) => s + r.stars.length, 0);
}

export function serialize(c: Campaign): string {
  return JSON.stringify(c);
}

export function deserialize(raw: string | null): Campaign | null {
  if (!raw) return null;
  try {
    const c = JSON.parse(raw) as Campaign;
    if (c?.version !== 1 || typeof c.expedition !== 'number' || !c.base?.levels) return null;
    return c;
  } catch {
    return null;
  }
}
