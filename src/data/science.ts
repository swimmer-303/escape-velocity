// Written with AI assistance (Claude Code). See README "Use of AI tools".
// "Real Science" cards shown after each sol, keyed by what happened.
// Every number here is a published figure; sources are listed on the card and in the Science Log.

import type { ScienceTopic } from '../sim/explain';
import { REAL } from '../sim/constants';
import { OSDR_CARDS, type OsdrCard } from './osdr';

export interface ScienceFact {
  topic: ScienceTopic;
  title: string;
  body: string;
  source: string;
  url: string;
  art?: string;
}

export const FACTS: ScienceFact[] = [
  {
    topic: 'shelter',
    title: 'The biggest solar storm Curiosity ever measured',
    body: `On May 20, 2024, a giant solar storm hit Mars. NASA's Curiosity rover measured a radiation dose of ${REAL.may2024EventUgy.toLocaleString('en-US')} micrograys in one day: about the same as ${REAL.may2024EventChestXrays} chest X-rays. Astronauts on Mars will need a shelter to hide in during storms like that.`,
    source: 'NASA/JPL news release, June 2024 (Curiosity RAD)',
    url: 'https://www.jpl.nasa.gov/news/nasa-watches-mars-light-up-during-epic-solar-storm/',
    art: 'science-shield',
  },
  {
    topic: 'shelter',
    title: 'Radiation on the surface of Mars',
    body: `Mars has thin air and no global magnetic field, so more space radiation reaches the ground than on Earth. Curiosity measured about ${REAL.marsSurfaceMsvPerDay} millisieverts per day at Gale Crater. A millisievert (mSv) is the unit scientists use to measure radiation dose. In this game, every sol adds that much to your crew's dose.`,
    source: 'Hassler et al., Science (2014), Curiosity Radiation Assessment Detector',
    url: 'https://doi.org/10.1126/science.1244797',
    art: 'science-shield',
  },
  {
    topic: 'monitor',
    title: 'Why Mars needs its own space-weather station',
    body: 'Forecasters on Earth watch the Sun and send warnings, but their messages travel at the speed of light and take 3 to 22 minutes to reach Mars. In May 2024, solar particles reached Mars in just tens of minutes. Scientists are now designing warning systems that use detectors at Mars itself, to give crews at least 30 minutes of warning.',
    source: 'NASA DONKI; NASA/JPL (June 2024); Löwe et al. 2025, arXiv:2502.02469',
    url: 'https://ccmc.gsfc.nasa.gov/tools/DONKI/',
    art: 'event-blackout',
  },
  {
    topic: 'comm',
    title: 'The Sun can block the phone line',
    body: 'About every 26 months, the Sun passes between Earth and Mars. For around two weeks, mission teams stop sending commands because the Sun scrambles the radio signals. This is called solar conjunction.',
    source: 'NASA Mars Exploration: solar conjunction',
    url: 'https://science.nasa.gov/mars/',
    art: 'event-blackout',
  },
  {
    topic: 'o2',
    title: 'Making oxygen from Mars air',
    body: `MOXIE, an experiment on NASA's Perseverance rover, pulled oxygen out of the carbon dioxide in Mars' air. Over ${REAL.moxieRuns} runs it made ${REAL.moxieTotalO2g} grams: about what a small dog breathes in 10 hours. Its best rate was ${REAL.moxiePeakGPerHour} grams per hour. A version about 200 times bigger could make oxygen for astronauts to breathe AND for the rocket that flies them home.`,
    source: 'NASA, MOXIE completes Mars mission (2023); NASA PDS MOXIE page',
    url: 'https://www.nasa.gov/missions/mars-2020-perseverance/nasas-oxygen-generating-experiment-moxie-completes-mars-mission/',
    art: 'science-o2',
  },
  {
    topic: 'o2',
    title: 'How much air does an astronaut breathe?',
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
    body: `In 2007, a dust storm blocked about 99% of the direct sunlight at the Opportunity rover. Its solar panels went from about ${REAL.oppyNormalWh} watt-hours a day down to ${REAL.oppy2007StormWh}. In 2018, a planet-wide storm cut its power to about ${REAL.oppy2018StormWh} watt-hours, and Opportunity never woke up again.`,
    source: 'NASA/JPL (2007 storm); The Planetary Society (2018 power figure)',
    url: 'https://science.nasa.gov/mission/mer-opportunity/',
    art: 'event-dust',
  },
  {
    topic: 'dust',
    title: 'Wind can clean solar panels',
    body: 'The Spirit and Opportunity rovers got lucky "cleaning events": gusts of wind blew the dust off their solar panels, and their power jumped back up.',
    source: 'NASA/JPL, Mars Exploration Rover mission',
    url: 'https://science.nasa.gov/mission/mer-opportunity/',
    art: 'event-cleaning',
  },
  {
    topic: 'cold',
    title: 'Freezing Mars nights',
    body: 'Mars nights are far colder than winter anywhere people live on Earth. Batteries and electronics can be damaged by deep cold, so rovers and outposts spend power on heaters every night, even when they would rather use it for something else.',
    source: 'NASA Mars facts',
    url: 'https://science.nasa.gov/mars/facts/',
    art: 'event-cold',
  },
  {
    topic: 'build',
    title: 'Less sunlight on Mars',
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

export function factFor(topic: ScienceTopic, seed: number): ScienceFact {
  const list = [...FACTS, ...OSDR_FACTS].filter((f) => f.topic === topic);
  const pool = list.length ? list : FACTS;
  return pool[Math.abs(seed) % pool.length];
}
