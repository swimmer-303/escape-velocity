// Written with AI assistance (Claude Code). See README "Use of AI tools".
// Builds the hidden day-by-day plan for a mission from a seed and a pool of REAL
// space-weather events. The player's choices never change the plan; they change
// how well the outpost copes with it.

import { DUST_STORM_LENGTH, MOON_TUNING, expeditionFor, landingOf, tuningFor } from './constants';
import { makeRng, randInt, shuffle, type Rng } from './rng';
import { applyLabPlan, dealLabStorms, stormDealFor } from './lab';
import type { MissionConfig, SolPlan, SpaceWeatherEvent, Severity } from './types';

const SEVERITY_RANK: Record<Severity, number> = { minor: 0, moderate: 1, major: 2 };

/** Major (X-class) storms send the fastest particles: they can beat Earth's warning to Mars. */
export function isFast(e: SpaceWeatherEvent): boolean {
  return e.severity === 'major';
}

/** Start of the May 2024 "Replay History" scenario: sol 1 = May 6, 2024 (UTC). */
export const MAY2024_START = Date.UTC(2024, 4, 6);

export function chooseStorms(rng: Rng, pool: SpaceWeatherEvent[], count: number, maxMajor: number): SpaceWeatherEvent[] {
  // Sort first, so the same events give the same storms whatever order they arrived in
  // (one class code = the same Mars on every student's device).
  const events = [...pool].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const byTier = (sev: Severity) => {
    const live = shuffle(rng, events.filter((e) => e.severity === sev && e.origin === 'live'));
    const archive = shuffle(rng, events.filter((e) => e.severity === sev && e.origin === 'archive'));
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
  const t = tuningFor(config.difficulty, config.site, landingOf(config));
  const spec = expeditionFor(config.expedition, config.site, landingOf(config));
  const rng = makeRng(`${config.seed}|plan|${config.expedition}`);
  const W = spec.windowSol + t.windowBonus;
  const plan = blankPlan(W);
  const at = (sol: number) => plan[sol - 1];

  // --- Radiation storms from real DONKI events -------------------------------
  const stormSols: number[] = [];
  let drawSols = stormSols;
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
    const used = new Set(config.usedEventIds ?? []);
    const fresh = config.eventPool.filter((e) => !used.has(e.id));
    const pool = fresh.length >= t.stormCount ? fresh : config.eventPool;
    const storms = chooseStorms(rng, pool, t.stormCount, t.maxMajor);
    placeStorms(plan, rng, storms, W, stormSols);
    if (config.lab && config.lab.sun !== 'average') {
      // Space Lab: a quieter or busier Sun. Deal again from the same real pool, on the lab's own random stream, so
      // the rest of the plan (dust storms, cold snaps, blackout, false alarms) stays exactly the same: a fair test.
      drawSols = [...stormSols];
      for (const sol of stormSols) delete at(sol).storm;
      stormSols.length = 0;
      const labRng = makeRng(`${config.seed}|lab-sun|${config.expedition}`);
      placeStorms(plan, labRng, dealLabStorms(labRng, pool, stormDealFor(t, config.lab.sun)), W, stormSols);
    }
  }

  // Earth's outlook: "the Sun is active" before real storms, plus some false alarms.
  // (A Space Lab Sun moved the storms: the false alarms are still drawn as for the real storms, so the rest of the
  // plan is unchanged. Without the lab, drawSols is stormSols and this is simply `soon || rng() < 0.15`.)
  for (const p of plan) {
    // Earth sees active sunspot regions days ahead, but can't say exactly when (or if) they'll erupt.
    const near = (sols: number[]) => sols.some((s) => s >= p.sol && s <= p.sol + 3);
    const falseAlarm = !near(drawSols) && rng() < 0.15;
    p.outlookActive = near(stormSols) || falseAlarm;
  }

  if (config.site === 'moon') return moonPlan(plan, rng, W, MOON_TUNING[config.difficulty].nightLength, spec.resupplySol);

  // --- Dust storms (Opportunity-style), spotted from orbit a day ahead --------
  const dustKinds: Array<'dusty' | 'storm'> = t.dustStorms >= 2 ? ['dusty', 'storm'] : ['dusty'];
  let lastDustEnd = 0;
  for (let i = 0; i < dustKinds.length; i++) {
    const kind = dustKinds[i];
    const len = DUST_STORM_LENGTH;
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
  at(Math.min(spec.resupplySol, W)).resupply = true;

  // Space Lab: Mars' place in its orbit changes how big the dust storms get (same days, see lab.ts).
  if (config.lab) applyLabPlan(plan, config.lab);

  return plan;
}

/** Spread storms over sols 3..W-3, about 3 sols apart. Records each storm's sol in `stormSols`. */
function placeStorms(plan: SolPlan[], rng: Rng, storms: SpaceWeatherEvent[], W: number, stormSols: number[]): void {
  const at = (sol: number) => plan[sol - 1];
  const first = 3;
  const last = Math.min(W - 4, 15);
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

/**
 * The Moon has no air: no dust storms, no wind, no weather. Earth is 1.3 light-seconds away, so the Sun never
 * blocks the radio. What it does have is the lunar night: about 14.8 Earth days of darkness (half of the 29.53-day
 * synodic month, NASA Moon Fact Sheet), compressed here into a few turns.
 */
function moonPlan(plan: SolPlan[], rng: Rng, W: number, nightLength: number, resupplySol: number): SolPlan[] {
  const at = (sol: number) => plan[sol - 1];
  // Leave a few days to stock up before the night, and a few to finish fuelling after it.
  const lo = Math.max(5, Math.round(W * 0.3));
  const hi = Math.max(lo, W - nightLength - 6);
  const start = randInt(rng, lo, hi);
  for (let s = start; s < start + nightLength && s <= W; s++) at(s).night = true;
  at(Math.min(resupplySol, W)).resupply = true;
  return plan;
}

export function severityRank(s: Severity): number {
  return SEVERITY_RANK[s];
}
