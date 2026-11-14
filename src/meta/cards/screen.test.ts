// @vitest-environment happy-dom
// Written with AI assistance (Claude Code). See README "Use of AI tools".
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderTitleExtras, setMetaContext, type MetaContext } from '../hooks';
import { may2024Pool, RECENT_SNAPSHOT, type DonkiSnapshot } from '../../data/donki';
import type { SpaceWeatherEvent } from '../../sim/types';
import { addMeeting, emptyCollection, saveCollection, type Collection } from './store';
import { poolFacts, setFeedForTests } from './pool';
import { renderCollection, renderDetail } from './screen';
import { rarityOf } from './rarity';
import './index';

const FLARE: SpaceWeatherEvent = {
  id: '2026-11-07T12:26:00-FLR-001',
  kind: 'flare',
  classType: 'M1.2',
  severity: 'moderate',
  time: '2026-11-07T12:43:00.000Z',
  activeRegionNum: 14566,
  sourceLocation: 'N08E20',
  link: 'https://ccmc.gsfc.nasa.gov/DONKI/view/FLR/1/-1',
  origin: 'archive',
};

function withCards(...events: SpaceWeatherEvent[]): Collection {
  const col = emptyCollection();
  for (const e of events) addMeeting(col, e, { shielded: false });
  return col;
}

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '<div id="modal-root"></div>';
  setFeedForTests(null);
});

describe('the Storm Cards screen', () => {
  it('shows the total from the current pool, and the rest as dark silhouettes', () => {
    const total = poolFacts().length;
    expect(total).toBeGreaterThan(150);
    const el = renderCollection(emptyCollection(), { onOpen: () => {}, onBack: () => {} });
    expect(el.querySelector('.sc-total')!.textContent).toContain(`0 of ${total.toLocaleString('en-US')}`);
    expect(el.textContent).toContain('No cards yet');
    const ghosts = el.querySelectorAll('.sc-missing');
    expect(ghosts.length).toBe(48); // the first page
    expect(ghosts[0].textContent).toContain('Not found yet');
    expect(ghosts[0].textContent).toContain('play missions to meet this storm');
    // Sorted by rarity, so the Legendary ones come first.
    expect(ghosts[0].textContent).toContain('Legendary');
    const more = Array.from(el.querySelectorAll('button')).find((b) => b.textContent!.startsWith('Show all'))!;
    more.click();
    expect(el.querySelectorAll('.sc-missing').length).toBe(total);
  });

  it('shows collected cards with their rarity word, real data and tags, and filters them', () => {
    const [x1, , , x87] = may2024Pool();
    const col = withCards(FLARE, x1, x87);
    const opened: string[] = [];
    const el = renderCollection(col, { onOpen: (id) => opened.push(id), onBack: () => {} });
    const total = poolFacts().filter((f) => !col.cards[f.id]).length + 3;
    expect(el.querySelector('.sc-total')!.textContent).toContain(`3 of ${total.toLocaleString('en-US')}`);
    const cards = Array.from(el.querySelectorAll<HTMLButtonElement>('button.sc-card'));
    expect(cards.map((c) => c.querySelector('.sc-big')!.textContent)).toEqual(['X8.7', 'X1.0', 'M1.2']);
    expect(cards[0].querySelector('.sc-rarity')!.textContent).toBe('Legendary');
    expect(cards[0].getAttribute('aria-label')).toContain('X8.7 solar flare, Legendary card');
    expect(cards[0].textContent).toContain('May 14, 2024');
    expect(cards[0].textContent).toContain('Region 13664');
    expect(cards[0].textContent).toContain('Real event');
    expect(cards[0].textContent).toContain('Archive');
    expect(cards[0].querySelector('.sc-foil')).not.toBeNull(); // shimmer for Legendary
    expect(cards[2].querySelector('.sc-foil')).toBeNull();
    // The picture is described for screen readers (a plain stand-in when there is no canvas).
    expect(cards[0].querySelector('[role="img"]')!.getAttribute('aria-label')).toContain('X8.7 flare');
    cards[1].click();
    expect(opened).toEqual([x1.id]);

    const filter = (name: string) => Array.from(el.querySelectorAll<HTMLButtonElement>('.sc-filter')).find((b) => b.textContent!.startsWith(name))!;
    filter('Rare').click();
    expect(filter('Rare').getAttribute('aria-pressed')).toBe('true');
    expect(Array.from(el.querySelectorAll('button.sc-card .sc-big')).map((b) => b.textContent)).toEqual(['M1.2']);
    filter('May 2024 set').click();
    expect(el.querySelectorAll('button.sc-card').length).toBe(2);
    expect(el.querySelectorAll('.sc-missing').length).toBe(3);
    expect(el.querySelector('.sc-set .kicker')!.textContent).toBe('May 2024 set: 2 of 5');

    // Sort by date: newest first.
    filter('All').click();
    Array.from(el.querySelectorAll<HTMLButtonElement>('.sc-sort')).find((b) => b.textContent === 'Date')!.click();
    expect(Array.from(el.querySelectorAll('button.sc-card .sc-big')).map((b) => b.textContent)).toEqual(['M1.2', 'X8.7', 'X1.0']);
    Array.from(el.querySelectorAll<HTMLButtonElement>('.sc-sort')).find((b) => b.textContent === 'Rarity')!.click();
  });

  it('marks new cards and can show only them', () => {
    const col = withCards(FLARE, may2024Pool()[0]);
    const el = renderCollection(col, { fresh: new Set([FLARE.id]), onOpen: () => {}, onBack: () => {} });
    const newBtn = Array.from(el.querySelectorAll<HTMLButtonElement>('.sc-filter')).find((b) => b.textContent!.startsWith('New'))!;
    expect(newBtn.textContent).toBe('New (1)');
    newBtn.click();
    const shown = el.querySelectorAll('button.sc-card');
    expect(shown.length).toBe(1);
    expect(shown[0].querySelector('.sc-new')!.textContent).toBe('New');
    expect(el.querySelectorAll('.sc-missing').length).toBe(0);
    Array.from(el.querySelectorAll<HTMLButtonElement>('.sc-filter')).find((b) => b.textContent === 'All')!.click();
  });

  it('explains how rarity works with the flare scale', () => {
    const el = renderCollection(emptyCollection(), { onOpen: () => {}, onBack: () => {} });
    const how = el.querySelector('.sc-how')!;
    expect(how.textContent).toContain('Each letter is 10 times stronger than the one before');
    expect(Array.from(how.querySelectorAll('.sc-ladder b')).map((b) => b.textContent)).toEqual(['A', 'B', 'C', 'M', 'X']);
    for (const word of ['Common', 'Rare', 'Epic', 'Legendary']) expect(how.textContent).toContain(word);
  });

  it('the detail view: big card, what the class means, the NASA link, how often you met it and if you were shielded', () => {
    const col = emptyCollection();
    const x87 = may2024Pool()[3];
    addMeeting(col, x87, { shielded: false });
    addMeeting(col, x87, { shielded: true });
    const back = vi.fn();
    const el = renderDetail(col.cards[x87.id], { inSet: true, onBack: back, onTitle: () => {} });
    expect(el.querySelector('h2')!.textContent).toBe('X8.7 solar flare');
    expect(el.textContent).toContain('What X8.7 means');
    expect(el.textContent).toContain('87 times as strong as an M1 flare');
    expect(el.textContent).toContain('May 14, 2024 at 16:51 UTC');
    expect(el.textContent).toContain('13664');
    expect(el.textContent).toContain('Met 2 times');
    expect(el.textContent).toContain('1 of 2 times');
    expect(el.querySelector('.sc-stamp')!.textContent).toBe('Shielded');
    const links = Array.from(el.querySelectorAll<HTMLAnchorElement>('a')).filter((a) => a.textContent === 'See the NASA record');
    expect(links.length).toBeGreaterThan(0);
    for (const a of links) {
      expect(a.href).toBe(x87.link);
      expect(a.target).toBe('_blank');
      expect(a.rel).toContain('noopener');
    }
    expect(el.textContent).toContain('stored copy of NASA DONKI');
    Array.from(el.querySelectorAll('button')).find((b) => b.textContent === 'Back to Storm Cards')!.click();
    expect(back).toHaveBeenCalled();
  });

  it('the far-side CME detail tells its speed and why Earth could not see it', () => {
    const far = may2024Pool()[4];
    const col = withCards(far);
    const el = renderDetail(col.cards[far.id], { inSet: true, onBack: () => {}, onTitle: () => {} });
    expect(rarityOf(col.cards[far.id])).toBe('legendary');
    expect(el.textContent).toContain('2,678 km/s');
    expect(el.textContent).toContain('far side of the Sun');
    expect(el.querySelector('.sc-ribbon')!.textContent).toBe('Special');
  });

  it('opens from the title row and goes back to the title', () => {
    saveCollection(withCards(FLARE));
    const showTitle = vi.fn();
    const root = document.getElementById('modal-root')!;
    const ctx = {
      modal: (content: Node, opts: { label: string }) => {
        root.innerHTML = '';
        const box = document.createElement('div');
        box.className = 'modal';
        box.setAttribute('aria-label', opts.label);
        box.append(content);
        root.append(box);
        return box;
      },
      closeModal: () => (root.innerHTML = ''),
      showTitle,
      reducedMotion: () => true,
    } as unknown as MetaContext;
    setMetaContext(ctx);
    const row = renderTitleExtras().find((e) => e.classList.contains('sc-row'))!;
    expect(row).toBeTruthy();
    expect(row.textContent).toContain(`1 of ${poolFacts().length} collected`);
    expect(row.textContent).toContain('1 Rare');
    document.body.append(row);
    const open = row.querySelector<HTMLButtonElement>('button.sc-open')!;
    expect(open.textContent).toBe('Open Storm Cards1 new');
    open.click();
    expect(root.querySelector('[aria-label="Storm Cards"]')).not.toBeNull();
    // Opening the screen shows the card as New once.
    expect(root.querySelector('.sc-new')).not.toBeNull();
    (root.querySelector('button.sc-card') as HTMLButtonElement).click();
    expect(root.querySelector('[aria-label="Storm Card: M1.2 solar flare"]')).not.toBeNull();
    // Only one card: no Previous / Next.
    expect(Array.from(root.querySelectorAll('button')).some((b) => b.textContent === 'Next card')).toBe(false);
    Array.from(root.querySelectorAll('button')).find((b) => b.textContent === 'Back to Storm Cards')!.click();
    expect(root.querySelector('[aria-label="Storm Cards"]')).not.toBeNull();
    Array.from(root.querySelectorAll('button')).find((b) => b.textContent === 'Back to the title screen')!.click();
    expect(showTitle).toHaveBeenCalled();
  });
});

describe('new from the real Sun', () => {
  const liveSnap = (): DonkiSnapshot => ({
    ...RECENT_SNAPSHOT!,
    fetchedAt: '2026-11-14T18:00:00Z',
  });

  it('says how many live storms are newer than anything collected, with real dates', () => {
    setFeedForTests({ status: 'live', snapshot: liveSnap(), fetchedAt: '2026-11-14T18:00:00Z', via: 'proxy' });
    const now = new Date('2026-11-14T10:00:00Z');
    // The player's newest card is the real M1.2 flare of Nov 7, 2026 (12:43 UTC).
    const col = withCards({ ...FLARE, origin: 'live' });
    const newer = RECENT_SNAPSHOT!.flares.filter((f) => Date.parse(f.peakTime!) > Date.parse('2026-11-07T12:43:00Z'));
    expect(newer.length).toBe(6);
    const el = renderCollection(col, { now, onOpen: () => {}, onBack: () => {} });
    const sun = el.querySelector('.sc-sun');
    expect(sun).not.toBeNull();
    expect(sun!.querySelector('.tag.live')!.textContent).toBe('Live');
    expect(sun!.textContent).toContain('6 new real storms on the Sun this week (Nov 7 to Nov 11, 2026): play missions to collect them');

    // The title row says it too.
    saveCollection(col);
    const row = renderTitleExtras().find((e) => e.classList.contains('sc-row'))!;
    expect(row.querySelector('.sc-row-sun .tag.live')).not.toBeNull();
    expect(row.querySelector('.sc-row-sun')!.textContent).toMatch(/\d+ new real storms? on the Sun/);
  });

  it('never says it from archived data', () => {
    setFeedForTests(null); // the stored snapshot, labeled ARCHIVE
    const el = renderCollection(emptyCollection(), { onOpen: () => {}, onBack: () => {} });
    expect(el.querySelector('.sc-sun')).toBeNull();
    expect(el.querySelector('.tag.live')).toBeNull();
  });
});
