// Written with AI assistance (Claude Code). See README "Use of AI tools".
// View helpers shared by the game screens.

import { h, fmt1 } from './dom';
import { icon } from './icons';
import { eventName, eventDate } from '../sim/explain';
import { REAL, SUN_EARTH_LIGHT_MIN, EARTH_PROCESSING_MIN } from '../sim/constants';
import type { Allocation, Briefing, MissionState, SolReport, SpaceWeatherEvent } from '../sim/types';
import type { ScienceFact } from '../data/science';
import { RADLAB_ISS, RADLAB_ISS_MAY2024 } from '../data/radlab';
import { siteText, type Site } from '../sim/site';

export function shortRange(a: string, b: string) {
  const f = (s: string) => new Date(`${s}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  return `${f(a)} to ${f(b)}`;
}

export function weatherLine(b: Briefing, site?: Site) {
  if (site === 'moon') return b.night ? 'Lunar night: the Sun has set.' : 'No air, no weather: the Sun shines in a black sky.';
  if (b.weather === 'storm') return 'A huge dust storm is blocking the Sun!';
  if (b.weather === 'dusty') return 'Dust storm: the sky is hazy.';
  return 'Clear skies.';
}

/** Art for the briefing. All our illustrations show Mars, so a Moon base gets none (the 3D view shows the Moon). */
export function briefingArt(b: Briefing, site?: Site): string | null {
  if (site === 'moon') return null;
  if (b.warning) return 'event-flare';
  if (b.outlook === 'none') return 'event-blackout';
  if (b.resupply) return 'event-resupply';
  if (b.weather !== 'clear') return 'event-dust';
  if (b.powerNotes.some((n) => n.startsWith('Wind'))) return 'event-cleaning';
  if (b.coldSnap) return 'event-cold';
  return 'title';
}

export function upcomingRegion(m: MissionState): number | null {
  for (let s = m.sol; s <= m.sol + 3 && s <= m.plan.length; s++) {
    const r = m.plan[s - 1].storm?.event.activeRegionNum;
    if (r) return r;
  }
  return null;
}

export function briefMini(m: MissionState, b: Briefing, remaining: number): HTMLElement[] {
  const t = siteText(m.config);
  const lines: HTMLElement[] = [];
  lines.push(h('div', { class: 'line px' }, `${t.TURN} ${m.sol} PLAN`));
  if (b.warning) lines.push(h('div', { class: 'line bad' }, icon('radiation', 16), 'Storm today: power the shelter!'));
  else if (b.outlook === 'active') lines.push(h('div', { class: 'line warn' }, icon('sun', 16), 'Sun is active: storms possible.'));
  else if (b.outlook === 'none') lines.push(h('div', { class: 'line warn' }, icon('antenna', 16), 'No messages from Earth.'));
  if (b.coldSnap) lines.push(h('div', { class: 'line warn' }, icon('heater', 16), 'Cold night: heaters need 2.'));
  if (b.night) lines.push(h('div', { class: 'line warn' }, icon('heater', 16), `Lunar night: heaters need ${b.heaterNeed}.`));
  if (b.nightIn != null && b.nightIn <= 5)
    lines.push(
      h(
        'div',
        { class: 'line warn' },
        icon('sun', 16),
        `Night in ${b.nightIn} day${b.nightIn === 1 ? '' : 's'}: ${b.hasBattery ? 'stock up and charge the battery.' : 'stock up on air and food.'}`,
      ),
    );
  if (b.weather !== 'clear') lines.push(h('div', { class: 'line warn' }, icon('dust', 16), 'Dusty: less power.'));
  const airDays = m.air / m.crew;
  const foodDays = m.food / m.crew;
  lines.push(h('div', { class: 'line' }, icon('air', 16), `Crew of ${m.crew}: uses 1 day of air and food each ${t.turn}.`));
  if (airDays < 2) lines.push(h('div', { class: 'line bad' }, icon('air', 16), `Air is low (${fmt1(airDays)} days).`));
  if (foodDays < 2) lines.push(h('div', { class: 'line bad' }, icon('food', 16), `Food is low (${fmt1(foodDays)} days).`));
  if (b.dustTomorrow) lines.push(h('div', { class: 'line warn' }, icon('dust', 16), b.hasBattery ? 'Dust storm tomorrow: fill the battery?' : 'Dust storm tomorrow: stock up.'));
  lines.push(h('div', { class: 'line' }, icon('cell', 16), remaining > 0 ? `${remaining} cell${remaining === 1 ? '' : 's'} left` : 'All cells placed'));
  return lines;
}

export function eventCard(e: SpaceWeatherEvent, late?: { lateBy: number; lightMin: number }): HTMLElement {
  const where = e.activeRegionNum ? ` from sunspot region ${e.activeRegionNum}` : '';
  const what =
    e.kind === 'flare'
      ? `${article(eventName(e))} erupted${where} on ${eventDate(e)}.`
      : e.kind === 'cme'
        ? `${article(eventName(e))} blasted off the Sun on ${eventDate(e)}.`
        : `A solar particle storm was recorded on ${eventDate(e)}.`;
  return h(
    'div',
    { class: 'card event' },
    h('span', { class: `tag ${e.origin}` }, e.origin === 'live' ? 'LIVE' : 'ARCHIVE'),
    h('span', { class: 'tag real' }, 'REAL EVENT'),
    h('div', { style: 'margin-top:6px' }, what, e.linkedSep ? ' NASA also recorded a burst of fast particles from it.' : ''),
    e.note ? h('div', { class: 'title-foot' }, h('span', { class: 'tag game' }, 'NOTE'), e.note) : null,
    late
      ? h(
          'div',
          { class: 'title-foot' },
          `Why the warning was late: light from the flare took ${Math.round(SUN_EARTH_LIGHT_MIN)} minutes to reach Earth, forecasters needed about ${EARTH_PROCESSING_MIN} minutes to check it, and their message took ${Math.round(late.lightMin)} more minutes to reach Mars. The fastest particles got there about ${late.lateBy} minutes before the warning (game estimate).`,
        )
      : null,
    h('div', { class: 'title-foot' }, 'Source: NASA DONKI (Space Weather Database). ', e.link ? h('a', { href: e.link, target: '_blank', rel: 'noopener' }, 'See the record') : null),
  );
}

function article(name: string) {
  return /^[AEFHILMNORSX]/.test(name) ? `An ${name}` : `A ${name}`;
}

export function scienceCard(f: ScienceFact, site?: Site): HTMLElement {
  // Our illustrations all show Mars, so cards on a Moon base go without one.
  const art = site === 'moon' ? undefined : f.art;
  return h(
    'details',
    { class: 'science' },
    h('summary', { class: 'kicker', style: 'cursor:pointer' }, `Real Science: ${f.title}`),
    art ? h('div', { class: 'art', style: 'margin-top:8px' }, h('img', { src: `/art/${art}.png`, alt: `${f.title} (AI-generated illustration)`, loading: 'lazy' })) : null,
    h('p', null, f.body),
    h('div', { class: 'src' }, 'Source: ', h('a', { href: f.url, target: '_blank', rel: 'noopener' }, f.source)),
  );
}

interface Beat {
  at: number;
  text: string;
  storm?: number;
}

export function runBeats(r: SolReport, site?: Site): Beat[] {
  if (site === 'moon') return moonBeats(r);
  const beats: Beat[] = [{ at: 0, text: 'Sunrise. The solar panels wake up.' }];
  const on = (id: keyof Allocation) => r.alloc[id] > 0;
  if (on('fuel')) beats.push({ at: 0.12, text: `The O2 plant hums: ${r.alloc.fuel} cell${r.alloc.fuel === 1 ? '' : 's'} filling the rocket.` });
  if (on('greenhouse')) beats.push({ at: 0.22, text: 'The greenhouse glows under its grow lights.' });
  if (r.storm) {
    beats.push({
      at: 0.38,
      text: r.storm.shelterCells ? 'SOLAR STORM! The crew is safe in the shelter.' : 'SOLAR STORM! Fast particles rain down on the outpost.',
      storm: r.storm.shelterCells >= 2 ? 0.4 : 1,
    });
  }
  if (r.weather !== 'clear') beats.push({ at: 0.3, text: 'Dust dims the sky. The panels struggle.' });
  beats.push({ at: 0.5, text: 'Sunset. Mars sunsets are blue!' });
  beats.push({ at: 0.62, text: r.heaterShortfall ? 'Night falls. It is freezing, and the heaters are short of power...' : 'Night falls. The heaters keep the batteries warm.' });
  if (r.alloc.monitor) beats.push({ at: 0.8, text: 'The radiation monitor watches the Sun.' });
  if (r.alloc.build) beats.push({ at: 0.72, text: r.built ? 'The Workshop crew bolts on the last piece. Done!' : 'Sparks fly in the Workshop.' });
  if (r.stored) beats.push({ at: 0.45, text: 'Spare power flows into the battery.' });
  beats.push({ at: 0.97, text: 'A new sol begins.' });
  return beats.sort((a, b) => a.at - b.at);
}

/**
 * One Earth day at a Moon base. At the lunar south pole the Sun hovers just above the horizon (NASA), and in daylight
 * it stays up for about two weeks, so there is no sunrise or sunset inside one turn.
 */
function moonBeats(r: SolReport): Beat[] {
  const on = (id: keyof Allocation) => r.alloc[id] > 0;
  const beats: Beat[] = [
    {
      at: 0,
      text: r.night ? 'The long lunar night goes on. The solar panels are dark.' : 'The Sun hangs low over the south pole. The solar panels hum.',
    },
  ];
  if (on('fuel')) beats.push({ at: 0.12, text: `The O2 plant bakes oxygen out of Moon soil: ${r.alloc.fuel} cell${r.alloc.fuel === 1 ? '' : 's'} filling the rocket.` });
  if (on('greenhouse')) beats.push({ at: 0.22, text: 'The greenhouse glows under its grow lights.' });
  if (r.storm) {
    beats.push({
      at: 0.38,
      text: r.storm.shelterCells ? 'SOLAR STORM! The crew is safe in the shelter.' : 'SOLAR STORM! Fast particles rain down on the outpost.',
      storm: r.storm.shelterCells >= 2 ? 0.4 : 1,
    });
  }
  if (r.stored) beats.push({ at: 0.45, text: 'Spare power flows into the battery for the night.' });
  if (!r.night) beats.push({ at: 0.5, text: 'The Sun barely moves. Daylight on the Moon lasts about two weeks.' });
  beats.push({
    at: 0.62,
    text: r.heaterShortfall
      ? 'It is bitterly cold, and the heaters are short of power...'
      : r.night
        ? 'The heaters fight the deep cold of the lunar night.'
        : 'The heaters keep the base and batteries warm.',
  });
  if (r.alloc.build) beats.push({ at: 0.72, text: r.built ? 'The Workshop crew bolts on the last piece. Done!' : 'Sparks fly in the Workshop.' });
  beats.push({ at: 0.97, text: r.night ? 'Another day of darkness passes.' : 'A new day begins.' });
  return beats.sort((a, b) => a.at - b.at);
}

/** Real radiation comparison: ISS (NASA OSDR RadLab) vs. Mars surface vs. the May 2024 storm (Curiosity RAD). */
export function compareCard(m: MissionState): HTMLElement | null {
  if (m.config.site === 'moon') return moonCompareCard(m);
  const iss = m.config.scenario === 'may2024' ? (RADLAB_ISS_MAY2024 ?? RADLAB_ISS) : RADLAB_ISS;
  if (!iss) return null;
  const rows: Array<[string, number, string]> = [
    [`A day on the ISS (${shortRange(iss.startDate, iss.endDate)})`, iss.meanDoseRatePerDay, 'var(--air)'],
    ['A normal day at Gale Crater, Mars', REAL.marsSurfaceUgyPerDay, 'var(--oxide)'],
    ['The May 20, 2024 storm at Gale Crater', REAL.may2024EventUgy, 'var(--red)'],
  ];
  const max = Math.max(...rows.map((r) => r[1]));
  const sols = m.log.length;
  return h(
    'div',
    { class: 'card' },
    h('div', { class: 'kicker' }, 'Real data: how much radiation?'),
    rows.map(([label, v, color]) =>
      h(
        'div',
        { style: 'margin:6px 0' },
        h('div', { style: 'display:flex; justify-content:space-between; gap:8px; font-size:15px' }, h('span', null, label), h('b', { class: 'px' }, `${Math.round(v).toLocaleString('en-US')} µGy`)),
        h('div', { class: 'bar' }, h('div', { class: 'fill', style: `width:${Math.max(1.5, (v / max) * 100)}%; background:${color}` })),
      ),
    ),
    h(
      'p',
      { style: 'margin-top:8px' },
      `Your crew spent ${sols} sol${sols === 1 ? '' : 's'} on Mars. From the steady background alone, that is about ${(sols * REAL.marsSurfaceUgyPerDay).toLocaleString('en-US')} micrograys: similar to ${sols} days on the ISS. One big solar storm adds as much as ${Math.round(REAL.may2024EventUgy / REAL.marsSurfaceUgyPerDay)} normal days at once. That's why shelters and early warnings matter.`,
    ),
    h(
      'div',
      { class: 'title-foot' },
      'µGy (microgray) measures radiation energy absorbed by a detector. ISS: DOSTEL detector, NASA OSDR RadLab (archived readings). Mars: Curiosity RAD (Hassler et al. 2014; NASA/JPL 2024).',
    ),
  );
}

/** Moon version: ISS (NASA OSDR RadLab) vs. the Moon's surface (Chang'e 4 LND) vs. Mars (Curiosity RAD). */
function moonCompareCard(m: MissionState): HTMLElement | null {
  const iss = RADLAB_ISS;
  const moonUgyPerDay = Math.round(REAL.moonSurfaceUgyPerHour * 24);
  const rows: Array<[string, number, string]> = [
    ...(iss ? [[`A day on the ISS (${shortRange(iss.startDate, iss.endDate)})`, iss.meanDoseRatePerDay, 'var(--air)'] as [string, number, string]] : []),
    ['A normal day on the Moon (Chang\'e 4 lander, 2019)', moonUgyPerDay, 'var(--red)'],
    ['A normal day at Gale Crater, Mars', REAL.marsSurfaceUgyPerDay, 'var(--oxide)'],
  ];
  const max = Math.max(...rows.map((r) => r[1]));
  const days = m.log.length;
  return h(
    'div',
    { class: 'card' },
    h('div', { class: 'kicker' }, 'Real data: how much radiation?'),
    rows.map(([label, v, color]) =>
      h(
        'div',
        { style: 'margin:6px 0' },
        h('div', { style: 'display:flex; justify-content:space-between; gap:8px; font-size:15px' }, h('span', null, label), h('b', { class: 'px' }, `${Math.round(v).toLocaleString('en-US')} µGy`)),
        h('div', { class: 'bar' }, h('div', { class: 'fill', style: `width:${Math.max(1.5, (v / max) * 100)}%; background:${color}` })),
      ),
    ),
    h(
      'p',
      { style: 'margin-top:8px' },
      `Your crew spent ${days} day${days === 1 ? '' : 's'} on the Moon. From the steady background alone, that is about ${(days * moonUgyPerDay).toLocaleString('en-US')} micrograys. The Moon has almost no air, so nothing overhead blocks space radiation. That's why shelters and early warnings matter.`,
    ),
    h(
      'div',
      { class: 'title-foot' },
      "µGy (microgray) measures radiation energy absorbed by a detector. ISS: DOSTEL detector, NASA OSDR RadLab (archived readings). Moon: Chang'e 4 LND, 13.2 µGy per hour (Zhang et al., Science Advances 2020). Mars: Curiosity RAD (Hassler et al. 2014).",
    ),
  );
}
