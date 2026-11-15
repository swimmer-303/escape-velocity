// Written with AI assistance (Claude Code). See README "Use of AI tools".
// Outpost Architect: the live engineering readout. Every rate comes from the game's own simulation (src/sim/sim.ts)
// and tuning (src/sim/constants.ts), which are sourced there: we build a real MissionState for the chosen site and
// ask the sim for air per cell, food per cell, fuel per cell, shelter blocking and so on. Nothing here is a new fact.
//
// How a day works (the same power-cell rules as the main game):
// - MAKING: each Solar panel makes 1 cell on a clear sol (the game's "Solar panel row: +1 power cell every sol");
//   dust takes DUST_LOSS of it; Arcadia's array makes what the game's does there (6 of 7 cells); on the Moon panels
//   make nothing at night. A reactor adds REACTOR_CELLS, day and night. Batteries give back what they saved.
// - USING: the base plans each day like a careful player: shelter first if a storm is warned, then air, heat,
//   the Sun watcher, then food, saving cells in the batteries, and everything left fills the rocket.

import { ARCADIA, DUST_LOSS, HEATER_NEED, MODULE_CAP, MOON_BATTERY, MOON_NIGHT, RATES, REAL, STORM_DOSE, TUNING, WEAR_PER_DAMAGE, tuningFor } from '../../sim/constants';
import { REACTOR_CELLS, airPerCell, backgroundDose, createMission, foodPerGreenhouseCell, fuelPctPerCell, greenhouseAirPerCell, shelterBlock, solarCells } from '../../sim/sim';
import { freshBase } from '../../sim/upgrades';
import type { MissionConfig, MissionState, Severity, Weather } from '../../sim/types';
import { BEDS_PER_HABITAT, SHELTER_SEATS } from './parts';
import { countOf, shelterHasBerm, type Layout, type SiteId } from './layout';

// ------------------------------------------------------------------ the game's numbers for a site
/** A real mission state for a site (first crew, Cadet), so the sim's own functions give us the rates. */
export function missionFor(site: SiteId, upgrades: { moxie2?: boolean; berm?: boolean } = {}): MissionState {
  const base = freshBase();
  if (upgrades.moxie2) base.levels.moxie2 = 1;
  if (upgrades.berm) base.levels.berm = 1;
  const config: MissionConfig = {
    seed: 'outpost-architect',
    difficulty: 'cadet',
    site: site === 'moon' ? 'moon' : 'mars',
    landing: site === 'arcadia' ? 'arcadia' : 'gale',
    lightTimeMin: site === 'moon' ? REAL.moonLightSec / 60 : 11,
    eventPool: [],
    expedition: 1,
    base,
    prefillPct: 0,
  };
  return createMission(config);
}

export interface Rates {
  site: SiteId;
  /** Person-days of air per O2 plant cell (regular, Big). */
  air: number;
  airBig: number;
  /** Fuel tank % per O2 plant cell (regular, Big). */
  fuel: number;
  fuelBig: number;
  /** Person-days of food (and air) per greenhouse cell. */
  food: number;
  ghAir: number;
  /** Fraction of a storm blocked by a shelter with 0, 1 or 2 cells; with a berm. */
  block: readonly number[];
  blockBerm: readonly number[];
  /** Steady background radiation per sol, mSv. */
  background: number;
  /** Clear-sol cells the game's starting array makes here, and at Gale (Arcadia makes fewer). */
  arraySite: number;
  arrayGale: number;
  /** Starting reserves (days for the whole crew) and the mission dose budget, mSv. */
  startAirDays: number;
  startFoodDays: number;
  doseBudget: number;
}

const rateCache = new Map<SiteId, Rates>();
export function ratesFor(site: SiteId): Rates {
  const hit = rateCache.get(site);
  if (hit) return hit;
  const s = missionFor(site);
  const big = missionFor(site, { moxie2: true });
  const berm = missionFor(site, { berm: true });
  const t = tuningFor('cadet', s.config.site, s.config.landing);
  const r: Rates = {
    site,
    air: airPerCell(s),
    airBig: airPerCell(big),
    fuel: fuelPctPerCell(s),
    fuelBig: fuelPctPerCell(big),
    food: foodPerGreenhouseCell(s),
    ghAir: greenhouseAirPerCell(s),
    block: shelterBlock(s),
    blockBerm: shelterBlock(berm),
    background: backgroundDose(s),
    arraySite: solarCells(s),
    arrayGale: solarCells(missionFor('gale')),
    startAirDays: t.startAirDays,
    startFoodDays: t.startFoodDays,
    doseBudget: t.doseBudget,
  };
  rateCache.set(site, r);
  return r;
}

/** The game's floor on Mars: "the base always gets at least 2 cells" (getBriefing in src/sim/sim.ts). */
export const MARS_FLOOR_CELLS = 2;
/** Arcadia's panels: the game's starting array makes 1 cell fewer there (7 -> 6), so each panel makes 6/7 as much. */
export const ARCADIA_SUN = (TUNING.cadet.baseCells - ARCADIA.sunCellsLost) / TUNING.cadet.baseCells;

// ------------------------------------------------------------------ one day
export interface Conditions {
  weather: Weather;
  coldSnap: boolean;
  /** Lunar night (Moon only). */
  night: boolean;
  /** A solar storm hits today. */
  storm?: { severity: Severity; fast: boolean } | null;
  /** Dust or cold is forecast for tomorrow (Mars): save cells in the batteries. */
  saveForTomorrow?: boolean;
  /** Lunar night turns still to come after today (the game shows this too), so the batteries last. */
  nightsLeft?: number;
}

export const CLEAR_DAY: Conditions = { weather: 'clear', coldSnap: false, night: false, storm: null };

/** Parts counted for the sums. */
export interface BaseCounts {
  site: SiteId;
  panels: number;
  reactors: number;
  batteries: number;
  habitats: number;
  o2: number;
  bigo2: number;
  greenhouses: number;
  heaters: number;
  shelters: number;
  /** Shelters with a berm touching them (1 cell blocks 90%). */
  bermShelters: number;
  monitors: number;
  rocket: boolean;
  crew: number;
  seats: number;
}

export function countBase(layout: Layout): BaseCounts {
  const shelters = layout.parts.filter((p) => p.part === 'shelter');
  const habitats = countOf(layout, 'habitat');
  return {
    site: layout.site,
    panels: countOf(layout, 'solar'),
    reactors: countOf(layout, 'reactor'),
    batteries: countOf(layout, 'battery'),
    habitats,
    o2: countOf(layout, 'o2'),
    bigo2: countOf(layout, 'bigo2'),
    greenhouses: countOf(layout, 'greenhouse'),
    heaters: countOf(layout, 'heater'),
    shelters: shelters.length,
    bermShelters: shelters.filter((s) => shelterHasBerm(layout, s)).length,
    monitors: countOf(layout, 'monitor'),
    rocket: countOf(layout, 'rocket') > 0,
    crew: habitats * BEDS_PER_HABITAT,
    seats: shelters.length * SHELTER_SEATS,
  };
}

/** Solar cells from the panels today (rounded like the game rounds its dust loss). */
export function solarToday(panels: number, site: SiteId, c: Pick<Conditions, 'weather' | 'night'>): number {
  if (panels <= 0 || (site === 'moon' && c.night)) return 0;
  const clear = site === 'arcadia' ? Math.round(panels * ARCADIA_SUN) : panels;
  if (site === 'moon' || c.weather === 'clear') return clear;
  return clear - Math.round(clear * DUST_LOSS[c.weather]);
}

/** Heat the base needs today, in cells. */
export function heatNeed(b: BaseCounts, c: Pick<Conditions, 'coldSnap' | 'night'>): number {
  if (b.habitats <= 0) return 0;
  return b.habitats * HEATER_NEED.normal + Math.max(0, b.greenhouses - 1) + (c.coldSnap ? HEATER_NEED.coldSnap : 0) + (c.night ? MOON_NIGHT.heaterExtra : 0);
}

export interface Carry {
  /** Cells saved in the batteries. */
  stored: number;
  /** Cells lost today to cold batteries (yesterday's missing heat), and to damage. */
  coldPenalty: number;
  damage: number;
  /** Cold nights so far toward the next damaged battery (every WEAR_PER_DAMAGE costs 1 cell for good). */
  wear: number;
  /** The Sun watcher was powered yesterday: today's storm is warned, even a fast one. */
  monitorOnline: boolean;
}

export const FRESH: Carry = { stored: 0, coldPenalty: 0, damage: 0, wear: 0, monitorOnline: false };

export interface DayPlan {
  /** Cells made today, and where they came from. */
  cells: number;
  solar: number;
  reactor: number;
  fromBattery: number;
  /** Where the cells went. */
  use: { shelter: number; air: number; heat: number; food: number; monitor: number; battery: number; fuel: number };
  spare: number;
  heatNeed: number;
  heatShort: number;
  airNeed: number;
  airMade: number;
  foodNeed: number;
  foodMade: number;
  fuelPct: number;
  /** Storm: warned in time, crew in shelters, the share blocked for the worst-off crew member, the dose taken (mSv). */
  warned: boolean;
  sheltered: number;
  block: number;
  stormDose: number;
  stormDoseFull: number;
  /** A battery was damaged by the cold for good today. */
  newDamage: boolean;
  /** Carry into tomorrow. */
  next: Carry;
}

function batteryCaps(b: BaseCounts, site: SiteId) {
  return {
    /** Most cells all batteries can take in one day. */
    inPerDay: b.batteries * MODULE_CAP.battery,
    /** Most they hold (Moon) or keep overnight (Mars). */
    capacity: site === 'moon' ? b.batteries * MOON_BATTERY.capacity : b.batteries * MODULE_CAP.battery,
    /** Most they give back on one lunar night turn. */
    outPerNight: b.batteries * MOON_BATTERY.releasePerNight,
  };
}

/** Plan one day for this base under these conditions. Pure. */
export function planDay(b: BaseCounts, c: Conditions, carry: Carry = FRESH): DayPlan {
  const site = b.site;
  const caps = batteryCaps(b, site);

  // --- making
  const solar = solarToday(b.panels, site, c);
  const reactor = b.reactors * REACTOR_CELLS;
  let made = solar + reactor - carry.coldPenalty - carry.damage;
  const floor = site === 'moon' && c.night ? MOON_NIGHT.floorCells : MARS_FLOOR_CELLS;
  if (b.panels + b.reactors > 0) made = Math.max(floor, made);
  made = Math.max(0, made);
  // Mars: everything saved yesterday comes back today (the game's rule). Moon: on night turns the base takes from
  // its batteries only what it needs, up to the game's release limit per bank, so the charge lasts the whole night.
  if (site !== 'moon') return allocate(b, c, carry, made, Math.min(carry.stored, caps.capacity), solar, reactor);
  if (!c.night) return allocate(b, c, carry, made, 0, solar, reactor);
  const most = Math.min(carry.stored, caps.outPerNight);
  const trial = allocate(b, c, carry, made, most, solar, reactor);
  // Keep enough for the rest of the night; share out any extra evenly (it fills the rocket).
  const deficit = Math.max(0, cellsForNeeds(trial) - made);
  const left = Math.max(0, c.nightsLeft ?? 0);
  const extra = Math.max(0, carry.stored - deficit * (left + 1));
  return allocate(b, c, carry, made, Math.min(most, deficit + Math.ceil(extra / (left + 1))), solar, reactor);
}

function allocate(b: BaseCounts, c: Conditions, carry: Carry, made: number, fromBattery: number, solar: number, reactor: number): DayPlan {
  const site = b.site;
  const r = ratesFor(site);
  const caps = batteryCaps(b, site);
  const cells = made + fromBattery;
  let left = cells;
  const take = (want: number) => {
    const n = Math.max(0, Math.min(left, Math.floor(want)));
    left -= n;
    return n;
  };
  const use = { shelter: 0, air: 0, heat: 0, food: 0, monitor: 0, battery: 0, fuel: 0 };

  // --- storm: power shelters if the crew was warned (bermed shelters first: they need just 1 cell).
  const warned = !!c.storm && (site === 'moon' || !c.storm.fast || carry.monitorOnline);
  let sheltered = 0;
  let minBlock = 0;
  const stormDoseFull = c.storm ? STORM_DOSE[c.storm.severity] : 0;
  if (c.storm && b.crew > 0) {
    const blocks: number[] = [];
    if (warned) {
      const order = [...Array(b.bermShelters).fill(true), ...Array(b.shelters - b.bermShelters).fill(false)] as boolean[];
      for (const berm of order) {
        if (sheltered >= b.crew) break;
        const table = berm ? r.blockBerm : r.block;
        const full = berm ? 1 : Math.min(MODULE_CAP.shelter, table.length - 1);
        const cellsHere = take(full);
        const seats = Math.min(SHELTER_SEATS, b.crew - sheltered);
        use.shelter += cellsHere;
        if (cellsHere > 0) {
          sheltered += seats;
          for (let i = 0; i < seats; i++) blocks.push(table[Math.min(cellsHere, table.length - 1)]);
        }
      }
    }
    minBlock = sheltered >= b.crew && blocks.length ? Math.min(...blocks) : 0;
  }
  const stormDose = c.storm && b.crew > 0 ? stormDoseFull * (1 - minBlock) : 0;

  // --- air: Big O2 plants first (more air per cell), then the regular ones; the greenhouse adds a little.
  const crew = b.crew;
  const airNeed = crew * RATES.usePerPersonPerSol;
  const foodNeed = crew * RATES.usePerPersonPerSol;
  // Food cells we will want, so their air counts before we spend cells on the O2 plant.
  const ghCap = b.greenhouses * MODULE_CAP.greenhouse;
  const ghWanted = Math.min(ghCap, Math.ceil(foodNeed / r.food - 1e-9));
  let airGot = 0;
  const airCells = (perCell: number, plants: number) => {
    if (plants <= 0) return 0;
    const still = airNeed - airGot - ghWanted * r.ghAir;
    if (still <= 1e-9) return 0;
    const n = take(Math.min(plants * MODULE_CAP.air, Math.ceil(still / perCell - 1e-9)));
    airGot += n * perCell;
    return n;
  };
  const airBigCells = airCells(r.airBig, b.bigo2);
  const airRegCells = airCells(r.air, b.o2);
  use.air = airBigCells + airRegCells;

  // --- heat
  const need = heatNeed(b, c);
  use.heat = take(Math.min(need, b.heaters * MODULE_CAP.heaters));
  const heatShort = Math.max(0, need - use.heat);

  // --- the Sun watcher: 1 cell tonight means tomorrow's storm is warned (Mars). Before food: the crew has days of
  // food saved up, but a missed warning cannot be made up later.
  if (site !== 'moon' && b.monitors > 0) use.monitor = take(MODULE_CAP.monitor);

  // --- food
  use.food = take(ghWanted);
  const foodMade = use.food * r.food;
  const airMade = airGot + use.food * r.ghAir;

  // --- batteries: Moon: fill up by day for the night. Mars: save cells when dust or cold is coming.
  let stored = site === 'moon' ? carry.stored - fromBattery : 0;
  if (b.batteries > 0) {
    if (site === 'moon' && !c.night) {
      use.battery = take(Math.min(caps.inPerDay, caps.capacity - stored));
    } else if (site !== 'moon' && c.saveForTomorrow) {
      use.battery = take(caps.inPerDay);
    }
    stored += use.battery;
  }

  // --- the rest fills the rocket (Big O2 plants first).
  let fuelPct = 0;
  if (b.rocket) {
    const big = take(b.bigo2 * MODULE_CAP.fuel);
    const reg = take(b.o2 * MODULE_CAP.fuel);
    use.fuel = big + reg;
    fuelPct = big * r.fuelBig + reg * r.fuel;
  }

  // --- tomorrow: missing heat chills the batteries (fewer cells) and wears things out (the game's rules).
  let wear = carry.wear + heatShort;
  let damage = carry.damage;
  let newDamage = false;
  while (wear >= WEAR_PER_DAMAGE) {
    wear -= WEAR_PER_DAMAGE;
    damage += 1;
    newDamage = true;
  }
  const next: Carry = { stored, coldPenalty: heatShort, damage, wear, monitorOnline: use.monitor >= 1 };

  return {
    cells,
    solar,
    reactor,
    fromBattery,
    use,
    spare: left,
    heatNeed: need,
    heatShort,
    airNeed,
    airMade,
    foodNeed,
    foodMade,
    fuelPct,
    warned,
    sheltered,
    block: minBlock,
    stormDose,
    stormDoseFull,
    newDamage,
    next,
  };
}

/** Cells actually used today (everything but the spare). */
export function cellsUsed(p: DayPlan): number {
  const u = p.use;
  return u.shelter + u.air + u.heat + u.food + u.monitor + u.battery + u.fuel;
}

/** Cells used for the crew's needs (no fuel, no saving). */
export function cellsForNeeds(p: DayPlan): number {
  const u = p.use;
  return u.shelter + u.air + u.heat + u.food + u.monitor;
}
