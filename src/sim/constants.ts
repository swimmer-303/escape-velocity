// Written with AI assistance (Claude Code). See README "Use of AI tools".
//
// Real-world figures (REAL) and game tuning (TUNING).
// The game time-compresses and scales numbers so a mission fits in ~10 minutes.
// Every REAL value carries its source; the in-game Science Log shows them next to
// the scaled game value so players and judges can see exactly what we changed.

export const REAL = {
  /** O2 used per crew member per day, kg (nominal 0.895). NASA Life Support Baseline Values and Assumptions (BVAD) Rev 2, 2022, Table 3-31. */
  o2PerCrewKgPerDay: 0.895,
  crewSize: 4,
  /** Mars surface dose-equivalent rate at Gale Crater, mSv/day. Curiosity RAD, Hassler et al., Science 343 (2014), as reported in SwRI's release (paper: 0.64 ± 0.12). */
  marsSurfaceMsvPerDay: 0.67,
  /** Mars surface ABSORBED dose rate at Gale Crater, µGy/day (0.210 ± 0.040 mGy/day). Hassler et al., Science 2014. */
  marsSurfaceUgyPerDay: 210,
  /** Deep-space cruise dose-equivalent rate, mSv/day. Curiosity RAD cruise, Zeitlin et al., Science 2013. */
  cruiseMsvPerDay: 1.8,
  /** Moon surface dose-equivalent rate, µSv/day. Chang'e 4 LND, Zhang et al., Science Advances 2020. (~1.9x the ISS total of 731; 2.6x is vs. the ISS GCR-only 523.) */
  moonSurfaceUsvPerDay: 1369,
  /** May 20 2024 solar event at Gale Crater, Curiosity RAD absorbed dose, µGy. NASA/JPL news release, June 2024. */
  may2024EventUgy: 8100,
  may2024EventChestXrays: 30,
  /** MOXIE on Perseverance: total O2 made (g) and runs, 2021-2023. NASA/JPL. */
  moxieTotalO2g: 122,
  moxieRuns: 16,
  /** MOXIE best rate, g O2 per hour, at >= 98% purity. NASA/JPL. */
  moxiePeakGPerHour: 12,
  /** Opportunity solar output, Wh/day: normal and 2007 storm low point (NASA/JPL 2007); 2018 storm (The Planetary Society; JPL gives tau 10.8). */
  oppyNormalWh: 700,
  oppy2007StormWh: 128,
  oppy2018StormWh: 22,
  /** Sol length in minutes (24 h 39 min 35 s). */
  solMinutes: 24 * 60 + 39.6,
  /** Escape velocity, km/s. NASA planetary fact sheets. */
  marsEscapeKms: 5.03,
  moonEscapeKms: 2.38,
  /** One-way light time range Earth-Mars, minutes. */
  marsLightMinMin: 3,
  marsLightMaxMin: 22,
  moonLightSec: 1.3,
} as const;

export type Difficulty = 'cadet' | 'commander';

/**
 * Units: air and food are counted in PERSON-DAYS (1 = one astronaut for one sol).
 * The HUD shows "days left" = stock / crew size.
 */

export interface Tuning {
  /** Solar power cells on a clear sol before any upgrades. */
  baseCells: number;
  /** Starting reserves, in days for the whole crew (cargo lands with each crew). */
  startAirDays: number;
  startFoodDays: number;
  /** Mission radiation dose budget per crew, mSv. Much stricter than NASA's real 600 mSv career limit, so radiation choices matter in a short game. */
  doseBudget: number;
  /** Extra sols added to every expedition's launch window. */
  windowBonus: number;
  /** Real space-weather events dealt into each expedition. */
  stormCount: number;
  /** Max major (X-class) storms per expedition. */
  maxMajor: number;
  dustStorms: number;
  coldSnaps: number;
  blackout: boolean;
}

export const TUNING: Record<Difficulty, Tuning> = {
  cadet: {
    baseCells: 7,
    startAirDays: 4,
    startFoodDays: 6,
    doseBudget: 27,
    windowBonus: 3,
    stormCount: 3,
    maxMajor: 1,
    dustStorms: 1,
    coldSnaps: 2,
    blackout: false,
  },
  commander: {
    baseCells: 7,
    startAirDays: 3,
    startFoodDays: 5,
    doseBudget: 27,
    windowBonus: 1,
    stormCount: 4,
    maxMajor: 2,
    dustStorms: 2,
    coldSnaps: 3,
    blackout: true,
  },
};

/** The campaign: each expedition is a new crew that inherits the base the last crew built. */
export interface ExpeditionSpec {
  n: number;
  name: string;
  crew: number;
  /** Fuel units needed to fill this expedition's ascent vehicle (1 unit = 1 cell on FUEL before upgrades). */
  fuelNeeded: number;
  /** Launch window closes at the end of this sol (before difficulty bonus). */
  windowSol: number;
  resupplySol: number;
  blurb: string;
}

export const EXPEDITIONS: ExpeditionSpec[] = [
  {
    n: 1,
    name: 'First Footprints',
    crew: 4,
    fuelNeeded: 40,
    windowSol: 18,
    resupplySol: 7,
    blurb: 'Four astronauts land at a brand-new outpost in Gale Crater. Make enough rocket oxygen to get home, and start building a base for the crews who come after you.',
  },
  {
    n: 2,
    name: 'The Builders',
    crew: 5,
    fuelNeeded: 52,
    windowSol: 20,
    resupplySol: 8,
    blurb: 'Twenty-six months later, Earth and Mars line up again and a crew of five arrives. More people means more air and food. Can your base keep up?',
  },
  {
    n: 3,
    name: 'Home Away From Home',
    crew: 6,
    fuelNeeded: 58,
    windowSol: 23,
    resupplySol: 9,
    blurb: 'Six astronauts: the biggest crew yet. Everything the earlier crews built is now keeping this one alive.',
  },
];

/** Production per power cell, in person-days. */
export const RATES = {
  /** 1 cell on AIR = 1 day of air for 4 people (about 3.6 kg of oxygen). */
  airPerCell: 4,
  /** Grow lights are power-hungry: 1 cell = food for 2 people for a day... */
  foodPerGreenhouseCell: 2,
  /** ...plus a little oxygen from the plants. */
  airPerGreenhouseCell: 0.6,
  /** Each astronaut breathes and eats 1 person-day per sol. */
  usePerPersonPerSol: 1,
} as const;

/** Heaters needed per sol (cold snaps need 1 more; a second greenhouse dome needs 1 more). */
export const HEATER_NEED = { normal: 1, coldSnap: 1 } as const;

/** Cold damage: every 3 un-heated nights permanently costs 1 power cell (damaged batteries). */
export const WEAR_PER_DAMAGE = 3;

/** Fraction of SOLAR power lost to dust (the reactor doesn't care about dust). */
export const DUST_LOSS = { dusty: 0.3, storm: 0.4 } as const;
export const DUST_STORM_LENGTH = 3;

/** Radiation dose added by an unsheltered storm, mSv (scaled game values). */
export const STORM_DOSE = { minor: 0.5, moderate: 3, major: 8 } as const;

/** Fraction of storm dose blocked by shelter with 0, 1 or 2 cells. The regolith berm upgrade makes 1 cell enough. */
export const SHELTER_BLOCK = [0, 0.5, 0.9] as const;

/** Most cells each module can take in one sol. */
export const MODULE_CAP = {
  air: 4,
  fuel: 8,
  greenhouse: 6,
  heaters: 3,
  shelter: 2,
  monitor: 1,
  build: 3,
  battery: 2,
} as const;

/** Earth-side detection + forecaster time before a warning is sent, minutes (game assumption). */
export const EARTH_PROCESSING_MIN = 10;
/** Light time Sun to Earth, minutes. */
export const SUN_EARTH_LIGHT_MIN = 8.3;

/** Sols between expeditions on the real calendar: Earth-Mars launch windows come every ~26 months. */
export const SYNODIC_MONTHS = 26;
/** While the base is empty, the robot O2 plant pre-fills the next crew's tank (percent per power cell, capped). */
export const PREFILL_PCT_PER_CELL = 2;
export const PREFILL_MAX_PCT = 25;
