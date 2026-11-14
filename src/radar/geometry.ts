// Written with AI assistance (Claude Code). See README "Use of AI tools".
// Geometry for the Space weather radar: turning DONKI's CME directions into directions in the solar system.
//
// DONKI's CME analyses give a direction as Stonyhurst heliographic longitude and latitude (degrees):
//   longitude 0 = the meridian facing Earth, + = west (W), - = east (E); latitude + = north of the Sun's equator.
// "West" as seen from Earth is the Sun's right-hand limb, which faces the way Earth moves around the Sun,
// so W90 points 90 degrees AHEAD of Earth in its orbit and W180 is the far side of the Sun.
//
// The planets (src/data/lighttime.ts) live in heliocentric ecliptic coordinates. To compare the two, we
// rebuild the Stonyhurst axes in ecliptic space for the moment of the event:
//   Z = the Sun's rotation axis (solar equator tilted 7.25 degrees to the ecliptic, ascending node K),
//   X = Earth's direction projected onto the solar equator, Y = Z x X (points the way Earth moves).
// Ignoring the 7.25-degree tilt would shift directions by at most about half a degree; we keep it anyway,
// because it also tells us how far north or south of the planets' plane a CME is aimed.

export const AU_KM = 149_597_870.7;
export const R_SUN_KM = 695_700;
/** DONKI's time21_5 is when the CME's front was 21.5 solar radii from the Sun's center. */
export const R21_5_AU = (21.5 * R_SUN_KM) / AU_KM;

const DEG = Math.PI / 180;
/** Tilt of the Sun's equator to the ecliptic (Carrington), degrees. */
export const SOLAR_EQUATOR_TILT = 7.25;

type V3 = [number, number, number];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a: V3): V3 => {
  const n = Math.hypot(a[0], a[1], a[2]);
  return [a[0] / n, a[1] / n, a[2] / n];
};

export const wrap360 = (deg: number) => ((deg % 360) + 360) % 360;
/** Signed difference a - b folded into -180..180. */
export const wrap180 = (deg: number) => wrap360(deg + 180) - 180;

/** Ecliptic longitude of the solar equator's ascending node, degrees (Meeus, Astronomical Algorithms, ch. 29). */
export function solarNodeDeg(ms: number): number {
  const jd = ms / 86_400_000 + 2440587.5;
  return 73.6667 + (1.3958333 * (jd - 2396758)) / 36525;
}

/** Unit vector toward ecliptic longitude/latitude (degrees). */
export function eclipticVector(lonDeg: number, latDeg = 0): V3 {
  const lo = lonDeg * DEG;
  const la = latDeg * DEG;
  return [Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)];
}

/**
 * A Stonyhurst direction (DONKI's CME longitude/latitude) as a heliocentric ecliptic direction.
 * `earthLonDeg` is Earth's heliocentric ecliptic longitude at the time of the measurement.
 */
export function stonyhurstToEcliptic(lonDeg: number, latDeg: number, earthLonDeg: number, ms: number): { lonDeg: number; latDeg: number } {
  const K = solarNodeDeg(ms) * DEG;
  const i = SOLAR_EQUATOR_TILT * DEG;
  const n: V3 = [Math.sin(i) * Math.sin(K), -Math.sin(i) * Math.cos(K), Math.cos(i)]; // the Sun's north pole
  const e = eclipticVector(earthLonDeg);
  const en = dot(e, n);
  const X = unit([e[0] - en * n[0], e[1] - en * n[1], e[2] - en * n[2]]);
  const Y = cross(n, X);
  const lo = lonDeg * DEG;
  const la = latDeg * DEG;
  const cx = Math.cos(la) * Math.cos(lo);
  const cy = Math.cos(la) * Math.sin(lo);
  const cz = Math.sin(la);
  const d: V3 = [cx * X[0] + cy * Y[0] + cz * n[0], cx * X[1] + cy * Y[1] + cz * n[1], cx * X[2] + cy * Y[2] + cz * n[2]];
  return { lonDeg: wrap360(Math.atan2(d[1], d[0]) / DEG), latDeg: Math.asin(Math.max(-1, Math.min(1, d[2]))) / DEG };
}

/** Angle between two ecliptic directions, degrees. */
export function angleBetween(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const c = dot(eclipticVector(lon1, lat1), eclipticVector(lon2, lat2));
  return Math.acos(Math.max(-1, Math.min(1, c))) / DEG;
}

/**
 * Where a cone (center line at ecliptic latitude `axisLatDeg`, half-angle `halfAngleDeg`) cuts the planets' plane:
 * the half-width in ecliptic longitude around its center line, degrees. Null if the cone passes wholly above or below.
 * A planet in the plane is inside the cone exactly when it is within this many degrees of the center line's longitude.
 */
export function planeHalfWidth(axisLatDeg: number, halfAngleDeg: number): number | null {
  const c = Math.cos(halfAngleDeg * DEG) / Math.cos(axisLatDeg * DEG);
  if (Math.abs(axisLatDeg) >= halfAngleDeg || c > 1) return null;
  return Math.acos(Math.max(-1, c)) / DEG;
}
