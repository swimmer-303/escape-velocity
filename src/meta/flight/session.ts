// Written with AI assistance (Claude Code). See README "Use of AI tools".
// One visit to a flight mini-game: the how-to card, one or more flights, the crash card (landing) and the results
// card with the medal, the best medal, and XP. Always ends (Skip, an error, or Continue), and always cleans up.

import { h, clear } from '../../ui/dom';
import { emitGame } from '../hooks';
import { AUTOPILOT_XP, MEDAL_XP, SAFE_SPEED, scoreLanding, scoreLaunch, type FlightSite, type Medal } from './physics';
import { ABORT, FlightShell, medalIcon, type Abort, type FlightSound } from './engine';
import { landingHint, landingStats, landingTip, runLanding, type LandingRun } from './landing';
import { launchHint, launchStats, launchTip, runLaunch, type LaunchRun } from './launch';
import { MEDAL_NAME, bestFor, recordFlight, upgradeXp, type BestRecord, type FlightGame } from './store';
import type { Scenery } from './scenery';

export interface FlightSetup {
  game: FlightGame;
  site: FlightSite;
  scenery: Scenery;
  crew: number;
  /** One-way Earth light time in minutes (Mars); undefined in Flight school (then the real range is shown). */
  lightTimeMin?: number;
  /** Flight school: XP only for beating your best medal. */
  practice: boolean;
}

export interface FlightEnv {
  root: HTMLElement;
  audio: FlightSound | null;
  reducedMotion: boolean;
  inert?: Array<HTMLElement | null>;
}

export interface FlightOutcome {
  /** Finished at least one flight (a medal or an autopilot landing). */
  finished: boolean;
  /** Best medal of this visit. */
  medal: Medal | null;
  autopilot: boolean;
  xp: number;
  flights: number;
}

const placeName = (site: FlightSite) => (site === 'mars' ? 'Mars' : 'Moon');

function resultCard(opts: {
  kicker: string;
  title: string;
  medal: Medal | null;
  medalText: string;
  stats: string[];
  best: { prev: BestRecord | null; newBest: boolean } | null;
  xp: number;
  practice: boolean;
  tip?: string | null;
}): HTMLElement {
  const { best } = opts;
  return h(
    'div',
    { class: 'ev-flight-result' },
    h('div', { class: 'kicker' }, opts.kicker),
    h('h2', null, opts.title),
    h('div', { class: `ev-flight-medal ${opts.medal ?? 'none'}` }, medalIcon(opts.medal ?? 'none', true), h('b', null, opts.medalText)),
    h('ul', { class: 'ev-flight-stats' }, ...opts.stats.map((t) => h('li', null, t))),
    opts.tip ? h('p', { class: 'ev-flight-fact' }, opts.tip) : null,
    best
      ? best.newBest
        ? h('p', { class: 'ev-flight-best new' }, h('b', null, 'New best!'), best.prev ? ` (was ${MEDAL_NAME[best.prev.medal]})` : '')
        : best.prev
          ? h('p', { class: 'ev-flight-best' }, 'Your best: ', medalIcon(best.prev.medal), ` ${MEDAL_NAME[best.prev.medal]}`)
          : null
      : null,
    opts.xp > 0
      ? h('p', { class: 'ev-flight-xp' }, h('b', null, `+${opts.xp} XP`))
      : opts.practice
        ? h('p', { class: 'ev-flight-xp none' }, 'Beat your best medal to earn XP.')
        : null,
  );
}

/** Play one visit to a mini-game. Never throws; clears `env.root` before it resolves. */
export async function playFlight(setup: FlightSetup, env: FlightEnv): Promise<FlightOutcome> {
  const out: FlightOutcome = { finished: false, medal: null, autopilot: false, xp: 0, flights: 0 };
  let shell: FlightShell | null = null;
  // XP already given in this visit (missions): replaying can top it up to a better medal, never stack it.
  let given = 0;
  const award = (amount: number, reason: string) => {
    if (amount <= 0) return 0;
    out.xp += amount;
    emitGame('xp', { amount, reason });
    return amount;
  };
  const where = placeName(setup.site);
  try {
    shell = new FlightShell({
      root: env.root,
      label: setup.game === 'landing' ? `${where} landing mini-game` : `${where} launch mini-game`,
      audio: env.audio,
      reducedMotion: env.reducedMotion,
      inert: env.inert,
    });
    const hint = setup.game === 'landing' ? landingHint(setup) : launchHint(setup);
    const bestSoFar = bestFor(setup.game, setup.site);
    if (bestSoFar) hint.append(h('p', { class: 'ev-flight-best' }, `Your best ${setup.game} here: `, medalIcon(bestSoFar.medal), ` ${MEDAL_NAME[bestSoFar.medal]}`));
    const go = await shell.choose(hint, [{ id: 'fly', label: setup.game === 'landing' ? 'Start landing' : 'Start launch', primary: true }], 'How to fly');
    if (go === ABORT) return out;
    let autopilot = false;
    for (;;) {
      shell.focusPlay();
      if (setup.game === 'landing') {
        const run: LandingRun | Abort = await Promise.race<LandingRun | Abort>([runLanding(shell, setup, autopilot), shell.aborted]);
        if (run === ABORT) break;
        out.flights++;
        if (run.kind === 'crashed') {
          const c: 'again' | 'auto' | Abort = await shell.choose<'again' | 'auto'>(
            h(
              'div',
              null,
              h('div', { class: 'kicker' }, `${where} landing`),
              h('h2', null, 'Too fast!'),
              h('p', null, `The lander bumped down at ${(run.state.touchdown ?? 0).toFixed(1)} m/s. Safe is under ${SAFE_SPEED} m/s. Let's rewind time and try again.`),
              h('p', { class: 'ev-flight-fact' }, 'Tip: watch the SPEED gauge. When it says SLOW DOWN, hold the engine. When it says OK, let go. Touch down when it says SAFE. (Up high you can fall fast; near the ground, go slow.)'),
              h('p', { class: 'ev-flight-note' }, 'Real landers land themselves, so you can also let the autopilot do it.'),
            ),
            [
              { id: 'again', label: 'Try again', primary: true },
              { id: 'auto', label: 'Let the autopilot land' },
            ],
            'Too fast',
          );
          if (c === ABORT) break;
          autopilot = c === 'auto';
          continue;
        }
        out.finished = true;
        let xp = 0;
        let card: HTMLElement;
        if (run.autopilot) {
          out.autopilot = true;
          if (!setup.practice) {
            xp = award(Math.max(0, AUTOPILOT_XP - given), `Autopilot landing on ${setup.site === 'mars' ? 'Mars' : 'the Moon'}`);
            given += xp;
          }
          const score = scoreLanding(run.state);
          card = resultCard({
            kicker: `${where} landing`,
            title: 'The autopilot landed',
            medal: null,
            medalText: 'Autopilot landing',
            stats: [score ? `Touchdown speed: ${score.speed.toFixed(1)} m/s` : 'Safely down', 'Fly it yourself to win a medal.'],
            best: null,
            xp,
            practice: setup.practice,
          });
        } else {
          const score = scoreLanding(run.state)!;
          const best = recordFlight('landing', setup.site, score.medal, score.score);
          if (!out.medal || MEDAL_XP[score.medal] > MEDAL_XP[out.medal]) out.medal = score.medal;
          if (setup.practice) xp = award(upgradeXp(score.medal, best.prev?.medal), `Flight school: ${MEDAL_NAME[score.medal]} medal ${where} landing`);
          else {
            xp = award(Math.max(0, MEDAL_XP[score.medal] - given), `${MEDAL_NAME[score.medal]} medal ${where} landing`);
            given += xp;
          }
          card = resultCard({
            kicker: `${where} landing`,
            title: 'Touchdown!',
            medal: score.medal,
            medalText: `${MEDAL_NAME[score.medal]} medal`,
            stats: landingStats(score),
            best,
            xp,
            practice: setup.practice,
            tip: landingTip(score),
          });
          shell.announce(`${MEDAL_NAME[score.medal]} medal!${best.newBest ? ' New best!' : ''}${xp ? ` Plus ${xp} XP.` : ''}`);
        }
        const next = await shell.choose(
          card,
          [
            { id: 'done', label: setup.practice ? 'Done' : 'Continue', primary: true },
            { id: 'again', label: run.autopilot ? 'Fly it myself' : 'Fly again' },
          ],
          'Landing results',
        );
        if (next === ABORT || next === 'done') break;
        autopilot = false;
        continue;
      }

      // Launch.
      const run: LaunchRun | Abort = await Promise.race<LaunchRun | Abort>([runLaunch(shell, setup), shell.aborted]);
      if (run === ABORT) break;
      out.flights++;
      out.finished = true;
      const score = scoreLaunch(run.state);
      const best = recordFlight('launch', setup.site, score.medal, score.score);
      if (!out.medal || MEDAL_XP[score.medal] > MEDAL_XP[out.medal]) out.medal = score.medal;
      let xp: number;
      if (setup.practice) xp = award(upgradeXp(score.medal, best.prev?.medal), `Flight school: ${MEDAL_NAME[score.medal]} medal ${where} launch`);
      else {
        xp = award(Math.max(0, MEDAL_XP[score.medal] - given), `${MEDAL_NAME[score.medal]} medal launch to escape velocity`);
        given += xp;
      }
      shell.announce(`${MEDAL_NAME[score.medal]} medal!${best.newBest ? ' New best!' : ''}${xp ? ` Plus ${xp} XP.` : ''}`);
      const next = await shell.choose(
        resultCard({
          kicker: `${where} launch`,
          title: 'Escape velocity!',
          medal: score.medal,
          medalText: `${MEDAL_NAME[score.medal]} medal`,
          stats: launchStats(score, run.helped),
          best,
          xp,
          practice: setup.practice,
          tip: launchTip(score),
        }),
        [
          { id: 'done', label: setup.practice ? 'Done' : 'Continue', primary: true },
          { id: 'again', label: 'Fly again' },
        ],
        'Launch results',
      );
      if (next === ABORT || next === 'done') break;
    }
  } catch (e) {
    console.error('[flight] mini-game failed', e);
  } finally {
    if (shell) shell.destroy();
    else clear(env.root);
  }
  return out;
}

/** The best medal for each mini-game and world (for the Flight school buttons). */
export function bestMedal(game: FlightGame, site: FlightSite): Medal | null {
  return bestFor(game, site)?.medal ?? null;
}
