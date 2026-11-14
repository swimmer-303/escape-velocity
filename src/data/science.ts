// Written with AI assistance (Claude Code). See README "Use of AI tools".
// "Real Science" cards shown after each sol, keyed by what happened.
// Every number here is a published figure; sources are listed on the card and in the Science Log.

import type { ScienceTopic } from '../sim/explain';
import { ARCADIA, REAL, type Landing, type Site } from '../sim/constants';
import { OSDR_CARDS, type OsdrCard } from './osdr';

export interface ScienceFact {
  topic: ScienceTopic;
  title: string;
  body: string;
  source: string;
  url: string;
  art?: string;
  /** Only shown at this site. Missing = true for both Mars and the Moon. */
  site?: Site;
  /** Mars only: only shown at this landing site. Missing = shown at every landing site. */
  landing?: Landing;
}

export const FACTS: ScienceFact[] = [
  {
    topic: 'shelter',
    title: 'The biggest solar storm Curiosity ever measured',
    site: 'mars',
    body: `On May 20, 2024, a giant solar storm hit Mars. NASA's Curiosity rover measured a radiation dose of ${REAL.may2024EventUgy.toLocaleString('en-US')} micrograys in one day: about the same as ${REAL.may2024EventChestXrays} chest X-rays. Astronauts on Mars will need a shelter to hide in during storms like that.`,
    source: 'NASA/JPL news release, June 2024 (Curiosity RAD)',
    url: 'https://www.jpl.nasa.gov/news/nasa-watches-mars-light-up-during-epic-solar-storm/',
    art: 'science-shield',
  },
  {
    topic: 'shelter',
    title: 'Radiation on the surface of Mars',
    site: 'mars',
    body: `Mars has thin air and no global magnetic field, so more space radiation reaches the ground than on Earth. Curiosity measured about ${REAL.marsSurfaceMsvPerDay} millisieverts per day at Gale Crater. A millisievert (mSv) is the unit scientists use to measure radiation dose. In this game, every sol adds that much to your crew's dose.`,
    source: 'Hassler et al., Science (2014), Curiosity Radiation Assessment Detector',
    url: 'https://doi.org/10.1126/science.1244797',
    art: 'science-shield',
  },
  {
    topic: 'monitor',
    title: 'Why Mars needs its own space-weather station',
    site: 'mars',
    body: 'Forecasters on Earth watch the Sun and send warnings, but their messages travel at the speed of light and take 3 to 22 minutes to reach Mars. In May 2024, solar particles reached Mars in just tens of minutes. Scientists are now designing warning systems that use detectors at Mars itself, to give crews at least 30 minutes of warning.',
    source: 'NASA DONKI; NASA/JPL (June 2024); Löwe et al. 2025, arXiv:2502.02469',
    url: 'https://ccmc.gsfc.nasa.gov/tools/DONKI/',
    art: 'event-blackout',
  },
  {
    topic: 'comm',
    title: 'The Sun can block the phone line',
    site: 'mars',
    body: 'About every 26 months, the Sun passes between Earth and Mars. For around two weeks, mission teams stop sending commands because the Sun scrambles the radio signals. This is called solar conjunction.',
    source: 'NASA Mars Exploration: solar conjunction',
    url: 'https://science.nasa.gov/mars/',
    art: 'event-blackout',
  },
  {
    topic: 'o2',
    title: 'Making oxygen from Mars air',
    site: 'mars',
    body: `MOXIE, an experiment on NASA's Perseverance rover, pulled oxygen out of the carbon dioxide in Mars' air. Over ${REAL.moxieRuns} runs it made ${REAL.moxieTotalO2g} grams: about what a small dog breathes in 10 hours. Its best rate was ${REAL.moxiePeakGPerHour} grams per hour. A version about 200 times bigger could make oxygen for astronauts to breathe AND for the rocket that flies them home.`,
    source: 'NASA, MOXIE completes Mars mission (2023); NASA PDS MOXIE page',
    url: 'https://www.nasa.gov/missions/mars-2020-perseverance/nasas-oxygen-generating-experiment-moxie-completes-mars-mission/',
    art: 'science-o2',
  },
  {
    topic: 'o2',
    title: 'How much air does an astronaut breathe?',
    site: 'mars',
    body: `Each astronaut uses about ${REAL.o2PerCrewKgPerDay.toFixed(1)} kg of oxygen per day. Your crew of ${REAL.crewSize} needs about ${(REAL.o2PerCrewKgPerDay * REAL.crewSize).toFixed(1)} kg every sol. In the game, 1 power cell on AIR makes 1 day of air for the whole crew.`,
    source: 'NASA Life Support Baseline Values and Assumptions (BVAD), Rev 2, 2022',
    url: 'https://ntrs.nasa.gov/citations/20210024855',
    art: 'science-o2',
  },
  {
    topic: 'greenhouse',
    title: 'Growing food far from home',
    body: 'Astronauts on the International Space Station have grown and eaten lettuce and other leafy greens under LED lights. Growing food takes a lot of power for lights and heat, which is why your greenhouse needs 2 cells to feed the crew.',
    source: 'NASA Veggie plant growth system; Canadian Space Agency: Food production on the Moon and in remote areas',
    url: 'https://www.asc-csa.gc.ca/eng/youth-educators/resources-stem-and-youth-organizations.asp',
    art: 'science-plants',
  },
  {
    topic: 'dust',
    title: 'Dust storms and solar power',
    site: 'mars',
    body: `In 2007, a dust storm blocked about 99% of the direct sunlight at the Opportunity rover. Its solar panels went from about ${REAL.oppyNormalWh} watt-hours a day down to ${REAL.oppy2007StormWh}. In 2018, a planet-wide storm cut its power to about ${REAL.oppy2018StormWh} watt-hours, and Opportunity never woke up again.`,
    source: 'NASA/JPL (2007 storm); The Planetary Society (2018 power figure)',
    url: 'https://science.nasa.gov/mission/mer-opportunity/',
    art: 'event-dust',
  },
  {
    topic: 'dust',
    title: 'Wind can clean solar panels',
    site: 'mars',
    body: 'The Spirit and Opportunity rovers got lucky "cleaning events": gusts of wind blew the dust off their solar panels, and their power jumped back up.',
    source: 'NASA/JPL, Mars Exploration Rover mission',
    url: 'https://science.nasa.gov/mission/mer-opportunity/',
    art: 'event-cleaning',
  },
  {
    topic: 'cold',
    title: 'Freezing Mars nights',
    site: 'mars',
    body: 'Mars nights are far colder than winter anywhere people live on Earth. Batteries and electronics can be damaged by deep cold, so rovers and outposts spend power on heaters every night, even when they would rather use it for something else.',
    source: 'NASA Mars facts',
    url: 'https://science.nasa.gov/mars/facts/',
    art: 'event-cold',
  },
  {
    topic: 'build',
    title: 'Less sunlight on Mars',
    site: 'mars',
    body: 'Mars is farther from the Sun than Earth, so it gets only about 43% as much sunlight. Solar panels on Mars make less than half the power the same panels would make on Earth, which is why a Mars base needs a big solar array.',
    source: 'NASA Mars Fact Sheet (solar irradiance 586 W/m² vs. 1361 W/m² at Earth)',
    url: 'https://nssdc.gsfc.nasa.gov/planetary/factsheet/marsfact.html',
    art: 'event-cleaning',
  },
  {
    topic: 'build',
    title: 'Nuclear power for the Moon and Mars',
    body: 'Dust storms and long nights are hard on solar power. NASA\'s Fission Surface Power project is designing small nuclear reactors that could run day and night on the Moon and Mars, whatever the weather.',
    source: 'NASA Fission Surface Power project',
    url: 'https://www.nasa.gov/directorates/stmd/fission-surface-power/',
    art: 'title',
  },
  {
    topic: 'build',
    title: 'Building for the next crew',
    site: 'mars',
    body: 'The International Space Station was built piece by piece over more than ten years, by many crews. Each crew added to what the last one left. A Mars base would grow the same way.',
    source: 'NASA International Space Station',
    url: 'https://www.nasa.gov/international-space-station/',
    art: 'event-resupply',
  },
  {
    topic: 'crew',
    title: 'Recycling water in space',
    body: 'Water is heavy to launch, so spacecraft recycle it. In 2023, the International Space Station reached about 98% water recovery: almost every drop gets cleaned and used again.',
    source: 'NASA, ISS Environmental Control and Life Support System (2023)',
    url: 'https://www.nasa.gov/missions/station/iss-research/nasa-achieves-water-recovery-milestone-on-international-space-station/',
    art: 'science-crew',
  },
  // ---------------------------------------------------------------- the ice landing site (Arcadia Planitia)
  {
    topic: 'greenhouse',
    site: 'mars',
    landing: 'arcadia',
    title: 'Ice under your boots',
    body: `NASA's Subsurface Water Ice Mapping project (SWIM) put together measurements from three NASA spacecraft orbiting Mars to map where ice is probably hiding under the ground. The scientists found that the broad plains of Arcadia match the most signs of ice that astronauts could reach. Ice could give a crew water to drink and water for growing plants. In this game, your greenhouse grows ${ARCADIA.greenhouseBoost} times as much here (a game value).`,
    source: 'Morgan et al., Nature Astronomy (2021); Planetary Science Institute, Feb 8, 2021',
    url: 'https://www.psi.edu/blog/water-ice-resources-identified-in-martian-northern-hemisphere/',
  },
  {
    topic: 'cold',
    site: 'mars',
    landing: 'arcadia',
    title: 'Ice or sunshine?',
    body: "Close to Mars' poles there is lots of ice just under the ground, but it is colder there and the nights are long. Near the equator, where Curiosity explores Gale Crater, it is warmer and sunny enough for solar power, but there is little ice near the surface. NASA's mission planners are looking for a middle ground, like the northern plains of Arcadia Planitia: some ice, some sunshine.",
    source: 'NASA/JPL, "Where Should Future Astronauts Land on Mars? Follow the Water" (Feb 8, 2021)',
    url: 'https://www.jpl.nasa.gov/news/where-should-future-astronauts-land-on-mars-follow-the-water',
  },
  {
    topic: 'o2',
    site: 'mars',
    landing: 'arcadia',
    title: 'Ice means a ride home',
    body: 'Bringing all the rocket fuel for a round trip from Earth is basically not possible, so almost every plan for a human Mars mission in the last 30 years looks at making fuel on Mars. A SWIM scientist says ice could give astronauts drinking water, plants, air to breathe and rocket fuel, "but the most important is to provide fuel for the return trip home to Earth." On the space station, astronauts already make oxygen by splitting water with electricity. In this game, your O2 plant still takes oxygen from Mars air, like MOXIE.',
    source: 'Planetary Science Institute (Feb 8, 2021); NASA, ISS life support (oxygen from water)',
    url: 'https://www.psi.edu/blog/water-ice-resources-identified-in-martian-northern-hemisphere/',
  },
  // ---------------------------------------------------------------- the Moon
  {
    topic: 'shelter',
    site: 'moon',
    title: 'The first radiation measurements on the Moon',
    body: `In 2019, China's Chang'e 4 lander made the first measurements of radiation on the Moon's surface. Its detector measured ${REAL.moonSurfaceUsvPerDay.toLocaleString('en-US')} microsieverts per day: almost twice the dose inside the International Space Station at the same time (${REAL.issSameTimeUsvPerDay} microsieverts per day), and about twice what Curiosity measured on Mars. In this game, every day on the Moon adds that much (${(REAL.moonSurfaceUsvPerDay / 1000).toFixed(2)} mSv) to your crew's dose.`,
    source: "Zhang et al., Science Advances (2020), Chang'e 4 Lunar Lander Neutrons and Dosimetry (LND)",
    url: 'https://doi.org/10.1126/sciadv.aaz1334',
  },
  {
    topic: 'shelter',
    site: 'moon',
    title: 'Warnings from Earth in 1.3 seconds',
    body: `The Moon is about ${REAL.moonDistanceKm.toLocaleString('en-US')} km from Earth. Radio messages travel at the speed of light, so they reach the Moon in about ${REAL.moonLightSec} seconds. Messages to Mars take ${REAL.marsLightMinMin} to ${REAL.marsLightMaxMin} minutes. That is why Earth's storm warnings always reach a Moon base in time.`,
    source: 'NASA Moon Fact Sheet (mean distance 384,400 km)',
    url: 'https://nssdc.gsfc.nasa.gov/planetary/factsheet/moonfact.html',
  },
  {
    topic: 'o2',
    site: 'moon',
    title: 'Moon dirt is full of oxygen',
    body: `Rock and soil samples brought back from the Moon show that its soil, called regolith, is ${REAL.regolithO2PctMin} to ${REAL.regolithO2PctMax} percent oxygen by weight! The oxygen is locked inside minerals and glass, so a machine has to break them apart to get it out.`,
    source: 'European Space Agency, "ESA opens oxygen plant: making air out of moondust" (2020)',
    url: 'https://www.esa.int/Enabling_Support/Space_Engineering_Technology/ESA_opens_oxygen_plant_making_air_out_of_moondust',
  },
  {
    topic: 'o2',
    site: 'moon',
    title: 'NASA pulls oxygen out of pretend Moon soil',
    body: "In April 2023, a NASA team at Johnson Space Center heated simulated Moon soil with a powerful laser inside a big vacuum chamber, and got oxygen out of it. It was the first time this was done in a vacuum, like on the real Moon. Oxygen made this way could be used for breathing, and as rocket propellant. Your O2 plant works like a bigger version.",
    source: 'NASA, Carbothermal Reduction Demonstration (April 25, 2023)',
    url: 'https://www.nasa.gov/centers-and-facilities/johnson/nasa-successfully-extracts-oxygen-from-lunar-soil-simulant/',
  },
  {
    topic: 'o2',
    site: 'moon',
    title: 'How much air does an astronaut breathe?',
    body: `Each astronaut uses about ${REAL.o2PerCrewKgPerDay.toFixed(1)} kg of oxygen per day. Your crew of ${REAL.crewSize} needs about ${(REAL.o2PerCrewKgPerDay * REAL.crewSize).toFixed(1)} kg every day. In the game, 1 power cell on AIR makes 1 day of air for the whole crew.`,
    source: 'NASA Life Support Baseline Values and Assumptions (BVAD), Rev 2, 2022',
    url: 'https://ntrs.nasa.gov/citations/20210024855',
  },
  {
    topic: 'night',
    site: 'moon',
    title: 'The two-week lunar night',
    body: `On the Moon, one sunrise to the next takes about ${REAL.moonSynodicDays} Earth days. So daylight lasts about 15 Earth days, and so does the night. At the Moon's equator, the ground swings from about ${REAL.moonTempMaxK - 273} °C in the day to about ${REAL.moonTempMinK - 273} °C at night. In the game, the night is squeezed into 4 days so your mission fits in a class period.`,
    source: 'NASA Moon Fact Sheet (synodic period 29.53 days; temperature 95 K to 390 K)',
    url: 'https://nssdc.gsfc.nasa.gov/planetary/factsheet/moonfact.html',
  },
  {
    topic: 'night',
    site: 'moon',
    title: 'Full sunshine, then none',
    body: `The Moon gets as much sunlight as Earth: about ${REAL.moonSolarWm2.toLocaleString('en-US')} watts on every square meter. But during the lunar night, solar panels make nothing at all. That is why a Moon base needs batteries, or another kind of power, like the small nuclear reactors NASA is designing.`,
    source: 'NASA Moon Fact Sheet (solar irradiance); NASA Fission Surface Power project',
    url: 'https://nssdc.gsfc.nasa.gov/planetary/factsheet/moonfact.html',
  },
  {
    topic: 'cold',
    site: 'moon',
    title: 'Sleeping through the lunar night',
    body: "China's Chang'e 4 lander goes into hibernation to get through the cold lunar night. Its radiation detector even has a little door that closes at night to keep out the cold, and opens again in the lunar morning.",
    source: "Zhang et al., Science Advances (2020), Chang'e 4 LND",
    url: 'https://doi.org/10.1126/sciadv.aaz1334',
  },
  {
    topic: 'build',
    site: 'moon',
    title: 'Building for the next crew',
    body: 'The International Space Station was built piece by piece over more than ten years, by many crews. Each crew added to what the last one left. A Moon base would grow the same way.',
    source: 'NASA International Space Station',
    url: 'https://www.nasa.gov/international-space-station/',
  },
  {
    topic: 'crew',
    site: 'moon',
    title: "Exploring the Moon's south pole",
    body: "NASA plans to send Artemis astronauts to the region around the Moon's south pole. There, the Sun hovers below or just above the horizon, tall mountains cast long shadows, and some deep craters never see sunlight at all. Those craters can get as cold as -203 °C, and they are likely to trap frozen chemicals that scientists call volatiles.",
    source: "NASA, \"Moon's South Pole is Full of Mystery, Science, Intrigue\" (2022)",
    url: 'https://www.nasa.gov/humans-in-space/moons-south-pole-is-full-of-mystery-science-intrigue/',
  },
];

const OSDR_ART: Record<OsdrCard['tieIn'], string> = {
  greenhouse: 'science-plants',
  shelter: 'science-shield',
  crew: 'science-crew',
  o2: 'science-o2',
};

/** Real NASA OSDR studies, shown as Real Science cards for the matching topic. */
export const OSDR_FACTS: ScienceFact[] = OSDR_CARDS.map((c) => ({
  topic: c.tieIn,
  title: `${c.osdId}: ${c.title}`,
  body: c.takeaway,
  source: `NASA Open Science Data Repository, study ${c.osdId}`,
  url: c.url,
  art: OSDR_ART[c.tieIn],
}));

/** A Real Science card for what just happened, at this site (Mars at Gale Crater by default). */
export function factFor(topic: ScienceTopic, seed: number, site: Site = 'mars', landing: Landing = 'gale'): ScienceFact {
  const here = (f: ScienceFact) => (f.site ?? site) === site && (!f.landing || (site === 'mars' && f.landing === landing));
  const list = [...FACTS, ...OSDR_FACTS].filter((f) => f.topic === topic && here(f));
  // At a special landing site, its own cards come up every other time (Gale Crater has none, so it is unchanged).
  const own = list.filter((f) => f.landing && f.landing === landing);
  if (own.length && Math.abs(seed) % 2 === 0) return own[Math.floor(Math.abs(seed) / 2) % own.length];
  const pool = list.length ? list : FACTS.filter(here);
  return pool[Math.abs(seed) % pool.length];
}
