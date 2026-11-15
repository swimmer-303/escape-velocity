// Written with AI assistance (Claude Code). See README "Use of AI tools".
// Flight school: a row of buttons on the title screen to replay either mini-game on Mars or the Moon any time, for
// practice and better medals. Practice needs no mission: it runs in its own layer over the title screen.

import { h, clear } from '../../ui/dom';
import { metaContext } from '../hooks';
import { medalIcon } from './engine';
import { bestMedal, playFlight, type FlightOutcome } from './session';
import { sceneryOf } from './scenery';
import { MEDAL_NAME, type FlightGame } from './store';
import type { FlightSite } from './physics';

const ENTRIES: Array<{ game: FlightGame; site: FlightSite; label: string }> = [
  { game: 'landing', site: 'mars', label: 'Land on Mars' },
  { game: 'landing', site: 'moon', label: 'Land on the Moon' },
  { game: 'launch', site: 'mars', label: 'Launch from Mars' },
  { game: 'launch', site: 'moon', label: 'Launch from the Moon' },
];

let busy = false;

/** Open a practice flight over whatever is on screen. Resolves when the player is done. */
export async function practice(game: FlightGame, site: FlightSite): Promise<FlightOutcome | null> {
  if (busy) return null;
  busy = true;
  const host = h('div', { class: 'ev-flight-host' });
  document.body.append(host);
  try {
    const meta = metaContext();
    return await playFlight(
      { game, site, scenery: sceneryOf(site), crew: 4, practice: true },
      {
        root: host,
        audio: meta?.audio ?? null,
        reducedMotion: meta?.reducedMotion() ?? false,
        inert: [document.getElementById('app'), document.getElementById('modal-root')],
      },
    );
  } finally {
    host.remove();
    busy = false;
  }
}

function entryButton(e: (typeof ENTRIES)[number], refresh: () => void): HTMLButtonElement {
  const best = bestMedal(e.game, e.site);
  const btn = h(
    'button',
    {
      class: 'btn small ev-fs-btn',
      type: 'button',
      'data-flight-school': `${e.game}-${e.site}`,
      'aria-label': `${e.label}. ${best ? `Best medal: ${MEDAL_NAME[best]}` : 'No medal yet'}`,
    },
    medalIcon(best ?? 'none'),
    h('span', null, e.label),
  );
  btn.addEventListener('click', () => {
    metaContext()?.audio.sfx('click');
    void practice(e.game, e.site).then(() => {
      refresh();
      // Back to the button the player came from (it was redrawn with the new medal).
      document.querySelector<HTMLElement>(`[data-flight-school="${e.game}-${e.site}"]`)?.focus();
    });
  });
  return btn;
}

/** The Flight school panel for the title screen. */
export function renderFlightSchool(): HTMLElement {
  const row = h('div', { class: 'ev-fs-row' });
  const refresh = () => {
    clear(row);
    for (const e of ENTRIES) row.append(entryButton(e, refresh));
  };
  refresh();
  // A lobby tile group (one grid cell, styled like the tiles in src/meta/tile.ts) with the four flights inside.
  const medals = ENTRIES.filter((e) => bestMedal(e.game, e.site)).length;
  return h(
    'section',
    { class: 'ev-flight-school title-tile-group accent-cyan', 'data-tile': 'flight-school', 'aria-label': 'Flight school' },
    h('div', { class: 'ev-fs-head' }, h('b', null, 'Flight school'), h('span', null, `Practice landing and launching. ${medals} of ${ENTRIES.length} medals.`)),
    row,
  );
}
