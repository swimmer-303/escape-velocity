// Written with AI assistance (Claude Code). See README "Use of AI tools".
// Rover physics and the battery, as pure functions (state in, state changed), so they are easy to test and need no
// WebGL. The drawing lives in ./world.ts and ./game.ts.
//
// REAL: gravity (./sites.ts). It pulls the rover back down after a bump (lower gravity = longer floating, so bumps
// send it flying much longer on the Moon), slows it uphill and speeds it downhill, and sets the energy it takes to
// climb: lifting a mass m by h takes m * g * h, so climbing costs more battery on Mars than on the Moon.
// GAME VALUES: speeds, acceleration and every battery number (tuned so a full battery lasts about three minutes of
// driving). Real rovers are far slower (see CURIOSITY_TOP_SPEED_CM_S in ./sites.ts).

import { DRIVE_RADIUS } from './sites';
import { hashString, seeded } from './rng';
import type { RoverSite } from './sites';

export interface Ground {
  height(x: number, z: number): number;
}

export interface RoverInput {
  /** -1 (reverse) .. 1 (forward). */
  throttle: number;
  /** -1 (left) .. 1 (right). */
  steer: number;
  boost: boolean;
  /** Holding Scan: the rover brakes to a stop. */
  scan: boolean;
  lights: boolean;
}

export const NO_INPUT: RoverInput = { throttle: 0, steer: 0, boost: false, scan: false, lights: false };

export interface RoverState {
  x: number;
  z: number;
  /** Height of the rover's wheels, game meters. */
  y: number;
  /** Vertical speed, m/s. */
  vy: number;
  /** Compass bearing, radians: 0 = north (+z), growing clockwise toward east (-x). */
  heading: number;
  /** Speed along the heading, m/s (negative backing up). */
  speed: number;
  grounded: boolean;
  /** Seconds in the air on the current jump. */
  airTime: number;
  /** 0..BATTERY.full. */
  battery: number;
  /** Meters driven this trip. */
  odometer: number;
  /** Sideways push (dust devils, slipping on steep ground), m/s. */
  pushX: number;
  pushZ: number;
}

/** Game values for driving. */
export const ROVER = {
  maxSpeed: 13,
  boostSpeed: 20,
  reverseSpeed: 5,
  accel: 6,
  boostAccel: 9,
  brake: 14,
  coast: 3,
  /** Turn rate at speed, radians per second. */
  turnRate: 1.7,
  /** Steeper than this (rise per meter, about 31 degrees) the wheels slip. */
  steepGrade: 0.6,
  /** The suspension soaks up little hops; the rover only leaves the ground if it would rise more than this, m. */
  suspension: 0.14,
} as const;

/** Game values for the battery (units: percent of a full charge). */
export const BATTERY = {
  full: 100,
  /** Computers, radio and heaters, per second, even standing still. */
  idle: 0.04,
  /** Driving, per meter. */
  perMeter: 0.03,
  /** Extra per meter while boosting (boost costs more than double). */
  boostPerMeter: 0.04,
  /** Climbing, per meter of height per m/s² of gravity (energy = m * g * h). */
  climb: 0.045,
  /** Headlights, per second. */
  lights: 0.06,
  /** One scan. */
  scan: 1,
  /** Charging on the pad, per second. */
  charge: 45,
} as const;

export const SCAN_SECONDS = 1.5;
/** How close the rover must be to scan a target, m. */
export const SCAN_RANGE = 14;
/** Slower than this counts as stopped for scanning, m/s. */
export const SCAN_MAX_SPEED = 3;
/** The charging pad's radius, m. */
export const PAD_RADIUS = 9;

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

export function forward(heading: number): { x: number; z: number } {
  return { x: -Math.sin(heading), z: Math.cos(heading) };
}

/** Compass bearing from one spot to another (radians, 0 = north, clockwise). */
export function bearingTo(fromX: number, fromZ: number, toX: number, toZ: number): number {
  return Math.atan2(-(toX - fromX), toZ - fromZ);
}

export function newRover(ground: Ground, heading = 0): RoverState {
  return { x: 0, z: 0, y: ground.height(0, 0), vy: 0, heading, speed: 0, grounded: true, airTime: 0, battery: BATTERY.full, odometer: 0, pushX: 0, pushZ: 0 };
}

/** Rise per meter of the ground in a direction, measured over the rover's length. */
export function gradeAlong(ground: Ground, x: number, z: number, heading: number, half = 1.5): number {
  const f = forward(heading);
  return (ground.height(x + f.x * half, z + f.z * half) - ground.height(x - f.x * half, z - f.z * half)) / (2 * half);
}

/** Steepness (rise per meter, any direction) and the downhill direction. */
export function slopeAt(ground: Ground, x: number, z: number): { steep: number; downX: number; downZ: number } {
  const gx = (ground.height(x + 1, z) - ground.height(x - 1, z)) / 2;
  const gz = (ground.height(x, z + 1) - ground.height(x, z - 1)) / 2;
  const steep = Math.hypot(gx, gz);
  return { steep, downX: steep > 1e-9 ? -gx / steep : 0, downZ: steep > 1e-9 ? -gz / steep : 0 };
}

export interface StepInfo {
  /** Landing speed (m/s) if the rover touched down this step, else 0. */
  landed: number;
  /** Seconds of the jump that just ended (0 if none ended). */
  jump: number;
  steep: boolean;
  edge: boolean;
  /** The battery hit zero this step. */
  emptied: boolean;
  boosting: boolean;
}

/** Battery used for one step (pure: the caller subtracts it). */
export function batteryUse(o: { dt: number; moved: number; climbed: number; boosting: boolean; lights: boolean; g: number }): number {
  return (
    BATTERY.idle * o.dt +
    BATTERY.perMeter * o.moved +
    (o.boosting ? BATTERY.boostPerMeter * o.moved : 0) +
    BATTERY.climb * Math.max(0, o.climbed) * o.g +
    (o.lights ? BATTERY.lights * o.dt : 0)
  );
}

/** Move the rover one step. Mutates `s`; returns what happened. */
export function stepRover(s: RoverState, inp: RoverInput, dt: number, ground: Ground, g: number): StepInfo {
  const info: StepInfo = { landed: 0, jump: 0, steep: false, edge: false, emptied: false, boosting: false };
  const power = s.battery > 0;
  const thr = power ? clamp(inp.throttle, -1, 1) : 0;
  const steer = clamp(inp.steer, -1, 1);
  const f = forward(s.heading);
  const y0 = s.y;

  if (s.grounded) {
    const grade = gradeAlong(ground, s.x, s.z, s.heading);
    const slope = slopeAt(ground, s.x, s.z);
    const boosting = power && inp.boost && thr > 0 && !inp.scan;
    info.boosting = boosting;
    // Motors are weaker uphill: the top speed drops on a climb.
    const climbing = s.speed >= 0 ? grade : -grade;
    const cap = 1 - clamp(climbing * 0.9, 0, 0.6);
    if (inp.scan) {
      s.speed = s.speed > 0 ? Math.max(0, s.speed - ROVER.brake * dt) : Math.min(0, s.speed + ROVER.brake * dt);
    } else if (thr > 0) {
      if (s.speed < 0) s.speed = Math.min(0, s.speed + ROVER.brake * dt);
      else {
        const target = (boosting ? ROVER.boostSpeed : ROVER.maxSpeed) * thr * cap;
        const a = boosting ? ROVER.boostAccel : ROVER.accel;
        s.speed = s.speed < target ? Math.min(target, s.speed + a * dt) : Math.max(target, s.speed - ROVER.coast * dt);
      }
    } else if (thr < 0) {
      if (s.speed > 0) s.speed = Math.max(0, s.speed - ROVER.brake * dt);
      else s.speed = Math.max(ROVER.reverseSpeed * thr * cap, s.speed - ROVER.accel * dt);
    } else {
      s.speed = s.speed > 0 ? Math.max(0, s.speed - ROVER.coast * dt) : Math.min(0, s.speed + ROVER.coast * dt);
    }
    // Gravity along the slope (real g): it slows a climb and speeds a descent. Brakes hold a stopped rover.
    const along = grade / Math.sqrt(1 + grade * grade);
    if (thr !== 0 || Math.abs(s.speed) > 0.5 || slope.steep > ROVER.steepGrade) s.speed -= g * along * dt;
    // Too steep: the wheels slip and the rover slides back down.
    if (slope.steep > ROVER.steepGrade) {
      info.steep = true;
      const k = clamp((slope.steep - ROVER.steepGrade) * 4, 0.3, 1);
      s.pushX += slope.downX * g * k * dt;
      s.pushZ += slope.downZ * g * k * dt;
      if (climbing > ROVER.steepGrade * 0.8 && s.speed > 2) s.speed -= ROVER.brake * 0.5 * dt;
    }
    const turn = ROVER.turnRate * (Math.abs(s.speed) < 0.5 ? 0.6 : 1) * (s.speed < -0.3 ? -1 : 1);
    s.heading += steer * turn * dt;
  } else {
    // In the air: a little steering for fun, no grip.
    s.heading += steer * ROVER.turnRate * 0.3 * dt;
  }

  const dx = (f.x * s.speed + s.pushX) * dt;
  const dz = (f.z * s.speed + s.pushZ) * dt;
  s.x += dx;
  s.z += dz;
  const decay = Math.exp(-2.5 * dt);
  s.pushX *= decay;
  s.pushZ *= decay;

  // The edge of the map: turn back gently.
  const r = Math.hypot(s.x, s.z);
  if (r > DRIVE_RADIUS) {
    s.x *= DRIVE_RADIUS / r;
    s.z *= DRIVE_RADIUS / r;
    s.speed *= 0.6;
    info.edge = true;
  }

  const h = ground.height(s.x, s.z);
  if (s.grounded) {
    const groundVy = (h - s.y) / dt;
    // Leaving a crest faster than gravity can pull the rover down: it flies (if the hop beats the suspension).
    const lift = s.vy - groundVy;
    if (lift > 0 && (lift * lift) / (2 * g) > ROVER.suspension) {
      s.grounded = false;
      s.airTime = 0;
      s.vy -= g * dt;
      s.y += s.vy * dt;
      if (s.y < h) {
        s.y = h;
        s.grounded = true;
      }
    } else {
      s.vy = clamp(groundVy, -40, 40);
      s.y = h;
    }
  } else {
    s.vy -= g * dt;
    s.y += s.vy * dt;
    s.airTime += dt;
    if (s.y <= h) {
      info.landed = Math.max(0, -s.vy);
      info.jump = s.airTime;
      s.y = h;
      s.vy = 0;
      s.grounded = true;
      s.airTime = 0;
      if (info.landed > 5) s.speed *= 0.85;
    }
  }

  const moved = Math.hypot(dx, dz);
  s.odometer += moved;
  const before = s.battery;
  s.battery = Math.max(0, s.battery - batteryUse({ dt, moved, climbed: s.grounded ? s.y - y0 : 0, boosting: info.boosting, lights: inp.lights, g }));
  info.emptied = before > 0 && s.battery <= 0;
  return info;
}

// ---------------------------------------------------------------- going home

/** Battery a trip home would take from here, with some room for going around hills. */
export function returnCost(distHome: number, heightAbovePad: number, g: number): number {
  const t = distHome / (ROVER.maxSpeed * 0.85);
  return BATTERY.perMeter * distHome * 1.25 + BATTERY.idle * t + BATTERY.climb * Math.max(0, -heightAbovePad) * g;
}

export type HomeAlert = 'ok' | 'soon' | 'now';

/** 'now': head home or the battery runs out on the way. 'soon': start thinking about it. */
export function homeAlert(battery: number, cost: number): HomeAlert {
  if (battery <= cost * 1.2 + 4) return 'now';
  if (battery <= cost * 1.7 + 12) return 'soon';
  return 'ok';
}

/**
 * What the warnings say. They match what homeAlert measures: how much of the battery the drive back to the pad
 * needs from here (not how much battery is used up), so they are true whether you are near the pad or far out.
 */
export const HOME_ALERT_TEXT: Record<Exclude<HomeAlert, 'ok'>, string> = {
  soon: 'Plan your way home: the drive back will use a big part of your battery.',
  now: 'Time to head home: you need the rest of your battery to get back.',
};

/** On the charging pad? */
export function onPad(x: number, z: number): boolean {
  return Math.hypot(x, z) <= PAD_RADIUS;
}

/** Scan progress (0..1) after one step: it fills while Scan is held near a target with the rover stopped, and drains otherwise. */
export function scanStep(progress: number, holding: boolean, inRange: boolean, speed: number, dt: number): number {
  if (holding && inRange && Math.abs(speed) <= SCAN_MAX_SPEED) return Math.min(1, progress + dt / SCAN_SECONDS);
  return Math.max(0, progress - dt * 2);
}

// ---------------------------------------------------------------- dust devils (Mars only)
// Real: dust devils are common on Mars; NASA's Spirit and Curiosity rovers both filmed them (NASA JPL, e.g. PIA07253
// "Dust devil at Gusev" 2005, and Curiosity dust devil movies from Gale Crater, 2016-2020). Their paths and their
// gentle push here are game values.

export interface DustDevil {
  /** Center of its wandering loop, m. */
  cx: number;
  cz: number;
  /** Loop radius, m, and speed, radians per second. */
  loop: number;
  spin: number;
  phase: number;
  /** It pushes the rover within this distance, m. */
  reach: number;
}

export function dustDevils(site: RoverSite, date: string): DustDevil[] {
  if (site === 'moon') return []; // no air on the Moon, so no wind and no dust devils
  const r = seeded(hashString(`rover-devils|${date}|${site}`));
  const out: DustDevil[] = [];
  for (let i = 0; i < 3; i++) {
    const a = r() * Math.PI * 2;
    const d = 160 + r() * 420;
    out.push({ cx: Math.cos(a) * d, cz: Math.sin(a) * d, loop: 40 + r() * 60, spin: (0.05 + r() * 0.05) * (r() < 0.5 ? -1 : 1), phase: r() * Math.PI * 2, reach: 26 });
  }
  return out;
}

export function devilAt(d: DustDevil, t: number): { x: number; z: number } {
  const a = d.phase + d.spin * t;
  return { x: d.cx + Math.cos(a) * d.loop, z: d.cz + Math.sin(a) * d.loop * 0.7 };
}

/** The push (m/s² sideways) a dust devil gives the rover: outward and swirling, strongest near its middle. 0 outside its reach. */
export function devilPush(d: DustDevil, t: number, x: number, z: number): { x: number; z: number } {
  const p = devilAt(d, t);
  const dx = x - p.x;
  const dz = z - p.z;
  const dist = Math.hypot(dx, dz);
  if (dist >= d.reach || dist < 1e-6) return { x: 0, z: 0 };
  const k = (1 - dist / d.reach) * 9;
  const ux = dx / dist;
  const uz = dz / dist;
  // Half outward, half around (a swirl).
  return { x: (ux * 0.6 - uz * 0.8) * k, z: (uz * 0.6 + ux * 0.8) * k };
}
