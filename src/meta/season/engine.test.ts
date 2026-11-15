// @vitest-environment happy-dom
// Written with AI assistance (Claude Code). See README "Use of AI tools".
// The Season Pass rules: Season XP from every source (never the demo), the claim flow, Hangar unlocks, weekly and
// event challenges (live and archive), welcome-back gifts that never reset, and a graceful season end.
import { describe, it, expect, beforeEach } from 'vitest';
import { emitGame } from '../hooks';
import { isUnlocked, itemById } from '../hangar/items';
import './index';
import {
  GIFTS,
  SEASON_XP,
  addSeasonXp,
  cardView,
  claimAll,
  claimTier,
  claimableTiers,
  currentTier,
  eventView,
  firstGift,
  giftGreeting,
  giftReady,
  giftStrip,
  hangarUnlocks,
  onSeason,
  openGift,
  ownedIds,
  rerollCallsign,
  resetSeasonEngine,
  seasonState,
  setCard,
  track,
  weeklyToday,
  weeklyView,
  type SeasonNote,
} from './engine';
import { setFeedForTests } from './live';
import { STORAGE_KEY, loadState } from './store';
import { xpToReachTier } from './season';
import { setQuietToasts } from './ui';
import { endEvent, liveFeed, snapshotWith, solEvent } from './fixtures';
import { challengeById } from './weekly';

let t = new Date(2026, 10, 14, 19, 0);
const setNow = (d: Date) => {
  t = d;
};

beforeEach(() => {
  localStorage.clear();
  t = new Date(2026, 10, 14, 19, 0);
  resetSeasonEngine({ clock: () => t, fresh: true });
  setFeedForTests(null);
  setQuietToasts(true);
});

describe('Season XP', () => {
  it('fills from sols, launches and every xp event from other modes, but never from the demo', () => {
    emitGame('sol', solEvent({ demo: true, shelter: 2 }));
    emitGame('mission-end', endEvent({ demo: true }));
    expect(seasonState().xp).toBe(0);
    emitGame('sol', solEvent({ shelter: 2, built: 1 }));
    expect(seasonState().xp).toBe(SEASON_XP.sol + SEASON_XP.sheltered + SEASON_XP.upgrade);
    emitGame('mission-end', endEvent({ won: true, stars: 2 }));
    expect(seasonState().xp).toBe(75 + SEASON_XP.win + 2 * SEASON_XP.star);
    emitGame('xp', { amount: 60, reason: 'Gold medal Mars landing' });
    emitGame('xp', { amount: 40, reason: 'Rover expedition: found ice' });
    emitGame('xp', { amount: NaN, reason: 'bad' });
    emitGame('xp', { amount: -5, reason: 'bad' });
    emitGame('xp', { amount: 999999, reason: 'typo' });
    expect(seasonState().xp).toBe(75 + 150 + 60 + 40 + SEASON_XP.maxEvent);
    expect(seasonState().stats).toMatchObject({ sols: 1, missions: 1, launches: 1, storms: 1 });
  });

  it('announces each new tier once', () => {
    const notes: SeasonNote[] = [];
    const stop = onSeason((n) => notes.push(n));
    addSeasonXp(xpToReachTier(3), 'game');
    addSeasonXp(10, 'game');
    stop();
    expect(notes.filter((n) => n.kind === 'tier').map((n) => (n as { tier: number }).tier)).toEqual([2, 3]);
    expect(seasonState().announced).toBe(3);
  });
});

describe('claim flow', () => {
  it('tier 1 is a welcome gift; locked tiers cannot be claimed; a tier is claimed only once', () => {
    expect(currentTier()).toBe(1);
    expect(claimableTiers()).toEqual([1]);
    expect(claimTier(2)).toBeNull();
    const got = claimTier(1)!;
    expect(got.map((x) => x.id)).toEqual(['p-first-light']);
    expect(claimTier(1)).toBeNull();
    expect(claimableTiers()).toEqual([]);
    expect(ownedIds('patch').has('p-first-light')).toBe(true);
  });

  it('claims everything waiting at once, then the cosmetics can be worn', () => {
    addSeasonXp(xpToReachTier(6), 'game');
    expect(claimableTiers()).toEqual([1, 2, 3, 4, 5, 6]);
    expect(setCard('title', 't-storm-chaser')).toBe(false); // not claimed yet
    expect(claimAll()).toEqual([1, 2, 3, 4, 5, 6]);
    expect(claimAll()).toEqual([]);
    expect(setCard('title', 't-storm-chaser')).toBe(true);
    expect(setCard('frame', 'f-flare')).toBe(true);
    expect(setCard('banner', 'b-solar-wind')).toBe(false); // tier 13
    expect(cardView().title.name).toBe('Storm Chaser');
    // It is saved.
    expect(loadState().card.title).toBe('t-storm-chaser');
  });

  it('unlocks Season items in the Hangar only once their tier is claimed', () => {
    const aurora = itemById('lights-aurora')!;
    expect(aurora.season).toBe('Season 1 tier 10');
    expect(isUnlocked(aurora, 1)).toBe(false);
    addSeasonXp(xpToReachTier(10), 'game');
    expect(isUnlocked(aurora, 1)).toBe(false); // reached, not claimed
    claimTier(10);
    expect(hangarUnlocks()).toContain('lights-aurora');
    expect(isUnlocked(aurora, 1)).toBe(true);
    expect(isUnlocked(itemById('suit-solar-flare')!, 1)).toBe(false);
    // Nobody is locked out forever: level 50 unlocks them too.
    expect(isUnlocked(itemById('suit-solar-flare')!, 50)).toBe(true);
  });

  it('re-rolls the callsign from the word lists', () => {
    const before = cardView().callsign;
    const after = rerollCallsign();
    expect(after).not.toBe(before);
    expect(after).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+ \d{1,2}$/);
  });
});

describe('weekly challenges', () => {
  it('counts game events and pays Season XP once when done; a new week brings new ones', () => {
    const w = weeklyToday();
    expect(w.ids).toHaveLength(7);
    // Force a known challenge into this week for the test.
    w.ids[0] = 'w-launch-3';
    w.progress[0] = 0;
    const xp0 = seasonState().xp;
    for (let i = 0; i < 3; i++) track({ type: 'end', ...endEvent({ won: true }) });
    const v = weeklyView()[0];
    expect(v.done).toBe(true);
    expect(seasonState().xp - xp0).toBe(challengeById('w-launch-3')!.xp);
    track({ type: 'end', ...endEvent({ won: true }) });
    expect(seasonState().xp - xp0).toBe(challengeById('w-launch-3')!.xp);
    setNow(new Date(2026, 10, 16, 8, 0)); // Monday
    expect(weeklyToday().week).toBe('2026-W47');
    expect(weeklyView().every((x) => x.progress === 0)).toBe(true);
  });

  it('counts XP from other modes by its reason (flight medals) and in total', () => {
    const w = weeklyToday();
    w.ids.splice(0, 3, 'w-medals-3', 'w-bonus-600', 'w-xp-3000');
    w.progress.splice(0, 3, 0, 0, 0);
    emitGame('xp', { amount: 60, reason: 'Gold medal Mars landing' });
    emitGame('xp', { amount: 25, reason: 'Flight school: Bronze medal Moon launch' });
    emitGame('sol', solEvent());
    const view = weeklyView();
    expect(view[0].progress).toBe(2);
    expect(view[1].progress).toBe(85);
    expect(view[2].progress).toBe(85 + SEASON_XP.sol);
  });
});

describe('Sun events', () => {
  it('ARCHIVE: the Gannon storm event counts only May 2024 play and gives its patch', () => {
    const v0 = eventView();
    expect(v0.event.type).toBe('archive');
    emitGame('sol', solEvent({ mode: 'quick', shelter: 1 }));
    expect(eventView().steps.every((s) => s.progress === 0)).toBe(true);
    for (let i = 0; i < 5; i++) emitGame('sol', solEvent({ mode: 'history', shelter: i === 0 ? 1 : 0 }));
    emitGame('mission-end', endEvent({ mode: 'history', won: false }));
    const v = eventView();
    expect(v.steps.every((s) => s.done)).toBe(true);
    expect(v.rewarded).toBe(true);
    expect(seasonState().eventPatches.map((p) => p.id)).toEqual(['archive:gannon-2024']);
    expect(ownedIds('patch').has('archive:gannon-2024')).toBe(true);
    expect(setCard('patch', 'archive:gannon-2024')).toBe(true);
  });

  it('LIVE: a real flare event has its own challenges, and archive progress is kept separately', () => {
    emitGame('sol', solEvent({ mode: 'history' }));
    const nowUtc = new Date(t.getTime());
    setFeedForTests(liveFeed(snapshotWith(nowUtc, { flares: [{ cls: 'M3.5', hoursAgo: 6, id: '2026-11-14T18:00:00-FLR-001' }] })));
    const v = eventView();
    expect(v.event.type).toBe('live');
    expect(v.patch.id).toBe('live:2026-11-14T18:00:00-FLR-001');
    for (let i = 0; i < 5; i++) emitGame('sol', solEvent({ shelter: i === 0 ? 1 : 0 }));
    emitGame('mission-end', endEvent({ won: true }));
    expect(eventView().rewarded).toBe(true);
    expect(seasonState().eventPatches[0]).toMatchObject({ id: 'live:2026-11-14T18:00:00-FLR-001', mark: 'M3.5', kind: 'flare' });
    // Back offline: the archive event, with its earlier progress still there.
    setFeedForTests(null);
    expect(eventView().event.type).toBe('archive');
    expect(eventView().steps[0].progress).toBe(1);
  });
});

describe('welcome-back gifts', () => {
  it('says "Welcome, astronaut!" for the very first gift, and "Welcome back!" after that', () => {
    expect(firstGift()).toBe(true);
    expect(giftGreeting(firstGift(), 10).title).toBe('Welcome, astronaut!');
    expect(JSON.stringify(giftGreeting(true, 10))).not.toMatch(/welcome back/i);
    openGift();
    expect(firstGift()).toBe(false);
    expect(giftGreeting(firstGift(), 10).title).toBe('Welcome back!');
    expect(giftGreeting(false, 25).body).toContain('+25 Season XP');
  });

  it('one gift a day, missing days never reset the strip, and day 7 loops back', () => {
    expect(giftReady()).toEqual({ day: 1, xp: GIFTS[0] });
    expect(openGift()).toBe(GIFTS[0]);
    expect(giftReady()).toBeNull();
    expect(openGift()).toBe(0);
    setNow(new Date(2026, 10, 20, 9)); // six days later
    expect(giftReady()).toEqual({ day: 2, xp: GIFTS[1] });
    for (let d = 0; d < 6; d++) {
      setNow(new Date(2026, 10, 21 + d * 2, 9));
      openGift();
    }
    expect(seasonState().login.count).toBe(7);
    expect(giftStrip()).toMatchObject({ opened: 7, today: true });
    setNow(new Date(2026, 11, 30, 9));
    expect(giftReady()).toEqual({ day: 1, xp: GIFTS[0] });
    expect(GIFTS[6]).toBeGreaterThan(GIFTS[0]);
  });
});

describe('the end of the season', () => {
  it('stops new Season XP and challenges, but rewards already reached can still be claimed', () => {
    addSeasonXp(xpToReachTier(3), 'game');
    setNow(new Date(2027, 1, 2, 10));
    const xp = seasonState().xp;
    emitGame('sol', solEvent());
    emitGame('xp', { amount: 50, reason: 'x' });
    expect(seasonState().xp).toBe(xp);
    expect(giftReady()).toBeNull();
    expect(claimAll()).toEqual([1, 2, 3]);
  });
});

describe('storage', () => {
  it('saves under ev-season-v1 and survives blocked storage', () => {
    addSeasonXp(500, 'game');
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).xp).toBe(500);
    const orig = Storage.prototype.setItem;
    Storage.prototype.setItem = () => {
      throw new Error('blocked');
    };
    try {
      expect(() => addSeasonXp(100, 'game')).not.toThrow();
      expect(seasonState().xp).toBe(600);
    } finally {
      Storage.prototype.setItem = orig;
    }
  });
});
