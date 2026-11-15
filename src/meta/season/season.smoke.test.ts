// @vitest-environment happy-dom
// Written with AI assistance (Claude Code). See README "Use of AI tools".
// Season 1 inside the real game: the Player Card strip and the Season tile on the title screen, the Season Pass
// screen (claim, gift, archive event offline), the Player Card locker, and a LIVE event from a live feed.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { App } from '../../ui/app';
import { CssStage } from '../../render/stage';
import '../index';
import { addSeasonXp, claimAll, openGift, resetSeasonEngine, seasonState } from './engine';
import { refreshInPlace } from './index';
import { decorateLobby, loadLobby } from '../../ui/lobby';
import { setFeedForTests } from './live';
import { openLocker, openSeason, seasonTile, setQuietToasts, SEASON_LABEL, CARD_LABEL } from './ui';
import { liveFeed, snapshotWith } from './fixtures';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const buttons = (root: ParentNode = document) => [...root.querySelectorAll('button')] as HTMLButtonElement[];
const byText = (re: RegExp, root: ParentNode = document) => buttons(root).find((b) => re.test(b.textContent ?? '')) ?? null;

beforeEach(() => {
  document.body.innerHTML = `<div id="app"><div id="stage"></div><header id="hud"></header><main id="dock"></main></div><div id="modal-root"></div>`;
  localStorage.clear();
  localStorage.setItem('ev-tutorial-done', '1');
  history.replaceState(null, '', '/');
  resetSeasonEngine({ fresh: true });
  setFeedForTests(null);
  setQuietToasts(false);
});

describe('Season 1 on the title screen', () => {
  it('shows the Player Card and Season tile, opens the Season Pass and the locker, and goes back', async () => {
    const fetchSpy = vi.fn(() => Promise.reject(new Error('offline in tests')));
    vi.stubGlobal('fetch', fetchSpy);
    new App(new CssStage());
    await sleep(50);
    const meta = () => document.querySelector<HTMLElement>('#modal-root .title-meta')!;
    const strip = () => meta().querySelector<HTMLElement>('.ss-strip');
    const tile = () => meta().querySelector<HTMLElement>('[data-tile="season"]');
    expect(strip()).not.toBeNull();
    expect(tile()).not.toBeNull();
    const callsign = strip()!.querySelector('.ss-pc-call')!.textContent!;
    expect(callsign).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+ \d{1,2}$/);
    expect(strip()!.textContent).toContain('Junior Astronaut');
    // Order: rank (0), then the Player Card (5), then the Season tile (6), then Storm Cards (20).
    const kids = [...meta().children];
    const rank = kids.findIndex((k) => k.classList.contains('rank-strip'));
    const card = kids.indexOf(strip()!);
    const season = kids.indexOf(tile()!);
    expect(rank).toBeLessThan(card);
    expect(card).toBeLessThan(season);
    expect(tile()!.textContent).toContain('Season 1: Solar Maximum');
    expect(tile()!.textContent).toContain('Tier 1 of 40');
    // Offline: never LIVE.
    expect(tile()!.querySelector('.title-tile-badge')?.textContent).not.toBe('LIVE');
    const callsByGame = fetchSpy.mock.calls.length;

    // The Season Pass screen.
    tile()!.click();
    const screen = () => document.querySelector<HTMLElement>(`#modal-root [aria-label="${SEASON_LABEL}"]`);
    expect(screen()).not.toBeNull();
    expect(screen()!.querySelectorAll('.ss-tier')).toHaveLength(40);
    expect(screen()!.querySelectorAll('.ss-tier.big')).toHaveLength(8);
    expect(screen()!.querySelector('.ss-event.archive')).not.toBeNull();
    expect(screen()!.querySelector('.ss-event.live')).toBeNull();
    expect(screen()!.textContent).toContain('ARCHIVE EVENT');
    expect(screen()!.textContent).toContain('Gannon');
    expect(screen()!.querySelector('.ss-pass')!.compareDocumentPosition(screen()!.querySelector('.ss-event')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen()!.querySelectorAll('.ss-weekly .ss-chal')).toHaveLength(7);
    expect(screen()!.textContent).toMatch(/New challenges in/);
    expect(screen()!.textContent).toContain('Missing a day never resets your progress');
    expect(screen()!.querySelector('.ss-next')).not.toBeNull();
    expect(screen()!.querySelector('.ss-today')!.textContent).toContain('daily missions');

    // Claim tier 1 (the welcome reward).
    screen()!.querySelector<HTMLButtonElement>('[data-tier="1"] .ss-claim')!.click();
    expect(seasonState().claimed).toEqual([1]);
    expect(screen()!.querySelector('[data-tier="1"]')!.classList.contains('claimed')).toBe(true);
    expect(document.activeElement?.closest('[data-tier="1"]')).not.toBeNull();
    // Open today's gift.
    byText(/Open today's gift/, screen()!)!.click();
    expect(seasonState().login.count).toBe(1);
    expect(byText(/Open today's gift/, screen()!)).toBeNull();

    // The Player Card locker.
    byText(/^Player Card$/, screen()!)!.click();
    const locker = () => document.querySelector<HTMLElement>(`#modal-root [aria-label="${CARD_LABEL}"]`);
    expect(locker()).not.toBeNull();
    byText(/New callsign/, locker()!)!.click();
    const fresh = locker()!.querySelector('.ss-callrow b')!.textContent!;
    expect(fresh).not.toBe(callsign);
    // The claimed patch can be worn; a locked title cannot.
    locker()!.querySelector<HTMLButtonElement>('[data-key="patch-p-first-light"]')!.click();
    expect(seasonState().card.patch).toBe('p-first-light');
    locker()!.querySelector<HTMLButtonElement>('[data-key="title-t-storm-chaser"]')!.click();
    expect(seasonState().card.title).toBe('t-junior');
    expect(locker()!.textContent).toContain('Season tier 5');
    expect(locker()!.textContent).toContain('Solar storms survived');

    // Back to the title: the strip shows the new callsign. Season made no network request of its own.
    byText(/Back to title/, locker()!)!.click();
    expect(document.querySelector('#modal-root [aria-label="Escape Velocity title screen"]')).not.toBeNull();
    expect(strip()!.textContent).toContain(fresh);
    expect(fetchSpy.mock.calls.length).toBe(callsByGame);
  });

  it('a reward from a tier already reached says to claim it, not which tier it needs', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new Error('offline in tests')));
    new App(new CssStage());
    await sleep(50);
    addSeasonXp(1000, 'game');
    openLocker();
    const opt = (key: string) => document.querySelector<HTMLElement>(`#modal-root [aria-label="${CARD_LABEL}"] [data-key="${key}"]`)!;
    // Tier 2's title is reached but not claimed yet; tier 8's is still ahead.
    expect(opt('title-t-sun-watcher').textContent).toContain('Claim it in the Season Pass');
    expect(opt('title-t-sun-watcher').textContent).not.toContain('Season tier 2');
    expect(opt('title-t-oxygen-maker').textContent).toContain('Season tier 8');
  });

  it('redraws the Season tile in place, so opening it after a redraw still clears its lobby NEW badge', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new Error('offline in tests')));
    new App(new CssStage());
    await sleep(50);
    // Nothing to claim and no gift: the tile has no badge of its own, so the lobby gives it NEW.
    openGift();
    claimAll();
    const root = document.createElement('div');
    const first = seasonTile();
    root.append(first);
    document.body.append(root);
    decorateLobby(root, true);
    expect(first.querySelector('.lobby-new')).not.toBeNull();
    // The feed arrives and the tile is redrawn: same element, same listeners, NEW kept.
    const after = refreshInPlace(first, seasonTile());
    expect(after).toBe(first);
    expect(after.getAttribute('data-tile')).toBe('season');
    expect(after.querySelector('.lobby-new')).not.toBeNull();
    after.click();
    expect(loadLobby().opened).toContain('season');
    expect(after.querySelector('.lobby-new')).toBeNull();
    // Next time the title is drawn, no NEW.
    const root2 = document.createElement('div');
    root2.append(seasonTile());
    decorateLobby(root2, true);
    expect(root2.querySelector('.lobby-new')).toBeNull();
    // A fresh tile with its own badge (LIVE, a gift) never shows the lobby NEW over it.
    const own = document.createElement('button');
    own.append(Object.assign(document.createElement('span'), { className: 'title-tile-badge', textContent: 'LIVE' }));
    const withNew = document.createElement('button');
    withNew.append(Object.assign(document.createElement('span'), { className: 'title-tile-badge lobby-new', textContent: 'NEW' }));
    refreshInPlace(withNew, own);
    expect(withNew.querySelectorAll('.title-tile-badge')).toHaveLength(1);
    expect(withNew.textContent).toBe('LIVE');
  });

  it('after January 31, 2027 says "Season 1 complete" and still lets players claim and look', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new Error('offline in tests')));
    new App(new CssStage());
    await sleep(50);
    resetSeasonEngine({ fresh: true, clock: () => new Date(2027, 1, 3, 10) });
    const t = seasonTile();
    expect(t.textContent).toContain('Season 1 complete');
    const box = openSeason()!;
    expect(box.textContent).toContain('Season 1 complete');
    expect(box.querySelector('.ss-weekly')).toBeNull();
    expect(box.querySelector('.ss-event')).toBeNull();
    expect(box.querySelector('.ss-gift-open')).toBeNull();
    expect(box.querySelectorAll('.ss-tier')).toHaveLength(40);
    box.querySelector<HTMLButtonElement>('[data-tier="1"] .ss-claim')!.click();
    expect(seasonState().claimed).toEqual([1]);
  });

  it('shows LIVE only when the feed is live with a real big flare, and links its DONKI record', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new Error('offline in tests')));
    new App(new CssStage());
    await sleep(50);
    setFeedForTests(liveFeed(snapshotWith(new Date(), { flares: [{ cls: 'X1.4', hoursAgo: 20, id: '2026-11-14T00:00:00-FLR-001' }] })));
    const t = seasonTile();
    expect(t.querySelector('.title-tile-badge')!.textContent).toBe('LIVE');
    const box = openSeason()!;
    const ev = box.querySelector<HTMLElement>('.ss-event.live')!;
    expect(ev).not.toBeNull();
    expect(ev.textContent).toContain('LIVE EVENT');
    expect(ev.textContent).toContain('The real Sun just erupted');
    expect(ev.textContent).toContain('X1.4');
    expect(ev.textContent).toMatch(/Event ends in (2 days|1 day)/);
    const a = ev.querySelector<HTMLAnchorElement>('a.ss-elink')!;
    expect(a.href).toMatch(/^https:\/\/ccmc\.gsfc\.nasa\.gov\/DONKI\/view\/FLR\//);
    expect(a.rel).toContain('noopener');
    // A LIVE event is the big news: it sits above the rewards track.
    expect(ev.compareDocumentPosition(box.querySelector('.ss-pass')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Escape goes back to the title screen.
    box.querySelector('h2')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.querySelector('#modal-root [aria-label="Escape Velocity title screen"]')).not.toBeNull();
  });
});
