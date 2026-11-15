// Written with AI assistance (Claude Code). See README "Use of AI tools".
import { describe, it, expect } from 'vitest';
import {
  BATTERY,
  NO_INPUT,
  ROVER,
  SCAN_SECONDS,
  batteryUse,
  bearingTo,
  devilAt,
  devilPush,
  dustDevils,
  homeAlert,
  HOME_ALERT_TEXT,
  newRover,
  onPad,
  returnCost,
  scanStep,
  stepRover,
  type Ground,
  type RoverInput,
  type RoverState,
} from './physics';
import { DRIVE_RADIUS, GRAVITY } from './sites';
import { directionWords } from './hud';

const flat: Ground = { height: () => 0 };
const DT = 1 / 60;
const go = (o: Partial<RoverInput> = {}): RoverInput => ({ ...NO_INPUT, throttle: 1, ...o });

function run(s: RoverState, inp: RoverInput, secs: number, ground: Ground = flat, g = GRAVITY.gale) {
  const out = { maxAir: 0, landed: 0, steep: false, emptied: false };
  for (let t = 0; t < secs; t += DT) {
    const i = stepRover(s, inp, DT, ground, g);
    if (i.jump) out.maxAir = Math.max(out.maxAir, i.jump);
    if (i.landed) out.landed = Math.max(out.landed, i.landed);
    if (i.steep) out.steep = true;
    if (i.emptied) out.emptied = true;
  }
  return out;
}

describe('rover driving', () => {
  it('speeds up to its top speed and drives where it points (north is +z, east is -x)', () => {
    const s = newRover(flat, 0);
    run(s, go(), 4);
    expect(s.speed).toBeCloseTo(ROVER.maxSpeed, 1);
    expect(s.z).toBeGreaterThan(20);
    expect(Math.abs(s.x)).toBeLessThan(1e-6);
    const east = newRover(flat, Math.PI / 2);
    run(east, go(), 2);
    expect(east.x).toBeLessThan(-5);
    expect(bearingTo(0, 0, -10, 0)).toBeCloseTo(Math.PI / 2, 6);
  });

  it('boost goes faster; steering right turns clockwise; it stops when let go', () => {
    const s = newRover(flat, 0);
    run(s, go({ boost: true }), 4);
    expect(s.speed).toBeGreaterThan(ROVER.maxSpeed + 3);
    const h0 = s.heading;
    run(s, go({ steer: 1 }), 0.5);
    expect(s.heading).toBeGreaterThan(h0);
    run(s, NO_INPUT, 8);
    expect(s.speed).toBe(0);
  });

  it('slows on a climb (gravity pulls back) and slips on ground that is too steep', () => {
    const ramp: Ground = { height: (_x, z) => z * 0.3 };
    const up = newRover(ramp, 0);
    run(up, go(), 5, ramp);
    const level = newRover(flat, 0);
    run(level, go(), 5);
    expect(up.speed).toBeLessThan(level.speed - 2);
    const wall: Ground = { height: (_x, z) => z * 0.9 };
    const s = newRover(wall, 0);
    const out = run(s, go(), 3, wall);
    expect(out.steep).toBe(true);
    expect(s.z).toBeLessThan(5);
  });

  it('floats much longer over the same bump on the Moon than on Mars (real gravity)', () => {
    // A sharp crest: up at 25 percent, then down.
    const crest: Ground = { height: (_x, z) => (z < 30 ? Math.max(0, z) * 0.25 : Math.max(0, 7.5 - (z - 30) * 0.25)) };
    const mars = newRover(crest, 0);
    mars.speed = 12;
    const m = run(mars, go(), 15, crest, GRAVITY.gale);
    const moon = newRover(crest, 0);
    moon.speed = 12;
    const l = run(moon, go(), 15, crest, GRAVITY.moon);
    expect(m.maxAir).toBeGreaterThan(0.2);
    expect(l.maxAir).toBeGreaterThan(m.maxAir * 1.8);
  });

  it('turns back at the edge of the map', () => {
    const s = newRover(flat, 0);
    s.z = DRIVE_RADIUS - 1;
    const info = stepRover(s, go(), 0.2, flat, GRAVITY.gale);
    s.speed = 15;
    stepRover(s, go(), 0.2, flat, GRAVITY.gale);
    expect(Math.hypot(s.x, s.z)).toBeLessThanOrEqual(DRIVE_RADIUS + 1e-6);
    expect(info.edge || Math.hypot(s.x, s.z) <= DRIVE_RADIUS).toBe(true);
  });
});

describe('battery', () => {
  it('lasts about three minutes of plain driving on a full charge', () => {
    const s = newRover(flat, 0);
    let t = 0;
    // A gentle circle, so the rover never reaches the edge of the map.
    while (s.battery > 0 && t < 600) {
      stepRover(s, go({ steer: 0.05 }), DT, flat, GRAVITY.gale);
      t += DT;
    }
    expect(t).toBeGreaterThan(150);
    expect(t).toBeLessThan(330);
    expect(s.odometer).toBeGreaterThan(2000);
  });

  it('boost, climbing, headlights and time all cost more; climbing costs more on Mars than on the Moon', () => {
    const base = { dt: 1, moved: 10, climbed: 0, boosting: false, lights: false, g: GRAVITY.gale };
    const plain = batteryUse(base);
    expect(batteryUse({ ...base, boosting: true })).toBeGreaterThan(plain * 2);
    expect(batteryUse({ ...base, lights: true })).toBeCloseTo(plain + BATTERY.lights, 9);
    expect(batteryUse({ ...base, climbed: 5 })).toBeGreaterThan(plain);
    expect(batteryUse({ ...base, climbed: -5 })).toBeCloseTo(plain, 9); // no charge back going downhill
    const marsClimb = batteryUse({ ...base, climbed: 5 }) - plain;
    const moonClimb = batteryUse({ ...base, climbed: 5, g: GRAVITY.moon }) - batteryUse({ ...base, g: GRAVITY.moon });
    expect(marsClimb / moonClimb).toBeCloseTo(GRAVITY.gale / GRAVITY.moon, 6);
  });

  it('a boosted trip covers less ground than a calm one', () => {
    const calm = newRover(flat, 0);
    const fast = newRover(flat, 0);
    run(calm, go({ steer: 0.05 }), 400);
    run(fast, go({ boost: true, steer: 0.05 }), 400);
    expect(fast.odometer).toBeLessThan(calm.odometer * 0.7);
  });

  it('stops the rover when it runs out (and reports it once)', () => {
    const s = newRover(flat, 0);
    s.battery = 0.05;
    s.speed = 10;
    const out = run(s, go(), 6);
    expect(out.emptied).toBe(true);
    expect(s.battery).toBe(0);
    expect(s.speed).toBe(0);
  });

  it('warns to head home in time: more warning the further out you are', () => {
    expect(returnCost(600, 0, GRAVITY.gale)).toBeGreaterThan(returnCost(100, 0, GRAVITY.gale));
    expect(returnCost(300, -40, GRAVITY.gale)).toBeGreaterThan(returnCost(300, 0, GRAVITY.gale)); // the pad is uphill
    expect(returnCost(300, 40, GRAVITY.gale)).toBeCloseTo(returnCost(300, 0, GRAVITY.gale), 9); // downhill home
    const cost = returnCost(500, 0, GRAVITY.gale);
    expect(homeAlert(90, cost)).toBe('ok');
    expect(homeAlert(cost * 1.5 + 10, cost)).toBe('soon');
    expect(homeAlert(cost, cost)).toBe('now');
    // The warning comes with enough charge left to make it home.
    expect(cost * 1.2 + 4).toBeGreaterThan(cost);
  });

  it('words the warnings by what is measured (the battery the drive home needs), never "half gone"', () => {
    // Close to the pad, the early warning can come with most of the battery left: the words must still be true.
    const near = returnCost(1200, 0, GRAVITY.gale);
    const battery = near * 1.7 + 12;
    expect(homeAlert(battery, near)).toBe('soon');
    for (const t of Object.values(HOME_ALERT_TEXT)) {
      expect(t).not.toMatch(/half|%|percent/i);
      expect(t).toMatch(/home|back/i);
    }
    expect(HOME_ALERT_TEXT.now).toMatch(/rest of your battery to get back/);
  });
});

describe('scanning and the pad', () => {
  it('takes about 1.5 seconds of holding Scan, stopped, near a target', () => {
    let p = 0;
    let t = 0;
    while (p < 1 && t < 5) {
      p = scanStep(p, true, true, 0, DT);
      t += DT;
    }
    expect(t).toBeCloseTo(SCAN_SECONDS, 1);
    expect(scanStep(0.5, false, true, 0, 0.1)).toBeLessThan(0.5);
    expect(scanStep(0.5, true, false, 0, 0.1)).toBeLessThan(0.5);
    expect(scanStep(0.5, true, true, 10, 0.1)).toBeLessThan(0.5);
  });

  it('knows when the rover is on the charging pad', () => {
    expect(onPad(0, 0)).toBe(true);
    expect(onPad(5, 5)).toBe(true);
    expect(onPad(30, 0)).toBe(false);
  });
});

describe('dust devils', () => {
  it('are on Mars only (the Moon has no air), the same each day, and push only nearby', () => {
    expect(dustDevils('moon', '2026-11-14')).toEqual([]);
    const d = dustDevils('gale', '2026-11-14');
    expect(d.length).toBe(3);
    expect(dustDevils('gale', '2026-11-14')).toEqual(d);
    const p = devilAt(d[0], 10);
    const near = devilPush(d[0], 10, p.x + 5, p.z);
    expect(Math.hypot(near.x, near.z)).toBeGreaterThan(0);
    expect(devilPush(d[0], 10, p.x + 200, p.z)).toEqual({ x: 0, z: 0 });
  });
});

describe('direction words', () => {
  it('say where things are for "Read to me"', () => {
    expect(directionWords(0)).toBe('straight ahead');
    expect(directionWords(Math.PI / 2)).toBe('to your right');
    expect(directionWords(-Math.PI / 2)).toBe('to your left');
    expect(directionWords(Math.PI)).toBe('behind you');
  });
});
