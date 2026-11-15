// Written with AI assistance (Claude Code). See README "Use of AI tools".
// "Suggest a plan": a sensible starting plan for today, with one plain reason per module, so a
// first-time player has something to adjust instead of a blank board. It never changes the
// Workshop project, and it leaves the big trade-offs (how much to build) modest on purpose.

import { getBriefing, moduleCap, airPerCell, foodPerGreenhouseCell, greenhouseAirPerCell, fuelPctPerCell, windowSol, emptyAlloc, previewSol, backgroundDose, isIceSite } from './sim';
import { UPGRADES } from './upgrades';
import { nightStock, nightsAhead } from './strategies';
import { tuningFor } from './constants';
import type { Allocation, Briefing, MissionState, ModuleId } from './types';

export interface Advice {
  alloc: Allocation;
  /** Why each module got its cells, in kid-friendly words. */
  reasons: Array<{ id: ModuleId; text: string }>;
}

/**
 * Sols to spare that the ice-site shelter check keeps before the launch window closes. It judges the trip by today's
 * power, so the spare sols cover the dust storms and cold snaps still to come.
 */
const ICE_SHELTER_SPARE_SOLS = 4;

/**
 * Room for a "just in case" shelter at the ice site (Arcadia Planitia). The Gale Crater rule wants 3 cells to spare
 * after heat and the fuel pace: 2 for the shelter and about 1 more for food. Arcadia's smaller solar array never has 3
 * to spare, so with that rule the advice never sheltered there and nearly every Commander first crew was lost to
 * radiation. But Arcadia's greenhouse feeds the crew on much less power, so check the whole trip instead: after 2
 * shelter cells today, can today's power (less heat, food and air) still fill the rocket with a few sols to spare?
 */
function iceSiteHasRoom(state: MissionState, b: Briefing, fuelCellsLeft: number, solsLeft: number): boolean {
  const ghCells = state.crew / foodPerGreenhouseCell(state);
  const airCells = Math.max(0, state.crew - ghCells * greenhouseAirPerCell(state)) / airPerCell(state);
  const fuelPerSol = b.cells - b.heaterNeed - ghCells - airCells;
  return fuelPerSol * (solsLeft - ICE_SHELTER_SPARE_SOLS) - 2 >= fuelCellsLeft;
}

export function advise(state: MissionState): Advice {
  const b = getBriefing(state);
  const alloc = emptyAlloc();
  const reasons: Advice['reasons'] = [];
  let left = b.cells;
  const give = (id: ModuleId, n: number, why: string) => {
    const k = Math.max(0, Math.min(n, left, moduleCap(state, id) - alloc[id]));
    if (k <= 0) return 0;
    alloc[id] += k;
    left -= k;
    reasons.push({ id, text: why });
    return k;
  };
  const crew = state.crew;
  const extra = b as unknown as { night?: boolean; nightIn?: number | null };
  const hardTimesAhead = b.dustTomorrow || b.weather !== 'clear' || !!extra.night || (extra.nightIn != null && extra.nightIn <= 2);

  give('heaters', b.heaterNeed, b.heaterNeed > 1 ? `Cold night: the heaters need ${b.heaterNeed} cells.` : 'Keeps the batteries warm tonight.');
  if (b.warning) give('shelter', 2, 'A storm hits today: the shelter protects the crew.');
  else if (b.outlook === 'active' && !b.monitorOnline && state.config.site !== 'moon') {
    // On Mars the fastest storms can beat Earth's warning. If the dose left could not take the big storms
    // still likely to come before launch, shelter on days the Sun is active, just in case. (Mostly Commander.)
    const t = tuningFor(state.config.difficulty, state.config.site, state.config.landing);
    const bigHit = previewSol(state, emptyAlloc()).stormDoseIfMajorUnsheltered;
    const bigSeen = state.log.filter((r) => r.storm && r.storm.doseUnsheltered >= bigHit * 0.9).length;
    const allSeen = state.log.filter((r) => r.storm).length;
    const bigLeft = Math.max(0, t.maxMajor - bigSeen);
    const smallLeft = Math.max(0, t.stormCount - t.maxMajor - (allSeen - bigSeen));
    const fuelCellsLeft = Math.max(0, (100 - state.fuel) / fuelPctPerCell(state));
    const solsToGo = Math.min(windowSol(state) - state.sol + 1, Math.ceil(fuelCellsLeft / 4) + 1);
    const headroom = state.doseBudget - state.dose - backgroundDose(state) * solsToGo;
    // Never at the cost of the launch window: only when today's power covers the fuel pace as well.
    const solsLeft = Math.max(1, windowSol(state) - state.sol + 1);
    const pace = Math.ceil(fuelCellsLeft / Math.max(1, solsLeft - 2));
    const roomForShelter = isIceSite(state) ? iceSiteHasRoom(state, b, fuelCellsLeft, solsLeft) : b.cells - b.heaterNeed - pace >= 3;
    if (roomForShelter && bigHit > 0 && bigLeft + smallLeft > 0 && headroom < bigHit * bigLeft + bigHit * 0.4 * smallLeft + 1) give('shelter', 2, 'The Sun is active and a big storm could beat Earth\'s warning: shelter, just in case.');
  }
  if (b.hasMonitor && b.outlook !== 'quiet' && left >= 2) give('monitor', 1, 'The Sun is active: the monitor watches for storms tonight.');

  // Moon: stock up for the lunar night a few days ahead (the panels make almost nothing then).
  const night = nightStock(state, 5);
  const reserve = (hardTimesAhead ? 3.5 : 2) + night;
  const foodNeed = (reserve + 1) * crew - state.food;
  const gh = Math.ceil(Math.max(0, foodNeed) / foodPerGreenhouseCell(state));
  give('greenhouse', gh, hardTimesAhead ? 'Hard days ahead: grow extra food now.' : 'Keeps about 2 days of food in store.');
  const airFromGh = alloc.greenhouse * greenhouseAirPerCell(state);
  const airNeed = (reserve + 1) * crew - state.air - airFromGh;
  give('air', Math.ceil(Math.max(0, airNeed) / airPerCell(state)), hardTimesAhead ? 'Hard days ahead: make extra air now.' : 'Keeps about 2 days of air in store.');

  if (b.hasBattery && (hardTimesAhead || (extra.nightIn != null && extra.nightIn <= 3)) && left >= 2) give('battery', 2, 'Saves power for the hard days coming.');

  // Fuel first, at the pace the launch window needs; a little spare power goes to the Workshop.
  const solsLeft = Math.max(1, windowSol(state) - state.sol + 1 - nightsAhead(state));
  const fuelCellsNeeded = Math.max(0, (100 - state.fuel) / fuelPctPerCell(state));
  const pace = Math.ceil(fuelCellsNeeded / Math.max(1, solsLeft - 2));
  const spare = left - pace;
  const project = state.base.project;
  if (spare > 0 && project) give('build', Math.min(spare, 2), `Spare power builds the ${UPGRADES[project].name.toLowerCase()} for future crews.`);
  give('fuel', left, 'Everything else fills the rocket for the trip home.');
  // Anything still left (fuel was full): back to food and air.
  give('greenhouse', left, 'Extra food, just in case.');
  give('air', left, 'Extra air, just in case.');
  give('build', left, 'Extra power for the Workshop.');
  // Last resort (every cap reached): place the rest anywhere it fits, so the plan can run.
  for (const id of ['heaters', 'shelter', 'battery', 'monitor'] as ModuleId[]) {
    const k = Math.max(0, Math.min(left, moduleCap(state, id) - alloc[id]));
    alloc[id] += k;
    left -= k;
  }
  return { alloc, reasons };
}
