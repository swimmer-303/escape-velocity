// Written with AI assistance (Claude Code). See README "Use of AI tools".
// The Science Log: every dataset, what it does in the game, live vs. archived status,
// and exactly how the game scales real numbers. This is how players and judges can check our science.

import { h } from './dom';
import { REAL, TUNING, RATES, STORM_DOSE, DUST_LOSS, EXPEDITIONS, PREFILL_MAX_PCT, type Difficulty } from '../sim/constants';
import type { SpaceWeatherFeed } from '../data/donki';
import { MAY2024_SNAPSHOT, countByClass } from '../data/donki';
import type { LightTime } from '../data/lighttime';
import { OSDR_CARDS } from '../data/osdr';
import { RADLAB_ISS, RADLAB_ISS_MAY2024 } from '../data/radlab';
import { GALE_EXAGGERATION, GALE_PRODUCT, GALE_PRODUCT_URL } from '../render/gale-info';

interface Ctx {
  feed: SpaceWeatherFeed;
  light: LightTime;
  difficulty: Difficulty;
}

const link = (href: string, text: string) => h('a', { href, target: '_blank', rel: 'noopener' }, text);
const tag = (kind: 'live' | 'archive' | 'real' | 'game', text: string) => h('span', { class: `tag ${kind}` }, text);
const day = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'unknown';

export function renderScienceLog(ctx: Ctx): HTMLElement[] {
  const { feed, light } = ctx;
  const t = TUNING[ctx.difficulty];
  const counts = feed.snapshot ? countByClass(feed.snapshot) : null;
  const donkiStatus =
    feed.status === 'live'
      ? [tag('live', 'LIVE'), ` Fetched ${day(feed.fetchedAt)} (${feed.via === 'proxy' ? 'through our cached server' : 'directly from NASA'}).`]
      : feed.status === 'archive'
        ? [tag('archive', 'ARCHIVE'), ` Live fetch was unavailable, so we use a stored snapshot taken ${day(feed.fetchedAt)}. It is real data, just not from right now.`]
        : [tag('archive', 'UNAVAILABLE'), ' No space-weather data could be loaded.'];

  const rows: Array<[string, (Node | string)[], (Node | string)[], (Node | string)[]]> = [
    [
      'NASA DONKI: solar flares and particle storms',
      [
        'Every solar storm in your mission is a real event from DONKI. Flare class sets the storm size: C = small, M = medium, X = big. ',
        counts ? `Window ${feed.snapshot!.startDate} to ${feed.snapshot!.endDate}: ${counts.X} X, ${counts.M} M, ${counts.C} C flares; ${counts.sep} particle-storm records. ` : '',
        'If the current window has no big (X-class) flares, the game deals in archived X-class flares from May 2024, and those cards say ARCHIVE.',
      ],
      donkiStatus,
      [link('https://ccmc.gsfc.nasa.gov/tools/DONKI/', 'ccmc.gsfc.nasa.gov/tools/DONKI')],
    ],
    [
      'NASA DONKI: May 2024 storms (Replay History)',
      [
        'The real sequence: sunspot region 13664 fired X-class flares toward Earth (May 8 to 15), Earth had a Kp 9 geomagnetic storm on May 10, and on May 20 a CME DONKI clocked at 2,678 km/s left the far side of the Sun, which was facing Mars.',
      ],
      MAY2024_SNAPSHOT ? [tag('archive', 'ARCHIVE'), ` Snapshot taken ${day(MAY2024_SNAPSHOT.fetchedAt)}.`] : ['Not available'],
      [link('https://ccmc.gsfc.nasa.gov/DONKI/view/CME/31034/-1', 'May 20, 2024 CME record')],
    ],
    [
      'NASA Solar Dynamics Observatory (SDO): the Sun right now',
      [
        "The picture of the Sun on the title screen and in each morning briefing is real NASA imagery, not AI-generated. It comes from SDO's AIA camera at 171 angstroms: extreme ultraviolet light our eyes cannot see, which NASA colors gold. It shows glowing loops over busy sunspot regions, where flares come from. NASA adds a new picture about every 10 minutes. Next to it: the latest flare in the DONKI data above.",
      ],
      [tag('live', 'LIVE'), " Loaded from NASA when you open the game, through our server (which keeps a copy for up to 10 minutes) or straight from NASA. When our server knows the time SDO took the picture, the game shows it. If the picture can't be loaded, the game hides it."],
      [link('https://sdo.gsfc.nasa.gov/', 'sdo.gsfc.nasa.gov'), ' · ', link('https://svs.gsfc.nasa.gov/3980', 'NASA SVS: what 171 angstroms shows')],
    ],
    [
      'JPL planetary orbital elements: message delay',
      [
        `Messages from Earth take about ${light.oneWayMinutes.toFixed(1)} minutes to reach Mars today (distance ${light.distanceAU.toFixed(2)} AU, ${Math.round(light.distanceKm / 1e6)} million km). We calculate this in your browser from JPL's published orbital elements, so it is approximate. Checked against JPL Horizons on Nov 14, 2026: 11.01 min, an exact match to 2 decimals.`,
      ],
      [tag('live', 'CALCULATED NOW')],
      [link('https://ssd.jpl.nasa.gov/planets/approx_pos.html', 'ssd.jpl.nasa.gov approximate positions'), ' · ', link('https://ssd.jpl.nasa.gov/horizons/', 'JPL Horizons')],
    ],
    [
      'Curiosity RAD: radiation on Mars',
      [
        `Every sol adds ${REAL.marsSurfaceMsvPerDay} mSv to your crew's dose: the real average Curiosity measured at Gale Crater. The May 20, 2024 storm (${REAL.may2024EventUgy.toLocaleString('en-US')} micrograys, about ${REAL.may2024EventChestXrays} chest X-rays) is the model for a "big" storm.`,
      ],
      [tag('real', 'PUBLISHED FIGURE')],
      [link('https://doi.org/10.1126/science.1244797', 'Hassler et al., Science 2014'), ' · ', link('https://www.jpl.nasa.gov/news/nasa-watches-mars-light-up-during-epic-solar-storm/', 'NASA/JPL, June 2024')],
    ],
    [
      'OSDR RadLab: radiation on the ISS',
      [
        RADLAB_ISS
          ? `Astronauts on the ISS: the DOSTEL detector in the Columbus module averaged about ${Math.round(RADLAB_ISS.meanDoseRatePerDay)} micrograys per day (${RADLAB_ISS.startDate} to ${RADLAB_ISS.endDate}). `
          : 'ISS dose readings. ',
        RADLAB_ISS_MAY2024 ? `During May 2024: ${Math.round(RADLAB_ISS_MAY2024.meanDoseRatePerDay)} micrograys per day. ` : '',
        'Shown on the end screen to compare Mars with the ISS. These are absorbed doses (grays), a different unit from the sieverts in your dose meter.',
      ],
      [tag('archive', 'ARCHIVE'), ` Fetched ${day(RADLAB_ISS?.fetchedAt)}. RadLab's ISS series ends in late 2024.`],
      [link('https://visualization.osdr.nasa.gov/radlab/gui/data-api/', 'RadLab data API')],
    ],
    [
      'OSDR: space biology studies',
      [
        `${OSDR_CARDS.length} real studies appear as Real Science cards: `,
        OSDR_CARDS.map((c) => c.osdId).join(', '),
        '. Plant studies go with the greenhouse, radiation studies with the shelter, and bone and muscle studies with your crew.',
      ],
      [tag('archive', 'ARCHIVE'), ' Picked from the OSDR search API at build time.'],
      [link('https://osdr.nasa.gov/bio/repo/', 'osdr.nasa.gov')],
    ],
    [
      'MOXIE (Perseverance): oxygen from Mars air',
      [
        `MOXIE made ${REAL.moxieTotalO2g} g of oxygen over ${REAL.moxieRuns} runs, at best ${REAL.moxiePeakGPerHour} g per hour. Your O2 plant is a scaled-up MOXIE: each cell on AIR makes 1 day of air for 4 people (about ${(REAL.o2PerCrewKgPerDay * REAL.crewSize).toFixed(1)} kg).`,
      ],
      [tag('real', 'PUBLISHED FIGURE')],
      [link('https://www.nasa.gov/missions/mars-2020-perseverance/nasas-oxygen-generating-experiment-moxie-completes-mars-mission/', 'NASA MOXIE'), ' · ', link('https://pds-atmospheres.nmsu.edu/data_and_services/atmospheres_data/PERSEVERANCE/moxie.html', 'NASA PDS')],
    ],
    [
      'NASA life support baseline (BVAD): how much air a crew needs',
      [`Each person uses about ${REAL.o2PerCrewKgPerDay} kg of oxygen per day (nominal value).`],
      [tag('real', 'PUBLISHED FIGURE')],
      [link('https://ntrs.nasa.gov/citations/20210024855', 'BVAD Rev 2 (2022)')],
    ],
    [
      'Opportunity rover: dust storms and solar power',
      [
        `Real storms cut Opportunity's power from about ${REAL.oppyNormalWh} Wh/day to ${REAL.oppy2007StormWh} Wh (2007) and ${REAL.oppy2018StormWh} Wh (2018). The game's storms dim your solar panels by ${Math.round(DUST_LOSS.dusty * 100)}% or ${Math.round(DUST_LOSS.storm * 100)}%: gentler than real life, so your mission can survive. A fission reactor upgrade is not affected by dust.`,
      ],
      [tag('real', 'PUBLISHED FIGURE')],
      [link('https://www.jpl.nasa.gov/news/nasa-mars-rovers-braving-severe-dust-storms', 'NASA/JPL 2007'), ' · ', link('https://www.planetary.org/articles/06-mer-update-opportunity-dust-storm-sleep', 'Planetary Society 2018')],
    ],
    [
      'NASA Mars Trek: Gale Crater terrain',
      [
        `Terrain: NASA Mars Trek, ${GALE_PRODUCT}, Gale Crater; horizontal scale compressed, height exaggerated ×${GALE_EXAGGERATION}. `,
        'Your base sits where Curiosity landed (Bradbury Landing). The crater wall and Mount Sharp around it are built from real heights measured from orbit by the MOLA laser on Mars Global Surveyor and the HRSC camera on Mars Express. The landscape is shrunk a lot to fit around your base (the buildings are not to scale), and the ground right next to the base is smoothed flat. On the Moon, the craters are made up for the game.',
      ],
      [tag('archive', 'ARCHIVE'), ' A snapshot of Mars Trek elevations, stored with the game.'],
      [link('https://trek.nasa.gov/mars/', 'trek.nasa.gov/mars'), ' · ', link(GALE_PRODUCT_URL, 'USGS product page')],
    ],
    [
      'Canadian Space Agency: food production',
      ['Partner-agency resource on growing food on the Moon and in remote places; it informs the greenhouse Real Science cards.'],
      [tag('real', 'PARTNER RESOURCE')],
      [link('https://www.asc-csa.gc.ca/eng/youth-educators/resources-stem-and-youth-organizations.asp', 'CSA youth and STEM resources')],
    ],
  ];

  const scaling: Array<[string, string]> = [
    ['Time', 'One sol (24 h 39 min) plays in about 30 seconds. A whole mission fits in about 10 minutes.'],
    ['Rocket fuel', `Crews of ${EXPEDITIONS.map((e) => e.crew).join(', ')} need ${EXPEDITIONS.map((e) => e.fuelNeeded).join(', ')} fuel cells to fill their (bigger and bigger) rockets. A real crewed rocket home would need about 25 to 31 tonnes of oxygen, made by a 25 to 30 kW plant (MOXIE scaled up about 200 times) running for about 16 months before the crew arrives. Between crews, the game's robot O2 plant pre-fills up to ${PREFILL_MAX_PCT}% of the next tank.`],
    ['Air and food', `1 cell on AIR = 1 day of air for ${RATES.airPerCell} people (about ${(RATES.airPerCell * REAL.o2PerCrewKgPerDay).toFixed(1)} kg of oxygen). Grow lights are power-hungry: 1 greenhouse cell = food for ${RATES.foodPerGreenhouseCell} people for a day, plus a little air. Water is assumed to be recycled (the ISS recovers about 98%).`],
    ['Time between crews', 'Earth and Mars line up for a short trip about every 26 months, so each new crew arrives 26 months after the last one left. That timing is real; the game skips straight to it.'],
    ['Upgrades', 'Upgrade costs and effects are game values. Each upgrade is based on a real technology: more solar panels, battery banks, regolith shielding, LED greenhouses, a scaled-up MOXIE, and NASA\'s Fission Surface Power reactor project.'],
    ['Radiation budget', `Your crew's budget is ${t.doseBudget} mSv for the whole mission. That is much stricter than NASA's real career limit (600 mSv), so radiation choices matter in a short game. Background dose (${REAL.marsSurfaceMsvPerDay} mSv per sol) is the real Gale Crater value.`],
    ['Storm sizes', `Game doses for a storm caught outside: small ${STORM_DOSE.minor}, medium ${STORM_DOSE.moderate}, big ${STORM_DOSE.major} mSv. The big one is modeled on the May 2024 event. In real life not every big flare sends particles to Mars; in the game, every X-class flare does.`],
    ['Warnings', 'In May 2024, particles reached Mars in tens of minutes (NASA/JPL). Big storms send the fastest particles, so in the game an X-class storm always beats Earth\'s warning to Mars. Medium storms build more slowly, so Earth\'s warning arrives in time. A powered radiation monitor warns you the next morning either way.'],
    ['Shelter', 'A storm shelter with 2 cells blocks 90% of a storm; 1 cell blocks half. Shelters mostly help against solar storms, not the steady background radiation, and the game models it that way.'],
  ];

  return [
    h('div', { class: 'kicker' }, 'Science Log'),
    h('h2', null, 'Where our numbers come from'),
    h('p', null, 'Escape Velocity uses real NASA data. Here is every source, what it does in the game, and whether it was fetched just now (LIVE) or stored earlier (ARCHIVE). We never invent events or numbers, and we never call stored data live.'),
    h(
      'table',
      { class: 'log' },
      h('thead', null, h('tr', null, h('th', null, 'Data'), h('th', null, 'What it does in the game'), h('th', null, 'Status'), h('th', null, 'Link'))),
      h(
        'tbody',
        null,
        rows.map(([name, what, status, links]) => h('tr', null, h('td', null, h('b', null, name)), h('td', null, ...what), h('td', null, ...status), h('td', null, ...links))),
      ),
    ),
    h('h3', null, 'How the game scales real life (and why)'),
    h('table', { class: 'log' }, h('tbody', null, scaling.map(([k, v]) => h('tr', null, h('td', null, h('b', null, k)), h('td', null, v))))),
    h('p', { class: 'title-foot' }, 'More detail, including raw field names and every source URL, is in docs/data-notes.md in our public code repository.'),
  ];
}
