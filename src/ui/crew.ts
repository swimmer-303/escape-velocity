// Written with AI assistance (Claude Code). See README "Use of AI tools".
// "Meet your crew": portraits, names and roles. Each crew's portraits share one sprite sheet
// (one square cell per astronaut, left to right), and CSS shows one cell per portrait.

import { h } from './dom';
import { crewFor, crewQuote, type CrewRoster } from '../data/crew';

/** One astronaut's portrait, cut from the crew's sprite sheet with CSS. */
export function crewPortrait(roster: CrewRoster, index: number): HTMLElement {
  const n = roster.members.length;
  const m = roster.members[index];
  const x = n > 1 ? (index / (n - 1)) * 100 : 0;
  return h('div', {
    class: 'crew-face',
    role: 'img',
    'aria-label': `${m.name}, ${m.role} (AI-generated portrait)`,
    style: `background-image:url(${roster.sheet});background-size:${n * 100}% auto;background-position:${x}% 0`,
  });
}

/** The roster block for the expedition intro. */
export function meetCrew(expedition: number): HTMLElement {
  const roster = crewFor(expedition);
  return h(
    'section',
    { class: 'crew', 'aria-label': 'Meet your crew' },
    h('h3', null, 'Meet your crew'),
    h(
      'ul',
      { class: 'crew-grid' },
      roster.members.map((m, i) =>
        h(
          'li',
          { class: 'crew-card' },
          crewPortrait(roster, i),
          h('b', { class: 'crew-name' }, m.name),
          h('span', { class: 'crew-role' }, m.role),
          h('span', { class: 'crew-fact' }, m.fact),
        ),
      ),
    ),
    h('p', { class: 'crew-note' }, 'Crew portraits are AI-generated art. Everyone on the crew is made up.'),
  );
}

/** A one-line word from a crew member for the end screen. */
export function crewSays(expedition: number, won: boolean): HTMLElement {
  const roster = crewFor(expedition);
  const q = crewQuote(expedition, won);
  return h('div', { class: 'crew-says' }, crewPortrait(roster, q.index), h('p', null, h('b', null, `${q.member.name} says: `), `"${q.line}"`));
}
