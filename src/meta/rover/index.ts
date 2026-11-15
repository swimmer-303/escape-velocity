// Written with AI assistance (Claude Code). See README "Use of AI tools".
// Rover Expeditions: a free-roam 3D rover drive across the real ground around the player's base (Gale Crater or
// Arcadia Planitia, from NASA Mars Trek heights) or a made-up Moon map near the south pole. 5 to 8 science targets a
// day, the same for everyone, go into the Sample Museum, and the battery teaches the base's lesson: no choice is free.
// It talks to the game only through ../hooks:
// - the title screen gets a lobby tile (order 24) that opens the start card;
// - each played sol remembers which site the player's base is on, to preselect it;
// - banked samples award XP (emitGame 'xp').
// The 3D drive (./game.ts, ./world.ts) loads only when a drive starts.

import './rover.css';
import { addTitleExtra, onGame } from '../hooks';
import { landingOf, siteOf } from '../../sim/constants';
import { rememberGameSite } from './store';
import { renderTile } from './ui';

export { openStart, openMuseum, startDrive, resultsCard, renderTile } from './ui';

addTitleExtra({ id: 'rover', order: 24, render: renderTile });

onGame('sol', (p) => {
  if (p.demo) return;
  const cfg = p.after?.config;
  if (!cfg) return;
  rememberGameSite(siteOf(cfg) === 'moon' ? 'moon' : landingOf(cfg) === 'arcadia' ? 'arcadia' : 'gale');
});
