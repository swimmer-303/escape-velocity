// Written with AI assistance (Claude Code). See README "Use of AI tools".
// Every word that changes between a Mars base and a Moon base, in one place.
// Pure (no DOM), so both the simulation's debriefs and the UI can use it.
//
// Moon facts used here (NASA Moon Fact Sheet, https://nssdc.gsfc.nasa.gov/planetary/factsheet/moonfact.html):
// escape velocity 2.38 km/s; mean distance 384,400 km, so radio messages take about 1.3 seconds;
// synodic month 29.53 days, so lunar day and lunar night each last about 14.8 Earth days.

import { REAL, siteOf, type Site } from './constants';

export type { Site };

export interface SiteText {
  site: Site;
  /** "Mars" or "the Moon", mid-sentence. */
  body: string;
  /** "Mars" or "The Moon", at the start of a sentence. */
  Body: string;
  /** One turn: a sol on Mars, an Earth day on the Moon. */
  turn: 'sol' | 'day';
  Turn: 'Sol' | 'Day';
  TURN: 'SOL' | 'DAY';
  turns: 'sols' | 'days';
  /** What one turn is, for the How to play screen. */
  turnIs: string;
  /** Where the base is. */
  where: string;
  /** Escape velocity, km/s, rounded for kids. */
  escapeKms: string;
  /** Where the O2 plant gets its oxygen. */
  o2From: string;
  /** "messages from Earth take about ..." */
  delay(lightTimeMin: number): string;
}

const MARS: SiteText = {
  site: 'mars',
  body: 'Mars',
  Body: 'Mars',
  turn: 'sol',
  Turn: 'Sol',
  TURN: 'SOL',
  turns: 'sols',
  turnIs: 'one sol (a Mars day, 24 hours 39 minutes)',
  where: 'Gale Crater',
  escapeKms: REAL.marsEscapeKms.toFixed(1),
  o2From: 'Mars air',
  delay: (min) => `about ${Math.round(min)} minutes`,
};

const MOON: SiteText = {
  site: 'moon',
  body: 'the Moon',
  Body: 'The Moon',
  turn: 'day',
  Turn: 'Day',
  TURN: 'DAY',
  turns: 'days',
  turnIs: 'one Earth day (on the Moon, daylight lasts about 15 Earth days, and so does the night)',
  where: "the Moon's south pole",
  escapeKms: REAL.moonEscapeKms.toFixed(1),
  o2From: 'Moon soil (regolith)',
  delay: () => `about ${REAL.moonLightSec} seconds`,
};

/** Words for this site. Accepts a Site, or anything with an optional `site` (a mission config, a campaign). */
export function siteText(x: Site | { site?: Site } | null | undefined): SiteText {
  const site = typeof x === 'string' ? x : siteOf(x);
  return site === 'moon' ? MOON : MARS;
}

/** "1 sol" / "3 days". */
export function turnsText(n: number, x: Site | { site?: Site } | null | undefined): string {
  const t = siteText(x);
  return `${n} ${n === 1 ? t.turn : t.turns}`;
}
