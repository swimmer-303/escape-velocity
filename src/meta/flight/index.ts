// Written with AI assistance (Claude Code). See README "Use of AI tools".
// Flight mini-games: land the new crew on the pad (the 'landing' interstitial), and fly the full rocket to escape
// velocity (the 'launch' interstitial). Medals earn XP; best medals are kept per world. Flight school on the title
// screen replays either one any time. See physics.ts for the real numbers and the game values.

import { clear } from '../../ui/dom';
import { landingOf } from '../../sim/constants';
import { addTitleExtra, setInterstitial, type InterstitialContext } from '../hooks';
import { playFlight, type FlightOutcome } from './session';
import { sceneryOf } from './scenery';
import { renderFlightSchool } from './school';
import type { FlightGame } from './store';

/** Run a mini-game as the game's interstitial. Always resolves, with the root cleared. */
export async function flightInterstitial(game: FlightGame, ctx: InterstitialContext): Promise<FlightOutcome | null> {
  try {
    const m = ctx.mission;
    const site = ctx.site === 'moon' ? 'moon' : 'mars';
    return await playFlight(
      {
        game,
        site,
        scenery: sceneryOf(site, m?.config ? landingOf(m.config) : undefined),
        crew: m?.crew ?? 4,
        lightTimeMin: site === 'mars' ? m?.config?.lightTimeMin : undefined,
        practice: false,
      },
      { root: ctx.root, audio: ctx.audio ?? null, reducedMotion: !!ctx.reducedMotion, inert: [document.getElementById('app')] },
    );
  } catch (e) {
    console.error('[flight] interstitial failed', e);
    try {
      clear(ctx.root);
    } catch {
      /* nothing to clear */
    }
    return null;
  }
}

setInterstitial('landing', async (ctx) => {
  await flightInterstitial('landing', ctx);
});
setInterstitial('launch', async (ctx) => {
  await flightInterstitial('launch', ctx);
});
addTitleExtra({ id: 'flight-school', order: 40, render: renderFlightSchool });

export { playFlight } from './session';
export { practice } from './school';
