// Written with AI assistance (Claude Code). See README "Use of AI tools".
// Outpost Architect: placement rules (bounds, overlap, the one-rocket limit, the launch-pad blast zone, locked
// parts), turning footprints, the berm-next-to-shelter rule, and the editor's undo and redo.
import { describe, it, expect } from 'vitest';
import { Editor, GRID, canPlace, cellsOf, emptyLayout, footprint, partAt, sanitize, shelterHasBerm, workingParts, type Layout } from './layout';
import { STARTER_PARTS, type PartId } from './parts';

const placed = (ed: Editor, part: PartId, x: number, z: number, rot: 0 | 1 | 2 | 3 = 0) => {
  const r = ed.place(part, x, z, rot);
  if (!('uid' in r)) throw new Error(r.reason);
  return r;
};

describe('placement rules', () => {
  it('keeps parts on the pad', () => {
    const l = emptyLayout();
    expect(canPlace(l, 'habitat', 0, 0, 0).ok).toBe(true);
    expect(canPlace(l, 'habitat', GRID - 2, GRID - 2, 0).ok).toBe(true);
    const off = canPlace(l, 'habitat', GRID - 1, 0, 0);
    expect(off.ok).toBe(false);
    if (!off.ok) {
      expect(off.why).toBe('bounds');
      expect(off.reason).toMatch(/off the build pad/);
    }
    expect(canPlace(l, 'solar', -1, 3, 0).ok).toBe(false);
  });

  it('turns footprints a quarter turn', () => {
    expect(footprint('solar', 0)).toEqual({ w: 1, d: 2 });
    expect(footprint('solar', 1)).toEqual({ w: 2, d: 1 });
    expect(footprint('solar', 2)).toEqual({ w: 1, d: 2 });
    expect(cellsOf({ part: 'o2', x: 3, z: 4, rot: 1 })).toEqual([
      [3, 4],
      [3, 5],
    ]);
    // A solar panel turned sideways fits in the last row; upright it does not.
    const l = emptyLayout();
    expect(canPlace(l, 'solar', 0, GRID - 1, 0).ok).toBe(false);
    expect(canPlace(l, 'solar', 0, GRID - 1, 1).ok).toBe(true);
  });

  it('refuses overlaps and names what is in the way', () => {
    const ed = new Editor();
    placed(ed, 'greenhouse', 4, 4);
    const r = canPlace(ed.layout, 'battery', 5, 5, 0);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/Greenhouse/);
    expect(canPlace(ed.layout, 'battery', 6, 5, 0).ok).toBe(true);
    expect(partAt(ed.layout, 5, 5)?.part).toBe('greenhouse');
    expect(partAt(ed.layout, 6, 5)).toBeNull();
  });

  it('allows one rocket, with one clear square around the launch pad (paths are fine)', () => {
    const ed = new Editor();
    placed(ed, 'rocket', 6, 6);
    const second = canPlace(ed.layout, 'rocket', 0, 0, 0);
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.why).toBe('max');
    const blast = canPlace(ed.layout, 'battery', 8, 6, 0);
    expect(blast.ok).toBe(false);
    if (!blast.ok) expect(blast.why).toBe('blast');
    expect(canPlace(ed.layout, 'battery', 9, 6, 0).ok).toBe(true);
    expect(canPlace(ed.layout, 'path', 8, 6, 0).ok).toBe(true);
    // And the other way round: a rocket can't go right next to a building.
    const ed2 = new Editor();
    placed(ed2, 'habitat', 0, 0);
    expect(canPlace(ed2.layout, 'rocket', 2, 0, 0).ok).toBe(false);
    expect(canPlace(ed2.layout, 'rocket', 3, 0, 0).ok).toBe(true);
  });

  it('refuses locked parts', () => {
    const unlocked = new Set<PartId>(STARTER_PARTS);
    const r = canPlace(emptyLayout(), 'reactor', 0, 0, 0, undefined, unlocked);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.why).toBe('locked');
    expect(canPlace(emptyLayout(), 'habitat', 0, 0, 0, undefined, unlocked).ok).toBe(true);
  });

  it('counts a berm only when it touches the shelter', () => {
    const ed = new Editor();
    const s = placed(ed, 'shelter', 4, 4);
    placed(ed, 'berm', 4, 7);
    expect(shelterHasBerm(ed.layout, s)).toBe(false);
    placed(ed, 'berm', 4, 5);
    expect(shelterHasBerm(ed.layout, s)).toBe(true);
  });

  it('does not count decor as working parts', () => {
    const ed = new Editor();
    placed(ed, 'habitat', 0, 0);
    placed(ed, 'path', 5, 5);
    placed(ed, 'flag', 6, 6);
    expect(workingParts(ed.layout)).toBe(1);
  });
});

describe('the editor', () => {
  it('undoes and redoes placing, moving, turning, deleting and clearing', () => {
    const ed = new Editor();
    const a = placed(ed, 'solar', 0, 0);
    placed(ed, 'battery', 3, 3);
    expect(ed.layout.parts).toHaveLength(2);
    expect(ed.move(a.uid, 5, 5).ok).toBe(true);
    expect(ed.rotate(a.uid).ok).toBe(true);
    expect(ed.layout.parts.find((p) => p.uid === a.uid)).toMatchObject({ x: 5, z: 5, rot: 1 });
    expect(ed.remove(a.uid)).toBe(true);
    ed.clear();
    expect(ed.layout.parts).toHaveLength(0);
    expect(ed.undo()).toBe(true); // clear
    expect(ed.layout.parts).toHaveLength(1);
    expect(ed.undo()).toBe(true); // remove
    expect(ed.undo()).toBe(true); // rotate
    expect(ed.layout.parts.find((p) => p.uid === a.uid)).toMatchObject({ x: 5, z: 5, rot: 0 });
    expect(ed.undo()).toBe(true); // move
    expect(ed.layout.parts.find((p) => p.uid === a.uid)).toMatchObject({ x: 0, z: 0 });
    expect(ed.canRedo).toBe(true);
    expect(ed.redo()).toBe(true);
    expect(ed.layout.parts.find((p) => p.uid === a.uid)).toMatchObject({ x: 5, z: 5 });
    // A new change wipes the redo list.
    placed(ed, 'heater', 10, 10);
    expect(ed.canRedo).toBe(false);
  });

  it('refuses a move or turn that does not fit, and leaves no undo step for it', () => {
    const ed = new Editor();
    const a = placed(ed, 'o2', 0, 0);
    placed(ed, 'battery', 0, 1);
    const before = JSON.stringify(ed.layout);
    expect(ed.rotate(a.uid).ok).toBe(false);
    expect(ed.move(a.uid, GRID - 1, 0).ok).toBe(false);
    expect(JSON.stringify(ed.layout)).toBe(before);
    ed.undo();
    expect(ed.layout.parts).toHaveLength(1);
  });

  it('cycles a flag design', () => {
    const ed = new Editor();
    const f = placed(ed, 'flag', 2, 2);
    expect(ed.restyle(f.uid, 6)).toBe(true);
    expect(ed.layout.parts[0].style).toBe(1);
    const h = placed(ed, 'habitat', 5, 5);
    expect(ed.restyle(h.uid, 6)).toBe(false);
  });
});

describe('sanitize', () => {
  it('drops unknown, out-of-range and overlapping parts', () => {
    const l: Layout = sanitize({
      site: 'moon',
      parts: [
        { part: 'habitat', x: 0, z: 0, rot: 0 },
        { part: 'habitat', x: 1, z: 1, rot: 0 },
        { part: 'laser-cannon', x: 5, z: 5, rot: 0 },
        { part: 'solar', x: 99, z: 0, rot: 0 },
        { part: 'solar', x: 4, z: 4, rot: 7 },
        { part: 'solar', x: 4.5, z: 4, rot: 0 },
        null,
        'junk',
        { part: 'battery', x: 8, z: 8, rot: 2 },
      ],
    });
    expect(l.site).toBe('moon');
    expect(l.parts.map((p) => p.part)).toEqual(['habitat', 'battery']);
    expect(sanitize(null).parts).toEqual([]);
    expect(sanitize({ site: 'venus', parts: 'no' }).site).toBe('gale');
  });
});
