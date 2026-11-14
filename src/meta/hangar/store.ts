// Written with AI assistance (Claude Code). See README "Use of AI tools".
// What the player has equipped in the Hangar, saved in this browser (localStorage 'ev-hangar-v1'), plus which
// unlocked items they have already seen (for the "New" badges) and the last level whose unlocks were announced.
// Storage may be blocked or hold junk: anything unreadable falls back to the defaults, and the game carries on.

import { metaContext, playerLevel, type MetaContext } from '../hooks';
import type { Cosmetics } from '../../render/stage';
import { DEFAULTS, ITEMS, SLOTS, cosmeticsOf, isUnlocked, itemById, type Equipped, type HangarItem, type ItemOf, type Slot } from './items';

export const STORAGE_KEY = 'ev-hangar-v1';

export interface HangarSave {
  equipped: Record<Slot, string>;
  /** Items the player has seen unlocked in the Hangar. */
  seen: string[];
  /** The highest level whose unlocks have had a toast (0 = none yet). */
  toasted: number;
}

function fresh(): HangarSave {
  return { equipped: { ...DEFAULTS }, seen: [], toasted: 0 };
}

export function loadSave(): HangarSave {
  const out = fresh();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return out;
    const d = JSON.parse(raw) as Partial<Record<keyof HangarSave, unknown>> | null;
    if (!d || typeof d !== 'object') return out;
    const eq = d.equipped as Record<string, unknown> | undefined;
    if (eq && typeof eq === 'object') {
      for (const slot of SLOTS) {
        const id = eq[slot];
        if (typeof id === 'string' && itemById(id)?.slot === slot) out.equipped[slot] = id;
      }
    }
    if (Array.isArray(d.seen)) out.seen = d.seen.filter((id): id is string => typeof id === 'string' && !!itemById(id));
    if (typeof d.toasted === 'number' && Number.isFinite(d.toasted)) out.toasted = Math.max(0, Math.floor(d.toasted));
  } catch {
    /* corrupt or blocked storage: start fresh */
  }
  return out;
}

export function writeSave(s: HangarSave): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    /* storage full or blocked: the choice still applies until the page reloads */
  }
}

/**
 * What a slot shows right now: the saved choice if it is unlocked at this level, otherwise the default.
 * (The save keeps the choice, so it comes back if the level was only missing for a moment.)
 */
export function equippedItem<S extends Slot>(slot: S, level = playerLevel(), save = loadSave()): ItemOf<S> {
  const it = itemById(save.equipped[slot]);
  return (it && it.slot === slot && isUnlocked(it, level) ? it : itemById(DEFAULTS[slot])!) as ItemOf<S>;
}

export function equippedAll(level = playerLevel(), save = loadSave()): Equipped {
  return { suit: equippedItem('suit', level, save), rocket: equippedItem('rocket', level, save), pet: equippedItem('pet', level, save), lights: equippedItem('lights', level, save) };
}

/** What the stage should paint right now. */
export function currentCosmetics(level = playerLevel()): Cosmetics {
  return cosmeticsOf(equippedAll(level));
}

/** Equip an item, if it exists and is unlocked. Returns whether it was equipped. */
export function equip(id: string, level = playerLevel()): boolean {
  const it = itemById(id);
  if (!it || !isUnlocked(it, level)) return false;
  const s = loadSave();
  s.equipped[it.slot] = id;
  writeSave(s);
  return true;
}

/** Items unlocked since the player last looked in the Hangar (the starting items never count as new). */
export function newItems(level = playerLevel(), save = loadSave()): HangarItem[] {
  const seen = new Set(save.seen);
  return ITEMS.filter((i) => i.level > 1 && isUnlocked(i, level) && !seen.has(i.id));
}

/** The player has looked: everything unlocked so far is no longer new. */
export function markAllSeen(level = playerLevel()): void {
  const s = loadSave();
  const seen = new Set(s.seen);
  for (const i of ITEMS) if (i.level > 1 && isUnlocked(i, level)) seen.add(i.id);
  s.seen = [...seen];
  writeSave(s);
}

/**
 * A new level: the items it unlocks (and any skipped levels' items, if the level jumped since the last
 * announcement), each announced only once. Returns the items to announce.
 */
export function unlocksToAnnounce(level: number): HangarItem[] {
  const s = loadSave();
  if (level <= s.toasted) return [];
  const from = s.toasted > 0 ? s.toasted : level - 1;
  s.toasted = level;
  writeSave(s);
  return ITEMS.filter((i) => i.level > 1 && i.level > from && i.level <= level);
}

let painted = '';
/** Paint the equipped looks on the stage (skipped when nothing changed since the last paint). */
export function applyLooks(ctx: MetaContext | null = metaContext(), level = playerLevel()): void {
  if (!ctx) return;
  const looks = currentCosmetics(level);
  const key = JSON.stringify(looks);
  if (key === painted) return;
  painted = key;
  ctx.stage.setCosmetics?.(looks);
}

/** Forget what was painted (for tests that swap the game context). */
export function resetLooksMemo(): void {
  painted = '';
}
