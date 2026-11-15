// Written with AI assistance (Claude Code). See README "Use of AI tools".
// The three places a rover can explore, and the honest notes on how each map was made. No imports of three.js or
// the elevation grids here (those load only when a drive starts, in ./world.ts).
//
// REAL: surface gravity, Mars 3.71 m/s² and Moon 1.62 m/s² (NASA planetary fact sheets,
// https://nssdc.gsfc.nasa.gov/planetary/factsheet/marsfact.html and .../moonfact.html; the same numbers as
// GRAVITY in src/meta/flight/physics.ts). The Mars ground heights are real (see ./world.ts).
// GAME VALUES: the map scale, the vertical exaggeration and the rover's speed (said so in the Science notes).

export type RoverSite = 'gale' | 'arcadia' | 'moon';
export const SITES: readonly RoverSite[] = ['gale', 'arcadia', 'moon'];

export function isRoverSite(s: unknown): s is RoverSite {
  return s === 'gale' || s === 'arcadia' || s === 'moon';
}

/** Surface gravity, m/s². NASA planetary fact sheets. */
export const GRAVITY: Record<RoverSite, number> = { gale: 3.71, arcadia: 3.71, moon: 1.62 };

/** Mars maps: 1 meter in the game is MARS_SHRINK meters of real Mars, side to side. */
export const MARS_SHRINK = 100;
/** Mars maps: hills are this many times taller than real (after shrinking), the same as the base diorama (gale-info.ts). */
export const MARS_EXAGGERATION = 1.5;
/** The Moon map (made up, src/render/moon.ts) is drawn this many game meters per diorama unit. */
export const MOON_SCALE = 9;
/** How far from the charging pad the map reaches, game meters. */
export const WORLD_RADIUS = 900;
/** The rover is gently turned back past here. */
export const DRIVE_RADIUS = 840;

/**
 * Curiosity's top speed on flat, hard ground: about 4 cm/s (NASA, "Curiosity rover: quick facts",
 * https://science.nasa.gov/mission/msl-curiosity/). Shown in the Science notes; our rover is far faster.
 */
export const CURIOSITY_TOP_SPEED_CM_S = 4;

export interface SiteInfo {
  id: RoverSite;
  name: string;
  /** Short name for buttons and the tile. */
  short: string;
  world: 'mars' | 'moon';
  /** One line for the site picker. */
  blurb: string;
  /** Honest notes on how the map was made, for the Science notes on the start card. */
  notes: string[];
}

export const SITE_INFO: Record<RoverSite, SiteInfo> = {
  gale: {
    id: 'gale',
    name: 'Gale Crater, Mars',
    short: 'Gale Crater',
    world: 'mars',
    blurb: "Curiosity's crater. Mount Sharp rises to the south-east.",
    notes: [
      "The hills and the crater are real: heights from NASA's Mars Trek (MOLA and HRSC data), around Curiosity's landing site.",
      `The map is shrunk ${MARS_SHRINK} times side to side, and hills are ${MARS_EXAGGERATION} times taller than that, so you can see them. Small bumps and rocks are made up.`,
    ],
  },
  arcadia: {
    id: 'arcadia',
    name: 'Arcadia Planitia, Mars',
    short: 'Arcadia Planitia',
    world: 'mars',
    blurb: 'Flat, icy plains. Ice signs get stronger to the north.',
    notes: [
      "The ground is real: heights from NASA's Mars Trek. Arcadia really is this flat. Small bumps and rocks are made up.",
      "Ice targets are placed using NASA's SWIM ice maps: more of them to the north, where those maps show stronger signs of ice.",
      `The map is shrunk ${MARS_SHRINK} times side to side.`,
    ],
  },
  moon: {
    id: 'moon',
    name: 'Moon, near the south pole',
    short: 'the Moon',
    world: 'moon',
    blurb: 'Low gravity: bumps send you floating. Dark craters hide ice.',
    notes: [
      'This Moon map is made up, shaped like real cratered ground. It is not real map data.',
      'Near the south pole the Sun stays low, so crater floors are dark. Use your headlights.',
    ],
  },
};

/**
 * Dust devils are real on Mars: NASA's Spirit rover filmed them in Gusev Crater (2005) and Curiosity has filmed them in
 * Gale Crater (NASA JPL image releases). Their paths and push in the game are made up.
 */
export const DUST_DEVIL_NOTE = "Dust devils (spinning whirlwinds of dust) are real on Mars: NASA's Spirit and Curiosity rovers filmed them. Where they wander here is made up.";

/** Notes that are true for every site. */
export const SHARED_NOTES = [
  `Gravity is real: Mars pulls with ${GRAVITY.gale} m/s², the Moon with only ${GRAVITY.moon} m/s². That is why bumps send you floating on the Moon.`,
  `Real rovers are slow: Curiosity's top speed is about ${CURIOSITY_TOP_SPEED_CM_S} cm per second. Ours is much faster, so a trip fits in a few minutes.`,
  'Climbing uses more battery on Mars than on the Moon, because lifting the rover against stronger gravity takes more energy.',
];
