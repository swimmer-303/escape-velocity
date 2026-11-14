// Written with AI assistance (Claude Code). See README "Use of AI tools".
// Builds the hidden day-by-day plan for a mission from a seed and a pool of REAL
// space-weather events. The player's choices never change the plan; they change
// how well the outpost copes with it.

import { TUNING, DUST_STORM_LENGTH } from './constants';
import { makeRng, randInt, shuffle, type Rng } from './rng';
import type { MissionConfig, SolPlan, SpaceWeatherEvent, Severity } from './types';

const SEVERITY_RANK: Record<Severity, number> = { minor: 0, moderate: 1, major: 2 };

/** Major (X-class) storms send the fastest particles: they can beat Earth's warning to Mars. */
export function isFast(e: SpaceWeatherEvent): boolean {
  return e.severity === 'major';
}

/** Start of the May 2024 "Replay History" scenario: sol 1 = May 6, 2024 (UTC). */
export const MAY2024_START = Date.UTC(2024, 4, 6);

export function chooseStorms(rng: Rng, pool: SpaceWeatherEvent[], count: number, maxMajor: number): SpaceWeatherEvent[] {
  const byTier = (sev: Severity) => {
    const live = shuffle(rng, pool.filter((e) => e.severity === sev && e.origin === 'live'));
    const archive = shuffle(rng, pool.filter((e) => e.severity === sev && e.origin === 'archive'));
    return [...live, ...archive];
  };
  const majors = byTier('major');
  const moderates = byTier('moderate');
  const minors = byTier('minor');
  const chosen: SpaceWeatherEvent[] = [];
  const seen = new Set<string>();
  const take = (list: SpaceWeatherEvent[], n: number) => {
    for (const e of list) {
      if (chosen.length >= count || n <= 0) break;
      if (seen.has(e.id)) continue;
      seen.add(e.id);
      chosen.push(e);
      n--;
    }
  };
  take(majors, maxMajor);
  take(moderates, count - chosen.length);
  take(minors, count - chosen.length);
  // Show the real events in the order they really happened.
  return chosen.sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
}

function blankPlan(windowSol: number): SolPlan[] {
  const plan: SolPlan[] = [];
  for (let sol = 1; sol <= windowSol; sol++) {
    plan.push({
      sol,
      weather: 'clear',
      dustTomorrow: false,
      coldSnap: false,
      outlookActive: false,
      blackout: false,
      resupply: false,
      cleaning: false,
    });
  }
  return plan;
}

export function buildPlan(config: MissionConfig): SolPlan[] {
  const t = TUNING[config.difficulty];
  const rng = makeRng(`${config.seed}|plan`);
  const plan = blankPlan(t.windowSol);
  const at = (sol: number) => plan[sol - 1];
  const W = t.windowSol;

  // --- Radiation storms from real DONKI events -------------------------------
  const stormSols: number[] = [];
  if (config.scenario === 'may2024') {
    // Replay History: put each real event on the sol matching its real date.
    for (const e of config.eventPool) {
      const sol = 1 + Math.floor((Date.parse(e.time) - MAY2024_START) / 86_400_000);
      if (sol >= 1 && sol <= W && !at(sol).storm) {
        at(sol).storm = { event: e, fast: isFast(e) };
        stormSols.push(sol);
      }
    }
  } else {
    const storms = chooseStorms(rng, config.eventPool, t.stormCount, t.maxMajor);
    // Spread them over sols 3..W-3, at least 3 sols apart.
    const first = 3;
    const last = Math.min(W - 4, 16);
    const span = last - first;
    const step = storms.length > 1 ? span / storms.length : span;
    storms.forEach((e, i) => {
      const lo = Math.round(first + i * step);
      const hi = Math.max(lo, Math.round(first + (i + 1) * step) - 2);
      let sol = randInt(rng, lo, hi);
      while (at(sol).storm && sol < last) sol++;
      at(sol).storm = { event: e, fast: isFast(e) };
      stormSols.push(sol);
    });
  }

  // Earth's outlook: "the Sun is active" before real storms, plus some false alarms.
  for (const p of plan) {
    // Earth sees active sunspot regions days ahead, but can't say exactly when (or if) they'll erupt.
    const soon = stormSols.some((s) => s >= p.sol && s <= p.sol + 3);
    p.outlookActive = soon || rng() < 0.15;
  }

  // --- Dust storms (Opportunity-style), spotted from orbit a day ahead --------
  const dustKinds: Array<'dusty' | 'storm'> = t.dustStorms >= 2 ? ['dusty', 'storm'] : ['dusty'];
  let lastDustEnd = 0;
  for (let i = 0; i < dustKinds.length; i++) {
    const kind = dustKinds[i];
    const len = kind === 'storm' ? DUST_STORM_LENGTH.global : DUST_STORM_LENGTH.regional;
    const segLo = Math.max(4, lastDustEnd + 3);
    const segHi = Math.min(W - len - 2, segLo + Math.floor((W - 6) / dustKinds.length));
    if (segHi < segLo) break;
    const start = randInt(rng, segLo, segHi);
    for (let s = start; s < start + len; s++) at(s).weather = kind;
    if (start > 1) at(start - 1).dustTomorrow = true;
    lastDustEnd = start + len - 1;
  }

  // Wind sometimes cleans the panels after a storm (Spirit and Opportunity got "cleaning events").
  const cleanSol = Math.min(W - 1, lastDustEnd + randInt(rng, 2, 4));
  if (cleanSol > 2 && at(cleanSol).weather === 'clear') at(cleanSol).cleaning = true;

  // --- Cold snaps ----------------------------------------------------------------
  let placed = 0;
  let guard = 0;
  while (placed < t.coldSnaps && guard++ < 100) {
    const s = randInt(rng, 3, W - 1);
    if (!at(s).coldSnap) {
      at(s).coldSnap = true;
      placed++;
    }
  }

  // --- Solar conjunction blackout (Commander) ---------------------------------
  if (t.blackout) {
    const start = randInt(rng, 6, W - 8);
    for (let s = start; s < start + 3; s++) at(s).blackout = true;
  }

  // --- Cargo resupply -----------------------------------------------------------
  at(Math.min(t.resupplySol, W)).resupply = true;

  return plan;
}

export function severityRank(s: Severity): number {
  return SEVERITY_RANK[s];
}
