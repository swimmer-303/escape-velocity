// Written with AI assistance (Claude Code). See README "Use of AI tools".
// Screen pieces that differ between a Mars base and a Moon base, kept out of app.ts.
// Moon numbers come from REAL in src/sim/constants.ts, where each one cites its source.

import { h } from './dom';
import { icon } from './icons';
import { REAL, type Difficulty, type Site } from '../sim/constants';
import { isNight } from '../sim/sim';
import type { Briefing, MissionState } from '../sim/types';

/** The two places you can build, for the mission chooser. */
export const SITE_CHOICES: Array<{ site: Site; name: string; blurb: string }> = [
  {
    site: 'mars',
    name: 'Mars',
    blurb: 'Gale Crater. Dust storms, freezing nights, and messages from Earth that take minutes to arrive.',
  },
  {
    site: 'moon',
    name: 'The Moon',
    blurb: 'Near the south pole. A long, dark lunar night, more radiation, and messages from Earth in about 1.3 seconds.',
  },
];

export const MOON_DIFFICULTY: Record<Difficulty, string> = {
  cadet: 'Recommended for a first game and for classes. More time, fewer storms.',
  commander: 'Less time, less air and food, and more and bigger storms. Storms can hit in the dark of the lunar night.',
};

/** Questions for the class at each break between Moon crews. */
export const MOON_TALK_ABOUT_IT: Record<number, string[]> = {
  1: [
    'What did your crew spend the most power on? Was that a good choice?',
    'The O2 plant makes air to breathe AND oxygen for the rocket. Why is that a hard choice?',
    'How did you get ready for the lunar night? What would you do differently?',
  ],
  2: [
    'Did the upgrades from the first crew help the second crew? How?',
    'What would happen if no crew ever built anything for the next one?',
    'Why might a Moon base want a nuclear reactor instead of only solar panels?',
  ],
  3: [
    'Real NASA planners make these same trade-offs. Which one was hardest for you, and why?',
    'Messages from Earth reach the Moon in about 1.3 seconds, but take minutes to reach Mars. How would that change your decisions?',
    'If you were designing the next Moon base, what would you build first?',
  ],
};

/** Briefing cards about the lunar night (Moon only; nothing on Mars). */
export function nightCards(m: MissionState, b: Briefing): HTMLElement[] {
  const nightLen = m.plan.filter((p) => p.night).length;
  if (b.night) {
    const left = b.nightLeft ?? 1;
    return [
      h(
        'div',
        { class: 'card event' },
        icon('heater', 20),
        ' ',
        h('b', null, 'Lunar night. '),
        `The Sun has set, so your solar panels make nothing. ${left === 1 ? 'This is the last day of darkness.' : `${left} more days of darkness, counting today.`} The heaters need ${b.heaterNeed} cells tonight.`,
        b.hasBattery ? ` Your battery holds ${b.batteryHeld ?? 0} more cell${b.batteryHeld === 1 ? '' : 's'} for later nights.` : '',
      ),
    ];
  }
  if (b.nightIn == null) return [];
  return [
    h(
      'div',
      { class: `card ${b.nightIn <= 3 ? 'event' : ''}` },
      icon('sun', 20),
      ' ',
      h('b', null, `Night falls in ${b.nightIn} day${b.nightIn === 1 ? '' : 's'}. `),
      `The Sun will set for ${nightLen} days, and your solar panels will make nothing. Stock up on air and food before then${b.hasBattery ? ', and save cells in the battery' : ''}.`,
      h('div', { class: 'title-foot', style: 'margin-top:4px' }, `A real lunar night lasts about 15 Earth days (half of the Moon's ${REAL.moonSynodicDays}-day cycle). The game squeezes it into ${nightLen}.`),
    ),
  ];
}

/**
 * Where the Sun is (for Stage.setTimeOfDay: 0 = sunrise, 0.5 = sunset) during turn `sol` of a Moon mission, `k` of the way through it.
 * One turn is one Earth day and lunar daylight lasts about two weeks, so the Sun only rises and sets around the night.
 */
export function moonSky(m: MissionState, sol: number, k: number): number {
  const night = isNight(m, sol);
  const prevNight = sol > 1 && isNight(m, sol - 1);
  const nextNight = sol + 1 <= m.plan.length && isNight(m, sol + 1);
  if (night && !prevNight) return 0.5 + 0.25 * k; // dusk deepens into night
  if (night) return nextNight ? 0.75 : 0.75 + 0.22 * k; // the last night ends near sunrise
  if (prevNight) return 0.02 + 0.23 * k; // sunrise
  if (nextNight) return 0.25 + 0.25 * k; // sunset at the end of the day
  return 0.25;
}
