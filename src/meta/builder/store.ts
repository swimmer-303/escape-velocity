// Written with AI assistance (Claude Code). See README "Use of AI tools".
// Outpost Architect: what this browser remembers (localStorage 'ev-builder-v1'): saved bases (slots, kept as share
// codes so a broken save can never load something odd), the base being edited, and the stars on each blueprint.
// Every read and write is wrapped: blocked or broken storage just means nothing is remembered.

import { CHALLENGES } from './challenges';
import { decodeLayout, encodeLayout } from './share';
import type { Layout } from './layout';

export const STORE_KEY = 'ev-builder-v1';
export const SLOT_COUNT = 6;

export interface Slot {
  name: string;
  code: string;
  savedAt: number;
}

export interface BuilderSave {
  v: 1;
  slots: Array<Slot | null>;
  /** The base on the pad when the builder was last closed (Free build). */
  current: string | null;
  stars: Record<string, number>;
  /** Parts the player has already been told are unlocked. */
  seen: string[];
}

export function blankSave(): BuilderSave {
  return { v: 1, slots: Array(SLOT_COUNT).fill(null), current: null, stars: {}, seen: [] };
}

const NAME_MAX = 24;
export function cleanName(name: unknown, fallback = 'My base'): string {
  const s = typeof name === 'string' ? name.replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, NAME_MAX) : '';
  return s || fallback;
}

export function readSave(): BuilderSave {
  const out = blankSave();
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_KEY) ?? 'null') as Partial<BuilderSave> | null;
    if (!raw || typeof raw !== 'object' || raw.v !== 1) return out;
    if (Array.isArray(raw.slots)) {
      for (let i = 0; i < SLOT_COUNT; i++) {
        const s = raw.slots[i] as Partial<Slot> | null | undefined;
        if (s && typeof s === 'object' && typeof s.code === 'string' && decodeLayout(s.code))
          out.slots[i] = { name: cleanName(s.name), code: s.code, savedAt: typeof s.savedAt === 'number' && Number.isFinite(s.savedAt) ? s.savedAt : 0 };
      }
    }
    if (typeof raw.current === 'string' && decodeLayout(raw.current)) out.current = raw.current;
    if (raw.stars && typeof raw.stars === 'object') {
      for (const c of CHALLENGES) {
        const n = Number((raw.stars as Record<string, unknown>)[c.id]);
        if (Number.isInteger(n) && n >= 1 && n <= 3) out.stars[c.id] = n;
      }
    }
    if (Array.isArray(raw.seen)) out.seen = raw.seen.filter((x): x is string => typeof x === 'string').slice(0, 64);
  } catch {
    /* blocked or broken storage: start fresh */
  }
  return out;
}

export function writeSave(s: BuilderSave): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(s));
  } catch {
    /* storage full or blocked: not remembered */
  }
}

export function saveSlot(i: number, name: string, layout: Layout): BuilderSave {
  const s = readSave();
  if (i < 0 || i >= SLOT_COUNT) return s;
  s.slots[i] = { name: cleanName(name), code: encodeLayout(layout), savedAt: Date.now() };
  writeSave(s);
  return s;
}

export function deleteSlot(i: number): BuilderSave {
  const s = readSave();
  if (i >= 0 && i < SLOT_COUNT) s.slots[i] = null;
  writeSave(s);
  return s;
}

export function loadSlot(i: number): Layout | null {
  const slot = readSave().slots[i];
  return slot ? decodeLayout(slot.code) : null;
}

export function saveCurrent(layout: Layout): void {
  const s = readSave();
  s.current = encodeLayout(layout);
  writeSave(s);
}

export function loadCurrent(): Layout | null {
  const c = readSave().current;
  return c ? decodeLayout(c) : null;
}

/** Record stars for a challenge. Returns how many are new (0 if not better). */
export function recordStars(id: string, stars: number): { before: number; added: number } {
  const s = readSave();
  const before = s.stars[id] ?? 0;
  const n = Math.max(0, Math.min(3, Math.floor(stars)));
  if (n <= before) return { before, added: 0 };
  s.stars[id] = n;
  writeSave(s);
  return { before, added: n - before };
}

export function starsNow(): Record<string, number> {
  return readSave().stars;
}

export function markSeen(ids: string[]): void {
  const s = readSave();
  const set = new Set(s.seen);
  for (const id of ids) set.add(id);
  s.seen = [...set].slice(0, 64);
  writeSave(s);
}
