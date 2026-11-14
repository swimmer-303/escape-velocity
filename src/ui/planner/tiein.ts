// Written with AI assistance (Claude Code). See README "Use of AI tools".
// One line for the launch end screen: how fast the rocket really had to go to head home.
// This file stays tiny because it is in the main bundle; the orbit math loads only when the line is shown.

import { h } from '../dom';

const found = new Map<number, string>();

/**
 * A paragraph that fills itself in: the best real trip home in the crew's launch window (crew 1 = the next window
 * after today, crew 2 = the one after that, and so on, matching the game's 26 months between crews).
 */
export function tripHomeLine(crew: number, now = new Date()): HTMLElement {
  const p = h('p', { class: 'tp-endline' });
  const n = Math.max(1, Math.min(3, Math.round(crew) || 1));
  const show = (text: string) => {
    p.textContent = text;
  };
  const cached = found.get(n);
  if (cached) {
    show(cached);
    return p;
  }
  p.hidden = true;
  Promise.all([import('../../orbits/transfer'), import('../../orbits/ephemeris')])
    .then(([{ bestTrips, escapeSpeed }, { daysSinceJ2000, msFromJ2000Days }]) => {
      const today = daysSinceJ2000(now.getTime());
      const trips = bestTrips('mars', 'earth', today, Math.min(today + n * 800 + 200, daysSinceJ2000(Date.UTC(2049, 6, 1))));
      const t = trips[n - 1];
      if (!t) return;
      const when = new Date(msFromJ2000Days(t.depart)).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
      const text = `To fly home in a real launch window (leaving Mars in ${when}), the rocket had to reach about ${t.surfaceSpeed.toFixed(1)} km/s: escape speed plus ${(t.surfaceSpeed - escapeSpeed('mars')).toFixed(1)} km/s more to head for Earth.`;
      found.set(n, text);
      show(text);
      p.hidden = false;
    })
    .catch(() => {
      /* the line is extra: if the math can't load, the end screen is still complete */
    });
  return p;
}
