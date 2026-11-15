// Written with AI assistance (Claude Code). See README "Use of AI tools".
// Everything a rover can find: 20 kinds of sample across the three sites, each with a rarity and ONE short, true fact
// for the Sample Museum. The source of every fact is in the comment above it. Where a sample turns up on the map is
// a game choice (see `place`), except Arcadia's ice, which follows NASA's SWIM ice maps (./targets.ts).

import type { RoverSite } from './sites';

export type Rarity = 'common' | 'uncommon' | 'rare' | 'legendary';
export const RARITIES: readonly Rarity[] = ['common', 'uncommon', 'rare', 'legendary'];
export const RARITY_WORD: Record<Rarity, string> = { common: 'Common', uncommon: 'Uncommon', rare: 'Rare', legendary: 'Legendary' };
/** Pips shown next to the rarity word, so rarity never relies on color alone. */
export const RARITY_PIPS: Record<Rarity, number> = { common: 1, uncommon: 2, rare: 3, legendary: 4 };
/** XP for each sample of this rarity banked at the charging pad. */
export const RARITY_XP: Record<Rarity, number> = { common: 10, uncommon: 15, rare: 30, legendary: 60 };
/** Extra XP the first time a kind of sample goes into the Museum. */
export const NEW_ENTRY_XP = 20;
/** Beacon colors (also used on the minimap, always with a shape and the rarity word). */
export const RARITY_COLOR: Record<Rarity, string> = { common: '#f4ead8', uncommon: '#7ddc5a', rare: '#5ef2e6', legendary: '#ffd84a' };

/**
 * Where a sample tends to turn up:
 * - 'any': anywhere on the map;
 * - 'sector': within `spread` radians of the compass bearing `angle` (0 = north, 90 degrees = east). On these maps
 *   north is +z and east is -x (as in src/render/gale.ts), so a bearing b points to (x, z) = (-sin b, cos b);
 * - 'ice': Arcadia's ice, placed more often where SWIM shows stronger signs of ice (to the north);
 * - 'crater': on the floor of a crater (the Moon's shadowed ice and soil).
 */
export type Placement =
  | { kind: 'any' }
  | { kind: 'sector'; angle: number; spread: number }
  | { kind: 'ice' }
  | { kind: 'crater' };

export interface SampleKind {
  id: string;
  site: RoverSite;
  name: string;
  rarity: Rarity;
  /** One short, true fact (source in the comment above it). */
  fact: string;
  /** Rock color for the 3D target and the Museum icon. */
  color: string;
  /** A second color for the icon (veins, ice, layers). */
  accent: string;
  place: Placement;
  /** Distance from the charging pad, game meters [min, max]. */
  dist: [number, number];
}

/**
 * Toward Mount Sharp from Curiosity's landing site, on our map. Mount Sharp is south-east of the landing site
 * (NASA: https://science.nasa.gov/mission/msl-curiosity/); targets.test.ts checks this bearing climbs the real
 * Mars Trek heights in src/data/snapshots/gale-terrain.json.
 */
export const MOUNT_SHARP_BEARING = (150 * Math.PI) / 180;

const DEG = Math.PI / 180;

export const SAMPLE_KINDS: readonly SampleKind[] = [
  // ------------------------------------------------------------------ Gale Crater
  {
    id: 'gale-mudstone',
    site: 'gale',
    name: 'Lake mudstone',
    rarity: 'common',
    // NASA JPL, Dec 8 2014, "NASA's Curiosity Rover Finds Clues to How Water Helped Shape Martian Landscape";
    // Grotzinger et al. 2014, Science 343, "A Habitable Fluvio-Lacustrine Environment at Yellowknife Bay, Gale Crater".
    fact: 'This rock was once mud at the bottom of a lake. Curiosity found it, so we know Gale Crater held water long ago.',
    color: '#7a5a48',
    accent: '#a37f68',
    place: { kind: 'any' },
    dist: [110, 420],
  },
  {
    id: 'gale-veins',
    site: 'gale',
    name: 'White mineral veins',
    rarity: 'common',
    // Nachon et al. 2014, JGR Planets 119, "Calcium sulfate veins characterized by ChemCam/Curiosity at Gale crater, Mars".
    fact: 'Water once flowed through cracks in these rocks. It left white veins of calcium sulfate, a mineral like gypsum.',
    color: '#8a4a2c',
    accent: '#f4f0e6',
    place: { kind: 'any' },
    dist: [120, 520],
  },
  {
    id: 'gale-dune',
    site: 'gale',
    name: 'Dark dune sand',
    rarity: 'uncommon',
    // NASA JPL, Dec 2015, "NASA Mars Rover Curiosity Reaches Sand Dunes": the first up-close study of active sand
    // dunes anywhere other than Earth (the Bagnold Dunes, between the landing site and Mount Sharp).
    fact: 'Curiosity visited the Bagnold Dunes in 2015. It was the first close look at moving sand dunes on another planet.',
    color: '#3d3434',
    accent: '#5e5150',
    place: { kind: 'sector', angle: 170 * DEG, spread: 45 * DEG },
    dist: [110, 280],
  },
  {
    id: 'gale-layers',
    site: 'gale',
    name: 'Mount Sharp layered rock',
    rarity: 'uncommon',
    // NASA, Curiosity mission pages: Mount Sharp (Aeolis Mons) rises about 5 km (3 miles) from the floor of Gale
    // Crater and is built of sedimentary layers (https://science.nasa.gov/mission/msl-curiosity/).
    fact: 'Mount Sharp is a mountain of rock layers about 5 km tall. Each layer is like a page in the story of Mars.',
    color: '#b0704a',
    accent: '#e0a878',
    place: { kind: 'sector', angle: MOUNT_SHARP_BEARING, spread: 35 * DEG },
    dist: [230, 600],
  },
  {
    id: 'gale-hematite',
    site: 'gale',
    name: 'Vera Rubin Ridge hematite',
    rarity: 'rare',
    // NASA JPL, Jan 2018, "Curiosity Rover Finds Clues to Ridge's Formation" / Fraeman et al. 2020, JGR Planets 125:
    // Vera Rubin Ridge, on Mount Sharp's lower slope, is rich in hematite; Curiosity climbed it in 2017.
    fact: 'Vera Rubin Ridge is rich in hematite, an iron mineral that often forms with water. Curiosity climbed it in 2017.',
    color: '#5a2a2a',
    accent: '#9a3a3a',
    place: { kind: 'sector', angle: MOUNT_SHARP_BEARING, spread: 40 * DEG },
    dist: [180, 420],
  },
  {
    id: 'gale-clay',
    site: 'gale',
    name: 'Clay-rich rock',
    rarity: 'rare',
    // NASA JPL, May 29 2019, "Curiosity Tastes First Sample in 'Clay-Bearing Unit'": the highest amounts of clay
    // minerals ever found during the mission (Glen Torridon, on Mount Sharp).
    fact: 'Clay forms when rock sits in water for a long time. On Mount Sharp, Curiosity found the most clay of its whole trip.',
    color: '#8c6a50',
    accent: '#c9a27a',
    place: { kind: 'sector', angle: MOUNT_SHARP_BEARING, spread: 45 * DEG },
    dist: [260, 620],
  },
  {
    id: 'gale-meteorite',
    site: 'gale',
    name: 'Iron meteorite',
    rarity: 'rare',
    // NASA JPL, July 15 2014, PIA18387 "Curiosity Finds Iron Meteorite on Mars": the rock "Lebanon", about
    // 7 feet (2 meters) wide.
    fact: 'In 2014 Curiosity found "Lebanon", an iron meteorite about 2 meters wide, lying on Mars.',
    color: '#4a4a52',
    accent: '#a0a4b4',
    place: { kind: 'any' },
    dist: [150, 640],
  },
  {
    id: 'gale-organics',
    site: 'gale',
    name: 'Rock with ancient organics',
    rarity: 'legendary',
    // NASA, June 7 2018, "NASA Finds Ancient Organic Material, Mysterious Methane on Mars"; Eigenbrode et al. 2018,
    // Science 360, "Organic matter preserved in 3-billion-year-old mudstones at Gale crater, Mars".
    fact: 'In 2018 Curiosity found organic molecules in 3-billion-year-old rock. Life is made of them, but they can also form without life.',
    color: '#5c4a3a',
    accent: '#ffd84a',
    place: { kind: 'any' },
    dist: [200, 620],
  },

  // ------------------------------------------------------------------ Arcadia Planitia
  {
    id: 'arc-polygons',
    site: 'arcadia',
    name: 'Polygon ground',
    rarity: 'common',
    // NASA Phoenix Mars Lander image releases (2008): the polygon pattern is believed to be caused by seasonal
    // expansion and contraction of underground ice (https://www.nasa.gov/mission_pages/phoenix/).
    fact: 'The ground here cracks into polygon shapes. Ice under the surface swells and shrinks with the seasons and cracks it.',
    color: '#9a6248',
    accent: '#d8c8bc',
    place: { kind: 'any' },
    dist: [110, 520],
  },
  {
    id: 'arc-basalt',
    site: 'arcadia',
    name: 'Dark basalt',
    rarity: 'common',
    // McSween et al. 2009, Science 324, "Elemental Composition of the Martian Crust": the crust is mostly basalt.
    fact: 'Basalt is rock made from cooled lava. Most of the outside of Mars is basalt.',
    color: '#3e3638',
    accent: '#6a5c5c',
    place: { kind: 'any' },
    dist: [120, 600],
  },
  {
    id: 'arc-ice',
    site: 'arcadia',
    name: 'Shallow water ice',
    rarity: 'uncommon',
    // src/data/snapshots/swim-ice.json: SWIM 2.0 ice consistency for the top 1 m (c0_1) is 0.54 around our site
    // (+1 = consistent with ice), rising from 0.31 at 44 N to 0.64 at 48 N. Morgan et al. 2021, Nature Astronomy 5.
    fact: "NASA's SWIM project compared many orbiter maps. Here they agree ice is likely in the top meter of ground, more so to the north.",
    color: '#c8d4dc',
    accent: '#ffffff',
    place: { kind: 'ice' },
    dist: [120, 640],
  },
  {
    id: 'arc-crater-ice',
    site: 'arcadia',
    name: 'Ice from a fresh crater',
    rarity: 'rare',
    // NASA JPL, Sept 24 2009, "NASA Spacecraft Sees Ice on Mars Exposed by Meteor Impacts"; Byrne et al. 2009,
    // Science 325: new craters in the northern mid-latitudes exposed bright ice, photographed by MRO.
    fact: 'When small space rocks hit these northern plains, some new craters showed bright, clean ice under the dust. A NASA orbiter saw it.',
    color: '#b8c4cc',
    accent: '#eaf6ff',
    place: { kind: 'ice' },
    dist: [200, 660],
  },
  {
    id: 'arc-phoenix',
    site: 'arcadia',
    name: 'Vanishing ice chip',
    rarity: 'rare',
    // NASA JPL, June 19 2008, "Bright Chunks at Phoenix Lander's Mars Site Must Have Been Ice": dice-size crumbs in
    // a trench vanished over four days (Phoenix landed in Mars' far north, at about 68 N).
    fact: "In 2008 the Phoenix lander dug up bright bits of ice in Mars' far north. Over four days they faded away into the air.",
    color: '#d6e2ea',
    accent: '#ffffff',
    place: { kind: 'ice' },
    dist: [150, 600],
  },
  {
    id: 'arc-thick-ice',
    site: 'arcadia',
    name: 'Thick buried ice',
    rarity: 'legendary',
    // Bramson et al. 2015, Geophysical Research Letters 42, "Widespread excess ice in Arcadia Planitia, Mars"
    // (SHARAD radar on NASA's Mars Reconnaissance Orbiter plus terraced craters: ice tens of meters thick).
    fact: 'Radar on a NASA orbiter, and the shapes of craters, show buried ice under Arcadia. In places it is tens of meters thick.',
    color: '#a8bccc',
    accent: '#ffd84a',
    place: { kind: 'ice' },
    dist: [260, 660],
  },

  // ------------------------------------------------------------------ Moon, near the south pole
  {
    id: 'moon-regolith',
    site: 'moon',
    name: 'Regolith',
    rarity: 'common',
    // NASA Moon facts (https://science.nasa.gov/moon/facts/): the surface is covered in regolith, broken rock and
    // dust made by billions of years of impacts.
    fact: 'The Moon is covered in regolith: dust and broken rock made by billions of years of space rock hits.',
    color: '#8d8b87',
    accent: '#b4b2ac',
    place: { kind: 'any' },
    dist: [110, 520],
  },
  {
    id: 'moon-glass',
    site: 'moon',
    name: 'Impact glass beads',
    rarity: 'common',
    // Heiken, Vaniman & French (eds.) 1991, "Lunar Sourcebook", ch. 7: impact melt makes glass beads and glassy
    // agglutinates, a large part of lunar soil.
    fact: 'Space rocks hit the Moon so fast that they melt rock. Moon dust is full of tiny glass beads made this way.',
    color: '#5e5c5a',
    accent: '#9fc2a8',
    place: { kind: 'any' },
    dist: [120, 600],
  },
  {
    id: 'moon-anorthosite',
    site: 'moon',
    name: 'Anorthosite',
    rarity: 'uncommon',
    // NASA, Apollo 15 sample 15415 ("Genesis Rock"), anorthosite from the Moon's early crust
    // (https://curator.jsc.nasa.gov/lunar/ and the Lunar Sample Compendium).
    fact: "The Moon's bright highlands are anorthosite, a pale rock from its first crust. Apollo 15 brought home a piece called the Genesis Rock.",
    color: '#d6d4cc',
    accent: '#ffffff',
    place: { kind: 'any' },
    dist: [150, 640],
  },
  {
    id: 'moon-breccia',
    site: 'moon',
    name: 'Breccia',
    rarity: 'uncommon',
    // NASA Lunar Sample Compendium (https://curator.jsc.nasa.gov/lunar/lsc/): breccias are rocks of broken pieces
    // welded by impacts, and are common among the Apollo samples.
    fact: 'Breccia is rock made of broken pieces, glued together by the heat and push of impacts. Apollo crews brought back lots of it.',
    color: '#6e6c68',
    accent: '#c4c2bc',
    place: { kind: 'any' },
    dist: [130, 620],
  },
  {
    id: 'moon-shadow-soil',
    site: 'moon',
    name: 'Super-cold crater soil',
    rarity: 'rare',
    // NASA LRO Diviner results; NASA, "The Moon's South Pole Is Full of Mystery, Science, and Intrigue"
    // (https://www.nasa.gov/humans-in-space/moons-south-pole-is-full-of-mystery-science-intrigue/): permanently
    // shadowed craters near the south pole reach about -203 °C (the same page the Science Log cites).
    fact: 'Some crater floors near the south pole never get sunlight. They stay colder than minus 200 degrees Celsius.',
    color: '#3c3c44',
    accent: '#8fd3ff',
    place: { kind: 'crater' },
    dist: [150, 700],
  },
  {
    id: 'moon-ice',
    site: 'moon',
    name: 'Shadowed crater ice',
    rarity: 'legendary',
    // NASA, Nov 13 2009, "LCROSS Impact Data Indicates Water on Moon"; Colaprete et al. 2010, Science 330:
    // water ice in the plume from Cabeus, a permanently shadowed crater near the south pole.
    fact: "In 2009 NASA's LCROSS probe crashed into Cabeus, a dark crater near the south pole, and found water ice in the dust it threw up.",
    color: '#9cb4c8',
    accent: '#ffd84a',
    place: { kind: 'crater' },
    dist: [150, 700],
  },
];

const BY_ID = new Map(SAMPLE_KINDS.map((k) => [k.id, k]));

export function sampleKind(id: string): SampleKind | undefined {
  return BY_ID.get(id);
}

export function kindsAt(site: RoverSite): SampleKind[] {
  return SAMPLE_KINDS.filter((k) => k.site === site);
}
