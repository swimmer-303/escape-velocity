// Written with AI assistance (Claude Code). See README "Use of AI tools".
// Outpost Architect: the stress test and the live readout's verdict. A short, SIMPLIFIED test using the game's own
// numbers (see ./engineering.ts): 8 sols with a dust storm, cold nights (or the lunar night) and a real solar storm,
// the far-side eruption of May 20, 2024 from NASA DONKI (src/data/snapshots/donki-may2024.json via may2024Pool()).
// The crew starts with the game's Cadet reserves of air and food, like a real new crew.

import { ARCADIA, DUST_STORM_LENGTH, MODULE_CAP, MOON_TUNING, RATES } from '../../sim/constants';
import { may2024Pool } from '../../data/donki';
import type { Severity, SpaceWeatherEvent } from '../../sim/types';
import { CLEAR_DAY, FRESH, countBase, planDay, ratesFor, type BaseCounts, type Carry, type Conditions, type DayPlan } from './engineering';
import type { Layout, SiteId } from './layout';

/** Sols in the stress test. */
export const STRESS_SOLS = 8;

export interface StressDay extends Conditions {
  sol: number;
  /** Short label for the timeline, e.g. "Dust storm". */
  label: string;
}

/** The real storm in the test: the biggest event of the May 2024 replay (the May 20 far-side eruption). */
export function stressEvent(): SpaceWeatherEvent | null {
  try {
    const pool = may2024Pool();
    return pool.filter((e) => e.severity === 'major').at(-1) ?? pool.at(-1) ?? null;
  } catch {
    return null;
  }
}

/** The test's schedule for a site. Mars: a 3-sol dust storm (the game's DUST_STORM_LENGTH), cold nights, the storm. */
export function stressSchedule(site: SiteId, severity: Severity = 'major'): StressDay[] {
  const storm = { severity, fast: severity === 'major' };
  if (site === 'moon') {
    // The game squeezes the ~14.8-day lunar night into MOON_TUNING.nightLength turns.
    const nightLen = MOON_TUNING.cadet.nightLength;
    const days: StressDay[] = [];
    for (let sol = 1; sol <= STRESS_SOLS; sol++) {
      const night = sol >= 4 && sol < 4 + nightLen;
      const nightsLeft = night ? 4 + nightLen - 1 - sol : 0;
      days.push({ sol, weather: 'clear', coldSnap: false, night, nightsLeft, storm: sol === 3 ? storm : null, label: sol === 3 ? 'Solar storm' : night ? 'Lunar night' : 'Lunar day' });
    }
    return days;
  }
  const dustStart = 3;
  const days: StressDay[] = [];
  for (let sol = 1; sol <= STRESS_SOLS; sol++) {
    const inDust = sol >= dustStart && sol < dustStart + DUST_STORM_LENGTH;
    const weather = inDust ? (sol === dustStart + 1 ? 'storm' : 'dusty') : 'clear';
    days.push({ sol, weather, coldSnap: false, night: false, storm: null, label: inDust ? (weather === 'storm' ? 'Huge dust storm' : 'Dust storm') : 'Clear sol' });
  }
  // Cold nights: one at Gale, plus ARCADIA.extraColdSnaps more at the colder ice site.
  const cold = site === 'arcadia' ? [6, 4, 8].slice(0, 1 + ARCADIA.extraColdSnaps) : [6];
  for (const s of cold) {
    days[s - 1].coldSnap = true;
    if (days[s - 1].weather === 'clear') days[s - 1].label = 'Cold night';
  }
  days[6].storm = storm;
  days[6].label = 'Solar storm';
  // Orbiters spot dust a day ahead; cold is forecast too: the base saves cells in its batteries.
  for (let i = 0; i < days.length - 1; i++) days[i].saveForTomorrow = days[i + 1].weather !== 'clear' || days[i + 1].coldSnap;
  return days;
}

export interface StressSol {
  day: StressDay;
  plan: DayPlan;
  /** Stocks at the end of the sol (person-days, mSv, %). */
  air: number;
  food: number;
  dose: number;
  fuel: number;
}

export interface StressResult {
  site: SiteId;
  crew: number;
  sols: StressSol[];
  event: SpaceWeatherEvent | null;
  /** Star 1: air and food never ran out, and every crew member was in a powered shelter in the storm. */
  pass: boolean;
  /** Star 2: heat, air and food were made every sol (no cold nights, reserves never touched). */
  steady: boolean;
  /** Star 3: everyone 90% shielded in the storm, and the rocket gained fuel every sol. */
  stormProof: boolean;
  stars: 0 | 1 | 2 | 3;
  airLeft: number;
  foodLeft: number;
  dose: number;
  doseBudget: number;
  fuel: number;
  /** Plain-English lines for the result card, most important first. */
  notes: string[];
}

const EPS = 1e-9;

/** Run the stress test on a layout. Pure and quick. */
export function runStress(layout: Layout, b: BaseCounts = countBase(layout)): StressResult {
  const site = layout.site;
  const r = ratesFor(site);
  const crew = b.crew;
  let air = r.startAirDays * crew;
  let food = r.startFoodDays * crew;
  let dose = 0;
  let fuel = 0;
  let carry: Carry = { ...FRESH };
  let ranOut = false;
  let steady = crew > 0;
  let shelteredAll = true;
  let ninety = true;
  let fuelEverySol = b.rocket;
  const sols: StressSol[] = [];
  for (const day of stressSchedule(site)) {
    const plan = planDay(b, day, carry);
    carry = plan.next;
    air += plan.airMade - crew * RATES.usePerPersonPerSol;
    food += plan.foodMade - crew * RATES.usePerPersonPerSol;
    dose += r.background + plan.stormDose;
    fuel = Math.min(100, fuel + plan.fuelPct);
    if (air < -EPS || food < -EPS) ranOut = true;
    if (plan.heatShort > 0 || plan.airMade + EPS < plan.airNeed || plan.foodMade + EPS < plan.foodNeed) steady = false;
    if (day.storm && crew > 0) {
      if (plan.sheltered < crew) shelteredAll = false;
      if (plan.block < 0.9 - EPS) ninety = false;
    }
    if (plan.fuelPct <= 0) fuelEverySol = false;
    sols.push({ day, plan, air: Math.max(0, air), food: Math.max(0, food), dose, fuel });
  }
  const pass = crew > 0 && !ranOut && shelteredAll && dose <= r.doseBudget + EPS;
  const steadyOk = pass && steady;
  const stormProof = steadyOk && ninety && fuelEverySol;
  const stars = (pass ? (steadyOk ? (stormProof ? 3 : 2) : 1) : 0) as StressResult['stars'];
  const res: StressResult = {
    site,
    crew,
    sols,
    event: stressEvent(),
    pass,
    steady: steadyOk,
    stormProof,
    stars,
    airLeft: Math.max(0, air),
    foodLeft: Math.max(0, food),
    dose,
    doseBudget: r.doseBudget,
    fuel,
    notes: [],
  };
  res.notes = stressNotes(res, b, { ranOut, shelteredAll, ninety, fuelEverySol });
  return res;
}

function stressNotes(res: StressResult, b: BaseCounts, f: { ranOut: boolean; shelteredAll: boolean; ninety: boolean; fuelEverySol: boolean }): string[] {
  const out: string[] = [];
  if (res.crew <= 0) return ['No crew beds: add a Habitat first.'];
  const where = res.site === 'moon' ? 'turn' : 'sol';
  const firstShort = res.sols.find((s) => s.plan.heatShort > 0 || s.plan.airMade + EPS < s.plan.airNeed || s.plan.foodMade + EPS < s.plan.foodNeed);
  if (f.ranOut) {
    const s = res.sols.find((x) => x.air <= EPS || x.food <= EPS);
    out.push(`The crew ran out of ${s && s.air <= EPS ? 'air' : 'food'} on ${where} ${s?.day.sol ?? '?'}. They would have to go home early.`);
  }
  if (!f.shelteredAll) {
    const storm = res.sols.find((s) => s.day.storm);
    if (storm && !storm.plan.warned) out.push('The fast solar storm hit before any warning. A powered Sun watcher warns you in time.');
    else if (b.seats < res.crew) out.push(`Your shelters fit ${b.seats} of ${res.crew} crew. Add another Storm shelter.`);
    else out.push('Not enough power to run every shelter during the storm.');
  }
  if (firstShort) {
    const p = firstShort.plan;
    const what = p.heatShort > 0 ? 'heat' : p.airMade + EPS < p.airNeed ? 'air' : 'food';
    out.push(`${firstShort.day.label} (${where} ${firstShort.day.sol}): not enough ${what}. ${shortFix(res.site, firstShort, what, b)}`);
  }
  if (res.pass && !f.ninety) out.push('In the storm, some crew got only 50% protection. 2 cells per shelter (or a berm next to it) blocks 90%.');
  if (res.pass && b.rocket && !f.fuelEverySol) out.push('On some days there was no spare power for rocket fuel.');
  if (res.pass && !b.rocket) out.push('No rocket: the crew has no ride home. Add a Rocket and pad.');
  if (!out.length) out.push('Your base handled everything. Great engineering!');
  return out;
}

function shortFix(site: SiteId, s: StressSol, what: string, b: BaseCounts): string {
  const day = s.day;
  if (what === 'heat' && b.heaters * MODULE_CAP.heaters < s.plan.heatNeed) return 'Add another Heater.';
  if (day.night) return b.batteries ? 'Add more batteries, or a reactor.' : 'Add a battery bank: it saves daytime power for the night.';
  if (day.weather !== 'clear') return b.batteries ? 'Add more panels or batteries.' : 'Add a battery or more panels.';
  if (day.coldSnap) return 'Add a Heater, or more power for cold nights.';
  if (what === 'air') return 'Add power, or another O2 plant.';
  if (what === 'food') return 'Add power, or another Greenhouse.';
  return site === 'moon' ? 'Add more power.' : 'Add more panels.';
}

// ------------------------------------------------------------------ the live readout
export type Tone = 'good' | 'warn' | 'bad';

export interface Readout {
  counts: BaseCounts;
  /** A clear, sunny sol (a lunar day on the Moon). */
  sunny: DayPlan;
  /** The toughest sol of the stress test (least power left after the crew's needs). */
  hardest: StressSol | null;
  /** Rocket full in this many sols at the sunny-day rate (null: no fuel). */
  solsToFill: number | null;
  stress: StressResult;
  verdict: { tone: Tone; text: string };
}

function shortOf(p: DayPlan): number {
  return p.heatShort + Math.max(0, p.airNeed - p.airMade) + Math.max(0, p.foodNeed - p.foodMade);
}

export function readout(layout: Layout): Readout {
  const counts = countBase(layout);
  const sunny = planDay(counts, CLEAR_DAY);
  const stress = runStress(layout, counts);
  let hardest: StressSol | null = null;
  let worst = -Infinity;
  for (const s of stress.sols) {
    const score = shortOf(s.plan) * 100 - s.plan.spare - s.plan.use.fuel + (s.day.label === 'Clear sol' || s.day.label === 'Lunar day' ? -50 : 0);
    if (score > worst) {
      worst = score;
      hardest = s;
    }
  }
  const solsToFill = sunny.fuelPct > 0 ? Math.ceil(100 / sunny.fuelPct - 1e-9) : null;
  return { counts, sunny, hardest, solsToFill, stress, verdict: verdictFor(counts, sunny, stress, solsToFill) };
}

/** One plain-English line about the most important thing to fix (or a cheer). */
export function verdictFor(b: BaseCounts, sunny: DayPlan, stress: StressResult, solsToFill: number | null): { tone: Tone; text: string } {
  const bad = (text: string) => ({ tone: 'bad' as const, text });
  const warn = (text: string) => ({ tone: 'warn' as const, text });
  const where = b.site === 'moon' ? 'turns' : 'sols';
  if (b.habitats === 0) return bad('Start with a Habitat: your crew needs beds.');
  if (b.panels + b.reactors === 0) return bad('No power yet: add Solar panels.');
  if (b.o2 + b.bigo2 === 0) return bad('Add an O2 plant so the crew can breathe.');
  if (b.greenhouses === 0) return bad('Add a Greenhouse to grow food.');
  if (b.heaters === 0) return bad('Add a Heater: cold nights freeze the batteries.');
  if (sunny.airMade + EPS < sunny.airNeed) return bad(sunny.use.air >= (b.o2 + b.bigo2) * MODULE_CAP.air ? 'Not enough air: add another O2 plant.' : 'Not enough air even on a sunny day: add more panels.');
  if (sunny.foodMade + EPS < sunny.foodNeed) return bad(sunny.use.food >= b.greenhouses * MODULE_CAP.greenhouse ? 'Not enough food: add another Greenhouse.' : 'Not enough food even on a sunny day: add more panels.');
  if (sunny.heatShort > 0) return bad(b.heaters * MODULE_CAP.heaters < sunny.heatNeed ? 'Not enough heat: add another Heater.' : 'Not enough power for heat: add more panels.');
  // The tough days, from the stress test.
  const shortDay = stress.sols.find((s) => shortOf(s.plan) > EPS);
  if (shortDay) {
    const d = shortDay.day;
    if (d.night) return warn(b.batteries ? 'Not enough power in the lunar night: add more batteries or a reactor.' : 'Not enough power at night: add a battery or a reactor.');
    if (d.weather !== 'clear') return warn(b.batteries ? 'A dust storm dims the panels too much: add panels or batteries.' : 'Not enough power in a dust storm: add a battery or more panels.');
    if (d.coldSnap) return warn(b.heaters * MODULE_CAP.heaters < shortDay.plan.heatNeed ? 'Cold nights need more heat: add a Heater.' : 'Not enough power on cold nights: add panels or a battery.');
    if (d.storm) return warn('Running the shelter in a storm leaves too little power: add panels.');
  }
  if (b.shelters === 0) return warn('No Storm shelter yet: a solar storm could hurt your crew.');
  if (b.seats < b.crew) return warn(`Your shelters fit ${b.seats} of ${b.crew} crew: add another Storm shelter.`);
  if (b.site !== 'moon' && b.monitors === 0) return warn('Add a Sun watcher: fast storms beat Earth\'s warning to Mars.');
  if (!stress.pass) return warn(stress.notes[0] ?? 'Run the stress test to see what goes wrong.');
  if (!b.rocket) return warn('Build a Rocket and pad so the crew can go home.');
  if (!solsToFill) return warn('No spare power for rocket fuel: add more panels.');
  return { tone: 'good', text: `Looking good! Rocket full in ${solsToFill} ${where} on sunny days. Try the stress test.` };
}
