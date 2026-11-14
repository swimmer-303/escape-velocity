// Written with AI assistance (Claude Code). See README "Use of AI tools".
// The heart of Escape Velocity: a pure, deterministic, seeded simulation.
// No rendering or DOM imports allowed in src/sim.

import {
  TUNING,
  RATES,
  REAL,
  HEATER_NEED,
  WEAR_PER_DAMAGE,
  DUST_CELL_LOSS,
  STORM_DOSE,
  SHELTER_BLOCK,
  MODULE_CAP,
  EARTH_PROCESSING_MIN,
  SUN_EARTH_LIGHT_MIN,
} from './constants';
import { buildPlan } from './plan';
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

/** Minutes after a big flare that its fastest particles can reach Mars (game assumption). */
export const FAST_PARTICLE_MIN = 20;

export function emptyAlloc(): Allocation {
  return { air: 0, fuel: 0, greenhouse: 0, heaters: 0, shelter: 0, monitor: 0 };
}

export function totalCells(a: Allocation): number {
  return MODULE_IDS.reduce((s, id) => s + a[id], 0);
}

export function createMission(config: MissionConfig): MissionState {
  const t = TUNING[config.difficulty];
  return {
    config,
    sol: 1,
    air: t.startAir,
    food: t.startFood,
    dose: 0,
    doseBudget: t.doseBudget,
    fuel: 0,
    wear: 0,
    damage: 0,
    coldPenalty: 0,
    monitorOnline: false,
    bonusCells: 0,
    plan: buildPlan(config),
    log: [],
    status: 'playing',
  };
}

export function windowSol(state: MissionState): number {
  return TUNING[state.config.difficulty].windowSol;
}

export function planFor(state: MissionState, sol = state.sol) {
  return state.plan[Math.min(sol, state.plan.length) - 1];
}

export function getBriefing(state: MissionState): Briefing {
  const t = TUNING[state.config.difficulty];
  const p = planFor(state);
  const notes: string[] = [];
  let cells = t.baseCells;
  if (p.weather === 'dusty') {
    cells -= DUST_CELL_LOSS.regional;
    notes.push(`Dust storm: -${DUST_CELL_LOSS.regional}`);
  } else if (p.weather === 'storm') {
    cells -= DUST_CELL_LOSS.global;
    notes.push(`Huge dust storm: -${DUST_CELL_LOSS.global}`);
  }
  if (p.cleaning) {
    cells += 1;
    notes.push('Wind cleaned your panels: +1');
  }
  if (state.bonusCells) {
    cells += state.bonusCells;
    notes.push(`Extra solar panel: +${state.bonusCells}`);
  }
  if (state.coldPenalty) {
    cells -= state.coldPenalty;
    notes.push(`Cold batteries: -${state.coldPenalty}`);
  }
  if (state.damage) {
    cells -= state.damage;
    notes.push(`Damaged batteries: -${state.damage}`);
  }
  cells = Math.max(2, cells);

  let warning: Warning | null = null;
  if (p.storm) {
    if (state.monitorOnline) warning = { source: 'monitor', event: p.storm.event };
    else if (!p.blackout && !p.storm.fast) warning = { source: 'earth', event: p.storm.event };
  }

  return {
    sol: state.sol,
    weather: p.weather,
    cells,
    powerNotes: notes,
    heaterNeed: p.coldSnap ? HEATER_NEED.coldSnap : HEATER_NEED.normal,
    coldSnap: p.coldSnap,
    warning,
    outlook: p.blackout ? 'none' : p.outlookActive ? 'active' : 'quiet',
    blackout: p.blackout,
    dustTomorrow: p.dustTomorrow,
    resupply: p.resupply,
    monitorOnline: state.monitorOnline,
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
    if (alloc[id] > MODULE_CAP[id]) problems.push(`${id} holds at most ${MODULE_CAP[id]}`);
  }
  if (used > b.cells) problems.push('You used more cells than you have.');
  if (used < b.cells) problems.push(`Place every power cell (${b.cells - used} left).`);
  return { ok: problems.length === 0, remaining: b.cells - used, problems };
}

export function snapshot(s: Pick<MissionState, 'air' | 'food' | 'dose' | 'fuel'>): Snapshot {
  return { air: s.air, food: s.food, dose: s.dose, fuel: s.fuel };
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
function applySol(
  state: MissionState,
  alloc: Allocation,
  crate: CrateId | undefined,
  stormOverride?: 'none' | 'major',
): Outcome {
  const t = TUNING[state.config.difficulty];
  const p = planFor(state);
  const b = getBriefing(state);
  const before = snapshot(state);
  const s: MissionState = { ...state, log: state.log };

  // Resupply crate lands first.
  if (p.resupply && crate) {
    if (crate === 'food') s.food += 3;
    if (crate === 'parts') {
      s.damage = Math.max(0, s.damage - 1);
      s.wear = 0;
    }
    if (crate === 'panel') s.bonusCells += 1; // power from tomorrow
  }

  // Production.
  const airMade = alloc.air * RATES.airPerCell + alloc.greenhouse * RATES.airPerGreenhouseCell;
  const foodMade = alloc.greenhouse * RATES.foodPerGreenhouseCell;
  const fuelMade = Math.min(100 - s.fuel, alloc.fuel * t.fuelPerCell);
  s.air += airMade;
  s.food += foodMade;
  s.fuel = Math.min(100, s.fuel + alloc.fuel * t.fuelPerCell);

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
  const baseDose = REAL.marsSurfaceMsvPerDay;
  s.dose += baseDose;
  let stormInfo: SolReport['storm'];
  const realStorm = stormOverride === undefined ? p.storm : undefined;
  const storm =
    stormOverride === 'major'
      ? { event: { id: 'what-if', kind: 'flare' as const, severity: 'major' as const, time: '', origin: 'archive' as const }, fast: true }
      : realStorm;
  if (storm) {
    const unsheltered = STORM_DOSE[storm.event.severity];
    const shelterCells = Math.min(alloc.shelter, SHELTER_BLOCK.length - 1);
    const taken = unsheltered * (1 - SHELTER_BLOCK[shelterCells]);
    s.dose += taken;
    const warnedBy = b.warning ? b.warning.source : null;
    stormInfo = {
      event: storm.event,
      fast: storm.fast,
      warnedBy,
      lateByMin:
        !warnedBy && storm.fast && !p.blackout && !(storm.event.kind === 'cme' && !storm.event.sourceLocation)
          ? earthWarningLateBy(state.config.lightTimeMin)
          : undefined,
      shelterCells,
      doseUnsheltered: unsheltered,
      doseTaken: taken,
    };
  }

  // The crew breathes and eats.
  s.air -= RATES.airUsePerSol;
  s.food -= RATES.foodUsePerSol;

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
  } else if (state.sol >= t.windowSol) {
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
    airMade,
    foodMade,
    fuelMade,
    heaterShortfall: shortfall,
    newDamage,
    crate: p.resupply ? crate : undefined,
    blackout: p.blackout,
    cleaning: p.cleaning,
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

export interface Preview {
  after: Snapshot;
  /** Extra dose if a major storm hit today with this shelter setting. */
  stormDoseIfMajor: number;
  stormDoseIfMajorUnsheltered: number;
  coldPenaltyTomorrow: number;
  newDamage: boolean;
  monitorTomorrow: boolean;
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
  };
}

/** Exposed for tests: run one sol with a forced storm scenario. */
export function simulateWhatIf(state: MissionState, alloc: Allocation, storm: 'none' | 'major', crate?: CrateId) {
  return applySol(state, alloc, crate, storm);
}

export function lifeSupportDays(s: Pick<MissionState, 'air' | 'food'>): number {
  return Math.min(s.air, s.food);
}

export function isModuleId(x: string): x is ModuleId {
  return (MODULE_IDS as readonly string[]).includes(x);
}
