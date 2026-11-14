// Written with AI assistance (Claude Code). See README "Use of AI tools".
// Builds the whole 3D diorama (no GPU needed) and exercises every update path.
import { describe, it, expect } from 'vitest';
import { Diorama } from './diorama';
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
