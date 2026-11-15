// Written with AI assistance (Claude Code). See README "Use of AI tools".
// Rover Expeditions screens built from plain DOM: the lobby tile, the start card (site, controls, Science notes,
// Start, Museum, Close), the Sample Museum, and the results card. The 3D drive itself loads only after Start
// (./game.ts), so none of this pulls three.js into the title screen.

import { h, clear } from '../../ui/dom';
import { metaContext, type MetaContext } from '../hooks';
import { titleTile } from '../tile';
import { toast } from '../toast';
import { roverIcon, rarityTag, sampleIcon } from './icons';
import { SAMPLE_KINDS, sampleKind, RARITIES, type Rarity } from './samples';
import { DUST_DEVIL_NOTE, SHARED_NOTES, SITES, SITE_INFO, type RoverSite } from './sites';
import { defaultSite, gotToday, loadStore, type RoverStore } from './store';
import { targetCount, todayKey } from './targets';
import type { BankResult } from './bank';

export const START_LABEL = 'Rover Expeditions';
export const MUSEUM_LABEL = 'Sample Museum';

/** The battery lesson, in one sentence (the same lesson as the base: no choice is free). */
export const LESSON =
  'Driving far, driving fast, climbing and boosting all drain the battery, so good explorers save enough power to get home.';

/** Targets left today at a site. */
export function targetsLeft(site: RoverSite, date = todayKey(), store: RoverStore = loadStore()): number {
  const got = gotToday(store, site, date);
  const n = targetCount(site, date);
  let left = 0;
  for (let i = 0; i < n; i++) if (!got.has(`${date}:${site}:${i}`)) left++;
  return left;
}

function leftText(n: number): string {
  return n > 0 ? `${n} new ${n === 1 ? 'target' : 'targets'} today` : 'All found today. New ones tomorrow';
}

// ------------------------------------------------------------------ lobby tile
export function renderTile(): HTMLElement {
  const store = loadStore();
  const date = todayKey();
  const site = defaultSite(store);
  const left = targetsLeft(site, date, store);
  return titleTile({
    id: 'rover',
    name: 'Rover Expeditions',
    sub: leftText(left),
    icon: roverIcon(48),
    badge: left > 0 && store.lastPlayed !== date ? 'NEW' : undefined,
    accent: 'green',
    onClick: () => {
      const ctx = metaContext();
      if (!ctx) return;
      ctx.audio.sfx('click');
      openStart(ctx);
    },
  });
}

// ------------------------------------------------------------------ start card
let starting = false;

/** "Sample Museum: 3 of 20 found. Best trip: 4 samples." */
function progressLine(store: RoverStore): HTMLElement {
  const { found, total } = museumCounts(store);
  const best = Math.max(...SITES.map((s) => store.best[s].haul));
  return h(
    'p',
    { class: 'ev-rover-progress' },
    h('b', null, 'Sample Museum: '),
    `${found} of ${total} found.`,
    best > 0 ? ` Best trip: ${best} ${best === 1 ? 'sample' : 'samples'}.` : ' Bank your first sample today!',
  );
}

function keyRow(keys: string[], what: string): HTMLElement {
  return h('li', null, ...keys.map((k) => h('kbd', null, k)), h('span', null, what));
}

/** Open the start card in the game's dialog layer. */
export function openStart(ctx: MetaContext, pick?: RoverSite): HTMLElement {
  const store = loadStore();
  const date = todayKey();
  let site: RoverSite = pick ?? defaultSite(store);
  const back = () => {
    ctx.closeModal();
    ctx.showTitle();
  };

  const notes = h('div', { class: 'ev-rover-notes' });
  const drawNotes = () => {
    clear(notes);
    notes.append(h('ul', null, ...[...SITE_INFO[site].notes, ...(SITE_INFO[site].world === 'mars' ? [DUST_DEVIL_NOTE] : []), ...SHARED_NOTES].map((n) => h('li', null, n))));
  };

  const choices = h(
    'div',
    { class: 'ev-rover-sites', role: 'radiogroup', 'aria-label': 'Where to drive' },
    ...SITES.map((s) => {
      const left = targetsLeft(s, date, store);
      const input = h('input', { type: 'radio', name: 'ev-rover-site', value: s, checked: s === site });
      input.addEventListener('change', () => {
        if (!input.checked) return;
        site = s;
        ctx.audio.sfx('click');
        drawNotes();
      });
      return h(
        'label',
        { class: `ev-rover-site site-${s}`, 'data-site': s },
        input,
        h('span', { class: 'ev-rover-site-text' }, h('b', null, SITE_INFO[s].name), h('span', null, SITE_INFO[s].blurb), h('small', { class: left ? 'left' : 'done' }, leftText(left))),
      );
    }),
  );
  drawNotes();

  const start = h('button', { class: 'btn primary', type: 'button', 'data-rover': 'start', 'data-autofocus': true }, 'Start driving', h('span', { class: 'arrow' }));
  start.addEventListener('click', () => {
    ctx.audio.sfx('click');
    void startDrive(ctx, site);
  });

  const box = ctx.modal(
    h(
      'div',
      { class: 'ev-rover-start' },
      h('div', { class: 'kicker' }, 'Rover Expeditions'),
      h('h2', null, 'Explore the real ground around your base'),
      h('p', null, 'Drive out, scan science targets, and bring your samples home to the charging pad before the battery runs out.'),
      progressLine(store),
      choices,
      h(
        'div',
        { class: 'ev-rover-help' },
        h('b', null, 'How to drive'),
        h(
          'ul',
          { class: 'ev-rover-keys' },
          keyRow(['W', 'S'], 'or the up and down arrows: drive and back up'),
          keyRow(['A', 'D'], 'or the left and right arrows: steer'),
          keyRow(['Space'], 'or E: hold near a target to scan it'),
          keyRow(['Shift'], 'boost (uses a lot more battery)'),
          keyRow(['L'], 'headlights'),
          keyRow(['Esc'], 'end the trip'),
        ),
        h('p', { class: 'ev-rover-touch' }, 'On a touch screen or with a mouse: drag the joystick, and hold the SCAN and BOOST buttons.'),
        h('p', { class: 'ev-rover-tradeoff' }, h('b', null, 'The catch: '), 'your battery drains as you drive. Speed, hills, boost and lights use more. Get back to the pad to bank your samples.'),
      ),
      h('details', { class: 'ev-rover-science' }, h('summary', null, 'Science notes: what is real here?'), notes),
      h(
        'div',
        { class: 'actions' },
        start,
        h('button', { class: 'btn', type: 'button', 'data-rover': 'museum', onclick: () => (ctx.audio.sfx('click'), openMuseum(ctx, () => openStart(ctx, site))) }, 'Sample Museum'),
        h('button', { class: 'btn small', type: 'button', 'data-rover': 'close', onclick: back }, 'Close'),
      ),
    ),
    { label: START_LABEL, onClose: back },
  );
  box.classList.add('ev-rover-modal');
  box.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || e.defaultPrevented) return;
    e.preventDefault();
    back();
  });
  return box;
}

/** Start a drive: close the dialog, load the 3D game, and come back to the title screen when done. */
export async function startDrive(ctx: MetaContext, site: RoverSite): Promise<void> {
  if (starting) return;
  starting = true;
  ctx.closeModal();
  const host = h('div', { class: 'ev-rover-host' });
  document.body.append(host);
  try {
    const game = await import('./game');
    await game.runExpedition(site, {
      root: host,
      audio: ctx.audio,
      reducedMotion: ctx.reducedMotion(),
      inert: [document.getElementById('app'), document.getElementById('modal-root')],
    });
  } catch (e) {
    console.error('[rover] could not start', e);
    toast('The rover could not start.', 'Check your connection and try again.', { tone: 'amber' });
  } finally {
    host.remove();
    starting = false;
    ctx.showTitle();
  }
}

// ------------------------------------------------------------------ Sample Museum
export function museumCounts(store: RoverStore = loadStore()): { found: number; total: number } {
  return { found: SAMPLE_KINDS.filter((k) => store.museum[k.id]).length, total: SAMPLE_KINDS.length };
}

export function museumView(store: RoverStore = loadStore()): HTMLElement {
  const { found, total } = museumCounts(store);
  const order: Record<Rarity, number> = { common: 0, uncommon: 1, rare: 2, legendary: 3 };
  return h(
    'div',
    { class: 'ev-rover-museum' },
    h('div', { class: 'kicker' }, 'Rover Expeditions'),
    h('h2', null, 'Sample Museum'),
    h('p', { class: 'ev-museum-count' }, `${found} of ${total} kinds found. Every sample here is based on something real that rovers, landers or astronauts found.`),
    ...SITES.map((s) =>
      h(
        'section',
        { class: 'ev-museum-site', 'aria-label': SITE_INFO[s].name },
        h('h3', null, SITE_INFO[s].name),
        h(
          'ul',
          { class: 'ev-museum-grid' },
          ...SAMPLE_KINDS.filter((k) => k.site === s)
            .slice()
            .sort((a, b) => order[a.rarity] - order[b.rarity])
            .map((k) => {
              const e = store.museum[k.id];
              return h(
                'li',
                { class: `ev-museum-item ${k.rarity}${e ? ' found' : ''}`, 'data-kind': k.id },
                h('span', { class: 'ev-museum-icon' }, sampleIcon(k, !!e)),
                h('span', { class: 'ev-museum-text' }, h('b', null, k.name), rarityTag(k.rarity), e ? h('small', null, `Found ${e.count} ${e.count === 1 ? 'time' : 'times'}`) : h('small', null, `Not found yet. Look at ${SITE_INFO[k.site].short}.`)),
                h('p', { class: 'ev-museum-fact' }, e ? k.fact : 'Find this sample to read its fact.'),
              );
            }),
        ),
      ),
    ),
  );
}

export function openMuseum(ctx: MetaContext, back: () => void): HTMLElement {
  const box = ctx.modal(h('div', null, museumView(), h('div', { class: 'actions end' }, h('button', { class: 'btn small', type: 'button', 'data-autofocus': true, onclick: back }, 'Back'))), {
    label: MUSEUM_LABEL,
    wide: true,
    onClose: back,
  });
  box.classList.add('ev-rover-modal');
  box.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || e.defaultPrevented) return;
    e.preventDefault();
    back();
  });
  return box;
}

// ------------------------------------------------------------------ results card
export interface ResultsInfo {
  site: RoverSite;
  result: BankResult;
  distance: number;
  towed: boolean;
  /** Samples the tow had no room for. */
  lost: number;
  left: number;
}

export function resultsCard(r: ResultsInfo): HTMLElement {
  const res = r.result;
  const sorted = res.byKind.slice().sort((a, b) => RARITIES.indexOf(b.rarity) - RARITIES.indexOf(a.rarity));
  return h(
    'div',
    { class: 'ev-rover-results' },
    h('div', { class: 'kicker' }, `${SITE_INFO[r.site].name}: expedition results`),
    h('h2', null, r.towed ? 'Towed home' : res.total ? 'Samples banked!' : 'Back at the pad'),
    r.towed
      ? h(
          'p',
          { class: 'ev-rover-tow' },
          'The battery ran out, so a friendly tow rover brought you home. ',
          r.lost ? `It only had room for ${res.total} of your ${res.total + r.lost} samples. The others are still out there for another try today.` : 'It brought every sample home.',
        )
      : null,
    sorted.length
      ? h(
          'ul',
          { class: 'ev-rover-haul' },
          ...sorted.map((k) => {
            const kind = sampleKind(k.kind)!;
            return h(
              'li',
              { class: k.rarity },
              sampleIcon(kind, true, 32),
              h('span', null, h('b', null, `${k.name}${k.count > 1 ? ` x${k.count}` : ''}`), rarityTag(k.rarity), k.isNew ? h('span', { class: 'ev-rover-new' }, 'New in the Museum') : null),
              h('span', { class: 'ev-rover-xp' }, `+${k.xp} XP`),
            );
          }),
        )
      : h('p', null, 'No samples this time. Drive up to a beacon and hold Scan to collect one.'),
    h(
      'ul',
      { class: 'ev-rover-stats' },
      h('li', null, `Samples banked: ${res.total}`),
      h('li', null, `Distance driven: ${Math.round(r.distance).toLocaleString('en-US')} m`),
      res.total && res.bestHaul.isNew ? h('li', { class: 'best' }, `New best: ${res.total} ${res.total === 1 ? 'sample' : 'samples'} in one trip!`) : null,
      res.bestDistance.isNew && r.distance >= 50 ? h('li', { class: 'best' }, 'New best: your longest drive here!') : null,
    ),
    res.xp > 0 ? h('p', { class: 'ev-flight-xp' }, h('b', null, `+${res.xp} XP`)) : null,
    h('p', { class: 'ev-rover-lesson' }, h('b', null, 'Power lesson: '), LESSON),
    h('p', { class: 'ev-rover-tomorrow' }, r.left > 0 ? `${r.left} ${r.left === 1 ? 'target is' : 'targets are'} still out there today. New targets tomorrow.` : 'You found every target here today. New targets tomorrow!'),
  );
}
