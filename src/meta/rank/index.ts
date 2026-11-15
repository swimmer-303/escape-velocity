// Written with AI assistance (Claude Code). See README "Use of AI tools".
// Astronaut rank: XP, 50 levels with rank titles, and three daily missions. It talks to the game only through
// ../hooks: it listens for sols, mission ends, campaign ends and 'xp' from other features, tells everyone the
// player's level, and adds the player card to the title screen. Nothing here runs in the self-playing demo.
//
//   curve.ts   the XP curve and rank titles      daily.ts  the daily mission pool and the pick for each day
//   store.ts   save data ('ev-rank-v1')           engine.ts the rules (XP, levels, mission progress, streak)
//   badge.ts   pixel rank badges                  ui.ts     pop-ups, title card, dialog, level-up card, XP chip

import { addTitleExtra, countsForRewards, onGame, setLevelProvider } from '../hooks';
import { currentLevel, onCampaignComplete, onMissionEnd, onSol, onXp } from './engine';
import { hideChip, scheduleCelebration, showChip, titleStrip } from './ui';

/** Wait this long after the end screen appears before the level-up card (let the player see their result first). */
export const END_DELAY_MS = 1200;
/** And this long after the title screen appears. */
export const TITLE_DELAY_MS = 500;

setLevelProvider(currentLevel);

onGame('sol', (p) => {
  // The self-playing demo and Space Lab experiments earn nothing here (the lab gives its own small, capped XP).
  if (!countsForRewards(p)) {
    hideChip();
    return;
  }
  onSol(p);
  showChip();
});

onGame('mission-end', (p) => {
  if (!countsForRewards(p)) return;
  onMissionEnd(p);
  scheduleCelebration('end', END_DELAY_MS);
});

onGame('campaign-complete', () => {
  onCampaignComplete();
  scheduleCelebration('end', END_DELAY_MS);
});

onGame('xp', onXp);

addTitleExtra({
  id: 'rank',
  order: 0,
  render: () => {
    // The title screen means no mission is on screen, and it is a calm moment for a waiting level-up card.
    hideChip();
    scheduleCelebration('title', TITLE_DELAY_MS);
    return titleStrip();
  },
});

export { currentLevel } from './engine';
export { openRankDialog } from './ui';
