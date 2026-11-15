// Written with AI assistance (Claude Code). See README "Use of AI tools".
// Outpost Architect: the build pad. A square grid, the parts placed on it, the placement rules (the ghost turns red
// when one is broken, with a reason a kid can read), and an editor with undo and redo. Pure: no DOM, no Three.js.

import { PARTS, isPartId, type PartId } from './parts';

/** Squares along each side of the build pad. */
export const GRID = 14;

export type SiteId = 'gale' | 'arcadia' | 'moon';
export const SITE_IDS: readonly SiteId[] = ['gale', 'arcadia', 'moon'];
export const SITE_NAMES: Record<SiteId, string> = { gale: 'Gale Crater, Mars', arcadia: 'Arcadia Planitia, Mars', moon: 'Moon, south pole' };
export const SITE_SHORT: Record<SiteId, string> = { gale: 'Gale Crater', arcadia: 'Arcadia (ice)', moon: 'Moon' };
export function isSiteId(x: unknown): x is SiteId {
  return x === 'gale' || x === 'arcadia' || x === 'moon';
}

/** Quarter turns: 0, 90, 180 or 270 degrees. */
export type Rot = 0 | 1 | 2 | 3;

export interface Placed {
  uid: number;
  part: PartId;
  /** The footprint's corner square with the smallest x and z. */
  x: number;
  z: number;
  rot: Rot;
  /** Decor variant (the flag's design). */
  style?: number;
}

export interface Layout {
  site: SiteId;
  parts: Placed[];
}

export function emptyLayout(site: SiteId = 'gale'): Layout {
  return { site, parts: [] };
}

/** Width (x) and depth (z) of a part at a rotation. */
export function footprint(part: PartId, rot: Rot): { w: number; d: number } {
  const p = PARTS[part];
  return rot % 2 === 0 ? { w: p.w, d: p.d } : { w: p.d, d: p.w };
}

export function cellsOf(p: Pick<Placed, 'part' | 'x' | 'z' | 'rot'>): Array<[number, number]> {
  const { w, d } = footprint(p.part, p.rot);
  const out: Array<[number, number]> = [];
  for (let i = 0; i < w; i++) for (let j = 0; j < d; j++) out.push([p.x + i, p.z + j]);
  return out;
}

export type Fit = { ok: true } | { ok: false; why: 'bounds' | 'overlap' | 'max' | 'blast' | 'locked'; reason: string };

/** Parts that may sit right next to the launch pad. */
const BLAST_OK = new Set<PartId>(['path']);

function near(a: Pick<Placed, 'part' | 'x' | 'z' | 'rot'>, b: Pick<Placed, 'part' | 'x' | 'z' | 'rot'>, gap: number): boolean {
  const fa = footprint(a.part, a.rot);
  const fb = footprint(b.part, b.rot);
  return a.x - gap < b.x + fb.w && b.x < a.x + fa.w + gap && a.z - gap < b.z + fb.d && b.z < a.z + fa.d + gap;
}

/**
 * Can this part go here? `ignore` is a part being moved (it doesn't block itself). `unlocked`: the parts this
 * player may use (all of them when missing).
 */
export function canPlace(layout: Layout, part: PartId, x: number, z: number, rot: Rot, ignore?: number, unlocked?: ReadonlySet<PartId>): Fit {
  if (unlocked && !unlocked.has(part)) return { ok: false, why: 'locked', reason: `${PARTS[part].name} is still locked.` };
  const { w, d } = footprint(part, rot);
  if (x < 0 || z < 0 || x + w > GRID || z + d > GRID) return { ok: false, why: 'bounds', reason: 'That is off the build pad.' };
  const cand = { part, x, z, rot };
  const others = layout.parts.filter((p) => p.uid !== ignore);
  for (const o of others) if (near(cand, o, 0)) return { ok: false, why: 'overlap', reason: `The ${PARTS[o.part].name} is already there.` };
  const max = PARTS[part].max;
  if (max !== undefined && others.filter((o) => o.part === part).length >= max)
    return { ok: false, why: 'max', reason: max === 1 ? `Your base has room for just one ${PARTS[part].name}.` : `Your base has room for ${max} of these at most.` };
  // Rocket blast: keep one clear square around the launch pad (paths are fine).
  for (const o of others) {
    const rocketInvolved = (part === 'rocket' && !BLAST_OK.has(o.part)) || (o.part === 'rocket' && !BLAST_OK.has(part));
    if (rocketInvolved && near(cand, o, 1)) return { ok: false, why: 'blast', reason: 'Keep 1 square clear around the launch pad: rocket blast!' };
  }
  return { ok: true };
}

export function partAt(layout: Layout, x: number, z: number): Placed | null {
  for (const p of layout.parts) {
    const { w, d } = footprint(p.part, p.rot);
    if (x >= p.x && x < p.x + w && z >= p.z && z < p.z + d) return p;
  }
  return null;
}

export function countOf(layout: Layout, part: PartId): number {
  let n = 0;
  for (const p of layout.parts) if (p.part === part) n++;
  return n;
}

/** Working (non-decor) parts: what "the smallest base" counts. */
export function workingParts(layout: Layout): number {
  return layout.parts.filter((p) => PARTS[p.part].cat !== 'decor').length;
}

/** Is a berm right next to (touching the side of) this shelter? Then 1 cell blocks 90% (the game's berm rule). */
export function shelterHasBerm(layout: Layout, shelter: Placed): boolean {
  const mine = new Set(cellsOf(shelter).map(([x, z]) => `${x},${z}`));
  for (const b of layout.parts) {
    if (b.part !== 'berm') continue;
    for (const [x, z] of cellsOf(b)) {
      for (const [dx, dz] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        if (mine.has(`${x + dx},${z + dz}`)) return true;
      }
    }
  }
  return false;
}

/** Keep only parts that are known, in bounds and not overlapping (for loaded saves and share codes). */
export function sanitize(raw: unknown, site?: SiteId): Layout {
  const out: Layout = emptyLayout(site ?? 'gale');
  if (!raw || typeof raw !== 'object') return out;
  const r = raw as { site?: unknown; parts?: unknown };
  if (!site && isSiteId(r.site)) out.site = r.site;
  if (!Array.isArray(r.parts)) return out;
  let uid = 1;
  for (const item of r.parts.slice(0, GRID * GRID)) {
    if (!item || typeof item !== 'object') continue;
    const q = item as Partial<Placed>;
    if (!isPartId(q.part)) continue;
    const x = Number(q.x);
    const z = Number(q.z);
    const rot = Number(q.rot ?? 0);
    if (!Number.isInteger(x) || !Number.isInteger(z) || !Number.isInteger(rot) || rot < 0 || rot > 3) continue;
    if (!canPlace(out, q.part, x, z, rot as Rot).ok) continue;
    const p: Placed = { uid: uid++, part: q.part, x, z, rot: rot as Rot };
    const style = Number(q.style);
    if (q.part === 'flag' && Number.isInteger(style) && style >= 0 && style < 16) p.style = style;
    out.parts.push(p);
  }
  return out;
}

// ------------------------------------------------------------------ the editor
const HISTORY = 100;

function snap(l: Layout): Layout {
  return { site: l.site, parts: l.parts.map((p) => ({ ...p })) };
}

/** The pad being edited, with undo and redo. Every change is one undo step. */
export class Editor {
  layout: Layout;
  private past: Layout[] = [];
  private future: Layout[] = [];
  private uid: number;

  constructor(start: Layout = emptyLayout()) {
    this.layout = snap(start);
    this.uid = this.layout.parts.reduce((m, p) => Math.max(m, p.uid), 0) + 1;
  }

  private commit() {
    this.past.push(snap(this.layout));
    if (this.past.length > HISTORY) this.past.shift();
    this.future = [];
  }

  place(part: PartId, x: number, z: number, rot: Rot, unlocked?: ReadonlySet<PartId>, style?: number): Placed | Fit {
    const fit = canPlace(this.layout, part, x, z, rot, undefined, unlocked);
    if (!fit.ok) return fit;
    this.commit();
    const p: Placed = { uid: this.uid++, part, x, z, rot };
    if (part === 'flag') p.style = style ?? 0;
    this.layout.parts.push(p);
    return p;
  }

  remove(uid: number): boolean {
    const i = this.layout.parts.findIndex((p) => p.uid === uid);
    if (i < 0) return false;
    this.commit();
    this.layout.parts.splice(i, 1);
    return true;
  }

  /** Move (and optionally turn) a placed part. */
  move(uid: number, x: number, z: number, rot?: Rot): Fit {
    const p = this.layout.parts.find((q) => q.uid === uid);
    if (!p) return { ok: false, why: 'bounds', reason: 'Nothing to move.' };
    const r = rot ?? p.rot;
    const fit = canPlace(this.layout, p.part, x, z, r, uid);
    if (!fit.ok) return fit;
    this.commit();
    const q = this.layout.parts.find((o) => o.uid === uid)!;
    q.x = x;
    q.z = z;
    q.rot = r;
    return fit;
  }

  /** Turn a placed part a quarter turn where it stands (if it fits). */
  rotate(uid: number): Fit {
    const p = this.layout.parts.find((q) => q.uid === uid);
    if (!p) return { ok: false, why: 'bounds', reason: 'Nothing to turn.' };
    return this.move(uid, p.x, p.z, ((p.rot + 1) % 4) as Rot);
  }

  /** Next flag design. */
  restyle(uid: number, styles: number): boolean {
    const p = this.layout.parts.find((q) => q.uid === uid);
    if (!p || p.part !== 'flag') return false;
    this.commit();
    const q = this.layout.parts.find((o) => o.uid === uid)!;
    q.style = ((q.style ?? 0) + 1) % styles;
    return true;
  }

  setSite(site: SiteId) {
    if (site === this.layout.site) return;
    this.commit();
    this.layout.site = site;
  }

  clear() {
    if (!this.layout.parts.length) return;
    this.commit();
    this.layout.parts = [];
  }

  /** Replace the whole pad (a loaded save or a challenge start). Can be undone. */
  load(l: Layout) {
    this.commit();
    this.layout = snap(l);
    this.uid = this.layout.parts.reduce((m, p) => Math.max(m, p.uid), this.uid) + 1;
  }

  get canUndo() {
    return this.past.length > 0;
  }
  get canRedo() {
    return this.future.length > 0;
  }

  undo(): boolean {
    const prev = this.past.pop();
    if (!prev) return false;
    this.future.push(snap(this.layout));
    this.layout = prev;
    return true;
  }

  redo(): boolean {
    const next = this.future.pop();
    if (!next) return false;
    this.past.push(snap(this.layout));
    this.layout = next;
    return true;
  }
}
