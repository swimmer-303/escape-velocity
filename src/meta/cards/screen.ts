// Written with AI assistance (Claude Code). See README "Use of AI tools".
// Storm Cards: the collection screen (a binder of every real storm there is to find), the detail view of one
// card, and the compact row on the title screen.

import { h, clear } from '../../ui/dom';
import { metaContext } from '../hooks';
import { cardFace, cardSummary, miniCard } from './art';
import {
  cardDate,
  cardDateTime,
  cardTitle,
  classMeaning,
  isFarSideGiant,
  kindWord,
  locationWords,
  rarityOf,
  rarityRank,
  RARITIES,
  RARITY_RULES,
  RARITY_WORD,
  strength,
  type CardFacts,
  type Rarity,
} from './rarity';
import { loadCollection, saveCollection, takeFresh, type Collection, type StoredCard } from './store';
import { may2024Ids, may2024Set, newFromTheSun, possibleCards, watchFeed, type FromTheSun } from './pool';

export type Filter = 'all' | Rarity | 'may2024' | 'new';
export type Sort = 'date' | 'rarity';

/** What the screen shows, kept while the player moves between the grid and a card. */
const view: { filter: Filter; sort: Sort; showMissing: boolean; allMissing: boolean } = {
  filter: 'all',
  sort: 'rarity',
  showMissing: true,
  allMissing: false,
};
const MISSING_LIMIT = 48;

const byDate = (a: CardFacts, b: CardFacts) => (Date.parse(b.time) || 0) - (Date.parse(a.time) || 0);
const byRarity = (a: CardFacts, b: CardFacts) =>
  rarityRank(rarityOf(b)) - rarityRank(rarityOf(a)) ||
  Number(isFarSideGiant(b)) - Number(isFarSideGiant(a)) ||
  strength(b) - strength(a) ||
  byDate(a, b);

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;
}

function dateRange(a: string, b: string): string {
  const da = cardDate(a);
  const db = cardDate(b);
  if (da === db) return da;
  const ya = da.slice(-4);
  return ya === db.slice(-4) ? `${da.slice(0, -6)} to ${db}` : `${da} to ${db}`;
}

/** "3 new real storms on the Sun this week (Nov 7 to Nov 11, 2026)". Only ever from a LIVE feed. */
export function fromTheSunText(s: FromTheSun): string {
  const n = s.events.length;
  const range = dateRange(s.events[0].time, s.events[n - 1].time);
  return `${plural(n, 'new real storm')} on the Sun${s.thisWeek ? ' this week' : ''} (${range}): play missions to collect ${n === 1 ? 'it' : 'them'}`;
}

function rarityChip(r: Rarity, text: string): HTMLElement {
  return h('span', { class: `sc-chip sc-${r}` }, h('i', { 'aria-hidden': 'true' }), text);
}

// ------------------------------------------------------------------ collection screen
export interface CollectionOpts {
  /** Card ids collected since the last visit. */
  fresh?: Set<string>;
  now?: Date;
  onOpen(id: string): void;
  onBack(): void;
}

export function renderCollection(col: Collection, o: CollectionOpts): HTMLElement {
  const fresh = o.fresh ?? new Set<string>();
  const possible = possibleCards(col);
  const owned = Object.values(col.cards);
  const setIds = may2024Ids();
  const setGot = may2024Set().filter((c) => col.cards[c.id]).length;
  const sun = newFromTheSun(col, o.now);

  const counts = RARITIES.map((r) => ({
    r,
    got: owned.filter((c) => rarityOf(c) === r).length,
    all: possible.all.filter((c) => rarityOf(c) === r).length,
  })).reverse();

  const host = h('div', { class: 'sc-lists' });
  const filterBtns: HTMLButtonElement[] = [];
  const sortBtns: HTMLButtonElement[] = [];

  const pass = (c: CardFacts) =>
    view.filter === 'all' ||
    (view.filter === 'may2024' ? setIds.has(c.id) : view.filter === 'new' ? fresh.has(c.id) : rarityOf(c) === view.filter);

  const draw = () => {
    for (const b of filterBtns) b.setAttribute('aria-pressed', String(b.dataset.key === view.filter));
    for (const b of sortBtns) b.setAttribute('aria-pressed', String(b.dataset.key === view.sort));
    clear(host);
    const cmp = view.sort === 'date' ? byDate : byRarity;
    const mine = owned.filter(pass).sort(cmp);
    const missing = view.filter === 'new' ? [] : possible.missing.filter(pass).sort(cmp);
    host.append(
      h('h3', { class: 'sc-sub' }, `Your cards (${mine.length.toLocaleString('en-US')})`),
      mine.length
        ? h(
            'ul',
            { class: 'sc-grid', role: 'list' },
            ...mine.map((c) =>
              h(
                'li',
                null,
                h(
                  'button',
                  { class: 'sc-card', type: 'button', 'data-id': c.id, 'aria-label': cardSummary(c, col.cards[c.id], fresh.has(c.id)), onclick: () => o.onOpen(c.id) },
                  cardFace(c, { stored: col.cards[c.id], fresh: fresh.has(c.id), inSet: setIds.has(c.id) }),
                ),
              ),
            ),
          )
        : h(
            'p',
            { class: 'sc-empty' },
            owned.length
              ? 'No cards match this filter yet.'
              : 'No cards yet. Every real solar storm your crew faces in a mission becomes a card here.',
          ),
    );
    if (view.filter !== 'new') {
      const shown = view.allMissing ? missing : missing.slice(0, MISSING_LIMIT);
      host.append(
        h(
          'div',
          { class: 'sc-missing-head' },
          h('h3', { class: 'sc-sub', tabindex: '-1' }, `Not found yet (${missing.length.toLocaleString('en-US')})`),
          h(
            'label',
            { class: 'sc-check' },
            h('input', {
              type: 'checkbox',
              checked: view.showMissing ? true : undefined,
              onchange: (e: Event) => {
                view.showMissing = (e.target as HTMLInputElement).checked;
                draw();
                host.querySelector<HTMLInputElement>('.sc-check input')?.focus();
              },
            }),
            'Show them',
          ),
        ),
      );
      if (view.showMissing && missing.length) {
        host.append(
          h('p', { class: 'sc-hint' }, view.filter === 'may2024' ? 'Play "May 2024 storms" on the title screen to meet these real storms.' : 'Play missions to meet these storms. Each one is a real event NASA recorded.'),
          h(
            'ul',
            { class: 'sc-grid', role: 'list' },
            ...shown.map((c) => {
              const r = rarityOf(c);
              return h(
                'li',
                null,
                h(
                  'div',
                  { class: `sc-card sc-missing sc-${r}` },
                  h(
                    'div',
                    { class: 'sc-face' },
                    h('div', { class: 'sc-head' }, h('span', { class: 'sc-rarity' }, RARITY_WORD[r])),
                    h('div', { class: 'sc-shadow', 'aria-hidden': 'true' }, '?'),
                    h('div', { class: 'sc-kind' }, 'Not found yet'),
                    h('div', { class: 'sc-hint-small' }, setIds.has(c.id) ? 'May 2024 set' : 'Play missions to meet this storm'),
                    h('span', { class: 'sr-only' }, `A ${RARITY_WORD[r]} card, not found yet: play missions to meet this storm.`),
                  ),
                ),
              );
            }),
          ),
        );
        if (shown.length < missing.length)
          host.append(
            h(
              'button',
              {
                class: 'btn small sc-more',
                type: 'button',
                onclick: () => {
                  view.allMissing = true;
                  draw();
                  host.querySelector<HTMLElement>('.sc-missing-head h3')?.focus();
                },
              },
              `Show all ${missing.length.toLocaleString('en-US')}`,
            ),
          );
      }
    }
  };

  const filterBtn = (key: Filter, text: string) => {
    const b = h(
      'button',
      {
        class: 'btn small sc-filter',
        type: 'button',
        'data-key': key,
        'aria-pressed': 'false',
        onclick: () => {
          view.filter = key;
          view.allMissing = false;
          draw();
        },
      },
      text,
    );
    filterBtns.push(b);
    return b;
  };
  const sortBtn = (key: Sort, text: string) => {
    const b = h(
      'button',
      {
        class: 'btn small sc-sort',
        type: 'button',
        'data-key': key,
        'aria-pressed': 'false',
        onclick: () => {
          view.sort = key;
          draw();
        },
      },
      text,
    );
    sortBtns.push(b);
    return b;
  };

  const el = h(
    'div',
    { class: 'sc sc-screen' },
    h('h2', null, 'Storm Cards'),
    h(
      'p',
      { class: 'sc-total' },
      h('b', null, `${owned.length.toLocaleString('en-US')} of ${possible.all.length.toLocaleString('en-US')}`),
      ' real storms collected. Every card is a real solar storm from NASA\'s DONKI database that one of your crews faced.',
    ),
    h('div', { class: 'sc-counts', role: 'list', 'aria-label': 'Cards by rarity' }, ...counts.map((c) => h('span', { role: 'listitem' }, rarityChip(c.r, `${RARITY_WORD[c.r]} ${c.got} of ${c.all}`)))),
    sun ? h('p', { class: 'sc-sun' }, h('span', { class: 'tag live' }, 'Live'), ' ', fromTheSunText(sun), '.') : null,
    setCard(col, setGot),
    howRarityWorks(),
    h(
      'div',
      { class: 'sc-controls' },
      h(
        'div',
        { class: 'sc-filters', role: 'group', 'aria-label': 'Show' },
        filterBtn('all', 'All'),
        ...RARITIES.slice()
          .reverse()
          .map((r) => filterBtn(r, RARITY_WORD[r])),
        filterBtn('may2024', 'May 2024 set'),
        filterBtn('new', fresh.size ? `New (${fresh.size})` : 'New'),
      ),
      h('div', { class: 'sc-sorts', role: 'group', 'aria-label': 'Sort by' }, h('span', { class: 'kicker' }, 'Sort'), sortBtn('rarity', 'Rarity'), sortBtn('date', 'Date')),
    ),
    host,
    h('div', { class: 'actions' }, h('button', { class: 'btn primary', type: 'button', onclick: o.onBack }, 'Back to the title screen')),
  );
  draw();
  return el;
}

function setCard(col: Collection, got: number): HTMLElement | null {
  const set = may2024Set();
  if (!set.length) return null;
  const done = got === set.length;
  return h(
    'div',
    { class: `sc-set${done ? ' done' : ''}` },
    h('div', { class: 'kicker' }, `May 2024 set: ${got} of ${set.length}${done ? ': complete!' : ''}`),
    h(
      'ul',
      { class: 'sc-set-row', role: 'list' },
      ...set.map((c) =>
        h('li', { 'aria-label': col.cards[c.id] ? cardTitle(c) : `${RARITY_WORD[rarityOf(c)]} card, not found yet` }, col.cards[c.id] ? miniCard(c) : h('span', { class: `sc-mini sc-mini-missing sc-${rarityOf(c)}`, 'aria-hidden': 'true' }, h('b', null, '?'))),
      ),
    ),
    h(
      'p',
      { class: 'sc-hint' },
      done
        ? 'You met every storm of the real May 2024 sequence, including the far-side giant.'
        : 'The real storms of May 2024, which gave Earth its strongest geomagnetic storm in over 20 years. Play "May 2024 storms" to meet them all.',
    ),
  );
}

function howRarityWorks(): HTMLElement {
  const letters = ['A', 'B', 'C', 'M', 'X'];
  return h(
    'details',
    { class: 'sc-how' },
    h('summary', { class: 'kicker' }, 'How rarity works'),
    h('p', null, 'Rarity comes from NASA\'s real measurements, never from luck. Solar flares are sorted by how bright their X-ray flash is, using the letters A, B, C, M and X. Each letter is 10 times stronger than the one before.'),
    h(
      'ol',
      { class: 'sc-ladder', 'aria-label': 'The flare scale, weakest to strongest' },
      ...letters.map((l, i) => h('li', { style: `--step:${i}` }, h('b', null, l), i > 0 ? h('span', null, `10 times ${letters[i - 1]}`) : h('span', null, 'weakest'))),
    ),
    h('p', null, 'So an X1 flare is 10 times stronger than an M1, and 100 times stronger than a C1. The number after the letter goes up inside the letter: an M5 is 5 times an M1. The game only uses C, M and X flares.'),
    h('ul', { class: 'sc-rules' }, ...RARITY_RULES.map((r) => h('li', null, rarityChip(r.rarity, RARITY_WORD[r.rarity]), ' ', r.text))),
  );
}

// ------------------------------------------------------------------ one card
export interface DetailOpts {
  inSet?: boolean;
  onBack(): void;
  onTitle(): void;
}

export function renderDetail(c: StoredCard, o: DetailOpts): HTMLElement {
  const rarity = rarityOf(c);
  const far = isFarSideGiant(c);
  const facts: HTMLElement[] = [];
  const row = (k: string, ...v: Array<Node | string | null>) => facts.push(h('div', { class: 'sc-fact' }, h('dt', null, k), h('dd', null, ...v)));

  const when = cardDateTime(c.time);
  row(c.kind === 'cme' ? 'Left the Sun' : 'When', when || 'Not in the record');
  if (c.region) row('Sunspot region', `${c.region} (NOAA's number for that group of sunspots)`);
  const where = locationWords(c.location);
  if (where) row('Where on the Sun', where);
  else if (far) row('Where on the Sun', 'DONKI lists no spot for it: Earth could not see where it erupted, because it came from the far side of the Sun.');
  if (c.kind === 'cme' && c.speedKms) row('Speed', `${Math.round(c.speedKms).toLocaleString('en-US')} km/s, measured by NASA's analysts.`);

  const meaning: HTMLElement[] = [];
  if (c.kind === 'flare') {
    const lines = classMeaning(c.classType);
    if (lines.length) meaning.push(h('h3', null, `What ${c.classType!.trim().toUpperCase()} means`), ...lines.map((l) => h('p', null, l)));
  } else if (c.kind === 'sep') {
    meaning.push(
      h('h3', null, 'What a particle storm is'),
      h('p', null, 'A burst of very fast particles thrown out by the Sun. The fastest ones can reach Mars in tens of minutes, which is why crews need a shelter.'),
    );
    if (c.severity === 'major') meaning.push(h('p', null, 'An instrument at Mars recorded this one, so it counts as Epic.'));
  } else {
    meaning.push(h('h3', null, 'What a CME is'), h('p', null, 'A coronal mass ejection: a giant cloud of the Sun\'s gas thrown out into space.'));
  }
  if (c.linkedSep) meaning.push(h('p', null, 'NASA also recorded a burst of fast particles from it.'));

  const shield =
    c.shieldedCount > 0
      ? `Shielded: your crew was safe in the powered shelter ${c.shieldedCount === c.count ? (c.count === 1 ? 'that time' : 'every time') : `${c.shieldedCount} of ${c.count} times`}.`
      : 'Not shielded yet. Next time this kind of storm is coming, power the shelter with 2 cells.';

  return h(
    'div',
    { class: 'sc sc-detail' },
    h('div', { class: 'sc-detail-card' }, h('div', { class: 'sc-card big', role: 'group', 'aria-label': cardSummary(c, c) }, cardFace(c, { stored: c, inSet: o.inSet, withLink: true }))),
    h(
      'div',
      { class: 'sc-detail-info' },
      h('div', { class: 'kicker' }, `${RARITY_WORD[rarity]}${far ? ': special' : ''} Storm Card`),
      h('h2', null, cardTitle(c)),
      h('p', null, h('span', { class: 'tag real' }, 'Real event'), h('span', { class: `tag ${c.origin}` }, c.origin === 'live' ? 'Live' : 'Archive'), o.inSet ? h('span', { class: 'tag set' }, 'May 2024 set') : null),
      h('dl', { class: 'sc-facts-list' }, ...facts),
      ...meaning,
      c.note ? h('p', { class: 'sc-note' }, h('span', { class: 'tag game' }, 'Note'), ' ', c.note) : null,
      h('h3', null, 'Your crews and this storm'),
      h('p', null, `Met ${c.count === 1 ? 'once' : `${c.count} times`}, first on ${cardDate(c.collectedAt) || 'an earlier mission'}${c.sites.length ? `, on ${c.sites.map((s) => (s === 'moon' ? 'the Moon' : 'Mars')).join(' and ')}` : ''}.`),
      h('p', { class: c.shieldedCount > 0 ? 'sc-shielded' : '' }, shield),
      h(
        'p',
        { class: 'sc-source' },
        c.origin === 'live'
          ? 'Data: fetched live from NASA DONKI (Space Weather Database) when your crew met it. '
          : 'Data: a stored copy of NASA DONKI (Space Weather Database) records. Real, just not fetched today. ',
        c.link ? h('a', { href: c.link, target: '_blank', rel: 'noopener' }, 'See the NASA record') : null,
      ),
      h(
        'div',
        { class: 'actions' },
        h('button', { class: 'btn primary', type: 'button', onclick: o.onBack }, 'Back to Storm Cards'),
        h('button', { class: 'btn small', type: 'button', onclick: o.onTitle }, 'Title screen'),
      ),
    ),
    // The kind word, for anyone reading the card without the picture.
    h('span', { class: 'sr-only' }, kindWord(c)),
  );
}

// ------------------------------------------------------------------ opening the screens
let fresh = new Set<string>();

/** Open the Storm Cards screen (from the title screen). */
export function openStormCards(): void {
  const ctx = metaContext();
  if (!ctx) return;
  watchFeed();
  view.allMissing = false;
  const col = loadCollection();
  // Cards collected since the last visit are "New" for this visit.
  const justNew = takeFresh(col);
  if (justNew.size) {
    fresh = justNew;
    saveCollection(col);
  }
  showGrid(col);
}

function showGrid(col: Collection, focusId?: string): void {
  const ctx = metaContext();
  if (!ctx) return;
  const back = () => ctx.showTitle();
  const box = ctx.modal(
    renderCollection(col, {
      fresh,
      onOpen: (id) => showCard(col, id),
      onBack: back,
    }),
    { label: 'Storm Cards', wide: true, onClose: back },
  );
  if (focusId) {
    const btn = Array.from(box.querySelectorAll<HTMLButtonElement>('button.sc-card')).find((b) => b.dataset.id === focusId);
    btn?.focus();
    btn?.scrollIntoView?.({ block: 'center' });
  }
}

function showCard(col: Collection, id: string): void {
  const ctx = metaContext();
  const c = col.cards[id];
  if (!ctx || !c) return;
  const back = () => showGrid(col, id);
  ctx.modal(renderDetail(c, { inSet: may2024Ids().has(id), onBack: back, onTitle: () => ctx.showTitle() }), {
    label: `Storm Card: ${cardTitle(c)}`,
    wide: true,
    onClose: back,
  });
}

// ------------------------------------------------------------------ title screen row
export function renderTitleRow(now = new Date()): HTMLElement {
  const col = loadCollection();
  const owned = Object.values(col.cards);
  const possible = possibleCards(col);
  const sun = newFromTheSun(col, now);
  const unseen = owned.filter((c) => c.fresh).length;
  const counts = RARITIES.slice()
    .reverse()
    .map((r) => ({ r, n: owned.filter((c) => rarityOf(c) === r).length }));
  return h(
    'section',
    { class: 'sc sc-row', 'aria-label': 'Storm Cards' },
    h(
      'div',
      { class: 'sc-row-main' },
      h('span', { class: 'sc-row-icon', 'aria-hidden': 'true' }, h('i', null), h('i', null), h('i', null)),
      h(
        'div',
        { class: 'sc-row-text' },
        h('b', null, 'Storm Cards'),
        h('span', { class: 'sc-row-count' }, `${owned.length.toLocaleString('en-US')} of ${possible.all.length.toLocaleString('en-US')} collected`),
        owned.length
          ? h('span', { class: 'sc-row-rarity' }, ...counts.filter((c) => c.n > 0).map((c) => rarityChip(c.r, `${c.n} ${RARITY_WORD[c.r]}`)))
          : h('span', { class: 'sc-row-rarity' }, 'Real NASA storms your crews face become cards.'),
      ),
      h(
        'button',
        { class: 'btn small cyan sc-open', type: 'button', onclick: () => openStormCards() },
        'Open Storm Cards',
        unseen ? h('span', { class: 'sc-badge' }, `${unseen} new`) : null,
      ),
    ),
    sun ? h('p', { class: 'sc-row-sun' }, h('span', { class: 'tag live' }, 'Live'), ' ', fromTheSunText(sun)) : null,
  );
}
