// Written with AI assistance (Claude Code). See README "Use of AI tools".
// Space Lab, the words and numbers behind the screens (no DOM): what each dial is called, the live readouts, the
// storm pool a lab mission deals from, the fair test (the autopilot flies the same storms under real and lab
// conditions), and the one-sentence science behind a result. The numbers come from src/sim/lab.ts and the game's
// own sim, so a readout always matches what the mission will really do.

import {
  REAL,
  tuningFor,
} from '../../sim/constants';
import {
  LAB_CREW,
  changedDials,
  crewO2KgPerDay,
  defaultLab,
  dustPowerFactor,
  DUST_TAU,
  isMarsLab,
  labLanding,
  labLightMin,
  labOutcome,
  labSite,
  labSolarCells,
  orbitIrradiance,
  orbitSunFactor,
  periAphRatio,
  stormDealFor,
  type DustLevel,
  type LabDial,
  type LabOutcome,
  type LabSettings,
  type LabWorld,
  type OrbitLevel,
  type RunSummary,
  type SunLevel,
} from '../../sim/lab';
import { createMission, earthWarningLateBy } from '../../sim/sim';
import { advise } from '../../sim/advisor';
import { playOut } from '../../sim/strategies';
import { missionConfigFor, newCampaign } from '../../sim/campaign';
import { buildEventPool, MAY2024_SNAPSHOT, RECENT_SNAPSHOT } from '../../data/donki';
import type { MissionConfig, SpaceWeatherEvent } from '../../sim/types';
import type { QuickStart } from '../hooks';

export const WORLD_NAME: Record<LabWorld, string> = { gale: 'Mars: Gale Crater', arcadia: 'Mars: Arcadia Planitia', moon: 'Moon: south pole' };
export const WORLD_SHORT: Record<LabWorld, string> = { gale: 'Gale Crater', arcadia: 'Arcadia Planitia', moon: 'the Moon' };
export const SUN_NAME: Record<SunLevel, string> = { min: 'Solar minimum', average: 'Average', max: 'Solar maximum' };
export const ORBIT_NAME: Record<OrbitLevel, string> = { aphelion: 'Farthest (aphelion)', average: 'Average', perihelion: 'Closest (perihelion)' };
export const DUST_NAME: Record<DustLevel, string> = { clear: 'Clear', hazy: 'Hazy (normal)', dusty: 'Dusty', storm: 'Dust storm', global: 'Planet-wide storm' };
export const DIAL_NAME: Record<LabDial, string> = { world: 'World', sun: 'Sun activity', orbit: 'Mars in its orbit', dust: 'Dust in the air', delay: 'Message delay', crew: 'Crew size' };

// ------------------------------------------------------------------ the storm pool
/**
 * Lab missions deal from the game's STORED copy of real NASA DONKI records (the recent snapshot plus May 2024), so
 * "Same storms each run" really means the same storms, today and tomorrow. Labeled ARCHIVE everywhere: never live.
 */
export function labPool(): SpaceWeatherEvent[] {
  return buildEventPool({ status: 'archive', snapshot: RECENT_SNAPSHOT ?? MAY2024_SNAPSHOT, fetchedAt: null, via: 'snapshot' });
}

/** What the game needs to start a lab mission (through MetaContext.startQuick). */
export function quickStartFor(lab: LabSettings, pool: SpaceWeatherEvent[] = labPool()): QuickStart {
  return { seed: lab.seed, difficulty: 'cadet', site: labSite(lab), eventPool: pool, lab };
}

// ------------------------------------------------------------------ readouts
const realCells = (lab: LabSettings) => tuningFor('cadet', labSite(lab), labLanding(lab)).baseCells;

/** Solar power on a clear day with these settings, and the real number for this world. */
export function solarReadout(lab: LabSettings): { cells: number; normal: number; text: string } {
  const normal = realCells(lab);
  const cells = labSolarCells(normal, lab);
  const text = cells === normal ? `Solar power: ${cells} cells a ${lab.world === 'moon' ? 'day' : 'sol'} (normal)` : `Solar power: ${cells} cells a sol (normal ${normal})`;
  return { cells, normal, text };
}

export function worldReadout(lab: LabSettings): string {
  if (lab.world === 'moon') return `Solar power: ${realCells(lab)} cells a day, 0 in the lunar night. No air, so no dust storms.`;
  if (lab.world === 'arcadia') return `${solarReadout(lab).text}. Far north: less sun, colder nights, but ice for the greenhouse.`;
  return `${solarReadout(lab).text}. Curiosity's crater, near the equator.`;
}

export function sunReadout(lab: LabSettings): string {
  const t = tuningFor('cadet', labSite(lab), labLanding(lab));
  const d = stormDealFor(t, lab.sun);
  const n = stormDealFor(t, 'average');
  const big = d.maxMajor === 0 ? (d.maxModerate <= 1 ? 'small ones (at most 1 medium)' : 'no big ones') : `up to ${d.maxMajor} big`;
  const normal = lab.sun === 'average' ? ' (normal)' : ` (normal ${n.count}, up to ${n.maxMajor} big)`;
  return `Radiation storms this mission: ${d.count}, ${big}${normal}`;
}

export function orbitReadout(lab: LabSettings): string {
  if (!isMarsLab(lab)) return 'Off on the Moon: it is always about as far from the Sun as Earth is.';
  const pct = Math.round(orbitSunFactor(lab.orbit) * 100);
  const storms = lab.orbit === 'perihelion' ? ' Dust storms: bigger (dust storm season).' : lab.orbit === 'aphelion' ? ' Dust storms: smaller (calm season).' : '';
  return `Sunlight: ${Math.round(orbitIrradiance(lab.orbit))} W per square meter, ${pct}% of average. ${solarReadout(lab).text}.${storms}`;
}

export function dustReadout(lab: LabSettings): string {
  if (!isMarsLab(lab)) return 'Off on the Moon: no air, so no dust in the sky.';
  const pct = Math.round(dustPowerFactor(lab.dust) * 100);
  return `Tau ${DUST_TAU[lab.dust]}: ${pct}% of a normal day's sunlight reaches the panels. ${solarReadout(lab).text}.`;
}

export function delayReadout(lab: LabSettings, todayMin: number): string {
  if (!isMarsLab(lab)) return `Off on the Moon: messages take about ${REAL.moonLightSec} seconds, so Earth's warnings always arrive in time.`;
  const min = Math.round(labLightMin(lab, todayMin));
  const late = earthWarningLateBy(min);
  const today = lab.delayMin === null ? " (today's real value)" : ` (today: ${Math.round(todayMin)} min)`;
  return `One way: ${min} min${today}. Earth's warning for the fastest storm particles arrives about ${late} min after they hit.`;
}

export function crewReadout(lab: LabSettings): string {
  const o2 = crewO2KgPerDay(lab.crew).toFixed(1);
  const normal = lab.crew === LAB_CREW.real ? ' (normal)' : ` (normal ${LAB_CREW.real} people, ${crewO2KgPerDay(LAB_CREW.real).toFixed(1)} kg)`;
  return `Each ${lab.world === 'moon' ? 'day' : 'sol'}: ${lab.crew} people use ${lab.crew} days' worth of air and food, and breathe ${o2} kg of oxygen${normal}.`;
}

/** Sunlight at Mars' closest point compared with its farthest, as a whole percentage (about 45). */
export const PERI_APH_PCT = Math.round((periAphRatio() - 1) * 100);

// ------------------------------------------------------------------ summaries
function dialValue(lab: LabSettings, d: LabDial): string {
  switch (d) {
    case 'world':
      return WORLD_NAME[lab.world];
    case 'sun':
      return SUN_NAME[lab.sun];
    case 'orbit':
      return ORBIT_NAME[lab.orbit];
    case 'dust':
      return `${DUST_NAME[lab.dust]} (tau ${DUST_TAU[lab.dust]})`;
    case 'delay':
      return lab.delayMin === null ? 'today' : `${lab.delayMin} min`;
    case 'crew':
      return `${lab.crew} astronauts`;
  }
}

/** "Dust in the air: Dust storm (tau 3), real: Hazy (normal) (tau 0.6)" for every dial that is not real. */
export function changesList(lab: LabSettings): string[] {
  const real = { ...defaultLab(lab.seed), world: lab.world };
  return changedDials(lab).map((d) => `${DIAL_NAME[d]}: ${dialValue(lab, d)} (real: ${dialValue(real, d)})`);
}

/** One line for the Settings dialog and the lobby tile. */
export function summaryLine(lab: LabSettings): string {
  const changed = changedDials(lab);
  if (!changed.length) return `Real conditions at ${WORLD_SHORT[lab.world]}.`;
  const bits = changed.map((d) => `${DIAL_NAME[d].toLowerCase()}: ${dialValue(lab, d).toLowerCase()}`);
  return `${WORLD_SHORT[lab.world][0].toUpperCase()}${WORLD_SHORT[lab.world].slice(1)}, ${bits.join(', ')}.`;
}

// ------------------------------------------------------------------ the fair test
/** The autopilot: presses "Suggest a plan" every sol and takes the food crate. */
const autopilot = (s: Parameters<typeof advise>[0]) => ({ alloc: advise(s).alloc, crate: 'food' as const });

function summarize(config: MissionConfig): RunSummary {
  const end = playOut(createMission(config), autopilot);
  return { won: end.status === 'won', sols: end.log.length };
}

/**
 * The fair test behind every result: the autopilot flies this exact mission (same seed, same storms) twice, once
 * under real conditions and once with the lab's dials. Only the dials differ, so any change comes from them.
 */
export function fairTest(config: MissionConfig): { real: RunSummary; lab: RunSummary; outcome: LabOutcome } {
  const { lab: _lab, ...realConfig } = config;
  const real = summarize(realConfig);
  const lab = config.lab ? summarize(config) : real;
  return { real, lab, outcome: labOutcome(real, lab) };
}

/** The mission config a lab mission gets (the same one the game builds). For tests and previews. */
export function labMissionConfig(lab: LabSettings, todayMin: number, pool: SpaceWeatherEvent[] = labPool()): MissionConfig {
  const c = newCampaign(lab.seed, 'cadet', labSite(lab), labLanding(lab));
  return { ...missionConfigFor(c, labLightMin(lab, todayMin), pool), lab };
}

// ------------------------------------------------------------------ the science behind it
const PRIORITY: LabDial[] = ['dust', 'orbit', 'sun', 'crew', 'delay'];

/** One sentence explaining the science behind the biggest change (or the world, when nothing changed). */
export function scienceLine(lab: LabSettings): string {
  const changed = changedDials(lab);
  const main = PRIORITY.find((d) => changed.includes(d));
  switch (main) {
    case 'dust':
      if (lab.dust === 'global')
        return 'Dust in the air blocks sunlight: in the 2018 planet-wide storm (tau 10.8), the Opportunity rover\'s panels made only about 3% of a normal day\'s power.';
      if (lab.dust === 'clear') return 'A clear sky lets more sunlight reach the solar panels, so there is more power for air, food and rocket fuel.';
      return 'Dust in the air blocks sunlight before it reaches the solar panels, so a dustier sky means less power for air, food and rocket fuel.';
    case 'orbit':
      return lab.orbit === 'perihelion'
        ? `Sunlight spreads out as it travels (the inverse-square law), so at its closest point Mars gets about ${PERI_APH_PCT}% more sunlight than at its farthest. But that is also its dust storm season.`
        : `Sunlight spreads out as it travels (the inverse-square law), so at its farthest point Mars gets about ${100 - Math.round(orbitSunFactor('aphelion') * 100)}% less sunlight than average, and the panels make less power.`;
    case 'sun':
      return lab.sun === 'max'
        ? 'Near solar maximum the Sun has the most sunspots, flares and eruptions of its 11-year cycle, so crews meet more and bigger radiation storms.'
        : 'Near solar minimum the Sun is quiet, with few sunspots and flares, so crews meet fewer and smaller radiation storms.';
    case 'crew':
      return lab.crew > LAB_CREW.real
        ? `Every astronaut breathes about ${REAL.o2PerCrewKgPerDay.toFixed(1)} kg of oxygen a day, so a bigger crew needs more air and food every sol, leaving less power for rocket fuel.`
        : `Every astronaut breathes about ${REAL.o2PerCrewKgPerDay.toFixed(1)} kg of oxygen a day, so a smaller crew needs less air and food, leaving more power for rocket fuel.`;
    case 'delay':
      return 'Radio messages travel at the speed of light, but the fastest storm particles still reach Mars before Earth\'s warning can, even at the shortest delay. That is why a base needs its own radiation monitor.';
    default:
      if (lab.world === 'moon') return 'The Moon has no air (no dust storms) and Earth is only 1.3 light-seconds away, but the long lunar night leaves the solar panels dark for days.';
      if (lab.world === 'arcadia') return 'Arcadia Planitia is far north: less sunshine and colder nights, but ice under the ground waters the greenhouse.';
      return 'These are real conditions: a perfect control run. Now change one dial and compare.';
  }
}

/** A friendly nudge when more than one dial changed at once. */
export function oneAtATimeNote(lab: LabSettings): string | null {
  const n = changedDials(lab).length;
  return n > 1 ? `You changed ${n} things at once, so it is hard to tell which one made the difference. Next time, try changing just one.` : null;
}
