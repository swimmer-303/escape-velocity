// Written with AI assistance (Claude Code). See README "Use of AI tools".
// Builds the whole 3D diorama (no GPU needed) and exercises every update path, on Mars and on the Moon,
// plus the outpost's life: tapping modules, drones, the cargo lander, rover, dust devils, comms beam, shelter, launch.
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { Diorama, LAUNCH_TIMELINE } from './diorama';
import { SwappableStage, type FocusKey, type Stage, type StageCue, type StageScene } from './stage';
import { CameraMove, framePose, overviewPose, isTap, OVERVIEW_POSITION, OVERVIEW_TARGET } from './focus';
import { ROVER_LOOP } from './life';
import { EARTH_POS } from './moon';
import { runBeats } from '../ui/views';
import type { SolReport } from '../sim/types';
import { galeRelativeMeters, marsHeight, EXAGGERATION } from './gale';
import { GALE_EXAGGERATION, GALE_PRODUCT, GALE_PRODUCT_URL } from './gale-info';
import gale from '../data/snapshots/gale-terrain.json';
import { emptyLevels, UPGRADE_IDS, maxLevel } from '../sim/upgrades';
import { emptyAlloc } from '../sim/sim';

describe('diorama', () => {
  it('builds, grows with upgrades, shows blueprints, weather, night and launch', () => {
    const d = new Diorama();
    const levels = emptyLevels();
    const scene = { sol: 1, weather: 'clear' as const, alloc: emptyAlloc(), fuel: 10, sheltered: false, levels, crew: 4, project: 'panel' as const, projectProgress: 0.4 };
    d.setScene(scene);
    d.tick(0.016, 0, false);
    let visibleBefore = 0;
    d.group.traverseVisible(() => visibleBefore++);
    // Build everything.
    const all = emptyLevels();
    for (const id of UPGRADE_IDS) all[id] = maxLevel(id);
    for (const weather of ['dusty', 'storm', 'clear'] as const) {
      d.setScene({ ...scene, weather, levels: all, project: null, projectProgress: undefined, alloc: { ...emptyAlloc(), air: 1, fuel: 3, greenhouse: 2, heaters: 1, shelter: 1, monitor: 1, battery: 1 } });
      for (let i = 0; i < 90; i++) d.tick(1 / 30, i / 30, false);
    }
    let visibleAfter = 0;
    d.group.traverseVisible(() => visibleAfter++);
    expect(visibleAfter).toBeGreaterThan(visibleBefore);
    d.setNight(1);
    d.storm(1);
    d.tick(0.016, 5, true);
    expect(d.stormLevel).toBeGreaterThan(0);
    const pad = d.group.getObjectByName('launch-pad')!;
    const padY = pad.position.y;
    for (let k = 0; k <= 1; k += 0.1) d.launchStep(k);
    expect(d.rocketPosition().y).toBeGreaterThan(50);
    // Only the rocket flies: the launch pad and tower stay on the ground.
    expect(pad.position.y).toBe(padY);
    expect(pad.parent).toBe(d.group);
    d.resetLaunch();
    expect(d.rocketPosition().y).toBeLessThan(5);
  });
});

describe('sites: Mars and the Moon', () => {
  const all = emptyLevels();
  for (const id of UPGRADE_IDS) all[id] = maxLevel(id);
  const scene = (site?: 'mars' | 'moon', weather: 'clear' | 'dusty' | 'storm' = 'clear') => ({
    sol: 3,
    weather,
    alloc: { ...emptyAlloc(), air: 1, fuel: 2, greenhouse: 1, heaters: 1, shelter: 1 },
    fuel: 40,
    sheltered: false,
    levels: all,
    crew: 4,
    site,
  });
  const shown = (d: Diorama, name: string) => {
    let o: THREE.Object3D | null | undefined = d.group.getObjectByName(name);
    if (!o) return false;
    for (; o; o = o.parent) if (!o.visible) return false;
    return true;
  };

  it('builds and ticks on both sites, including a launch', () => {
    for (const site of ['mars', 'moon'] as const) {
      const d = new Diorama();
      d.setScene(scene(site, 'storm'));
      for (let i = 0; i < 60; i++) d.tick(1 / 30, i / 30, false);
      d.setNight(1);
      d.tick(0.016, 3, false);
      expect(d.currentSite).toBe(site);
      for (let k = 0; k <= 1; k += 0.1) d.launchStep(k);
      expect(d.rocketPosition().y).toBeGreaterThan(50);
      d.resetLaunch();
      expect(d.rocketPosition().y).toBeLessThan(5);
      // No dust on the Moon, even when the sim says "storm".
      if (site === 'moon') expect(d.dustLevel()).toBe(0);
      else expect(d.dustLevel()).toBeGreaterThan(0.3);
    }
  });

  it('switches site at runtime and back', () => {
    const d = new Diorama();
    d.setScene(scene()); // no site given = Mars
    expect(d.currentSite).toBe('mars');
    expect(shown(d, 'mars-ground')).toBe(true);
    expect(d.group.getObjectByName('moon-ground')).toBeUndefined(); // built only when needed
    const rocket = d.group.getObjectByName('rocket')!;
    const hullMat = (rocket.children[0] as THREE.Mesh).material as THREE.MeshPhongMaterial;
    const marsHull = hullMat.color.clone();

    d.setScene(scene('moon', 'dusty'));
    for (let i = 0; i < 30; i++) d.tick(1 / 30, i / 30, false);
    expect(d.currentSite).toBe('moon');
    expect(shown(d, 'moon-ground')).toBe(true);
    expect(shown(d, 'mars-ground')).toBe(false);
    expect(shown(d, 'earth')).toBe(true);
    expect(d.dustLevel()).toBe(0);
    // White hulls are a little brighter on the Moon.
    expect(hullMat.color.r + hullMat.color.g + hullMat.color.b).toBeGreaterThan(marsHull.r + marsHull.g + marsHull.b);
    // Craters: the Moon has relief out past the pad.
    let relief = 0;
    for (let a = 0; a < 360; a += 2) for (const r of [14, 20, 28, 36]) relief = Math.max(relief, Math.abs(d.groundHeight(Math.cos(a) * r, Math.sin(a) * r)));
    expect(relief).toBeGreaterThan(0.3);

    d.setScene(scene('mars'));
    expect(shown(d, 'mars-ground')).toBe(true);
    expect(shown(d, 'moon-ground')).toBe(false);
    expect(shown(d, 'earth')).toBe(false);
    expect(hullMat.color.equals(marsHull)).toBe(true);
  });

  it('keeps the base pad flat and identical on both worlds', () => {
    const d = new Diorama();
    for (const site of ['mars', 'moon'] as const) {
      d.setSite(site);
      for (let a = 0; a < 360; a += 10)
        for (const r of [0, 3, 6, 9, 10.9]) expect(Math.abs(d.groundHeight(Math.cos((a * Math.PI) / 180) * r, Math.sin((a * Math.PI) / 180) * r))).toBe(0);
    }
  });
});

describe('Gale Crater terrain from NASA Mars Trek', () => {
  it('is a real elevation grid centered on the landing site', () => {
    expect(gale.units).toBe('m');
    expect(gale.heights.length).toBe(gale.size.cols * gale.size.rows);
    expect(gale.sourceUrls.some((u) => u.startsWith('https://trek.nasa.gov/'))).toBe(true);
    const mid = ((gale.size.rows - 1) / 2) * gale.size.cols + (gale.size.cols - 1) / 2;
    expect(gale.heights[mid]).toBe(gale.center.elevationM);
    // Bradbury Landing is about 4.5 km below the Mars datum.
    expect(gale.center.elevationM).toBeLessThan(-4000);
    expect(galeRelativeMeters(0, 0)).toBe(0);
    // The Science Log's labels match the data.
    expect(GALE_PRODUCT).toBe(gale.product);
    expect(GALE_PRODUCT_URL).toBe(gale.productInfoUrl);
    expect(EXAGGERATION).toBe(GALE_EXAGGERATION);
  });

  it('puts Mount Sharp to the south-east, kilometers above the base, and keeps the camera ring clear', () => {
    // North is +z and east is -x, so south-east is (-x, -z).
    let best = { h: -Infinity, x: 0, z: 0 };
    for (let x = -70; x <= 70; x += 2)
      for (let z = -70; z <= 70; z += 2) {
        if (Math.hypot(x, z) > 70) continue;
        const h = galeRelativeMeters(x, z);
        if (h > best.h) best = { h, x, z };
      }
    expect(best.x).toBeLessThan(0);
    expect(best.z).toBeLessThan(0);
    expect(best.h).toBeGreaterThan(4000);
    // The orbiting camera (up to 38 units out, and at least ~7 units up out there) stays above the ground.
    for (let a = 0; a < 360; a += 5) expect(marsHeight(Math.cos((a * Math.PI) / 180) * 38, Math.sin((a * Math.PI) / 180) * 38)).toBeLessThan(6);
  });
});

// ------------------------------------------------------------------------------------------------
// The outpost comes alive: tapping modules, drones, the cargo lander, rover, dust devils, comms beam,
// the crew running for the shelter, and the upgraded launch.

const allBuilt = () => {
  const l = emptyLevels();
  for (const id of UPGRADE_IDS) l[id] = maxLevel(id);
  return l;
};
const baseScene = (over: Partial<StageScene> = {}): StageScene => ({
  sol: 2,
  weather: 'clear',
  alloc: emptyAlloc(),
  fuel: 30,
  sheltered: false,
  levels: emptyLevels(),
  crew: 4,
  ...over,
});
const run = (d: Diorama, seconds: number, reduced = false, from = 0) => {
  for (let i = 0; i < Math.round(seconds * 30); i++) d.tick(1 / 30, from + i / 30, reduced);
};

describe('tapping parts of the base', () => {
  const ray = new THREE.Raycaster();
  const down = new THREE.Vector3(0, -1, 0);
  const at = (d: Diorama, x: number, z: number) => {
    ray.set(new THREE.Vector3(x, 40, z), down);
    return d.pick(ray);
  };

  it('finds the module under a tap, and only modules that are built', () => {
    const d = new Diorama();
    d.setScene(baseScene());
    expect(at(d, 0, 0)).toBe('heaters'); // the habitat, with its heater vents
    expect(at(d, 4.2, -1.2)).toBe('o2');
    expect(at(d, -4.2, -0.6)).toBe('greenhouse');
    expect(at(d, 1.2, 4.4)).toBe('shelter');
    expect(at(d, -0.8, -4.4)).toBe('build');
    expect(at(d, 8.7, 3.6)).toBe('rocket');
    expect(at(d, -9.5, 0.8)).toBe('panels');
    // Not built yet, or empty ground: nothing.
    expect(at(d, 2.6, -4.2)).toBeNull();
    expect(at(d, -2.5, -8)).toBeNull();
    expect(at(d, 20, 20)).toBeNull();
    expect(d.focusTargets().map((t) => t.key)).toEqual(['o2', 'greenhouse', 'heaters', 'shelter', 'build', 'rocket', 'panels']);

    d.setScene(baseScene({ levels: allBuilt() }));
    expect(at(d, 2.6, -4.2)).toBe('monitor');
    expect(at(d, -2.5, -8)).toBe('reactor');
    expect(at(d, 6.6, -2.6)).toBe('o2'); // the second O2 plant belongs to the O2 Plant card
    expect(at(d, 5.2, 1.6)).toBe('battery');
    const list = d.focusTargets();
    expect(list.map((t) => t.key)).toEqual(['o2', 'greenhouse', 'heaters', 'shelter', 'monitor', 'battery', 'build', 'rocket', 'panels', 'reactor']);
    expect(list.every((t) => t.label.length > 2)).toBe(true);
  });

  it('frames a module with the camera and swings back to the whole base', () => {
    const d = new Diorama();
    d.setScene(baseScene({ levels: allBuilt() }));
    const f = { center: new THREE.Vector3(), radius: 0, top: 0 };
    expect(d.focusFrame('monitor', f)).toBe(true);
    expect(Math.hypot(f.center.x - 2.6, f.center.z + 4.2)).toBeLessThan(1);
    expect(f.top).toBeGreaterThan(3); // the dish sits on a tall mast
    expect(d.focusFrame('rocket', f)).toBe(true);
    expect(f.center.y).toBeGreaterThan(1); // the hidden engine flame doesn't count
    expect(new Diorama().focusFrame('reactor', f)).toBe(false); // not built

    d.focusFrame('o2', f);
    const cam = new THREE.PerspectiveCamera(42, 16 / 9, 0.5, 400);
    cam.position.copy(OVERVIEW_POSITION);
    const target = OVERVIEW_TARGET.clone();
    const goalT = new THREE.Vector3();
    const goal = new THREE.Spherical();
    framePose(f.center, f.radius, cam, goalT, goal);
    const move = new CameraMove();
    move.start(cam, target, goalT, goal, 1.1);
    let lowest = Infinity;
    for (let i = 0; i < 120 && move.active; i++) {
      move.step(1 / 60, cam, target);
      lowest = Math.min(lowest, cam.position.y - d.groundHeight(cam.position.x, cam.position.z));
    }
    expect(move.active).toBe(false);
    expect(target.distanceTo(f.center)).toBeLessThan(1e-6);
    const dist = cam.position.distanceTo(target);
    expect(dist).toBeCloseTo(goal.radius, 5);
    // Close up, but the whole module fits in the view.
    expect(dist).toBeLessThan(OVERVIEW_POSITION.distanceTo(OVERVIEW_TARGET));
    expect(dist).toBeGreaterThan(f.radius / Math.tan(THREE.MathUtils.degToRad(cam.fov / 2)));
    expect(lowest).toBeGreaterThan(1);

    overviewPose(cam, goalT, goal);
    move.start(cam, target, goalT, goal, 0); // reduced motion: one jump
    move.step(1 / 60, cam, target);
    expect(move.active).toBe(false);
    expect(target.distanceTo(OVERVIEW_TARGET)).toBeLessThan(1e-6);
    expect(cam.position.distanceTo(target)).toBeCloseTo(OVERVIEW_POSITION.distanceTo(OVERVIEW_TARGET), 5);
  });

  it('tells a tap from a drag', () => {
    expect(isTap(3, 4, 120)).toBe(true);
    expect(isTap(30, 0, 120)).toBe(false);
    expect(isTap(0, 0, 2000)).toBe(false);
  });
});

describe('the Workshop builds: blueprint and drones', () => {
  it('fills the blueprint in from the bottom up (no squashing), smoothly', () => {
    const d = new Diorama();
    d.setScene(baseScene({ project: 'battery', projectProgress: 0.25 }));
    const bp = d.group.getObjectByName('blueprint')!;
    expect(bp.children.length).toBe(2); // the built part, and the faint part still to build
    for (const c of bp.children) expect(c.scale.y).toBe(1);
    expect(d.blueprintFill).toBeCloseTo(0.25, 5);
    expect(d.group.getObjectByName('build-line')!.visible).toBe(true);
    d.setScene(baseScene({ project: 'battery', projectProgress: 0.75 }));
    d.tick(1 / 30, 0, false);
    expect(d.blueprintFill).toBeGreaterThan(0.25);
    expect(d.blueprintFill).toBeLessThan(0.75);
    run(d, 4);
    expect(d.blueprintFill).toBeCloseTo(0.75, 3);
    // A new project starts at its own progress (no sweep from the old one).
    d.setScene(baseScene({ levels: { ...emptyLevels(), battery: 1 }, project: 'berm', projectProgress: 0 }));
    expect(d.blueprintFill).toBe(0);
    d.setScene(baseScene({ project: null }));
    expect(bp.children.length).toBe(0);
    expect(d.group.getObjectByName('build-line')!.visible).toBe(false);
  });

  it('sends 1 to 3 drones while cells are in the Workshop, with welding sparks', () => {
    const d = new Diorama();
    d.setScene(baseScene({ project: 'battery', projectProgress: 0.3, alloc: { ...emptyAlloc(), build: 2 } }));
    run(d, 4);
    expect(d.drones.flying).toBe(2);
    expect(d.sparks.alive).toBeGreaterThan(0);
    d.setScene(baseScene({ project: 'battery', projectProgress: 0.3, alloc: { ...emptyAlloc(), build: 6 } }));
    run(d, 4);
    expect(d.drones.flying).toBe(3);
    // No cells in the Workshop: they all fly home.
    d.setScene(baseScene({ project: 'battery', projectProgress: 0.3 }));
    run(d, 10);
    expect(d.drones.flying).toBe(0);
    // No project: none either.
    d.setScene(baseScene({ project: null, alloc: { ...emptyAlloc(), build: 2 } }));
    run(d, 5);
    expect(d.drones.flying).toBe(0);
  });
});

describe('cargo lander', () => {
  it('comes down on its retro-rockets, leaves the crate, and later flies off', () => {
    const d = new Diorama();
    d.setScene(baseScene());
    const craft = d.group.getObjectByName('lander-craft')!;
    const crate = d.group.getObjectByName('supply-crate')!;
    expect(craft.visible).toBe(false);
    d.cue({ kind: 'lander', crate: 'food' });
    run(d, 0.5);
    expect(d.lander.phase).toBe('descend');
    expect(craft.visible).toBe(true);
    expect(craft.position.y).toBeGreaterThan(10);
    expect(d.sparks.alive).toBeGreaterThan(0); // flames
    expect(crate.visible).toBe(false);
    run(d, 4.5, false, 0.5);
    expect(d.lander.phase).toBe('landed');
    expect(craft.position.y).toBeCloseTo(d.groundHeight(craft.position.x, craft.position.z), 5);
    expect(d.puffs.alive).toBeGreaterThan(0); // dust kicked up
    run(d, 1, false, 5);
    expect(crate.visible).toBe(true);
    run(d, 20, false, 6);
    expect(d.lander.phase).toBe('idle');
    expect(craft.visible).toBe(false);
    expect(crate.visible).toBe(false);
  });

  it('is quicker with reduced motion, and works on the Moon', () => {
    const d = new Diorama();
    d.setScene(baseScene({ site: 'moon' }));
    d.cue({ kind: 'lander', crate: 'panel' });
    run(d, 2, true);
    expect(d.lander.phase).toBe('landed');
  });
});

describe('rover and dust devils', () => {
  it('the rover patrols outside the buildings by day and parks at night', () => {
    const d = new Diorama();
    d.setScene(baseScene());
    const rover = d.group.getObjectByName('rover')!;
    const p0 = rover.position.clone();
    run(d, 3);
    expect(rover.position.distanceTo(p0)).toBeGreaterThan(1);
    expect(Math.hypot(rover.position.x, rover.position.z)).toBeCloseTo(ROVER_LOOP, 3);
    d.setNight(1);
    const p1 = rover.position.clone();
    run(d, 3);
    expect(rover.position.distanceTo(p1)).toBe(0);
  });

  it('dust devils only on clear Mars afternoons (never on the Moon, never with reduced motion)', () => {
    const check = (over: Partial<StageScene>, t: number, reduced = false) => {
      const d = new Diorama();
      d.setScene(baseScene(over));
      d.setDayTime(t);
      run(d, 3, reduced);
      return d.devils.level;
    };
    expect(check({}, 0.3)).toBeGreaterThan(0.9);
    expect(check({ site: 'moon' }, 0.3)).toBe(0);
    expect(check({ weather: 'dusty' }, 0.3)).toBe(0);
    expect(check({}, 0.05)).toBe(0); // morning
    expect(check({}, 0.3, true)).toBe(0);
    // They drift on the plains, never into the base.
    const d = new Diorama();
    d.setScene(baseScene());
    d.setDayTime(0.3);
    for (let i = 0; i < 30 * 40; i++) {
      d.tick(1 / 30, i / 30, false);
      for (const g of d.devils.group.children) if (g.visible) expect(Math.hypot(g.position.x, g.position.z)).toBeGreaterThan(12);
    }
  });
});

describe('storm warnings and the shelter', () => {
  it('a comms beam pulses from the dish that heard the warning, until the storm hits', () => {
    const d = new Diorama();
    d.setScene(baseScene({ warning: 'earth' }));
    run(d, 2);
    expect(d.beam.showing).toBe(true);
    expect(d.beam.arrivals).toBeGreaterThan(0); // a pulse reached the dish
    d.storm(1);
    run(d, 2);
    expect(d.beam.showing).toBe(false);
    // The monitor can only warn once it is built.
    d.setScene(baseScene({ warning: 'monitor' }));
    run(d, 2);
    expect(d.beam.showing).toBe(false);
    d.setScene(baseScene({ warning: 'monitor', levels: allBuilt() }));
    run(d, 2);
    expect(d.beam.showing).toBe(true);
    d.setScene(baseScene({ warning: null, levels: allBuilt() }));
    run(d, 2);
    expect(d.beam.showing).toBe(false);
  });

  it('on the Moon the beam points at the Earth', () => {
    const d = new Diorama();
    d.setScene(baseScene({ site: 'moon', warning: 'earth' }));
    run(d, 0.5);
    const g = d.beam.group;
    const dir = new THREE.Vector3(0, 1, 0).applyQuaternion(g.quaternion);
    const toEarth = EARTH_POS.clone().sub(g.position).normalize();
    expect(dir.dot(toEarth)).toBeGreaterThan(0.999);
  });

  it('the crew runs into the shelter before the storm hits, and comes back out after', () => {
    const d = new Diorama();
    d.setScene(baseScene({ sheltered: true, alloc: { ...emptyAlloc(), shelter: 2 } }));
    run(d, 1);
    expect(d.crewOutside).toBe(4);
    d.cue({ kind: 'shelter' });
    d.tick(1 / 30, 1, false);
    expect(d.crewOutside).toBe(4); // running, not vanished
    run(d, 1.3, false, 1);
    expect(d.crewOutside).toBe(0); // all inside before the hit
    d.storm(1);
    run(d, 2, false, 3);
    expect(d.crewOutside).toBe(0);
    run(d, 6, false, 5);
    expect(d.crewOutside).toBe(4);
    // Reduced motion: they just go in.
    d.tick(1 / 30, 19, true);
    d.cue({ kind: 'shelter' });
    d.tick(1 / 30, 20, true);
    expect(d.crewOutside).toBe(0);
  });
});

describe('launch: countdown, dust ring, plume light, staging', () => {
  const lightColor = (d: Diorama, i: number) => ((d.group.getObjectByName(`tower-light-${i}`) as THREE.Mesh).material as THREE.MeshPhongMaterial).emissive.getHexString();

  it('plays the whole timeline and resets for the next crew', () => {
    const d = new Diorama();
    d.setScene(baseScene({ levels: allBuilt(), fuel: 100 }));
    const T = LAUNCH_TIMELINE;
    const rocket = d.group.getObjectByName('rocket')!;
    const before = rocket.children.length;
    const red = lightColor(d, 0);
    const step = (k: number) => {
      d.launchStep(k, 1 / 60);
      d.tick(1 / 60, k * 8, false);
    };
    step(T.count[0] + 0.01);
    expect(lightColor(d, 0)).not.toBe(red);
    expect(lightColor(d, 2)).toBe(red);
    expect(d.group.getObjectByName('rocket-flame')!.visible).toBe(false);
    step(T.ignite + 0.005);
    expect(lightColor(d, 0)).toBe(lightColor(d, 2)); // all green
    expect(lightColor(d, 0)).not.toBe(red);
    expect(d.group.getObjectByName('rocket-flame')!.visible).toBe(true);
    expect(d.puffs.alive).toBeGreaterThan(40); // the dust ring
    expect(d.plumeLight).toBeGreaterThan(0);
    expect(d.rocketPosition().y).toBeLessThan(1); // still on the pad
    step(T.stage - 0.01);
    expect(d.staged).toBe(false);
    step(T.stage + 0.01);
    expect(d.staged).toBe(true);
    const booster = d.group.getObjectByName('booster')!;
    expect(booster.visible).toBe(true);
    expect(rocket.children.length).toBeLessThan(before); // the booster fell away
    expect(d.group.getObjectByName('rocket-flame')!.visible).toBe(false); // coasting
    step(T.relight + 0.02);
    expect(d.group.getObjectByName('rocket-flame')!.visible).toBe(true); // upper stage lit
    step(0.999);
    expect(d.rocketPosition().y).toBeGreaterThan(100);
    expect(booster.visible).toBe(false); // gone below the horizon
    d.resetLaunch();
    expect(d.staged).toBe(false);
    expect(rocket.children.length).toBe(before);
    expect(d.plumeLight).toBe(0);
    expect(lightColor(d, 0)).toBe(red);
    expect(d.rocketPosition().y).toBeLessThan(1);
  });

  it('does not shake the rocket with reduced motion', () => {
    const d = new Diorama();
    d.setScene(baseScene());
    d.tick(1 / 60, 0, true);
    const x = d.rocketPosition().x;
    for (let k = LAUNCH_TIMELINE.ignite; k < LAUNCH_TIMELINE.liftoff; k += 0.005) {
      d.launchStep(k);
      expect(d.rocketPosition().x).toBe(x);
    }
  });
});

describe('run beats cue the 3D stage', () => {
  const report = (over: Partial<SolReport>) => ({ alloc: emptyAlloc(), weather: 'clear', heaterShortfall: 0, stored: 0, ...over }) as SolReport;
  const storm = (shelterCells: number) => ({ shelterCells }) as unknown as NonNullable<SolReport['storm']>;

  it('sends the lander on a resupply sol and the crew to the shelter before a storm', () => {
    for (const site of ['mars', 'moon'] as const) {
      const beats = runBeats(report({ crate: 'food', storm: storm(2) }), site);
      const lander = beats.find((b) => b.cue?.kind === 'lander')!;
      const shelter = beats.find((b) => b.cue?.kind === 'shelter')!;
      const hit = beats.find((b) => b.storm)!;
      expect(lander.cue).toEqual({ kind: 'lander', crate: 'food' });
      expect(shelter.at).toBeLessThan(hit.at); // before the storm hits
    }
    // No shelter power: nobody runs. No crate: no lander.
    const quiet = runBeats(report({ storm: storm(0) }));
    expect(quiet.some((b) => b.cue)).toBe(false);
  });
});

describe('stage API', () => {
  const fake = (log: string[], name: string, extras = true): Stage => ({
    mount() {},
    setScene() {},
    setTimeOfDay() {},
    storm() {},
    launch: async () => {},
    setReducedMotion() {},
    dispose() {},
    ...(extras
      ? {
          focusModule: (k: FocusKey | null) => void log.push(`${name} focus ${k}`),
          cue: (c: StageCue) => void log.push(`${name} cue ${c.kind}`),
        }
      : {}),
  });

  it('the swappable stage passes picks, cues and focus through, before and after the swap', () => {
    const log: string[] = [];
    const a = fake(log, 'a');
    const b = fake(log, 'b');
    const s = new SwappableStage(a);
    const picks: Array<FocusKey | null> = [];
    s.onPick = (k) => picks.push(k);
    s.mount({} as HTMLElement);
    a.onPick!('o2');
    s.cue({ kind: 'lander', crate: 'parts' });
    s.focusModule('rocket');
    s.swap(b);
    b.onPick!(null);
    s.cue({ kind: 'shelter' });
    expect(picks).toEqual(['o2', null]);
    expect(log).toEqual(['a cue lander', 'a focus rocket', 'b cue shelter']);
    // A stage without the optional extras is fine too.
    s.swap(fake(log, 'c', false));
    expect(() => (s.cue({ kind: 'shelter' }), s.focusModule(null))).not.toThrow();
  });
});
