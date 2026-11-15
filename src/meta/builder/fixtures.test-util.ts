// Written with AI assistance (Claude Code). See README "Use of AI tools".
// TEST HELPERS ONLY: build a pad from a shopping list by putting each part in the first square where it fits.
import { Editor, GRID, emptyLayout, shelterHasBerm, type Layout, type Placed, type Rot, type SiteId } from './layout';
import type { PartId } from './parts';

const ORDER: PartId[] = ['rocket', 'reactor', 'habitat', 'greenhouse', 'bigo2', 'garage', 'o2', 'shelter', 'berm', 'workshop', 'solar', 'battery', 'heater', 'monitor', 'path', 'lamp', 'antenna', 'flag', 'statue', 'planter'];

function bermBeside(ed: Editor, s: Placed): boolean {
  for (let z = s.z - 2; z <= s.z + 3; z++) {
    for (let x = s.x - 2; x <= s.x + 3; x++) {
      for (const rot of [0, 1] as Rot[]) {
        const r = ed.place('berm', x, z, rot);
        if (!('uid' in r)) continue;
        if (shelterHasBerm(ed.layout, s)) return true;
        ed.undo();
      }
    }
  }
  return false;
}

/** `berms`: put a Regolith berm right beside every shelter as it is placed. */
export function autoLayout(site: SiteId, list: Partial<Record<PartId, number>>, opts: { berms?: boolean } = {}): Layout {
  const ed = new Editor(emptyLayout(site));
  for (const part of ORDER) {
    for (let n = 0; n < (list[part] ?? 0); n++) {
      let done: Placed | null = null;
      for (let z = 0; z < GRID && !done; z++) {
        for (let x = 0; x < GRID && !done; x++) {
          for (const rot of [0, 1] as Rot[]) {
            const r = ed.place(part, x, z, rot);
            if ('uid' in r) {
              done = r;
              break;
            }
          }
        }
      }
      if (!done) throw new Error(`no room for ${part}`);
      if (part === 'shelter' && opts.berms && !bermBeside(ed, done)) throw new Error('no room for a berm');
    }
  }
  return ed.layout;
}

/** The same shopping list with a berm beside every shelter. */
export function withBerms(site: SiteId, list: Partial<Record<PartId, number>>): Layout {
  return autoLayout(site, list, { berms: true });
}
