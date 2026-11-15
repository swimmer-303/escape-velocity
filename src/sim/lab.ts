// Written with AI assistance (Claude Code). See README "Use of AI tools".
//
// The Space Lab: a what-if lab framed as a fair-test science experiment. A player turns six dials (the world, the
// Sun's activity, where Mars is in its orbit, dust in the air, the message delay from Earth, and the crew size) and
// runs a mission to see what changes. This file is the pure part: the settings, their defaults (the real, normal
// game), sanitizing saved data, and every number a dial changes. sim.ts and plan.ts apply it ONLY when a mission
// config carries `lab`, so every normal mission (campaign, quick, daily, Rival Race, May 2024) is unchanged.
//
// It is NOT a real NASA simulation: it is the game's own model with a few real numbers plugged in. Every number is
// listed in docs/data-notes.md ("Space Lab") with its source, or marked "game value" / "game approximation".
//
// No DOM, and no imports from sim.ts or plan.ts (they import this file).

import { DUST_LOSS, REAL, type Landing, type Site, type Tuning } from './constants';
import { shuffle, type Rng } from './rng';
import type { Severity, SolPlan, SpaceWeatherEvent, Weather } from './types';

export type LabWorld = 'gale' | 'arcadia' | 'moon';
export type SunLevel = 'min' | 'average' | 'max';
export type OrbitLevel = 'aphelion' | 'average' | 'perihelion';
export type DustLevel = 'clear' | 'hazy' | 'dusty' | 'storm' | 'global';
export type LabDial = 'world' | 'sun' | 'orbit' | 'dust' | 'delay' | 'crew';

export interface LabSettings {
  world: LabWorld;
  sun: SunLevel;
  /** Mars only. */
  orbit: OrbitLevel;
  /** Mars only. */
  dust: DustLevel;
  /** Mars only: one-way Earth-Mars light time in whole minutes (3 to 22). null: today's real value. */
  delayMin: number | null;
  /** Astronauts (2 to 6). */
  crew: number;
  /** The mission seed: the same seed deals the same storms, dust storms and cold snaps ("Same storms each run"). */
  seed: string;
}

export const LAB_WORLDS: readonly LabWorld[] = ['gale', 'arcadia', 'moon'];
export const SUN_LEVELS: readonly SunLevel[] = ['min', 'average', 'max'];
export const ORBIT_LEVELS: readonly OrbitLevel[] = ['aphelion', 'average', 'perihelion'];
export const DUST_LEVELS: readonly DustLevel[] = ['clear', 'hazy', 'dusty', 'storm', 'global'];
export const LAB_DIALS: readonly LabDial[] = ['world', 'sun', 'orbit', 'dust', 'delay', 'crew'];

/** Crew size: 2 to 6 (the game's crews have 4, 5 and 6; a quick mission has 4). */
export const LAB_CREW = { min: 2, max: 6, real: 4 } as const;
/** Earth-Mars one-way light time, minutes: REAL.marsLightMinMin to REAL.marsLightMaxMin (3 to 22). */
export const LAB_DELAY = { min: REAL.marsLightMinMin, max: REAL.marsLightMaxMin } as const;
export const DEFAULT_LAB_SEED = 'lab-1';

/** The real, normal game: what "Reset to real" goes back to. */
export function defaultLab(seed: string = DEFAULT_LAB_SEED): LabSettings {
  return { world: 'gale', sun: 'average', orbit: 'average', dust: 'hazy', delayMin: null, crew: LAB_CREW.real, seed };
}

const oneOf = <T extends string>(list: readonly T[], v: unknown, fallback: T): T => (typeof v === 'string' && (list as readonly string[]).includes(v) ? (v as T) : fallback);

/** Anything (old saves, a hand-edited localStorage, garbage) -> valid settings. Never throws. */
export function sanitizeLab(x: unknown): LabSettings {
  const d = defaultLab();
  if (!x || typeof x !== 'object') return d;
  const o = x as Record<string, unknown>;
  const crew = typeof o.crew === 'number' && Number.isFinite(o.crew) ? Math.round(o.crew) : d.crew;
  const delay = typeof o.delayMin === 'number' && Number.isFinite(o.delayMin) ? Math.round(o.delayMin) : null;
  const seed = typeof o.seed === 'string' && /^[A-Za-z0-9-]{1,24}$/.test(o.seed) ? o.seed : d.seed;
  return {
    world: oneOf(LAB_WORLDS, o.world, d.world),
    sun: oneOf(SUN_LEVELS, o.sun, d.sun),
    orbit: oneOf(ORBIT_LEVELS, o.orbit, d.orbit),
    dust: oneOf(DUST_LEVELS, o.dust, d.dust),
    delayMin: delay === null ? null : Math.max(LAB_DELAY.min, Math.min(LAB_DELAY.max, delay)),
    crew: Math.max(LAB_CREW.min, Math.min(LAB_CREW.max, crew)),
    seed,
  };
}

export const isMarsLab = (lab: Pick<LabSettings, 'world'>) => lab.world !== 'moon';
export const labSite = (lab: Pick<LabSettings, 'world'>): Site => (lab.world === 'moon' ? 'moon' : 'mars');
export const labLanding = (lab: Pick<LabSettings, 'world'>): Landing => (lab.world === 'arcadia' ? 'arcadia' : 'gale');

/**
 * Which dials differ from the real game. The world is a choice of real place (all three are real), so it never
 * counts as a change; Mars-only dials do not count on the Moon (they do nothing there); a delay of null is today's.
 */
export function changedDials(lab: LabSettings): LabDial[] {
  const d = defaultLab();
  const out: LabDial[] = [];
  if (lab.sun !== d.sun) out.push('sun');
  if (isMarsLab(lab)) {
    if (lab.orbit !== d.orbit) out.push('orbit');
    if (lab.dust !== d.dust) out.push('dust');
    if (lab.delayMin !== null) out.push('delay');
  }
  if (lab.crew !== d.crew) out.push('crew');
  return out;
}

/** True when every dial is at its real value (the mission plays exactly like a normal quick mission). */
export function isRealLab(lab: LabSettings): boolean {
  return changedDials(lab).length === 0;
}

// ------------------------------------------------------------------ Mars in its orbit
/**
 * Mars' distance from the Sun, km. NASA Mars Fact Sheet (https://nssdc.gsfc.nasa.gov/planetary/factsheet/marsfact.html):
 * "Semimajor axis (10^6 km) 227.956", "Perihelion (10^6 km) 206.650", "Aphelion (10^6 km) 249.261".
 */
export const MARS_ORBIT_KM: Record<OrbitLevel, number> = { aphelion: 249.261e6, average: 227.956e6, perihelion: 206.65e6 };
/** Sunlight at Mars' average distance, W/m². NASA Mars Fact Sheet: "Solar irradiance (W/m2) 586.2". */
export const MARS_IRRADIANCE_WM2 = 586.2;

/** Sunlight compared with Mars' average distance, by the inverse-square law: (average / distance)². */
export function orbitSunFactor(level: OrbitLevel): number {
  const r = MARS_ORBIT_KM.average / MARS_ORBIT_KM[level];
  return r * r;
}
/** Sunlight at that distance, W/m². */
export function orbitIrradiance(level: OrbitLevel): number {
  return MARS_IRRADIANCE_WM2 * orbitSunFactor(level);
}
/** How much more sunlight Mars gets at its closest point than at its farthest: (aphelion / perihelion)² (about 1.45). */
export function periAphRatio(): number {
  const r = MARS_ORBIT_KM.aphelion / MARS_ORBIT_KM.perihelion;
  return r * r;
}

// ------------------------------------------------------------------ dust in the air
/**
 * Dust optical depth (tau) for each level. Only the planet-wide storm is measured: JPL gives tau 10.8 over
 * Opportunity on June 10, 2018. The others are GAME APPROXIMATIONS of a clear, a normal (hazy), a dusty and a
 * stormy Mars sky.
 */
export const DUST_TAU: Record<DustLevel, number> = { clear: 0.3, hazy: 0.6, dusty: 1.5, storm: 3, global: 10.8 };

/**
 * Solar power compared with a normal (hazy) day. GAME APPROXIMATION, built on the game's own dust-storm losses and
 * one real anchor:
 * - clear: a little more than normal (game value, 1.1);
 * - dusty: the game's "Dust storm" day, which loses DUST_LOSS.dusty (30%);
 * - storm: the game's "Huge dust storm" day, which loses DUST_LOSS.storm (40%);
 * - global: Opportunity in the 2018 planet-wide storm (tau 10.8): about 22 Wh on its darkest day against about 700 Wh
 *   on a normal one (REAL.oppy2018StormWh / REAL.oppyNormalWh, about 3%).
 */
export function dustPowerFactor(level: DustLevel): number {
  switch (level) {
    case 'clear':
      return 1.1;
    case 'hazy':
      return 1;
    case 'dusty':
      return 1 - DUST_LOSS.dusty;
    case 'storm':
      return 1 - DUST_LOSS.storm;
    case 'global':
      return REAL.oppy2018StormWh / REAL.oppyNormalWh;
  }
}

// ------------------------------------------------------------------ solar power
/** Sunlight reaching the panels compared with the real game (Mars: orbit x dust; the Moon: always 1). */
export function labSunFactor(lab: Pick<LabSettings, 'world' | 'orbit' | 'dust'>): number {
  if (!isMarsLab(lab)) return 1;
  return orbitSunFactor(lab.orbit) * dustPowerFactor(lab.dust);
}

/** Solar cells on a clear sol with the lab's sunlight, from the real game's number (whole cells, at least 0). */
export function labSolarCells(realCells: number, lab: Pick<LabSettings, 'world' | 'orbit' | 'dust'>): number {
  const f = labSunFactor(lab);
  return f === 1 ? realCells : Math.max(0, Math.round(realCells * f));
}

// ------------------------------------------------------------------ the Sun's activity
/** How the radiation storms are dealt for a level of solar activity. */
export interface StormDeal {
  count: number;
  maxMajor: number;
  maxModerate: number;
  /** Deal the weakest storms first (solar minimum) instead of the strongest. */
  weakFirst: boolean;
}

/**
 * GAME VALUES. Solar minimum: one storm fewer, no big (X-class) storms and at most one medium one. Average: the
 * game's normal deal. Solar maximum: one storm more and one more big one. Every storm still comes from the real
 * NASA DONKI pool: the lab only changes how many are dealt, and which sizes first. It never invents an event.
 */
export function stormDealFor(t: Pick<Tuning, 'stormCount' | 'maxMajor'>, sun: SunLevel): StormDeal {
  if (sun === 'min') return { count: Math.max(1, t.stormCount - 1), maxMajor: 0, maxModerate: 1, weakFirst: true };
  if (sun === 'max') return { count: t.stormCount + 1, maxMajor: t.maxMajor + 1, maxModerate: Infinity, weakFirst: false };
  return { count: t.stormCount, maxMajor: t.maxMajor, maxModerate: Infinity, weakFirst: false };
}

/** Deal real events from the pool for a lab mission (same shape as plan.ts chooseStorms: sorted, seeded, live first). */
export function dealLabStorms(rng: Rng, pool: readonly SpaceWeatherEvent[], deal: StormDeal): SpaceWeatherEvent[] {
  const events = [...pool].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const byTier = (sev: Severity) => [
    ...shuffle(rng, events.filter((e) => e.severity === sev && e.origin === 'live')),
    ...shuffle(rng, events.filter((e) => e.severity === sev && e.origin === 'archive')),
  ];
  const tiers = { major: byTier('major'), moderate: byTier('moderate'), minor: byTier('minor') };
  const chosen: SpaceWeatherEvent[] = [];
  const seen = new Set<string>();
  const take = (list: SpaceWeatherEvent[], n: number) => {
    for (const e of list) {
      if (chosen.length >= deal.count || n <= 0) break;
      if (seen.has(e.id)) continue;
      seen.add(e.id);
      chosen.push(e);
      n--;
    }
  };
  if (deal.weakFirst) {
    take(tiers.minor, deal.count);
    take(tiers.moderate, deal.maxModerate);
  } else {
    take(tiers.major, deal.maxMajor);
    take(tiers.moderate, Math.min(deal.maxModerate, deal.count - chosen.length));
    take(tiers.minor, deal.count - chosen.length);
  }
  return chosen.sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
}

// ------------------------------------------------------------------ dust storm season
/**
 * Mars' dust storm season comes near its closest point to the Sun (JPL, June 9 2016: "Southern spring and summer have
 * long been recognized as the dustiest part of the Martian year", with Mars "closest to the sun near the end of
 * southern spring"). GAME RULE: near perihelion every dust storm in the mission is a huge one; near aphelion the huge
 * ones shrink to ordinary dust storms. The dust storms' days stay the same (a fair test).
 */
export function labWeather(weather: Weather, lab: Pick<LabSettings, 'world' | 'orbit'>): Weather {
  if (!isMarsLab(lab) || weather === 'clear') return weather;
  if (lab.orbit === 'perihelion') return 'storm';
  if (lab.orbit === 'aphelion') return 'dusty';
  return weather;
}

/** Apply the dust-season rule to a whole plan (in place). Leaves a real (average-orbit) plan untouched. */
export function applyLabPlan(plan: SolPlan[], lab: Pick<LabSettings, 'world' | 'orbit'>): void {
  if (!isMarsLab(lab) || lab.orbit === 'average') return;
  for (const p of plan) p.weather = labWeather(p.weather, lab);
}

// ------------------------------------------------------------------ message delay
/** The one-way light time a lab mission uses, minutes: the dial on Mars (or today's value), 1.3 seconds on the Moon. */
export function labLightMin(lab: Pick<LabSettings, 'world' | 'delayMin'>, todayMin: number): number {
  if (!isMarsLab(lab)) return REAL.moonLightSec / 60;
  return lab.delayMin ?? todayMin;
}

// ------------------------------------------------------------------ crew
/** Oxygen the crew breathes a day, kg (NASA BVAD Rev 2: 0.895 kg per crew member per day). */
export function crewO2KgPerDay(crew: number): number {
  return crew * REAL.o2PerCrewKgPerDay;
}

// ------------------------------------------------------------------ the 3D view
/** How the 3D base should look under the lab's sky: the dustier of today's weather and the dust dial, and the Sun's brightness. */
export function labStageLook(lab: Pick<LabSettings, 'world' | 'orbit' | 'dust'>, weather: Weather): { weather: Weather; labSun: number } {
  if (!isMarsLab(lab)) return { weather, labSun: 1 };
  const dial: Weather = lab.dust === 'storm' || lab.dust === 'global' ? 'storm' : lab.dust === 'dusty' ? 'dusty' : 'clear';
  const rank = { clear: 0, dusty: 1, storm: 2 } as const;
  return { weather: rank[dial] > rank[weather] ? dial : weather, labSun: orbitSunFactor(lab.orbit) };
}

// ------------------------------------------------------------------ hypothesis
export type Hypothesis = 'sooner' | 'later' | 'not';
export type LabOutcome = 'sooner' | 'later' | 'same' | 'not';
export interface RunSummary {
  won: boolean;
  /** Sols (turns) played. */
  sols: number;
}

/** Compare a lab run with the same mission under real conditions. Launching where the real crew could not is "sooner". */
export function labOutcome(real: RunSummary, lab: RunSummary): LabOutcome {
  if (!lab.won) return 'not';
  if (!real.won || lab.sols < real.sols) return 'sooner';
  if (lab.sols > real.sols) return 'later';
  return 'same';
}

export function hypothesisHeld(h: Hypothesis, outcome: LabOutcome): boolean {
  return h === outcome;
}
