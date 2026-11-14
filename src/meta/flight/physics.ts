// Written with AI assistance (Claude Code). See README "Use of AI tools".
// Flight physics for the two mini-games, as pure functions (state in, new state out) so they are easy to test.
//
// REAL: surface gravity (Mars 3.71 m/s², Moon 1.62 m/s²; NASA planetary fact sheets), planet radii, escape
// velocities (REAL in src/sim/constants.ts), and the orbit speed that follows from them (v_orbit = v_escape / √2).
// GAME VALUES (said so on screen): landing heights and speeds are shortened so a landing fits in half a minute,
// the launch clock runs LAUNCH_WARP times faster than real time, and engine heat is a game rule.

import { REAL } from '../../sim/constants';

export type FlightSite = 'mars' | 'moon';
export type Medal = 'gold' | 'silver' | 'bronze';

/** Surface gravity, m/s². NASA Mars and Moon fact sheets (nssdc.gsfc.nasa.gov/planetary/factsheet). */
export const GRAVITY: Record<FlightSite, number> = { mars: 3.71, moon: 1.62 };
/** Earth's surface gravity, m/s², to say "about 3/8 of Earth's". */
export const EARTH_GRAVITY = 9.81;
/** Volumetric mean radius, m. NASA fact sheets: Mars 3389.5 km, Moon 1737.4 km. */
export const RADIUS: Record<FlightSite, number> = { mars: 3_389_500, moon: 1_737_400 };
/** Escape velocity at the surface, m/s (5.03 and 2.38 km/s). */
export const ESCAPE: Record<FlightSite, number> = { mars: REAL.marsEscapeKms * 1000, moon: REAL.moonEscapeKms * 1000 };
/** Speed for a circular orbit just above the surface, m/s: escape velocity / √2 (Mars 3.56 km/s, Moon 1.68 km/s). */
export const ORBIT: Record<FlightSite, number> = { mars: ESCAPE.mars / Math.SQRT2, moon: ESCAPE.moon / Math.SQRT2 };

/** XP for a medal, and for letting the autopilot land. */
export const MEDAL_XP: Record<Medal, number> = { gold: 60, silver: 40, bronze: 25 };
export const AUTOPILOT_XP = 10;
export const MEDAL_RANK: Record<Medal, number> = { gold: 3, silver: 2, bronze: 1 };

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
const clamp01 = (x: number) => clamp(x, 0, 1);

export interface FlightInput {
  thrust: boolean;
  left: boolean;
  right: boolean;
}
export const NO_INPUT: FlightInput = { thrust: false, left: false, right: false };

// =================================================================== LANDING

export interface LandingParams {
  g: number;
  /** Main engine acceleration at full power, m/s² (thrust-to-weight about 2.4 to 2.6). */
  thrust: number;
  /** Side thrusters, m/s². */
  rcs: number;
  /** Seconds of main-engine burn in a full tank (side thrusters use RCS_FUEL as much). */
  burnSeconds: number;
  /** Where control starts (after the parachute on Mars): height m, speeds m/s, sideways offset from the pad m. */
  startAlt: number;
  startVy: number;
  startX: number;
  startVx: number;
  /** Mars only: seconds hanging under the parachute before the rockets take over (0 on the Moon: no air). */
  chuteSeconds: number;
  /** Mars only: the speed the parachute settles to, m/s (game value: real Mars parachutes fall much faster). */
  chuteTerminal: number;
}

export const LANDING: Record<FlightSite, LandingParams> = {
  mars: { g: GRAVITY.mars, thrust: 9, rcs: 2, burnSeconds: 26, startAlt: 420, startVy: -38, startX: -55, startVx: 4, chuteSeconds: 2.6, chuteTerminal: 26 },
  moon: { g: GRAVITY.moon, thrust: 4.2, rcs: 1.2, burnSeconds: 32, startAlt: 240, startVy: -10, startX: 50, startVx: -3, chuteSeconds: 0, chuteTerminal: 0 },
};
/** Touching down slower than this (m/s) is safe. */
export const SAFE_SPEED = 3;
/** This slow or slower counts as perfectly soft. */
export const SOFT_SPEED = 0.6;
/** Half the pad's width, m. */
export const PAD_HALF = 10;
/** Side thrusters burn this fraction of the main engine's fuel rate. */
const RCS_FUEL = 0.15;
const CEILING_EXTRA = 140;
const X_LIMIT = 220;

export type LandingPhase = 'chute' | 'flying' | 'landed' | 'crashed';

export interface LandingState {
  site: FlightSite;
  phase: LandingPhase;
  /** Seconds since the start. */
  t: number;
  /** Sideways position (m, 0 = pad center, + = toward the base) and height above the ground (m). */
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Fuel left, 0..1. */
  fuel: number;
  /** Seconds of parachute left (Mars). */
  chute: number;
  /** What the engines did on the last step (for flames and sound). */
  firing: boolean;
  side: -1 | 0 | 1;
  /** Speed at touchdown, m/s. */
  touchdown?: number;
}

export function createLanding(site: FlightSite): LandingState {
  const p = LANDING[site];
  // On Mars, start a little higher and faster: the parachute phase slows the lander to its starting speed.
  const chute = p.chuteSeconds;
  return {
    site,
    phase: chute > 0 ? 'chute' : 'flying',
    t: 0,
    x: p.startX - p.startVx * chute,
    y: chute > 0 ? p.startAlt + 90 : p.startAlt,
    vx: p.startVx,
    vy: chute > 0 ? -48 : p.startVy,
    fuel: 1,
    chute,
    firing: false,
    side: 0,
  };
}

export function landingSpeed(s: Pick<LandingState, 'vx' | 'vy'>): number {
  return Math.hypot(s.vx, s.vy);
}

/** One step of the landing. `dt` in seconds (the game uses 1/60). */
export function stepLanding(s: LandingState, input: FlightInput, dt: number): LandingState {
  if (s.phase === 'landed' || s.phase === 'crashed') return s;
  const p = LANDING[s.site];
  const n = { ...s, t: s.t + dt };
  if (s.phase === 'chute') {
    // Hanging under the parachute: drag grows with the square of speed, so the fall settles to a steady speed.
    const ay = -p.g + p.g * (s.vy / p.chuteTerminal) ** 2;
    n.vy = s.vy + ay * dt;
    n.y = s.y + n.vy * dt;
    n.x = s.x + s.vx * dt;
    n.chute = s.chute - dt;
    n.firing = false;
    n.side = 0;
    if (n.chute <= 0) {
      n.chute = 0;
      n.phase = 'flying';
    }
    return n;
  }
  const hasFuel = s.fuel > 0;
  const firing = hasFuel && input.thrust;
  const side: -1 | 0 | 1 = hasFuel && input.left !== input.right ? (input.left ? -1 : 1) : 0;
  const ay = -p.g + (firing ? p.thrust : 0);
  const ax = side * p.rcs;
  n.vy = s.vy + ay * dt;
  n.vx = s.vx + ax * dt;
  n.y = s.y + n.vy * dt;
  n.x = s.x + n.vx * dt;
  n.fuel = Math.max(0, s.fuel - ((firing ? 1 : 0) + (side ? RCS_FUEL : 0)) * (dt / p.burnSeconds));
  n.firing = firing;
  n.side = side;
  // The edges of the play area.
  const ceiling = p.startAlt + CEILING_EXTRA;
  if (n.y > ceiling) {
    n.y = ceiling;
    n.vy = Math.min(0, n.vy);
  }
  if (Math.abs(n.x) > X_LIMIT) {
    n.x = Math.sign(n.x) * X_LIMIT;
    n.vx = 0;
  }
  if (n.y <= 0) {
    const speed = landingSpeed(n);
    n.y = 0;
    n.touchdown = speed;
    n.phase = speed <= SAFE_SPEED ? 'landed' : 'crashed';
    n.vx = 0;
    n.vy = 0;
    n.firing = false;
    n.side = 0;
  }
  return n;
}

/**
 * The autopilot real landers use, simplified: fall no faster than the engine can still stop before the ground,
 * slow to about 1 m/s near the ground, and steer over the pad.
 */
export function landingAutopilot(s: LandingState): FlightInput {
  if (s.phase !== 'flying') return NO_INPUT;
  const p = LANDING[s.site];
  const brake = p.thrust - p.g;
  const target = -Math.min(40, 0.9 + Math.sqrt(2 * 0.5 * brake * Math.max(0, s.y - 0.5)));
  const vxTarget = s.y < 6 ? 0 : clamp(-s.x * 0.12, -5, 5);
  return { thrust: s.vy < target, left: s.vx > vxTarget + 0.2, right: s.vx < vxTarget - 0.2 };
}

export interface LandingScore {
  medal: Medal;
  /** 0..1 */
  score: number;
  speed: number;
  /** Meters from the pad center. */
  distance: number;
  onPad: boolean;
  fuelLeft: number;
  soft: number;
  accuracy: number;
}

/** Medal for a safe landing: softness, landing on the pad, and fuel left. Null if the lander crashed or is still flying. */
export function scoreLanding(s: LandingState): LandingScore | null {
  if (s.phase !== 'landed' || s.touchdown === undefined) return null;
  const speed = s.touchdown;
  const distance = Math.abs(s.x);
  const onPad = distance <= PAD_HALF;
  const soft = clamp01(1 - (speed - SOFT_SPEED) / (SAFE_SPEED - SOFT_SPEED));
  const accuracy = clamp01(1 - distance / 60);
  const fuelScore = clamp01(s.fuel / 0.4);
  const score = 0.45 * soft + 0.35 * accuracy + 0.2 * fuelScore;
  const medal: Medal = onPad && score >= 0.72 ? 'gold' : score >= 0.5 ? 'silver' : 'bronze';
  return { medal, score, speed, distance, onPad, fuelLeft: s.fuel, soft, accuracy };
}

// =================================================================== LAUNCH

/** The launch clock runs this many times faster than real time, so a flight of several minutes fits in about half a minute. */
export const LAUNCH_WARP = 20;

export interface LaunchParams {
  g: number;
  radius: number;
  escape: number;
  /** Engine acceleration at full power, m/s². */
  thrust: number;
}
export const LAUNCH: Record<FlightSite, LaunchParams> = {
  mars: { g: GRAVITY.mars, radius: RADIUS.mars, escape: ESCAPE.mars, thrust: 14 },
  moon: { g: GRAVITY.moon, radius: RADIUS.moon, escape: ESCAPE.moon, thrust: 6.5 },
};
/** Letting go of the throttle drops the engine to this much power (rocket engines throttle down, they don't switch off mid-flight). */
export const MIN_THROTTLE = 0.4;
/** Engine heat (a game rule): rises at full power, falls when you ease off. At 1 the engine must cool down. */
export const HEAT = { up: 0.17, down: 0.32, coolRate: 0.2, coolTo: 0.3 } as const;
/** Steering speed, radians per (real) second, and how far the nose may stray from the path. */
export const STEER_RATE = 0.65;
const PITCH_LEEWAY = 0.55;
/** Within this many radians of the path counts as "on the path" (8 degrees). */
export const PATH_OK = (8 * Math.PI) / 180;
/** Seconds on the pad before the computer lifts off by itself, and seconds without any control before it helps fly. */
export const PAD_WAIT = 8;
export const IDLE_HELP = 10;
/** The computer finishes any flight that runs this long (real seconds). */
export const MAX_FLIGHT = 75;

export type LaunchPhase = 'pad' | 'flying' | 'escaped';

export interface LaunchState {
  site: FlightSite;
  phase: LaunchPhase;
  /** Real seconds since liftoff, and seconds on the mission clock (LAUNCH_WARP times faster). */
  t: number;
  clock: number;
  /** Seconds since the player last touched a control. */
  idle: number;
  /** Height above the surface (m), distance flown around the planet (m), speeds (m/s): vx along the ground, vy up. */
  h: number;
  x: number;
  vx: number;
  vy: number;
  /** Nose angle from straight up, radians (+ = leaning toward the flight direction). */
  pitch: number;
  heat: number;
  cooling: boolean;
  overheats: number;
  /** Throttle on the last step (MIN_THROTTLE..1). */
  throttle: number;
  /** Real seconds with the nose on the path (while the player flew). */
  onPath: number;
  /** The computer is flying (the player went idle, or the flight ran long). */
  assisted: boolean;
  /** Liftoff was started by the computer. */
  autoLiftoff: boolean;
  orbit: boolean;
}

export function createLaunch(site: FlightSite): LaunchState {
  return {
    site,
    phase: 'pad',
    t: 0,
    clock: 0,
    idle: 0,
    h: 0,
    x: 0,
    vx: 0,
    vy: 0,
    pitch: 0,
    heat: 0,
    cooling: false,
    overheats: 0,
    throttle: 0,
    onPath: 0,
    assisted: false,
    autoLiftoff: false,
    orbit: false,
  };
}

export function launchSpeed(s: Pick<LaunchState, 'vx' | 'vy'>): number {
  return Math.hypot(s.vx, s.vy);
}

/**
 * The gravity turn to follow: straight up at first, then leaning over as speed builds, almost level by orbit speed.
 * Radians from straight up.
 */
export function idealPitch(s: Pick<LaunchState, 'site' | 'vx' | 'vy'>): number {
  const f = launchSpeed(s) / LAUNCH[s.site].escape;
  const k = clamp01((f - 0.015) / 0.6);
  return ((88 * Math.PI) / 180) * k ** 0.55;
}

/** A gentle wobble the pilot corrects (thrust is never perfectly centered). Radians per real second. */
export function drift(t: number): number {
  return 0.07 * (Math.sin(0.8 * t) + 0.6 * Math.sin(2.1 * t + 1));
}

/** One step of the launch. `dt` is real seconds (the mission clock advances LAUNCH_WARP times as much). */
export function stepLaunch(s: LaunchState, input: FlightInput, dt: number): LaunchState {
  if (s.phase === 'escaped') return s;
  const touched = input.thrust || input.left || input.right;
  if (s.phase === 'pad') {
    const idle = touched ? 0 : s.idle + dt;
    if (input.thrust) return { ...s, phase: 'flying', idle: 0 };
    if (idle >= PAD_WAIT) return { ...s, phase: 'flying', idle: 0, autoLiftoff: true, assisted: true };
    return { ...s, idle };
  }
  const p = LAUNCH[s.site];
  const n = { ...s, t: s.t + dt };
  n.idle = touched ? 0 : s.idle + dt;
  // The computer flies when the player goes quiet, until they touch a control again. It always finishes the flight.
  n.assisted = n.t >= MAX_FLIGHT || (touched ? false : s.assisted || n.idle >= IDLE_HELP);
  const ctl = n.assisted ? launchAutopilot(s) : input;

  // Steering, plus the wobble. The guidance computer keeps the nose within PITCH_LEEWAY of the path.
  const ideal = idealPitch(s);
  const steer = (ctl.right ? 1 : 0) - (ctl.left ? 1 : 0);
  n.pitch = clamp(s.pitch + (steer * STEER_RATE + drift(n.t)) * dt, Math.max(-0.2, ideal - PITCH_LEEWAY), Math.min(1.75, ideal + PITCH_LEEWAY));

  // Engine heat (game rule).
  let throttle = ctl.thrust ? 1 : MIN_THROTTLE;
  if (s.cooling) {
    throttle = MIN_THROTTLE;
    n.heat = Math.max(0, s.heat - HEAT.coolRate * dt);
    if (n.heat <= HEAT.coolTo) n.cooling = false;
  } else {
    n.heat = clamp01(s.heat + (throttle === 1 ? HEAT.up : -HEAT.down) * dt);
    if (n.heat >= 1) {
      n.cooling = true;
      n.overheats = s.overheats + 1;
    }
  }
  n.throttle = throttle;

  // Flight, in small steps on the fast mission clock. A flat map with the two curvature terms of a round planet:
  // going sideways fast makes gravity matter less (that is what an orbit is), and gravity weakens with height.
  const simDt = dt * LAUNCH_WARP;
  const steps = Math.max(1, Math.ceil(simDt / 0.25));
  const h = simDt / steps;
  const a = p.thrust * throttle;
  for (let i = 0; i < steps; i++) {
    const r = p.radius + n.h;
    const g = p.g * (p.radius / r) ** 2;
    const ax = a * Math.sin(n.pitch) - (n.vx * n.vy) / r;
    const ay = a * Math.cos(n.pitch) - g + (n.vx * n.vx) / r;
    n.vx += ax * h;
    n.vy += ay * h;
    n.x += n.vx * h;
    n.h += n.vy * h;
    if (n.h < 0) {
      n.h = 0;
      n.vy = Math.max(0, n.vy);
    }
  }
  n.clock = s.clock + simDt;
  if (!n.assisted && Math.abs(n.pitch - idealPitch(n)) <= PATH_OK) n.onPath = s.onPath + dt;
  const v = launchSpeed(n);
  if (v >= ORBIT[s.site]) n.orbit = true;
  if (v >= p.escape) n.phase = 'escaped';
  return n;
}

/** The computer's way to fly: follow the path, and ease off before the engine gets too hot. */
export function launchAutopilot(s: LaunchState): FlightInput {
  const err = s.pitch - idealPitch(s);
  return { thrust: s.phase === 'pad' || (!s.cooling && s.heat < 0.7), left: err > 0.02, right: err < -0.02 };
}

/** Real seconds a great flight and a slow one take (from playing it with the autopilot and with no throttle). */
export const LAUNCH_PAR: Record<FlightSite, { fast: number; slow: number }> = {
  mars: { fast: 27, slow: 42 },
  moon: { fast: 27, slow: 42 },
};

export interface LaunchScore {
  medal: Medal;
  score: number;
  /** Fraction of the flight spent on the path, 0..1. */
  path: number;
  overheats: number;
  /** Real seconds, and minutes on the mission clock. */
  seconds: number;
  clockMinutes: number;
}

/** Medal for a launch: staying on the gravity-turn path, no overheats, and a quick climb. */
export function scoreLaunch(s: LaunchState): LaunchScore {
  const seconds = Math.max(0.001, s.t);
  const path = clamp01(s.onPath / seconds);
  const heat = clamp01(1 - 0.35 * s.overheats);
  const par = LAUNCH_PAR[s.site];
  const quick = clamp01((par.slow - seconds) / (par.slow - par.fast));
  const score = 0.55 * path + 0.25 * heat + 0.2 * quick;
  const medal: Medal = score >= 0.8 ? 'gold' : score >= 0.6 ? 'silver' : 'bronze';
  return { medal, score, path, overheats: s.overheats, seconds, clockMinutes: s.clock / 60 };
}

/** Run a whole flight with a controller (tests and tuning). */
export function flyLanding(site: FlightSite, pilot: (s: LandingState) => FlightInput, dt = 1 / 60, maxSeconds = 300): LandingState {
  let s = createLanding(site);
  for (let i = 0; i < maxSeconds / dt && (s.phase === 'chute' || s.phase === 'flying'); i++) s = stepLanding(s, pilot(s), dt);
  return s;
}

export function flyLaunch(site: FlightSite, pilot: (s: LaunchState) => FlightInput, dt = 1 / 60, maxSeconds = 300): LaunchState {
  let s = createLaunch(site);
  for (let i = 0; i < maxSeconds / dt && s.phase !== 'escaped'; i++) s = stepLaunch(s, pilot(s), dt);
  return s;
}
