// Written with AI assistance (Claude Code). See README "Use of AI tools".
// Builds the whole 3D diorama (no GPU needed) and exercises every update path, on Mars and on the Moon.
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { Diorama } from './diorama';
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
