// Written with AI assistance (Claude Code). See README "Use of AI tools".
import type { Difficulty, Site } from './constants';
import type { BaseState, UpgradeId } from './upgrades';

export type ModuleId = 'air' | 'fuel' | 'greenhouse' | 'heaters' | 'shelter' | 'monitor' | 'build' | 'battery';
export const MODULE_IDS: readonly ModuleId[] = ['air', 'fuel', 'greenhouse', 'heaters', 'shelter', 'monitor', 'build', 'battery'];

export type Allocation = Record<ModuleId, number>;

export type Severity = 'minor' | 'moderate' | 'major';

/** A real space-weather event taken from NASA DONKI (live or archived). Never invented. */
export interface SpaceWeatherEvent {
  /** DONKI activity id, e.g. "2024-05-20T05:08:00-FLR-001". */
  id: string;
  kind: 'flare' | 'sep' | 'cme';
  /** Flare class, e.g. "X12.0". */
  classType?: string;
  severity: Severity;
  /** ISO time of the event (flare peak / SEP onset / CME start). */
  time: string;
  sourceLocation?: string | null;
  activeRegionNum?: number | null;
  /** True if DONKI links this flare/CME to a solar energetic particle (SEP) event. */
  linkedSep?: boolean;
  /** CME speed from DONKI's most accurate analysis, km/s. */
  speedKms?: number | null;
  /** Game note shown on the card (e.g. why this storm is weaker at Mars). Never data. */
  note?: string;
  link?: string;
  /** Where the record came from: fetched today (live) or a stored snapshot (archive). */
  origin: 'live' | 'archive';
}

export type Weather = 'clear' | 'dusty' | 'storm';

export interface SolPlan {
  sol: number;
  weather: Weather;
  /** Dust storm starts tomorrow: orbiters spot it a day ahead. */
  dustTomorrow: boolean;
  coldSnap: boolean;
  /** A radiation storm reaches the outpost this sol. */
  storm?: { event: SpaceWeatherEvent; fast: boolean };
  /** Earth's space-weather outlook ("the Sun is active"). Can be a false alarm. */
  outlookActive: boolean;
  /** Sun is between Earth and Mars: no messages from Earth. */
  blackout: boolean;
  resupply: boolean;
  /** Wind cleaned the solar panels: +1 cell. */
  cleaning: boolean;
  /** Moon only: the lunar night (the solar panels are dark). Missing on Mars. */
  night?: boolean;
}

export type CrateId = 'food' | 'parts' | 'panel';

export interface MissionConfig {
  seed: string;
  difficulty: Difficulty;
  /** Where the base is: Mars (default, also for old saves) or the Moon. */
  site?: Site;
  /** One-way Earth to Mars (or Moon) light time used for the comm-delay mechanic, minutes. */
  lightTimeMin: number;
  /** Real space-weather events to deal into the mission. */
  eventPool: SpaceWeatherEvent[];
  /** Fixed history scenario (e.g. May 2024) instead of a random deal. */
  scenario?: 'may2024';
  /** Which expedition of the campaign (1-based). */
  expedition: number;
  /** The base this crew inherits. */
  base: BaseState;
  /** Fuel tank % pre-filled by the robot O2 plant before the crew arrived. */
  prefillPct: number;
  /** Real events already used by earlier expeditions (so each crew meets new storms). */
  usedEventIds?: string[];
}

export interface Warning {
  source: 'monitor' | 'earth';
  event: SpaceWeatherEvent;
}

export interface Briefing {
  sol: number;
  weather: Weather;
  cells: number;
  /** Why power is lower/higher than normal today. */
  powerNotes: string[];
  heaterNeed: number;
  coldSnap: boolean;
  warning: Warning | null;
  /** 'active' | 'quiet' from Earth, or 'none' during a blackout. */
  outlook: 'active' | 'quiet' | 'none';
  blackout: boolean;
  dustTomorrow: boolean;
  resupply: boolean;
  monitorOnline: boolean;
  /** Cells stored in the battery yesterday, included in `cells`. */
  fromBattery: number;
  /** Which modules exist yet. */
  hasMonitor: boolean;
  hasBattery: boolean;
  /** Cells the Workshop can still use on its current project today. */
  buildRoom: number;
  shelterBlock: readonly number[];
  /** Moon only: tonight is part of the lunar night. */
  night?: boolean;
  /** Moon only: turns until the lunar night begins (1 = tomorrow), if it is still ahead. */
  nightIn?: number | null;
  /** Moon only: turns of night left, counting today. */
  nightLeft?: number;
  /** Moon only: cells waiting in the battery for the night (after today's share comes out). */
  batteryHeld?: number;
}

export interface SolReport {
  sol: number;
  alloc: Allocation;
  cells: number;
  weather: Weather;
  coldSnap: boolean;
  storm?: {
    event: SpaceWeatherEvent;
    fast: boolean;
    warnedBy: 'monitor' | 'earth' | null;
    /** Minutes Earth's warning arrived after the particles, if it was late. */
    lateByMin?: number;
    shelterCells: number;
    doseUnsheltered: number;
    doseTaken: number;
  };
  baseDose: number;
  airMade: number;
  foodMade: number;
  fuelMade: number;
  heaterShortfall: number;
  newDamage: boolean;
  crate?: CrateId;
  blackout: boolean;
  cleaning: boolean;
  /** Upgrade finished this sol. */
  built?: UpgradeId;
  /** Every upgrade finished this sol (extra Workshop cells roll into the next project). */
  builtAll?: UpgradeId[];
  buildProject?: UpgradeId | null;
  stored: number;
  /** Moon only: this turn was part of the lunar night. */
  night?: boolean;
  before: Snapshot;
  after: Snapshot;
}

/** What the HUD shows. air/food are in DAYS for the whole crew (stock / crew size). */
export interface Snapshot {
  air: number;
  food: number;
  dose: number;
  fuel: number;
}

export type LoseReason = 'air' | 'food' | 'dose' | 'window';

export interface MissionState {
  config: MissionConfig;
  sol: number;
  crew: number;
  /** Person-days of air and food in storage. */
  air: number;
  food: number;
  dose: number;
  doseBudget: number;
  fuel: number;
  wear: number;
  damage: number;
  coldPenalty: number;
  monitorOnline: boolean;
  bonusCells: number;
  /** Cells in the battery for tomorrow. */
  stored: number;
  /** The base: upgrades built, Workshop progress. Carries to the next crew. */
  base: BaseState;
  /** Upgrades finished during this expedition. */
  builtThisExpedition: UpgradeId[];
  plan: SolPlan[];
  log: SolReport[];
  status: 'playing' | 'won' | 'lost';
  loseReason?: LoseReason;
}
