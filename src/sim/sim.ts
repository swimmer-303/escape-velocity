// Written with AI assistance (Claude Code). See README "Use of AI tools".
// The heart of Escape Velocity: a pure, deterministic, seeded simulation.
// No rendering or DOM imports allowed in src/sim.

import {
  RATES,
  REAL,
  HEATER_NEED,
  WEAR_PER_DAMAGE,
  DUST_LOSS,
  STORM_DOSE,
  SHELTER_BLOCK,
  MODULE_CAP,
  EARTH_PROCESSING_MIN,
  SUN_EARTH_LIGHT_MIN,
  MOON_BATTERY,
  MOON_NIGHT,
  expeditionFor,
  tuningFor,
  type ExpeditionSpec,
  type Site,
} from './constants';
import { buildPlan } from './plan';
import { defaultNextProject, maxLevel, nextCost, upgradesFor, type BaseState, type UpgradeId } from './upgrades';
import {
  MODULE_IDS,
  type Allocation,
  type Briefing,
  type CrateId,
  type MissionConfig,
  type MissionState,
  type ModuleId,
  type SolReport,
  type Snapshot,
  type Warning,
} from './types';

/** Minutes after a big flare that its fastest particles can reach Mars (game estimate; NASA/JPL: "tens of minutes"). */
export const FAST_PARTICLE_MIN = 20;
/** Cells the reactor adds, day and night, dust or not. */
export const REACTOR_CELLS = 3;
/** Multiplier from the Big O2 plant and the second greenhouse dome. */
export const UPGRADE_BOOST = 1.5;

export function emptyAlloc(): Allocation {
  return { air: 0, fuel: 0, greenhouse: 0, heaters: 0, shelter: 0, monitor: 0, build: 0, battery: 0 };
}

export function totalCells(a: Allocation): number {
  return MODULE_IDS.reduce((s, id) => s + a[id], 0);
}

export function expeditionSpec(config: Pick<MissionConfig, 'expedition'> & { site?: Site }): ExpeditionSpec {
  return expeditionFor(config.expedition, config.site);
}

export function windowSol(state: MissionState): number {
  return expeditionSpec(state.config).windowSol + tuningFor(state.config.difficulty, state.config.site).windowBonus;
}

function cloneBase(b: BaseState): BaseState {
  return { levels: { ...b.levels }, progress: { ...b.progress }, project: b.project };
}

export function createMission(config: MissionConfig): MissionState {
  const t = tuningFor(config.difficulty, config.site);
  const spec = expeditionSpec(config);
  return {
    config,
    sol: 1,
    crew: spec.crew,
    air: t.startAirDays * spec.crew,
    food: t.startFoodDays * spec.crew,
    dose: 0,
    doseBudget: t.doseBudget,
    fuel: Math.min(99, config.prefillPct),
    wear: 0,
    damage: 0,
    coldPenalty: 0,
    monitorOnline: false,
    bonusCells: 0,
    stored: 0,
    base: cloneBase(config.base),
    builtThisExpedition: [],
    plan: buildPlan(config),
    log: [],
    status: 'playing',
  };
}

export function planFor(state: MissionState, sol = state.sol) {
  return state.plan[Math.min(sol, state.plan.length) - 1];
}

// ---------------------------------------------------------------- derived rates

export const has = (s: MissionState, id: UpgradeId) => s.base.levels[id] > 0;

/** Moon rules apply (lunar night, regolith O2, no dust, Earth 1.3 light-seconds away). */
export const isMoon = (s: MissionState) => s.config.site === 'moon';

/** Moon only: is this turn part of the lunar night? Always false on Mars. */
export function isNight(s: MissionState, sol = s.sol): boolean {
  return isMoon(s) && !!planFor(s, sol)?.night;
}

/**
 * Cells the battery gives back today. Mars: everything stored yesterday. Moon: the battery saves cells for the
 * lunar night and gives back up to MOON_BATTERY.releasePerNight on each night turn.
 */
export function batteryOut(s: MissionState): number {
  if (!isMoon(s)) return s.stored;
  return isNight(s) ? Math.min(s.stored, MOON_BATTERY.releasePerNight) : 0;
}

/** Moon only: turns until the lunar night starts (1 = tomorrow), or null if it is night now or no night is ahead. */
export function nightIn(s: MissionState): number | null {
  if (!isMoon(s) || isNight(s)) return null;
  for (let sol = s.sol + 1; sol <= s.plan.length; sol++) if (s.plan[sol - 1].night) return sol - s.sol;
  return null;
}

/** Moon only: turns of lunar night left, counting today (0 in the daytime). */
export function nightLeft(s: MissionState): number {
  let n = 0;
  for (let sol = s.sol; sol <= s.plan.length && isNight(s, sol); sol++) n++;
  return n;
}

/** Steady background (cosmic ray) dose per turn: Curiosity RAD at Gale Crater, or Chang'e 4 LND on the Moon. */
export function backgroundDose(s: MissionState): number {
  return isMoon(s) ? REAL.moonSurfaceUsvPerDay / 1000 : REAL.marsSurfaceMsvPerDay;
}

export function airPerCell(s: MissionState) {
  return RATES.airPerCell * (has(s, 'moxie2') ? UPGRADE_BOOST : 1);
}
export function fuelPctPerCell(s: MissionState) {
  return (100 / expeditionSpec(s.config).fuelNeeded) * (has(s, 'moxie2') ? UPGRADE_BOOST : 1);
}
export function foodPerGreenhouseCell(s: MissionState) {
  return RATES.foodPerGreenhouseCell * (has(s, 'dome2') ? UPGRADE_BOOST : 1);
}
export function shelterBlock(s: MissionState): readonly number[] {
  return has(s, 'berm') ? [0, SHELTER_BLOCK[2], SHELTER_BLOCK[2]] : SHELTER_BLOCK;
}

/** Solar cells on a clear sol, from the starting array plus panels built. */
export function solarCells(s: MissionState) {
  return tuningFor(s.config.difficulty, s.config.site).baseCells + s.base.levels.panel;
}

/** Most cells each module can take today. */
export function moduleCap(s: MissionState, id: ModuleId): number {
  switch (id) {
    case 'monitor':
      return has(s, 'monitor') ? MODULE_CAP.monitor : 0;
    case 'battery':
      if (!has(s, 'battery')) return 0;
      // On the Moon the battery keeps its charge for the night, up to its capacity.
      return isMoon(s) ? Math.max(0, Math.min(MODULE_CAP.battery, MOON_BATTERY.capacity - (s.stored - batteryOut(s)))) : MODULE_CAP.battery;
    case 'shelter':
      return has(s, 'berm') ? 1 : MODULE_CAP.shelter;
    case 'build': {
      const p = s.base.project;
      if (!p) return 0;
      const cost = nextCost(p, s.base.levels);
      return cost === null ? 0 : Math.min(MODULE_CAP.build, cost - s.base.progress[p]);
    }
    default:
      return MODULE_CAP[id];
  }
}

export function getBriefing(state: MissionState): Briefing {
  const p = planFor(state);
  const notes: string[] = [];
  const solar = solarCells(state);
  const moon = isMoon(state);
  const night = isNight(state);
  let cells = night ? 0 : solar;
  if (night) notes.push(`Lunar night, panels dark: -${solar}`);
  if (p.weather !== 'clear') {
    const lost = Math.round(solar * DUST_LOSS[p.weather]);
    cells -= lost;
    notes.push(`${p.weather === 'storm' ? 'Huge dust storm' : 'Dust storm'}: -${lost}`);
  }
  if (has(state, 'reactor')) {
    cells += REACTOR_CELLS;
    notes.push(`Reactor: +${REACTOR_CELLS}`);
  }
  if (p.cleaning) {
    cells += 1;
    notes.push('Wind cleaned your panels: +1');
  }
  if (state.bonusCells && !night) {
    cells += state.bonusCells;
    notes.push(`Cargo solar panel: +${state.bonusCells}`);
  }
  if (state.coldPenalty) {
    cells -= state.coldPenalty;
    notes.push(`Cold batteries: -${state.coldPenalty}`);
  }
  if (state.damage) {
    cells -= state.damage;
    notes.push(`Damaged batteries: -${state.damage}`);
  }
  const floor = night ? MOON_NIGHT.floorCells : 2;
  if (night && cells < floor) notes.push(`Backup battery: ${floor} cells`);
  cells = Math.max(floor, cells);
  const fromBattery = batteryOut(state);
  if (fromBattery) {
    cells += fromBattery;
    notes.push(`From your battery: +${fromBattery}`);
  }

  let warning: Warning | null = null;
  if (p.storm) {
    if (state.monitorOnline) warning = { source: 'monitor', event: p.storm.event };
    // Mars: the fastest particles beat Earth's warning. Moon: the warning needs only 1.3 seconds, so it is always in time.
    else if (!p.blackout && (!p.storm.fast || moon)) warning = { source: 'earth', event: p.storm.event };
  }

  return {
    sol: state.sol,
    weather: p.weather,
    cells,
    powerNotes: notes,
    heaterNeed: HEATER_NEED.normal + (p.coldSnap ? HEATER_NEED.coldSnap : 0) + (night ? MOON_NIGHT.heaterExtra : 0) + (has(state, 'dome2') ? 1 : 0),
    coldSnap: p.coldSnap,
    warning,
    outlook: p.blackout ? 'none' : p.outlookActive ? 'active' : 'quiet',
    blackout: p.blackout,
    dustTomorrow: p.dustTomorrow,
    resupply: p.resupply,
    monitorOnline: state.monitorOnline,
    fromBattery,
    hasMonitor: has(state, 'monitor'),
    hasBattery: has(state, 'battery'),
    buildRoom: moduleCap(state, 'build'),
    shelterBlock: shelterBlock(state),
    ...(moon ? { night, nightIn: nightIn(state), nightLeft: nightLeft(state), batteryHeld: state.stored - fromBattery } : {}),
  };
}

export interface AllocCheck {
  ok: boolean;
  remaining: number;
  problems: string[];
}

export function checkAlloc(state: MissionState, alloc: Allocation): AllocCheck {
  const b = getBriefing(state);
  const used = totalCells(alloc);
  const problems: string[] = [];
  for (const id of MODULE_IDS) {
    if (alloc[id] < 0 || !Number.isInteger(alloc[id])) problems.push(`Bad value for ${id}`);
    if (alloc[id] > moduleCap(state, id)) problems.push(`${id} holds at most ${moduleCap(state, id)}`);
  }
  if (used > b.cells) problems.push('You used more cells than you have.');
  if (used < b.cells) problems.push(`Place every power cell (${b.cells - used} left).`);
  return { ok: problems.length === 0, remaining: b.cells - used, problems };
}

/** HUD view: air and food in days for the whole crew. */
export function snapshot(s: Pick<MissionState, 'air' | 'food' | 'dose' | 'fuel' | 'crew'>): Snapshot {
  return { air: s.air / s.crew, food: s.food / s.crew, dose: s.dose, fuel: s.fuel };
}

/** Light time from Earth plus Earth's own reaction time, compared with how fast the particles arrive. */
export function earthWarningLateBy(lightTimeMin: number): number {
  return Math.max(1, Math.round(SUN_EARTH_LIGHT_MIN + EARTH_PROCESSING_MIN + lightTimeMin - FAST_PARTICLE_MIN));
}

interface Outcome {
  next: MissionState;
  report: SolReport;
}

/**
 * Apply one sol. `stormOverride` lets previews and tests ask "what if a storm hits / doesn't hit"
 * without revealing the hidden plan.
 */
function applySol(state: MissionState, alloc: Allocation, crate: CrateId | undefined, stormOverride?: 'none' | 'major'): Outcome {
  const p = planFor(state);
  const b = getBriefing(state);
  const before = snapshot(state);
  const s: MissionState = { ...state, base: cloneBase(state.base), builtThisExpedition: [...state.builtThisExpedition] };

  // Resupply crate lands first.
  if (p.resupply && crate) {
    if (crate === 'food') s.food += 3 * s.crew;
    if (crate === 'parts') {
      s.damage = Math.max(0, s.damage - 1);
      s.wear = 0;
    }
    if (crate === 'panel') s.bonusCells += 1; // power from tomorrow
  }

  // Production.
  const airMade = alloc.air * airPerCell(state) + alloc.greenhouse * RATES.airPerGreenhouseCell;
  const foodMade = alloc.greenhouse * foodPerGreenhouseCell(state);
  const fuelAdd = alloc.fuel * fuelPctPerCell(state);
  const fuelMade = Math.min(100 - s.fuel, fuelAdd);
  s.air += airMade;
  s.food += foodMade;
  s.fuel = Math.min(100, s.fuel + fuelAdd);

  // Workshop: invest cells in the current project.
  let built: UpgradeId | undefined;
  const project = s.base.project;
  if (project && alloc.build > 0) {
    s.base.progress[project] += alloc.build;
    const cost = nextCost(project, s.base.levels);
    if (cost !== null && s.base.progress[project] >= cost) {
      s.base.levels[project] += 1;
      s.base.progress[project] = 0;
      built = project;
      s.builtThisExpedition.push(project);
      if (s.base.levels[project] >= maxLevel(project)) s.base.project = defaultNextProject(s.base.levels, state.config.site);
    }
  }

  // Battery. Mars: cells stored today come back tomorrow. Moon: they wait in the battery for the night.
  s.stored = isMoon(state) ? state.stored - b.fromBattery + alloc.battery : alloc.battery;

  // Heaters: every missing cell chills the batteries (fewer cells tomorrow) and wears equipment.
  const shortfall = Math.max(0, b.heaterNeed - alloc.heaters);
  s.coldPenalty = shortfall;
  s.wear += shortfall;
  let newDamage = false;
  while (s.wear >= WEAR_PER_DAMAGE) {
    s.wear -= WEAR_PER_DAMAGE;
    s.damage += 1;
    newDamage = true;
  }

  // Radiation: the steady background (cosmic rays) plus any solar storm.
  const baseDose = backgroundDose(state);
  s.dose += baseDose;
  let stormInfo: SolReport['storm'];
  const storm =
    stormOverride === 'major'
      ? { event: { id: 'what-if', kind: 'flare' as const, severity: 'major' as const, time: '', origin: 'archive' as const }, fast: true }
      : stormOverride === 'none'
        ? undefined
        : p.storm;
  if (storm) {
    const unsheltered = STORM_DOSE[storm.event.severity];
    const block = shelterBlock(state);
    const shelterCells = Math.min(alloc.shelter, block.length - 1);
    const taken = unsheltered * (1 - block[shelterCells]);
    s.dose += taken;
    const warnedBy = b.warning ? b.warning.source : null;
    stormInfo = {
      event: storm.event,
      fast: storm.fast,
      warnedBy,
      lateByMin:
        !warnedBy && storm.fast && !p.blackout && !isMoon(state) && !(storm.event.kind === 'cme' && !storm.event.sourceLocation)
          ? earthWarningLateBy(state.config.lightTimeMin)
          : undefined,
      shelterCells,
      doseUnsheltered: unsheltered,
      doseTaken: taken,
    };
  }

  // The crew breathes and eats.
  s.air -= s.crew * RATES.usePerPersonPerSol;
  s.food -= s.crew * RATES.usePerPersonPerSol;

  // A powered monitor watches the Sun overnight and warns you tomorrow morning.
  s.monitorOnline = alloc.monitor >= 1;

  const EPS = 1e-9;
  s.air = round3(s.air);
  s.food = round3(s.food);
  s.dose = round3(s.dose);
  s.fuel = round3(s.fuel);

  if (s.air < -EPS) {
    s.status = 'lost';
    s.loseReason = 'air';
  } else if (s.food < -EPS) {
    s.status = 'lost';
    s.loseReason = 'food';
  } else if (s.dose > s.doseBudget + EPS) {
    s.status = 'lost';
    s.loseReason = 'dose';
  } else if (s.fuel >= 100 - EPS) {
    s.status = 'won';
  } else if (state.sol >= windowSol(state)) {
    s.status = 'lost';
    s.loseReason = 'window';
  }

  const report: SolReport = {
    sol: state.sol,
    alloc: { ...alloc },
    cells: b.cells,
    weather: p.weather,
    coldSnap: p.coldSnap,
    storm: stormInfo,
    baseDose,
    airMade: airMade / s.crew,
    foodMade: foodMade / s.crew,
    fuelMade,
    heaterShortfall: shortfall,
    newDamage,
    crate: p.resupply ? crate : undefined,
    blackout: p.blackout,
    cleaning: p.cleaning,
    built,
    buildProject: project,
    stored: alloc.battery,
    ...(p.night && isMoon(state) ? { night: true } : {}),
    before,
    after: snapshot(s),
  };
  s.sol = state.sol + 1;
  return { next: s, report };
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

export function runSol(state: MissionState, alloc: Allocation, crate?: CrateId): Outcome {
  if (state.status !== 'playing') throw new Error('Mission is over');
  const check = checkAlloc(state, alloc);
  if (!check.ok) throw new Error(check.problems.join(' '));
  const out = applySol(state, alloc, crate);
  out.next.log = [...state.log, out.report];
  return out;
}

/** Pick which upgrade the Workshop works on. Progress on every project is kept. */
export function setProject(state: MissionState, id: UpgradeId | null): MissionState {
  if (id && nextCost(id, state.base.levels) === null) return state;
  if (id && !upgradesFor(state.config.site).includes(id)) return state;
  return { ...state, base: { ...cloneBase(state.base), project: id } };
}

export interface Preview {
  after: Snapshot;
  /** Extra dose if a major storm hit today with this shelter setting. */
  stormDoseIfMajor: number;
  stormDoseIfMajorUnsheltered: number;
  coldPenaltyTomorrow: number;
  newDamage: boolean;
  monitorTomorrow: boolean;
  builds?: UpgradeId;
}

/** What-if preview for the budgeting screen. Never reveals hidden storms. */
export function previewSol(state: MissionState, alloc: Allocation, crate?: CrateId): Preview {
  const calm = applySol(state, alloc, crate, 'none');
  const major = applySol(state, alloc, crate, 'major');
  return {
    after: calm.report.after,
    stormDoseIfMajor: major.report.storm?.doseTaken ?? 0,
    stormDoseIfMajorUnsheltered: major.report.storm?.doseUnsheltered ?? 0,
    coldPenaltyTomorrow: calm.next.coldPenalty,
    newDamage: calm.report.newDamage,
    monitorTomorrow: calm.next.monitorOnline,
    builds: calm.report.built,
  };
}

/** Exposed for tests: run one sol with a forced storm scenario. */
export function simulateWhatIf(state: MissionState, alloc: Allocation, storm: 'none' | 'major', crate?: CrateId) {
  return applySol(state, alloc, crate, storm);
}

export function lifeSupportDays(s: Pick<MissionState, 'air' | 'food' | 'crew'>): number {
  return Math.min(s.air, s.food) / s.crew;
}

export function isModuleId(x: string): x is ModuleId {
  return (MODULE_IDS as readonly string[]).includes(x);
}
