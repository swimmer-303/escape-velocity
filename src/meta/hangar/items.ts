// Written with AI assistance (Claude Code). See README "Use of AI tools".
// Everything in the Hangar and the Astronaut level that unlocks it. Something new unlocks at every level
// from 2 to 30, so the next reward is always close, then a few big ones: a glow-in-the-dark suit (35),
// the gold rocket (40), a gold pet (45) and the Legend suit (50). Earned by playing, never bought.

import type { Cosmetics } from '../../render/stage';

export type Slot = 'suit' | 'rocket' | 'pet' | 'lights';
export const SLOTS: Slot[] = ['suit', 'rocket', 'pet', 'lights'];

interface Base {
  id: string;
  /** Short name, as on the tile: 'Cyan'. */
  name: string;
  /** The Astronaut level that unlocks it (1 = from the start). */
  level: number;
  /** A true, kid-sized science fact, shown when it is equipped. */
  fact?: string;
}
export type HangarItem =
  | (Base & { slot: 'suit'; look: Cosmetics['suit'] })
  | (Base & { slot: 'rocket'; look: Cosmetics['rocket'] })
  | (Base & { slot: 'pet'; look: Cosmetics['pet'] })
  | (Base & { slot: 'lights'; look: string });
export type ItemOf<S extends Slot> = Extract<HangarItem, { slot: S }>;
/** One item per section. */
export type Equipped = { [S in Slot]: ItemOf<S> };

/** Words for each section: the tab, the reward kind on the level-up screen, the toast. */
export const SLOT_WORDS: Record<Slot, { tab: string; kind: string; unlocked: string; noun: string }> = {
  suit: { tab: 'Suits', kind: 'Suit color', unlocked: 'New suit color unlocked', noun: 'suit' },
  rocket: { tab: 'Rocket', kind: 'Rocket paint', unlocked: 'New rocket paint unlocked', noun: 'rocket paint' },
  pet: { tab: 'Pet', kind: 'Rover pet', unlocked: 'New rover pet unlocked', noun: 'rover pet' },
  lights: { tab: 'Lights', kind: 'Base lights', unlocked: 'New base lights unlocked', noun: 'base lights' },
};

const TRIM = '#c9c2b4';
const suit = (id: string, name: string, level: number, body: string, trim = TRIM, extra: Partial<Cosmetics['suit']> & { fact?: string } = {}): HangarItem => {
  const { fact, ...rest } = extra;
  return { id: `suit-${id}`, slot: 'suit', name, level, fact, look: { body, trim, ...rest } };
};
const rocket = (id: string, name: string, level: number, look: Cosmetics['rocket'], fact?: string): HangarItem => ({ id: `rocket-${id}`, slot: 'rocket', name, level, fact, look });
const pet = (id: string, name: string, level: number, look: Cosmetics['pet'], fact?: string): HangarItem => ({ id: `pet-${id}`, slot: 'pet', name, level, fact, look });
const lights = (id: string, name: string, level: number, color: string): HangarItem => ({ id: `lights-${id}`, slot: 'lights', name, level, look: color });

/** The whole catalog, in the order the tiles appear (by level within each section). */
export const ITEMS: HangarItem[] = [
  // Suits.
  suit('white', 'White', 1, '#f4f0e6', TRIM, { fact: 'Real spacewalk suits are white. White reflects sunlight, so the astronaut inside stays cooler.' }),
  suit('orange', 'Orange', 1, '#e8742a', TRIM, { fact: 'Crews wear bright orange suits for launch and landing: orange is easy to spot from far away.' }),
  suit('cyan', 'Cyan', 2, '#5ef2e6', '#1f6f6a'),
  suit('lime', 'Lime', 6, '#9be04a', '#3f7a24'),
  suit('purple', 'Purple', 8, '#a065e0', '#4f2d7a'),
  suit('pink', 'Bubblegum', 11, '#ff8ccf', '#b04a8a'),
  suit('red', 'Red', 13, '#e0402f', '#7a1f17'),
  suit('comet', 'Comet', 16, '#2b3f8f', '#ff9a3c'),
  suit('sky', 'Sky Blue', 21, '#8fd3ff', '#3d6f9e'),
  suit('lava', 'Lava', 24, '#3b3340', '#ff5a2a'),
  suit('gold', 'Gold', 27, '#ffcf4a', '#a8741a'),
  suit('glow', 'Glow', 35, '#b8ffb0', '#2f8f4a', { glow: true }),
  suit('legend', 'Legend', 50, '#ffd34d', '#7a3cff', { glow: true }),
  // Rocket paint.
  rocket('classic', 'Classic', 1, { pattern: 'solid', colors: ['#f4f0e6'], fins: '#b2552a' }),
  rocket('stripes', 'Candy Stripes', 3, { pattern: 'stripes', colors: ['#f4f0e6', '#e0402f'], fins: '#e0402f' }),
  rocket(
    'checkers',
    'Checkers',
    7,
    { pattern: 'checker', colors: ['#f4f0e6', '#1c1c24'], fins: '#1c1c24' },
    'Some early rockets were painted in black and white checks, so cameras on the ground could see if they were rolling.',
  ),
  rocket('sunset', 'Sunset', 10, { pattern: 'gradient', colors: ['#ffd34d', '#ff9a3c', '#ff5a6e', '#a14fd0', '#3b2a8f'], fins: '#3b2a8f' }),
  rocket('flames', 'Flames', 14, { pattern: 'flames', colors: ['#1c1c24', '#ff7a1a', '#ffd34d'], fins: '#ff7a1a' }),
  rocket(
    'mars-red',
    'Mars Red',
    17,
    { pattern: 'solid', colors: ['#b2452a'], fins: '#f4f0e6', nose: '#f4f0e6' },
    'Mars looks red because its dust has a lot of iron oxide in it. That is rust!',
  ),
  rocket('dots', 'Polka Dots', 19, { pattern: 'dots', colors: ['#5ef2e6', '#ff8ccf'], fins: '#ff8ccf' }),
  rocket('galaxy', 'Galaxy', 22, { pattern: 'stars', colors: ['#1d1450', '#ffffff', '#c58bff'], fins: '#c58bff' }),
  rocket('rainbow', 'Rainbow', 25, { pattern: 'stripes', colors: ['#e0402f', '#ff9a3c', '#ffd34d', '#7ddc5a', '#5ec8f2', '#a065e0'], fins: '#f4f0e6', nose: '#f4f0e6' }),
  rocket('lightning', 'Lightning', 28, { pattern: 'bolt', colors: ['#2b3f8f', '#ffd34d'], fins: '#ffd34d' }),
  rocket(
    'gold',
    'Gold',
    40,
    { pattern: 'solid', colors: ['#e8b832'], fins: '#a8741a', nose: '#ffd34d', shiny: true },
    'Shiny gold-colored foil wraps lots of spacecraft. It bounces heat away to keep the inside at the right temperature.',
  ),
  // Rover pets.
  pet('none', 'No pet', 1, null),
  pet('bolt', 'Bolt', 4, { body: '#f4f0e6', trim: '#4a4f63', eyes: '#5ef2e6' }, 'Real Mars rovers are driven by teams on Earth. Messages take minutes to get there, so rovers drive slowly and carefully.'),
  pet('dusty', 'Dusty', 12, { body: '#c2562a', trim: '#6e3418', eyes: '#ffd34d' }),
  pet('sparky', 'Sparky', 20, { body: '#5ef2e6', trim: '#1f6f6a', eyes: '#ffffff', glow: true }),
  pet('moonbeam', 'Moonbeam', 30, { body: '#c9ccd6', trim: '#5d5d60', eyes: '#c58bff' }),
  pet('champ', 'Champ', 45, { body: '#ffcf4a', trim: '#7a3cff', eyes: '#ff8ccf', glow: true }),
  // Base lights.
  lights('amber', 'Amber', 1, '#ffb627'),
  lights('cyan', 'Cyan', 5, '#5ef2e6'),
  lights('green', 'Green', 9, '#7ddc5a'),
  lights('pink', 'Pink', 15, '#ff6fcf'),
  lights('violet', 'Violet', 18, '#b06bff'),
  lights('moonlight', 'Moonlight', 23, '#e8f0ff'),
  lights('ruby', 'Ruby', 26, '#ff3b4f'),
  lights('sunny', 'Sunny', 29, '#fff04a'),
];

/** What everyone starts with. */
export const DEFAULTS: Record<Slot, string> = { suit: 'suit-white', rocket: 'rocket-classic', pet: 'pet-none', lights: 'lights-amber' };

const BY_ID = new Map(ITEMS.map((i) => [i.id, i]));
export function itemById(id: string): HangarItem | undefined {
  return BY_ID.get(id);
}

export function itemsIn(slot: Slot): HangarItem[] {
  return ITEMS.filter((i) => i.slot === slot);
}

export function isUnlocked(item: HangarItem, level: number): boolean {
  return item.level <= level;
}

/** A name that stands on its own: 'Cyan suit', 'Checkers rocket paint', 'Bolt the rover pet', 'Pink base lights'. */
export function fullName(item: HangarItem): string {
  if (item.slot === 'pet') return item.look ? `${item.name} the rover pet` : 'No pet';
  return `${item.name} ${SLOT_WORDS[item.slot].noun}`;
}

/** The next thing to unlock above `level` (null when everything is unlocked). */
export function nextUnlock(level: number): HangarItem | null {
  let best: HangarItem | null = null;
  for (const i of ITEMS) if (i.level > level && (!best || i.level < best.level)) best = i;
  return best;
}

/** What the stage paints for a set of equipped items. */
export function cosmeticsOf(eq: Equipped): Cosmetics {
  return { suit: eq.suit.look, rocket: eq.rocket.look, pet: eq.pet.look, lights: eq.lights.look };
}
