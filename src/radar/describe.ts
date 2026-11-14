// Written with AI assistance (Claude Code). See README "Use of AI tools".
// Plain-language text for the Space weather radar (pure, no DOM). Every result from our simple model says
// "(estimate)"; NASA's WSA-ENLIL predictions are always credited to NASA's model. Dates are UTC, like DONKI.

import type { Planet } from '../data/lighttime';
import { DAY_MS, calmForMars, type RadarCme, type RadarCounts, type RadarData } from './model';

const NAME: Record<Planet, string> = { earth: 'Earth', mars: 'Mars' };
const POSS: Record<Planet, string> = { earth: "Earth's", mars: "Mars'" };

export const kms = (n: number) => `${Math.round(n).toLocaleString('en-US')} km/s`;
export const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;

/** "Nov 5" or "Nov 5, 2026" (UTC). */
export function dayText(ms: number, withYear = false): string {
  return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: withYear ? 'numeric' : undefined, timeZone: 'UTC' });
}

/** "Nov 5, 18:00 UTC". */
export function timeText(ms: number, withYear = false): string {
  const d = new Date(ms);
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${dayText(ms, withYear)}, ${hh}:${mm} UTC`;
}

/** "about 3 days", "about 2.5 days", "about 20 hours". */
export function durationText(ms: number): string {
  const hours = ms / 3_600_000;
  if (hours < 22) return `about ${plural(Math.max(1, Math.round(hours)), 'hour')}`;
  const days = Math.round((ms / DAY_MS) * 2) / 2;
  return `about ${days} ${days === 1 ? 'day' : 'days'}`;
}

/** DONKI's Stonyhurst longitude in words. West of Earth = ahead of Earth on its path around the Sun. */
export function directionText(stonyLon: number): string {
  const a = Math.round(Math.abs(stonyLon));
  if (a <= 10) return 'almost straight at Earth';
  const side = stonyLon > 0 ? 'west' : 'east';
  return a >= 150 ? `${a}° ${side} of Earth, on the far side of the Sun` : `${a}° ${side} of Earth`;
}

/** What our simple model says about one planet, as a verb phrase ("it ..."). */
export function modelText(c: RadarCme, planet: Planet, endMs: number): string {
  const r = c[planet];
  const P = NAME[planet];
  if (r.inside) {
    return r.atMs <= endMs
      ? `reached ${POSS[planet]} distance ${durationText(r.atMs - c.startMs)} later (estimate)`
      : `is on its way and should reach ${POSS[planet]} distance around ${dayText(r.atMs)} (estimate)`;
  }
  if (c.planeHalfWidth == null) return `passed ${c.axisLat > 0 ? 'above (north of)' : 'below (south of)'} the planets and missed ${P} (estimate)`;
  return `missed ${P}, which was ${Math.max(1, Math.round(r.offsetDeg - c.halfAngle))}° outside its cone (estimate)`;
}

/** The same, short, for a line that already names the planet ("At Earth: ..."). */
export function modelShort(c: RadarCme, planet: Planet, endMs: number): string {
  const r = c[planet];
  if (r.inside) {
    return r.atMs <= endMs
      ? `reached ${POSS[planet]} distance ${durationText(r.atMs - c.startMs)} later (estimate)`
      : `on its way, should reach ${POSS[planet]} distance around ${dayText(r.atMs)} (estimate)`;
  }
  if (c.planeHalfWidth == null) return `missed, it passed ${c.axisLat > 0 ? 'above' : 'below'} the planets (estimate)`;
  return `missed by ${Math.max(1, Math.round(r.offsetDeg - c.halfAngle))}° (estimate)`;
}

/** NASA's WSA-ENLIL prediction for one planet, or null when DONKI lists no ENLIL run for this CME. */
export function enlilText(c: RadarCme, planet: Planet): string | null {
  if (!c.enlil) return null;
  const a = c.enlil[planet];
  const P = NAME[planet];
  if (!a) return `NASA's ENLIL model predicted no hit at ${P}`;
  const kind = a.glancing ? 'a glancing blow' : a.minor ? 'a minor impact' : 'a hit';
  const ms = Date.parse(a.time);
  return `NASA's ENLIL model predicted ${kind} at ${P}${Number.isFinite(ms) ? ` on ${timeText(ms)}` : ''}`;
}

export function cmeHeadline(c: RadarCme): string {
  return `CME on ${dayText(c.startMs)}, ${kms(c.speed)}, headed ${directionText(c.stonyLon)}`;
}

/** One sentence per CME, e.g. "CME on Nov 5, 1,048 km/s, headed 40° west of Earth: it reached Mars' distance about 3 days later (estimate). NASA's ENLIL model predicted a glancing blow at Mars on Nov 8, 06:00 UTC." */
export function cmeSentence(c: RadarCme, endMs: number, planet: Planet = 'mars'): string {
  const enlil = enlilText(c, planet);
  return `${cmeHeadline(c)}: it ${modelText(c, planet, endMs)}.${enlil ? ` ${enlil}.` : ''}`;
}

export type RadarSource = 'live' | 'archive' | 'replay';

/** The radar's text summary (also its accessible description). One string per sentence. */
export function summaryLines(data: RadarData, n: RadarCounts, source: RadarSource): string[] {
  const from = dayText(data.startMs);
  const to = dayText(Math.max(data.startMs, data.endMs - 1), true);
  const lines: string[] = [];
  if (source === 'replay') lines.push(`Replay: ${from} to ${to}, the month of the giant May 2024 solar storms (real data, not live).`);
  lines.push(`From ${from} to ${to}, NASA's DONKI database lists ${plural(n.total, 'CME')} (coronal mass ejections: giant clouds the Sun throws into space).`);
  if (n.total === 0) return lines;
  const one = n.directed === 1;
  const rest = n.total - n.directed;
  lines.push(
    rest === 0
      ? 'All of them have a measured direction, so all are on the radar.'
      : `${n.directed} ${one ? 'has' : 'have'} a measured direction and ${one ? 'is' : 'are'} on the radar. The other ${rest} ${rest === 1 ? 'was' : 'were'} measured from only one viewpoint, so DONKI gives no direction for ${rest === 1 ? 'it' : 'them'}.`,
  );
  if (calmForMars(n)) {
    lines.push(`The Sun was calm toward Mars${source === 'replay' ? '' : ' this month'}: ${plural(n.total, 'CME')}, none headed for Mars.`);
  } else {
    const later = n.modelMarsLater ? `, and ${n.modelMarsLater} more ${n.modelMarsLater === 1 ? 'is' : 'are'} still on the way` : '';
    lines.push(
      `Mars: our simple model says ${plural(n.modelMars, 'CME')} reached Mars' distance with Mars inside the cloud's cone${later} (estimate). NASA's ENLIL model predicted ${plural(n.enlilMars, 'CME')} would reach Mars.`,
    );
  }
  const laterE = n.modelEarthLater ? `, plus ${n.modelEarthLater} still on the way` : '';
  lines.push(`Earth: our simple model says ${n.modelEarth}${laterE} (estimate); NASA's ENLIL model predicted ${n.enlilEarth}.`);
  if (n.fastest) lines.push(`Fastest: ${kms(n.fastest.speed)} on ${dayText(n.fastest.startMs)}, headed ${directionText(n.fastest.stonyLon)}.`);
  return lines;
}
