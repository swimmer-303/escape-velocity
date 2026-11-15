// Written with AI assistance (Claude Code). See README "Use of AI tools".
// Season 1: Solar Maximum. A free season pass (40 tiers), weekly challenges, Live Sun Events from real NASA
// DONKI data (ARCHIVE when the data is not live), welcome-back gifts and the Player Card. It talks to the game
// only through ../hooks: it listens for sols, mission ends, campaign ends, level-ups and every 'xp' event (so
// XP from any mode fills the pass), and adds two things to the title screen. Nothing counts in the demo.
// The Hangar shows the season's items through its unlock source (../hangar/items.ts addUnlockSource).
//
//   season.ts  dates and tier math           rewards.ts  the 40 tiers and Player Card cosmetics
//   weekly.ts  weekly challenges, ISO weeks   live.ts     live / archive Sun events, the feed watcher
//   store.ts   save data ('ev-season-v1')     engine.ts   the rules
//   callsign.ts safe callsign word lists      art.ts      original patch art and icons
//   today.ts   "What's new today" registry    ui.ts       screens and pop-ups

import { addTitleExtra, onGame, whenMetaReady } from '../hooks';
import { addUnlockSource } from '../hangar/items';
import { hangarUnlocks, isOver, onCampaignComplete, onLevelUp, onMissionEnd, onSol, onXp, sunEvent, weeklyView, giftReady } from './engine';
import { watchFeed } from './live';
import { addTodayItem } from './today';
import { cardStrip, seasonTile } from './ui';

export { addTodayItem } from './today';
export { openSeason, openLocker } from './ui';

onGame('sol', onSol);
onGame('mission-end', onMissionEnd);
onGame('campaign-complete', onCampaignComplete);
onGame('xp', onXp);
onGame('level-up', onLevelUp);

addUnlockSource(hangarUnlocks);

// The two title-screen extras, redrawn in place when the game's space-weather feed arrives (it may turn on a
// LIVE event, or confirm there is none).
let strip: HTMLElement | null = null;
let tile: HTMLElement | null = null;
function redraw() {
  if (strip?.isConnected) {
    const next = cardStrip();
    strip.replaceWith(next);
    strip = next;
  }
  if (tile?.isConnected) {
    const next = seasonTile();
    tile.replaceWith(next);
    tile = next;
  }
}

addTitleExtra({
  id: 'player-card',
  order: 5,
  render: () => {
    watchFeed(redraw);
    strip = cardStrip();
    return strip;
  },
});
addTitleExtra({
  id: 'season',
  order: 6,
  render: () => {
    watchFeed(redraw);
    tile = seasonTile();
    return tile;
  },
});
whenMetaReady(() => watchFeed(redraw));

// What's new today: the season's own lines. Other features add theirs with addTodayItem.
addTodayItem({
  id: 'season-event',
  order: 0,
  text: () => {
    if (isOver()) return null;
    const e = sunEvent();
    return e.type === 'live' ? `The real Sun just made a ${e.headline}. Play the live event!` : 'Archive event: replay the May 2024 Gannon storm for a special patch.';
  },
  tag: () => (isOver() ? null : sunEvent().type === 'live' ? 'LIVE' : 'ARCHIVE'),
});
addTodayItem({
  id: 'daily-missions',
  order: 10,
  text: () => '3 new daily missions in Missions and rank.',
  tag: () => 'NEW',
});
addTodayItem({
  id: 'weekly',
  order: 20,
  text: () => {
    if (isOver()) return null;
    const left = weeklyView().filter((v) => !v.done).length;
    return left ? `${left} weekly ${left === 1 ? 'challenge' : 'challenges'} to finish this week.` : 'All 7 weekly challenges done. Great flying!';
  },
});
addTodayItem({
  id: 'gift',
  order: 30,
  text: () => (giftReady() ? "Today's welcome-back gift is waiting below." : null),
  tag: () => 'GIFT',
});
