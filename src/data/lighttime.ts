// Written with AI assistance (Claude Code). See README "Use of AI tools".
// Approximate Earth-Mars distance and one-way light time for any date.
// Uses the Keplerian elements from JPL Solar System Dynamics,
// "Approximate Positions of the Planets" (E. M. Standish), valid 1800-2050:
// https://ssd.jpl.nasa.gov/planets/approx_pos.html
// Orbits are treated as flat (inclination ignored), so results are APPROXIMATE (within ~1-2%).

interface Elements {
  a: number; // AU
  e: number;
  L0: number; // mean longitude at J2000, deg
  Ldot: number; // deg per Julian century
  peri: number; // longitude of perihelion, deg
}

const EARTH: Elements = { a: 1.00000261, e: 0.01671123, L0: 100.46457166, Ldot: 35999.37244981, peri: 102.93768193 };
const MARS: Elements = { a: 1.52371034, e: 0.0933941, L0: -4.55343205, Ldot: 19140.30268499, peri: -23.94362959 };

const DEG = Math.PI / 180;
const AU_LIGHT_SECONDS = 499.004784;
const J2000_MS = Date.UTC(2000, 0, 1, 12, 0, 0);

function position(el: Elements, centuries: number): [number, number] {
  const L = el.L0 + el.Ldot * centuries;
  let M = ((L - el.peri) % 360) * DEG;
  // Solve Kepler's equation E - e sin E = M.
  let E = M;
  for (let i = 0; i < 8; i++) E = E - (E - el.e * Math.sin(E) - M) / (1 - el.e * Math.cos(E));
  const x = el.a * (Math.cos(E) - el.e);
  const y = el.a * Math.sqrt(1 - el.e * el.e) * Math.sin(E);
  const w = el.peri * DEG;
  return [x * Math.cos(w) - y * Math.sin(w), x * Math.sin(w) + y * Math.cos(w)];
}

export type Planet = 'earth' | 'mars';
const PLANETS: Record<Planet, Elements> = { earth: EARTH, mars: MARS };
/** Days for one trip around the Sun (from the mean-longitude rates above). */
export const ORBIT_DAYS: Record<Planet, number> = { earth: (360 / EARTH.Ldot) * 36525, mars: (360 / MARS.Ldot) * 36525 };

export interface HelioPosition {
  /** Heliocentric ecliptic coordinates in AU (x toward the March equinox, y 90 degrees ahead, J2000), orbits flattened. */
  x: number;
  y: number;
  /** Distance from the Sun, AU. */
  rAU: number;
  /** Heliocentric ecliptic longitude, degrees 0-360. */
  lonDeg: number;
}

/** Where Earth or Mars is around the Sun at a moment (same approximate JPL elements as the light-time calculation). */
export function heliocentric(planet: Planet, date: Date | number): HelioPosition {
  const ms = typeof date === 'number' ? date : date.getTime();
  const [x, y] = position(PLANETS[planet], (ms - J2000_MS) / (86_400_000 * 36525));
  return { x, y, rAU: Math.hypot(x, y), lonDeg: ((Math.atan2(y, x) / DEG) % 360 + 360) % 360 };
}

export interface LightTime {
  date: Date;
  distanceAU: number;
  distanceKm: number;
  oneWayMinutes: number;
  /** Earth-Sun-Mars angle in degrees: near 0 = opposition (close), near 180 = conjunction (Sun in the way). */
  sunAngleDeg: number;
}

export function earthMarsLightTime(date: Date = new Date()): LightTime {
  const T = (date.getTime() - J2000_MS) / (86_400_000 * 36525);
  const [ex, ey] = position(EARTH, T);
  const [mx, my] = position(MARS, T);
  const dx = mx - ex;
  const dy = my - ey;
  const distanceAU = Math.hypot(dx, dy);
  const angle = Math.abs(Math.atan2(ex * my - ey * mx, ex * mx + ey * my)) / DEG;
  return {
    date,
    distanceAU,
    distanceKm: distanceAU * 149_597_870.7,
    oneWayMinutes: (distanceAU * AU_LIGHT_SECONDS) / 60,
    sunAngleDeg: angle,
  };
}
