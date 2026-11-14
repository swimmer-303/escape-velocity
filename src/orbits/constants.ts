// Written with AI assistance (Claude Code). See README "Use of AI tools".
// Physical constants for the trip planner. Every value carries its source; nothing here is tuned for the game.

/** Astronomical unit, km (IAU 2012 Resolution B2: exactly 149,597,870.7 km). */
export const AU_KM = 149_597_870.7;

/** Seconds in a day. */
export const DAY_S = 86_400;

/**
 * The Sun's GM, km^3/s^2. NASA Sun Fact Sheet gives 132,712 x 10^6 km^3/s^2
 * (https://nssdc.gsfc.nasa.gov/planetary/factsheet/sunfact.html); this is the same value to JPL's full precision
 * (JPL Solar System Dynamics, astrodynamic parameters).
 */
export const MU_SUN = 1.32712440018e11;

/** Mars, from the NASA Mars Fact Sheet (https://nssdc.gsfc.nasa.gov/planetary/factsheet/marsfact.html). */
export const MARS = {
  /** GM, km^3/s^2 (0.042828 x 10^6). */
  mu: 42_828,
  /** Volumetric mean radius, km. With the GM above this gives the fact sheet's escape velocity, 5.03 km/s. */
  radiusKm: 3389.5,
  /** Synodic period with Earth, days. */
  synodicDays: 779.94,
} as const;

/** Earth, from the NASA Earth Fact Sheet (https://nssdc.gsfc.nasa.gov/planetary/factsheet/earthfact.html). */
export const EARTH = {
  /** GM, km^3/s^2 (0.39860 x 10^6; 398,600.4418 to full precision). */
  mu: 398_600.4418,
  /** Equatorial radius, km. */
  radiusKm: 6378.137,
} as const;

/**
 * Model choices (not measurements). The planner's "total speed change" assumes a ship that starts in a low circular
 * orbit around Mars and ends in a low circular orbit around Earth, the usual way porkchop plots count delta-v.
 * 300 km is about the height of NASA's Mars Reconnaissance Orbiter; 400 km is about the height of the ISS.
 */
export const PARKING = {
  marsAltKm: 300,
  earthAltKm: 400,
  /**
   * Earth "entry interface": 400,000 ft = 121.92 km, the altitude NASA uses for the start of atmospheric entry.
   * With it, our entry speeds reproduce NASA/TM-1998-208533 Table 4 (e.g. v-infinity 3.50 km/s -> 11.61 km/s).
   */
  earthEntryAltKm: 121.92,
} as const;
