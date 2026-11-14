// Written with AI assistance (Claude Code). See README "Use of AI tools".
// A compact history of one crew's mission, for the "How your mission went" charts:
// the HUD numbers at landing and at the end of every sol, plus the events that explain them.
// Small enough to keep in the campaign save, so the finale can chart every crew.

import { UPGRADE_IDS, type UpgradeId } from './upgrades';
import type { LoseReason, MissionState, Severity } from './types';

/** How well the shelter covered the crew during a solar storm. */
export type ShelterCover = 'full' | 'part' | 'none';

export interface SeriesStorm {
  sol: number;
  severity: Severity;
  shelter: ShelterCover;
  /** Dose the crew actually took from the storm, mSv. */
  dose: number;
}

export interface SeriesBuild {
  sol: number;
  id: UpgradeId;
}

export interface MissionSeries {
  /** Index 0 is landing day (before sol 1); index k is the end of sol k. */
  fuel: number[];
  /** Days of air and food for the whole crew (what the HUD shows). */
  air: number[];
  food: number[];
  /** Radiation dose, mSv. */
  dose: number[];
  doseBudget: number;
  storms: SeriesStorm[];
  /** Sols with dust in the sky (less solar power). */
  dust: number[];
  built: SeriesBuild[];
  /** Sols the heaters were short of power. */
  cold: number[];
}

const r2 = (x: number) => Math.round(x * 100) / 100;

/** Pull the chart series out of a mission's sol log. */
export function missionSeries(m: Pick<MissionState, 'log' | 'doseBudget'>): MissionSeries {
  const s: MissionSeries = { fuel: [], air: [], food: [], dose: [], doseBudget: m.doseBudget, storms: [], dust: [], built: [], cold: [] };
  if (!m.log.length) return s;
  const points = [m.log[0].before, ...m.log.map((r) => r.after)];
  for (const p of points) {
    s.fuel.push(r2(p.fuel));
    s.air.push(r2(p.air));
    s.food.push(r2(p.food));
    s.dose.push(r2(p.dose));
  }
  for (const r of m.log) {
    if (r.storm) {
      const st = r.storm;
      const shelter: ShelterCover = st.shelterCells <= 0 ? 'none' : st.doseTaken <= st.doseUnsheltered * 0.1 + 1e-6 ? 'full' : 'part';
      s.storms.push({ sol: r.sol, severity: st.event.severity, shelter, dose: r2(st.doseTaken) });
    }
    if (r.weather !== 'clear') s.dust.push(r.sol);
    if (r.built) s.built.push({ sol: r.sol, id: r.built });
    if (r.heaterShortfall > 0) s.cold.push(r.sol);
  }
  return s;
}

/** Sols played (the last index of the value arrays). */
export function seriesSols(s: MissionSeries): number {
  return Math.max(0, s.fuel.length - 1);
}

const isNums = (x: unknown): x is number[] => Array.isArray(x) && x.every((v) => typeof v === 'number' && Number.isFinite(v));
const isSols = (x: unknown): x is number[] => isNums(x) && x.every((v) => Number.isInteger(v) && v >= 1);

/** Checks a series read back from a save (anything else is dropped, and the finale shows a note instead). */
export function isMissionSeries(x: unknown): x is MissionSeries {
  if (!x || typeof x !== 'object') return false;
  const s = x as Partial<MissionSeries>;
  if (!isNums(s.fuel) || !isNums(s.air) || !isNums(s.food) || !isNums(s.dose)) return false;
  const n = s.fuel.length;
  if (s.air.length !== n || s.food.length !== n || s.dose.length !== n) return false;
  if (typeof s.doseBudget !== 'number' || !(s.doseBudget > 0)) return false;
  if (!isSols(s.dust) || !isSols(s.cold)) return false;
  if (!Array.isArray(s.storms) || !s.storms.every((t) => t && typeof t.sol === 'number' && ['full', 'part', 'none'].includes(t.shelter) && typeof t.dose === 'number'))
    return false;
  if (!Array.isArray(s.built) || !s.built.every((b) => b && typeof b.sol === 'number' && (UPGRADE_IDS as readonly string[]).includes(b.id))) return false;
  return true;
}

// ------------------------------------------------------------------ the one-line takeaway

/** How an upgrade reads in a sentence ("after you built ..."). */
export function upgradePhrase(id: UpgradeId): string {
  return UPGRADE_PHRASE[id];
}

const UPGRADE_PHRASE: Record<UpgradeId, string> = {
  panel: 'a new row of solar panels',
  monitor: 'the radiation monitor',
  battery: 'the battery bank',
  berm: 'the regolith berm',
  dome2: 'the second greenhouse dome',
  moxie2: 'the Big O2 plant',
  reactor: 'the fission reactor',
};

/** Upgrades that really do make more fuel per sol (more oxygen per cell, or more cells). */
const FUEL_UPGRADES: readonly UpgradeId[] = ['moxie2', 'panel', 'reactor'];

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/** Fuel added on each sol: index k-1 is sol k. The last sol is left out if the tank topped off (it was capped). */
function fuelGains(s: MissionSeries): Array<{ sol: number; gain: number }> {
  const n = seriesSols(s);
  const out: Array<{ sol: number; gain: number }> = [];
  for (let k = 1; k <= n; k++) {
    if (k === n && s.fuel[n] >= 99.95) break;
    out.push({ sol: k, gain: s.fuel[k] - s.fuel[k - 1] });
  }
  return out;
}

/** The upgrade after which the tank filled clearly faster, if any. */
export function fuelSpeedup(s: MissionSeries): { id: UpgradeId; sol: number; before: number; after: number } | null {
  const gains = fuelGains(s);
  let best: { id: UpgradeId; sol: number; before: number; after: number } | null = null;
  for (const b of s.built) {
    if (!FUEL_UPGRADES.includes(b.id)) continue;
    const before = gains.filter((g) => g.sol <= b.sol).map((g) => g.gain);
    const after = gains.filter((g) => g.sol > b.sol).map((g) => g.gain);
    if (before.length < 2 || after.length < 2) continue;
    const mb = mean(before);
    const ma = mean(after);
    if (ma >= mb * 1.25 && ma - mb >= 1.5 && (!best || ma - mb > best.after - best.before)) best = { id: b.id, sol: b.sol, before: mb, after: ma };
  }
  return best;
}

/** Runs of back-to-back sols, e.g. [4,5,6,9] -> [[4,6],[9,9]]. */
export function runsOf(sols: number[]): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const k of [...sols].sort((a, b) => a - b)) {
    const last = out[out.length - 1];
    if (last && k === last[1] + 1) last[1] = k;
    else out.push([k, k]);
  }
  return out;
}

/** "sol 5" or "sols 4 to 6". */
export function solSpan([a, b]: [number, number]): string {
  return a === b ? `sol ${a}` : `sols ${a} to ${b}`;
}

/** The dust storm during which fuel clearly slowed down, if any. */
function dustSlowdown(s: MissionSeries): [number, number] | null {
  const gains = fuelGains(s);
  const dust = new Set(s.dust);
  const clear = mean(gains.filter((g) => !dust.has(g.sol)).map((g) => g.gain));
  if (clear < 1) return null;
  let worst: { run: [number, number]; rate: number } | null = null;
  for (const run of runsOf(s.dust)) {
    const inRun = gains.filter((g) => g.sol >= run[0] && g.sol <= run[1]).map((g) => g.gain);
    if (!inRun.length) continue;
    const rate = mean(inRun);
    if (rate <= clear * 0.6 && (!worst || rate < worst.rate)) worst = { run, rate };
  }
  return worst?.run ?? null;
}

export interface SeriesOutcome {
  status: 'won' | 'lost' | 'playing';
  loseReason?: LoseReason;
}

/** One plain sentence that says why the mission went the way it did, read straight from the chart's data. */
export function seriesTakeaway(s: MissionSeries, outcome: SeriesOutcome): string {
  const n = seriesSols(s);
  if (n < 1) return 'This crew did not finish a sol.';
  const recentDust = s.dust.some((k) => k >= n - 2);

  if (outcome.status === 'lost') {
    switch (outcome.loseReason) {
      case 'air':
      case 'food': {
        const what = outcome.loseReason === 'air' ? 'air' : 'food';
        return recentDust ? `The ${what} ran out on sol ${n}, just after a dust storm cut your power.` : `The ${what} ran out on sol ${n}, so the crew had to go home early.`;
      }
      case 'dose': {
        if (s.storms.some((st) => st.sol === n && st.dose >= 1)) return `The solar storm on sol ${n} pushed the dose past the limit.`;
        const big = s.storms.filter((st) => st.shelter !== 'full' && st.dose >= 2).sort((a, b) => b.dose - a.dose)[0];
        return big
          ? `The storm on sol ${big.sol} hit the crew outside the shelter, so the dose passed the limit on sol ${n}.`
          : `The dose crept up every sol until it passed the limit on sol ${n}.`;
      }
      case 'window':
        return `The tank was only ${Math.floor(s.fuel[n])}% full when the launch window closed on sol ${n}.`;
      default:
        break;
    }
  }

  const speed = fuelSpeedup(s);
  if (speed) return `Your fuel climbed faster after you built ${UPGRADE_PHRASE[speed.id]} on sol ${speed.sol}.`;

  const hit = s.storms.filter((st) => st.shelter !== 'full' && st.dose >= 2).sort((a, b) => b.dose - a.dose)[0];
  if (hit) return `The solar storm on sol ${hit.sol} hit ${hit.shelter === 'part' ? 'with the shelter only half on' : 'while the shelter was off'}, so the dose jumped.`;

  const dust = dustSlowdown(s);
  if (dust) return `Fuel grew slowly during the dust storm on ${solSpan(dust)}, when the panels made less power.`;

  if (s.storms.length && s.storms.every((st) => st.shelter === 'full')) {
    const all = s.storms.length === 1 ? 'the solar storm' : s.storms.length === 2 ? 'both solar storms' : `all ${s.storms.length} solar storms`;
    const low = s.dose[n] < s.doseBudget * 0.6;
    return low ? `You sheltered from ${all}, so the dose stayed low.` : `You sheltered from ${all}. The rest of the dose came from living on Mars.`;
  }
  if (outcome.status === 'won') return `Your crew filled the tank in ${n} sol${n === 1 ? '' : 's'}.`;
  return `After ${n} sol${n === 1 ? '' : 's'}, the tank was ${Math.floor(s.fuel[n])}% full.`;
}
