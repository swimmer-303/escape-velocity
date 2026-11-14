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
  /**
   * Moon surface dose-equivalent rate, µSv/day. Chang'e 4 LND, Zhang et al., "First measurements of the radiation
   * dose on the lunar surface", Science Advances 6, eaaz1334 (2020): "LND measured an average dose equivalent of
   * 1369 μSv/day on the surface of the Moon." https://doi.org/10.1126/sciadv.aaz1334
   * (~1.9x the ISS total of 731; 2.6x is vs. the ISS GCR-only 523, same paper.)
   */
  moonSurfaceUsvPerDay: 1369,
  /** Moon surface ABSORBED dose rate in silicon, µGy/hour (13.2 ± 1). Same paper (abstract). 13.2 x 24 = 317 µGy/day. */
  moonSurfaceUgyPerHour: 13.2,
  /** ISS dose equivalent over the same period, µSv/day (DOSIS 3D DOSTEL). Zhang et al. 2020. */
  issSameTimeUsvPerDay: 731,
  /** Mean Earth-Moon distance, km (semimajor axis 0.3844 x 10^6 km). NASA Moon Fact Sheet: https://nssdc.gsfc.nasa.gov/planetary/factsheet/moonfact.html */
  moonDistanceKm: 384_400,
  /** Synodic month (sunrise to sunrise on the Moon), days. NASA Moon Fact Sheet. Lunar day and lunar night each last about half: 14.8 days. */
  moonSynodicDays: 29.53,
  /** Equatorial surface temperature range, kelvin (95 K to 390 K, about -178 °C to 117 °C). NASA Moon Fact Sheet. */
  moonTempMinK: 95,
  moonTempMaxK: 390,
  /** Sunlight at the Moon, W/m², the same as at Earth. NASA Moon Fact Sheet. */
  moonSolarWm2: 1361,
  /**
   * Oxygen in lunar regolith, % by weight. ESA, "ESA opens oxygen plant - making air out of moondust" (17 Jan 2020):
   * "Samples returned from the lunar surface confirm that lunar regolith is made up of 40-45% percent oxygen by weight."
   * https://www.esa.int/Enabling_Support/Space_Engineering_Technology/ESA_opens_oxygen_plant_making_air_out_of_moondust
   */
  regolithO2PctMin: 40,
  regolithO2PctMax: 45,
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
  /** Escape velocity, km/s. NASA planetary fact sheets (Moon: https://nssdc.gsfc.nasa.gov/planetary/factsheet/moonfact.html). */
  marsEscapeKms: 5.03,
  moonEscapeKms: 2.38,
  /** One-way light time range Earth-Mars, minutes. */
  marsLightMinMin: 3,
  marsLightMaxMin: 22,
  /** One-way Earth-Moon light time, seconds: 384,400 km / 299,792 km/s = 1.28 s (1.21 s at perigee, 1.35 s at apogee). */
  moonLightSec: 1.3,
} as const;

export type Difficulty = 'cadet' | 'commander';

/** Where the base is. Missing (old saves) means Mars. */
export type Site = 'mars' | 'moon';

export function siteOf(x: { site?: Site } | null | undefined): Site {
  return x?.site === 'moon' ? 'moon' : 'mars';
}

/**
 * Where on Mars the base lands: Gale Crater (Curiosity's crater, the default) or the ice-rich plains of
 * Arcadia Planitia. Missing (old saves, and every Moon game) means Gale Crater.
 */
export type Landing = 'gale' | 'arcadia';

export function landingOf(x: { site?: Site; landing?: Landing } | null | undefined): Landing {
  return x?.site !== 'moon' && x?.landing === 'arcadia' ? 'arcadia' : 'gale';
}

/**
 * The ice landing site, Arcadia Planitia. Real facts (each with its source) and the game values built on them.
 *
 * - Where: the center of Arcadia Planitia, 46.66°N 192.00°E (planetocentric, east-positive), from the IAU/USGS
 *   Gazetteer of Planetary Nomenclature, feature 348: https://planetarynames.wr.usgs.gov/Feature/348
 *   Gale Crater (Bradbury Landing) is at 4.59°S (see src/data/snapshots/gale-terrain.json).
 * - Why: NASA's Subsurface Water Ice Mapping (SWIM) project found that "the broad plains of Arcadia and the extensive
 *   glacial networks across Deuteronilus Mensae match the greatest number of remote-sensing criteria for accessible
 *   ice-rich, subsurface material" (Morgan et al., Nature Astronomy 5, 230-236, 2021;
 *   https://pubs.usgs.gov/publication/70226786). The SWIM map value at this spot is in
 *   src/data/snapshots/swim-ice.json (scripts/fetch-swim.mjs).
 * - The trade-off: ice near the surface is stable poleward of about 50°, "but these regions are colder and subject to
 *   long seasons of extended night. Lower latitudes are warmer, have a manageable length of night and plenty of solar
 *   radiation for power generation" (G. Morgan, PSI, Feb 8 2021:
 *   https://www.psi.edu/blog/water-ice-resources-identified-in-martian-northern-hemisphere/). Ice is useful for
 *   "water for human consumption, growing plants for food, and for the generation of methane fuel and breathable air"
 *   (same release).
 *
 * The SIZES of the effects below are GAME VALUES (the Science Log says so): we found no published figure for how
 * much more food a Mars greenhouse grows with local water, or how many more cold nights a base at 47°N gets.
 */
export const ARCADIA = {
  lat: 46.66,
  lonE: 192.0,
  /** Gale Crater's latitude (Bradbury Landing), for comparisons. */
  galeLat: -4.59,
  /** GAME VALUE: less sunlight this far north, so the starting solar array makes 1 cell fewer (7 -> 6). */
  sunCellsLost: 1,
  /** GAME VALUE: colder nights, so each mission has this many more cold snaps (each needs 1 more heater cell). */
  extraColdSnaps: 2,
  /** GAME VALUE: water from the ice for the greenhouse: each greenhouse cell grows this many times as much food. */
  greenhouseBoost: 2,
} as const;

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

/**
 * Moon tuning (site 'moon'). The Moon has no air, so no dust storms, wind or cold snaps; Earth is 1.3 light-seconds
 * away, so there is no solar-conjunction blackout. Instead, every mission has a lunar night.
 */
export interface MoonTuning extends Tuning {
  /** Turns of lunar night in each mission. A real lunar night lasts about 14.8 Earth days: the game compresses it. */
  nightLength: number;
}

export const MOON_TUNING: Record<Difficulty, MoonTuning> = {
  cadet: {
    baseCells: 7,
    startAirDays: 4,
    startFoodDays: 6,
    doseBudget: 36,
    windowBonus: 3,
    stormCount: 3,
    maxMajor: 1,
    dustStorms: 0,
    coldSnaps: 0,
    blackout: false,
    nightLength: 4,
  },
  commander: {
    baseCells: 7,
    startAirDays: 3,
    startFoodDays: 5,
    doseBudget: 36,
    windowBonus: 1,
    stormCount: 4,
    maxMajor: 2,
    dustStorms: 0,
    coldSnaps: 0,
    blackout: false,
    nightLength: 4,
  },
};

/** Arcadia Planitia: Mars rules, with a smaller starting solar array and more cold snaps (game values, see ARCADIA). */
export const ARCADIA_TUNING: Record<Difficulty, Tuning> = {
  cadet: { ...TUNING.cadet, baseCells: TUNING.cadet.baseCells - ARCADIA.sunCellsLost, coldSnaps: TUNING.cadet.coldSnaps + ARCADIA.extraColdSnaps },
  commander: {
    ...TUNING.commander,
    baseCells: TUNING.commander.baseCells - ARCADIA.sunCellsLost,
    coldSnaps: TUNING.commander.coldSnaps + ARCADIA.extraColdSnaps,
  },
};

export function tuningFor(difficulty: Difficulty, site?: Site, landing?: Landing): Tuning {
  if (site === 'moon') return MOON_TUNING[difficulty];
  return landing === 'arcadia' ? ARCADIA_TUNING[difficulty] : TUNING[difficulty];
}

/** Lunar night rules (game values). */
export const MOON_NIGHT = {
  /** Heaters need this many extra cells on a lunar night. */
  heaterExtra: 1,
  /** With the panels dark, the base's small backup battery always gives at least this many cells (just enough heat for a normal night). */
  floorCells: 2,
} as const;

/** On the Moon the Battery bank saves cells for the night: up to 2 a day go in, up to `releasePerNight` come out each night. */
export const MOON_BATTERY = { capacity: 6, releasePerNight: 2 } as const;

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

/** The same three crews on the Moon, at a base near the lunar south pole. Windows and fuel are game values. */
export const MOON_EXPEDITIONS: ExpeditionSpec[] = [
  {
    ...EXPEDITIONS[0],
    fuelNeeded: 34,
    blurb: "Four astronauts land at a brand-new outpost near the Moon's south pole, the region NASA plans to explore with Artemis. Make enough rocket oxygen to get home, and start building a base for the crews who come after you.",
  },
  {
    ...EXPEDITIONS[1],
    fuelNeeded: 44,
    blurb: 'A crew of five arrives at the base the first crew left. More people means more air and food. Can your base keep up?',
  },
  {
    ...EXPEDITIONS[2],
    fuelNeeded: 50,
    blurb: 'Six astronauts: the biggest crew yet. Everything the earlier crews built is now keeping this one alive through the long lunar night.',
  },
];

/** The same three Mars crews at Arcadia Planitia: only the first crew's story changes. */
export const ARCADIA_EXPEDITIONS: ExpeditionSpec[] = [
  {
    ...EXPEDITIONS[0],
    blurb:
      'Four astronauts land on the icy plains of Arcadia Planitia, far north of Gale Crater. There is ice under their boots, but less sunshine and colder nights. Make enough rocket oxygen to get home, and start building a base for the crews who come after you.',
  },
  EXPEDITIONS[1],
  EXPEDITIONS[2],
];

export function expeditionFor(n: number, site?: Site, landing?: Landing): ExpeditionSpec {
  const list = site === 'moon' ? MOON_EXPEDITIONS : landing === 'arcadia' ? ARCADIA_EXPEDITIONS : EXPEDITIONS;
  return list[Math.max(0, Math.min(list.length - 1, n - 1))];
}

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
