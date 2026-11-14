// Written with AI assistance (Claude Code). See README "Use of AI tools".
// The flight physics: real gravity and escape speeds, safe landings and crashes, the launch always reaching escape
// velocity, heat, and medals.
import { describe, it, expect } from 'vitest';
import {
  AUTOPILOT_XP,
  ESCAPE,
  GRAVITY,
  HEAT,
  LANDING,
  LAUNCH,
  MAX_FLIGHT,
  MEDAL_XP,
  MIN_THROTTLE,
  NO_INPUT,
  ORBIT,
  PAD_HALF,
  RADIUS,
  SAFE_SPEED,
  createLanding,
  createLaunch,
  flyLanding,
  flyLaunch,
  idealPitch,
  landingAutopilot,
  launchAutopilot,
  launchSpeed,
  scoreLanding,
  scoreLaunch,
  stepLanding,
  stepLaunch,
  speedLimit,
  descentSpeed,
  AIM_SPEED,
  type FlightSite,
  type LandingState,
  type LaunchState,
} from './physics';
import { REAL } from '../../sim/constants';

const SITES: FlightSite[] = ['mars', 'moon'];
const DT = 1 / 60;

/** A lander already flying (parachute gone) at a given height and speed. */
function flying(site: FlightSite, y: number, vy: number, x = 0, vx = 0, fuel = 1): LandingState {
  return { ...createLanding(site), phase: 'flying', chute: 0, y, vy, x, vx, fuel };
}

function steps(s: LandingState, input = NO_INPUT, seconds = 1): LandingState {
  for (let i = 0; i < Math.round(seconds / DT); i++) s = stepLanding(s, input, DT);
  return s;
}

describe('real numbers', () => {
  it('uses real surface gravity and escape velocities', () => {
    expect(GRAVITY.mars).toBe(3.71);
    expect(GRAVITY.moon).toBe(1.62);
    expect(ESCAPE.mars).toBeCloseTo(REAL.marsEscapeKms * 1000);
    expect(ESCAPE.mars).toBeCloseTo(5030);
    expect(ESCAPE.moon).toBeCloseTo(2380);
    // Orbit speed just above the surface is escape velocity / sqrt(2): about 3.56 km/s on Mars, 1.68 km/s on the Moon.
    expect(ORBIT.mars / 1000).toBeCloseTo(3.56, 2);
    expect(ORBIT.moon / 1000).toBeCloseTo(1.68, 2);
    // The radii agree with the escape speeds: v = sqrt(2 g R), within 1%.
    for (const site of SITES) expect(Math.sqrt(2 * GRAVITY[site] * RADIUS[site]) / ESCAPE[site]).toBeGreaterThan(0.99);
  });

  it('falls with real gravity: Mars 3.71 m/s², the Moon 1.62 m/s²', () => {
    for (const site of SITES) {
      const s = steps(flying(site, 1000, 0), NO_INPUT, 1);
      expect(s.vy).toBeCloseTo(-GRAVITY[site], 6);
    }
  });

  it('the engine beats gravity (thrust-to-weight above 2), and steering pushes sideways', () => {
    for (const site of SITES) {
      const p = LANDING[site];
      expect(p.thrust / p.g).toBeGreaterThan(2);
      const up = steps(flying(site, 300, 0), { thrust: true, left: false, right: false }, 1);
      expect(up.vy).toBeCloseTo(p.thrust - p.g, 6);
      const right = steps(flying(site, 300, 0), { thrust: false, left: false, right: true }, 1);
      expect(right.vx).toBeCloseTo(p.rcs, 6);
    }
  });

  it('Mars starts under a parachute that slows the fall, then the rockets take over; the Moon has no parachute', () => {
    const mars = createLanding('mars');
    expect(mars.phase).toBe('chute');
    let s = mars;
    while (s.phase === 'chute') s = stepLanding(s, { thrust: true, left: false, right: false }, DT);
    expect(s.fuel).toBe(1); // no engine while hanging under the parachute
    expect(Math.abs(s.vy)).toBeLessThan(Math.abs(mars.vy));
    expect(createLanding('moon').phase).toBe('flying');
  });
});

describe('landing', () => {
  it('a soft touchdown lands, a fast one crashes', () => {
    for (const site of SITES) {
      const soft = steps(flying(site, 0.5, -1.5), NO_INPUT, 1);
      expect(soft.phase).toBe('landed');
      expect(soft.touchdown!).toBeLessThanOrEqual(SAFE_SPEED);
      const hard = steps(flying(site, 2, -8), NO_INPUT, 1);
      expect(hard.phase).toBe('crashed');
      expect(hard.touchdown!).toBeGreaterThan(SAFE_SPEED);
      expect(scoreLanding(hard)).toBeNull();
    }
  });

  it('doing nothing crashes; the autopilot always lands softly on the pad, in about half a minute', () => {
    for (const site of SITES) {
      const dropped = flyLanding(site, () => NO_INPUT);
      expect(dropped.phase).toBe('crashed');
      const auto = flyLanding(site, landingAutopilot);
      expect(auto.phase).toBe('landed');
      expect(auto.touchdown!).toBeLessThan(1.5);
      expect(Math.abs(auto.x)).toBeLessThanOrEqual(PAD_HALF);
      expect(auto.fuel).toBeGreaterThan(0.2);
      expect(auto.t).toBeGreaterThan(12);
      expect(auto.t).toBeLessThan(40);
    }
  });

  it('the speed gauge: a young pilot who just obeys SLOW DOWN (hold) and OK (let go) lands safely, even reacting late', () => {
    for (const site of SITES) {
      expect(speedLimit(site, 0)).toBe(AIM_SPEED);
      expect(speedLimit(site, 50)).toBeGreaterThan(speedLimit(site, 10));
      // React to what the gauge showed `delay` seconds ago; slide toward the pad using the PAD readout.
      for (const delay of [0, 0.2, 0.3]) {
        let s = createLanding(site);
        const seen: LandingState[] = [];
        while (s.phase === 'chute' || s.phase === 'flying') {
          seen.push(s);
          const v = seen[Math.max(0, seen.length - 1 - Math.round(delay / DT))];
          const wantVx = Math.abs(v.x) < 4 ? 0 : -Math.sign(v.x) * 3;
          s = stepLanding(s, { thrust: v.vy < 0.3 && descentSpeed(v) > speedLimit(site, v.y), left: v.vx > wantVx + 0.5, right: v.vx < wantVx - 0.5 }, DT);
        }
        expect(s.phase, `${site}, reacting ${delay} s late`).toBe('landed');
        expect(s.fuel).toBeGreaterThan(0.2);
        expect(s.t).toBeLessThan(40);
        expect(scoreLanding(s)!.onPad).toBe(true);
      }
      // The autopilot stays under the limit once the rockets are on.
      let s = createLanding(site);
      while (s.phase === 'chute' || s.phase === 'flying') {
        if (s.phase === 'flying') expect(Math.max(0, -s.vy)).toBeLessThanOrEqual(speedLimit(site, s.y) + 0.3);
        s = stepLanding(s, landingAutopilot(s), DT);
      }
    }
  });

  it('fuel runs out if you hover too long, and then the engine stops', () => {
    const s = flyLanding('moon', (st) => ({ thrust: st.vy < 0, left: false, right: false }), DT, 120);
    expect(s.fuel).toBe(0);
    expect(s.phase).toBe('crashed');
    const dry = stepLanding(flying('moon', 100, 0, 0, 0, 0), { thrust: true, left: false, right: false }, DT);
    expect(dry.firing).toBe(false);
  });

  it('medals: soft, on the pad and fuel left wins gold; landing off the pad never does', () => {
    const land = (speed: number, x: number, fuel: number) => steps(flying('mars', 1e-4, -speed, x, 0, fuel), NO_INPUT, DT);
    const gold = scoreLanding(land(0.8, 1, 0.45))!;
    expect(gold.medal).toBe('gold');
    expect(gold.onPad).toBe(true);
    expect(scoreLanding(land(2.9, 2, 0.05))!.medal).not.toBe('gold');
    expect(scoreLanding(land(0.5, 25, 0.6))!.medal).not.toBe('gold');
    expect(scoreLanding(land(2.85, 55, 0))!.medal).toBe('bronze');
    expect(scoreLanding(land(1.5, 5, 0.25))!.medal).toBe('silver');
    expect(scoreLanding(flyLanding('mars', landingAutopilot))!.medal).toBe('gold');
  });
});

describe('launch', () => {
  it('waits on the pad for the engine, and lifts off by itself if nobody presses anything', () => {
    let s = createLaunch('mars');
    s = stepLaunch(s, NO_INPUT, 1);
    expect(s.phase).toBe('pad');
    s = stepLaunch(s, { thrust: true, left: false, right: false }, DT);
    expect(s.phase).toBe('flying');
    expect(flyLaunch('moon', () => NO_INPUT).autoLiftoff).toBe(true);
  });

  it('even the lowest throttle out-pushes gravity, so the rocket never falls back', () => {
    for (const site of SITES) expect(LAUNCH[site].thrust * MIN_THROTTLE).toBeGreaterThan(GRAVITY[site]);
  });

  it('always reaches escape velocity: with the autopilot, holding full power, or with nobody flying', () => {
    const pilots = {
      auto: launchAutopilot,
      holdOnly: () => ({ thrust: true, left: false, right: false }),
      idle: () => NO_INPUT,
    };
    for (const site of SITES) {
      for (const [name, pilot] of Object.entries(pilots)) {
        const s = flyLaunch(site, pilot);
        expect(s.phase, `${site} ${name}`).toBe('escaped');
        expect(launchSpeed(s)).toBeGreaterThanOrEqual(ESCAPE[site]);
        expect(s.orbit).toBe(true);
        expect(s.h).toBeGreaterThan(50_000);
        expect(s.t).toBeLessThan(MAX_FLIGHT + 30);
      }
      // A well-flown launch takes 20 to 40 seconds of play.
      const auto = flyLaunch(site, launchAutopilot);
      expect(auto.t).toBeGreaterThan(20);
      expect(auto.t).toBeLessThan(40);
    }
  });

  it('never dips below the ground on the way up', () => {
    for (const site of SITES) {
      let s = createLaunch(site);
      let minH = Infinity;
      for (let i = 0; i < 60 * 60 && s.phase !== 'escaped'; i++) {
        s = stepLaunch(s, { thrust: true, left: false, right: i % 90 < 30 }, DT);
        if (s.phase === 'flying' && s.t > 3) minH = Math.min(minH, s.h);
      }
      expect(minH).toBeGreaterThan(1000);
    }
  });

  it('the gravity turn starts straight up and leans over to nearly level by orbit speed', () => {
    expect(idealPitch({ site: 'mars', vx: 0, vy: 0 })).toBe(0);
    let last = -1;
    for (const f of [0.05, 0.2, 0.4, 0.6, 0.8]) {
      const p = idealPitch({ site: 'mars', vx: 0, vy: f * ESCAPE.mars });
      expect(p).toBeGreaterThan(last);
      last = p;
    }
    expect((idealPitch({ site: 'moon', vx: ORBIT.moon, vy: 0 }) * 180) / Math.PI).toBeGreaterThan(80);
  });

  it('holding full power overheats the engine, which then cools at low power', () => {
    let s: LaunchState = { ...createLaunch('mars'), phase: 'flying' };
    const hold = { thrust: true, left: false, right: false };
    for (let i = 0; i < Math.ceil(1 / HEAT.up / DT) + 2; i++) s = stepLaunch(s, hold, DT);
    expect(s.cooling).toBe(true);
    expect(s.overheats).toBe(1);
    s = stepLaunch(s, hold, DT);
    expect(s.throttle).toBe(MIN_THROTTLE);
    for (let i = 0; i < 60 * 6; i++) s = stepLaunch(s, hold, DT);
    expect(s.overheats).toBeGreaterThanOrEqual(1);
  });

  it('medals: following the arc without overheating wins gold; going idle or never steering wins bronze', () => {
    for (const site of SITES) {
      expect(scoreLaunch(flyLaunch(site, launchAutopilot)).medal).toBe('gold');
      expect(scoreLaunch(flyLaunch(site, () => NO_INPUT)).medal).toBe('bronze');
      expect(scoreLaunch(flyLaunch(site, (s) => ({ thrust: s.heat < 0.7 && !s.cooling, left: false, right: false }))).medal).toBe('bronze');
      const hot = flyLaunch(site, (s) => ({ ...launchAutopilot(s), thrust: true }));
      expect(hot.overheats).toBeGreaterThan(0);
      expect(scoreLaunch(hot).medal).not.toBe('gold');
    }
  });

  it('XP: gold 60, silver 40, bronze 25, autopilot 10', () => {
    expect(MEDAL_XP).toEqual({ gold: 60, silver: 40, bronze: 25 });
    expect(AUTOPILOT_XP).toBe(10);
  });
});
