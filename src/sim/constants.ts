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

export interface Tuning {
  /** Power cells on a clear sol. */
  baseCells: number;
  /** Starting reserves, in "crew-days" (1 = enough for the whole crew for one sol). */
  startAir: number;
  startFood: number;
  /** Mission radiation dose budget, mSv. Much stricter than NASA's real 600 mSv career limit, so radiation choices matter in a short game. */
  doseBudget: number;
  /** Fuel tank % added per power cell on the FUEL side of the O2 plant. */
  fuelPerCell: number;
  /** Launch window closes at the end of this sol. */
  windowSol: number;
  /** How many real space-weather events get dealt into the mission. */
  stormCount: number;
  /** Max major (X-class) storms in the deck. */
  maxMajor: number;
  dustStorms: number;
  coldSnaps: number;
  blackout: boolean;
  resupplySol: number;
}

export const TUNING: Record<Difficulty, Tuning> = {
  cadet: {
    baseCells: 7,
    startAir: 4,
    startFood: 6,
    doseBudget: 27,
    fuelPerCell: 2.7,
    windowSol: 26,
    stormCount: 3,
    maxMajor: 1,
    dustStorms: 1,
    coldSnaps: 2,
    blackout: false,
    resupplySol: 8,
  },
  commander: {
    baseCells: 7,
    startAir: 3,
    startFood: 5,
    doseBudget: 28,
    fuelPerCell: 2.3,
    windowSol: 24,
    stormCount: 4,
    maxMajor: 2,
    dustStorms: 2,
    coldSnaps: 3,
    blackout: true,
    resupplySol: 9,
  },
};

/** Production per power cell (game units, crew-days). Same on every difficulty. */
export const RATES = {
  /** 1 cell on the AIR side of the O2 plant = 1 day of air for the crew. */
  airPerCell: 1,
  /** Grow lights are power-hungry: 1 cell = half a day of food... */
  foodPerGreenhouseCell: 0.5,
  /** ...plus a little oxygen from the plants. */
  airPerGreenhouseCell: 0.15,
  /** The crew eats and breathes 1 crew-day of each per sol. */
  airUsePerSol: 1,
  foodUsePerSol: 1,
} as const;

/** Heaters needed per sol (cold snaps need 2). */
export const HEATER_NEED = { normal: 1, coldSnap: 2 } as const;

/** Cold damage: every 3 un-heated nights permanently costs 1 power cell (damaged batteries). */
export const WEAR_PER_DAMAGE = 3;

/** Power lost to dust. */
export const DUST_CELL_LOSS = { regional: 2, global: 3 } as const;
export const DUST_STORM_LENGTH = { regional: 3, global: 3 } as const;

/** Radiation dose added by an unsheltered storm, mSv (scaled game values). */
export const STORM_DOSE = { minor: 0.5, moderate: 3, major: 8 } as const;

/** Fraction of storm dose blocked by shelter with 0, 1 or 2 cells. */
export const SHELTER_BLOCK = [0, 0.5, 0.9] as const;

/** Most cells each module can take. */
export const MODULE_CAP = {
  air: 3,
  fuel: 6,
  greenhouse: 4,
  heaters: 2,
  shelter: 2,
  monitor: 1,
} as const;

/** Earth-side detection + forecaster time before a warning is sent, minutes (game assumption). */
export const EARTH_PROCESSING_MIN = 10;
/** Light time Sun to Earth, minutes. */
export const SUN_EARTH_LIGHT_MIN = 8.3;
