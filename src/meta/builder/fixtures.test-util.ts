// Written with AI assistance (Claude Code). See README "Use of AI tools".
// TEST HELPERS ONLY: build a pad from a shopping list by putting each part in the first square where it fits.
import { Editor, GRID, emptyLayout, type Layout, type Rot, type SiteId } from './layout';
import type { PartId } from './parts';

export function autoLayout(site: SiteId, list: Partial<Record<PartId, number>>): Layout {
  const ed = new Editor(emptyLayout(site));
  // Big things first, so they find room.
  const order: PartId[] = ['rocket', 'reactor', 'habitat', 'greenhouse', 'bigo2', 'garage', 'o2', 'shelter', 'berm', 'workshop', 'solar', 'battery', 'heater', 'monitor', 'path', 'lamp', 'antenna', 'flag', 'statue', 'planter'];
  for (const part of order) {
    for (let n = 0; n < (list[part] ?? 0); n++) {
      let done = false;
      for (let z = 0; z < GRID && !done; z++) {
        for (let x = 0; x < GRID && !done; x++) {
          for (const rot of [0, 1] as Rot[]) {
            const r = ed.place(part, x, z, rot);
            if ('uid' in r) {
              done = true;
              break;
            }
          }
        }
      }
      if (!done) throw new Error(`no room for ${part}`);
    }
  }
  return ed.layout;
}

/** Put a berm right beside every shelter (tests of the berm rule). */
export function withBerms(layout: Layout): Layout {
  const ed = new Editor(layout);
  for (const s of layout.parts.filter((p) => p.part === 'shelter')) {
    for (const [dx, dz] of [
      [0, 1],
      [0, -1],
      [2, 0],
      [-2, 0],
    ]) {
      const r = ed.place('berm', s.x + dx, s.z + dz, s.rot);
      if ('uid' in r) break;
    }
  }
  return ed.layout;
}
