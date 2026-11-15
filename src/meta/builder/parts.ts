// Written with AI assistance (Claude Code). See README "Use of AI tools".
// Outpost Architect: every part a player can place on the build pad. Working parts echo the game's own modules
// (src/render/diorama.ts) and use the game's own numbers (src/sim) through ./engineering.ts. Decor is just for
// looks and uses no power.
//
// BUILDER VALUES (design rules for this mode, not facts about real bases; the readout labels them as game rules):
// - a Habitat has 2 crew beds and a Storm shelter fits 4 crew, so bigger crews need more buildings;
// - each extra building to heat needs 1 more heater cell (the game's own rule for its second greenhouse dome:
//   "One more building to heat: heaters need 1 extra cell every night", src/sim/upgrades.ts).

export type PartId =
  | 'solar'
  | 'battery'
  | 'reactor'
  | 'habitat'
  | 'o2'
  | 'bigo2'
  | 'greenhouse'
  | 'heater'
  | 'shelter'
  | 'berm'
  | 'monitor'
  | 'rocket'
  | 'workshop'
  | 'garage'
  | 'path'
  | 'lamp'
  | 'antenna'
  | 'flag'
  | 'statue'
  | 'planter';

export type Category = 'power' | 'life' | 'safety' | 'rocket' | 'decor';

export interface PartDef {
  id: PartId;
  name: string;
  /** One short line for ages 7-12: what it does. */
  blurb: string;
  /** Footprint in grid squares before rotation (w along x, d along z). */
  w: number;
  d: number;
  cat: Category;
  /** Swatch color for the palette (the game's palette). */
  color: string;
  /** Most of this part on one pad. */
  max?: number;
}

/** Crew beds in one Habitat (builder value). */
export const BEDS_PER_HABITAT = 2;
/** Crew one Storm shelter fits (builder value). */
export const SHELTER_SEATS = 4;

export const PARTS: Record<PartId, PartDef> = {
  solar: { id: 'solar', name: 'Solar panel', blurb: 'Makes 1 power cell on a sunny sol. Dust and night dim it.', w: 1, d: 2, cat: 'power', color: '#26386e' },
  battery: { id: 'battery', name: 'Battery bank', blurb: 'Saves power for later: for the night, or for a dusty day.', w: 1, d: 1, cat: 'power', color: '#c9c2b4' },
  reactor: { id: 'reactor', name: 'Fission reactor', blurb: 'Makes 3 cells day and night, even in dust storms.', w: 2, d: 2, cat: 'power', color: '#5ef2e6', max: 2 },
  habitat: { id: 'habitat', name: 'Habitat', blurb: `Home for the crew: ${BEDS_PER_HABITAT} beds. Needs heat.`, w: 2, d: 2, cat: 'life', color: '#e9e3d6' },
  o2: { id: 'o2', name: 'O2 plant', blurb: 'Makes AIR for the crew or FUEL for the rocket. Same machine, two jobs.', w: 2, d: 1, cat: 'life', color: '#9aa0b5' },
  bigo2: { id: 'bigo2', name: 'Big O2 plant', blurb: 'Like the O2 plant, but 50% more oxygen per cell.', w: 2, d: 2, cat: 'life', color: '#b8bdd0' },
  greenhouse: { id: 'greenhouse', name: 'Greenhouse', blurb: 'Grows food (and a little air) under grow lights.', w: 2, d: 2, cat: 'life', color: '#7ddc5a' },
  heater: { id: 'heater', name: 'Heater', blurb: 'Keeps buildings and batteries warm at night.', w: 1, d: 1, cat: 'life', color: '#e8742a' },
  shelter: { id: 'shelter', name: 'Storm shelter', blurb: `Blocks solar storm radiation when powered. Fits ${SHELTER_SEATS} crew.`, w: 2, d: 1, cat: 'safety', color: '#6e3418' },
  berm: { id: 'berm', name: 'Regolith berm', blurb: 'A soil pile. Put it next to a shelter: 1 cell then blocks 90%.', w: 2, d: 1, cat: 'safety', color: '#7d3d1c' },
  monitor: { id: 'monitor', name: 'Sun watcher', blurb: 'Radiation monitor: warns you about fast storms in time to shelter.', w: 1, d: 1, cat: 'safety', color: '#c58bff' },
  rocket: { id: 'rocket', name: 'Rocket and pad', blurb: 'Your ride home. The O2 plant fills its tank. Keep 1 square clear around it.', w: 2, d: 2, cat: 'rocket', color: '#f4f0e6', max: 1 },
  workshop: { id: 'workshop', name: 'Workshop', blurb: 'Where the crew builds upgrades for the next crew.', w: 2, d: 1, cat: 'rocket', color: '#c9c2b4', max: 2 },
  garage: { id: 'garage', name: 'Rover garage', blurb: 'A home for the rover that explores the ground near the base.', w: 2, d: 2, cat: 'rocket', color: '#ffb627', max: 2 },
  path: { id: 'path', name: 'Path', blurb: 'Decor: a walkway for the crew.', w: 1, d: 1, cat: 'decor', color: '#a89070' },
  lamp: { id: 'lamp', name: 'Light post', blurb: 'Decor: a little light for the night.', w: 1, d: 1, cat: 'decor', color: '#ffb627' },
  antenna: { id: 'antenna', name: 'Antenna', blurb: 'Decor: a tall radio mast.', w: 1, d: 1, cat: 'decor', color: '#9aa0b5' },
  flag: { id: 'flag', name: 'Base flag', blurb: 'Decor: your own flag. Pick it, then press Flag design to change it.', w: 1, d: 1, cat: 'decor', color: '#ff6bd6' },
  statue: { id: 'statue', name: 'Astronaut statue', blurb: 'Decor: a statue to honor your crews.', w: 1, d: 1, cat: 'decor', color: '#ffd84a' },
  planter: { id: 'planter', name: 'Planter', blurb: 'Decor: a little box of plants.', w: 1, d: 1, cat: 'decor', color: '#3f8f3a' },
};

export const PART_IDS = Object.keys(PARTS) as PartId[];

export const CATEGORIES: Array<{ id: Category; name: string }> = [
  { id: 'power', name: 'Power' },
  { id: 'life', name: 'Life' },
  { id: 'safety', name: 'Safety' },
  { id: 'rocket', name: 'Rocket and more' },
  { id: 'decor', name: 'Decor' },
];

/** Parts you can use from the start. The rest unlock by finishing blueprint challenges (see ./challenges.ts). */
export const STARTER_PARTS: readonly PartId[] = ['solar', 'battery', 'habitat', 'o2', 'greenhouse', 'heater', 'shelter', 'monitor', 'rocket', 'path'];

export function isPartId(x: unknown): x is PartId {
  return typeof x === 'string' && Object.prototype.hasOwnProperty.call(PARTS, x);
}

/** Flag designs a kid can pick (shapes and colors only: no national or agency flags). */
export const FLAG_DESIGNS: Array<{ name: string; field: string; mark: string; shape: 'star' | 'rocket' | 'planet' | 'stripes' | 'moon' | 'bolt' }> = [
  { name: 'Star', field: '#2e2654', mark: '#ffd84a', shape: 'star' },
  { name: 'Rocket', field: '#5ef2e6', mark: '#15122b', shape: 'rocket' },
  { name: 'Ringed planet', field: '#ff6bd6', mark: '#f4f0e6', shape: 'planet' },
  { name: 'Stripes', field: '#ffb627', mark: '#c2562a', shape: 'stripes' },
  { name: 'Crescent', field: '#26386e', mark: '#f4f0e6', shape: 'moon' },
  { name: 'Lightning', field: '#7ddc5a', mark: '#15122b', shape: 'bolt' },
];
