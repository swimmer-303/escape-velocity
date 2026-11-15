// Written with AI assistance (Claude Code). See README "Use of AI tools".
// "From Mars to Earth": the same ideas that keep a Mars crew alive (grow food with less, recycle
// every drop of water, store clean power) already improve lives and protect the environment on
// Earth. Every claim below comes from a NASA Spinoff article (checked 2026-11-14).

export interface EarthLink {
  id: 'farm' | 'water' | 'battery';
  mars: string;
  /** The same line for a Moon base, when the Mars one does not fit there. */
  moon?: string;
  earth: string;
  source: string;
  url: string;
}

export const EARTH_LINKS: EarthLink[] = [
  {
    id: 'farm',
    mars: 'Your greenhouse grew food under lights, with no soil and very little water.',
    earth:
      'NASA built the first vertical farm in the United States while learning to grow food for space. Indoor farms now use that research to grow food in cities with less water and no soil.',
    source: 'NASA Spinoff: NASA Research Launches a New Generation of Indoor Farming (2021)',
    url: 'https://www.nasa.gov/technology/tech-transfer-spinoffs/nasa-research-launches-a-new-generation-of-indoor-farming/',
  },
  {
    id: 'water',
    mars: 'Your crew could not waste a drop: air and water were too precious to throw away.',
    earth:
      'On the space station, sweat, urine and even breath moisture are cleaned and recycled into drinking water. Filter technology NASA helped develop led to a shower that recycles its own water, and to filters that bring clean water to remote villages.',
    source: 'NASA Spinoff: Space-Age Water Conservation',
    url: 'https://spinoff.nasa.gov/page/space-age-water-conservation-nasa',
  },
  {
    id: 'battery',
    mars: 'You saved solar power for the dark and stormy days.',
    moon: 'You saved solar power for the long, dark lunar night.',
    earth:
      'NASA invented a giant "flow battery" in the 1970s to store power in space. A company built on that research now stores solar power in a microgrid that keeps important community buildings running when the power goes out.',
    source: 'NASA Spinoff: Giant Batteries Deliver Renewable Energy When It’s Needed',
    url: 'https://spinoff.nasa.gov/Giant-Batteries-Deliver-Renewable-Energy',
  },
];
