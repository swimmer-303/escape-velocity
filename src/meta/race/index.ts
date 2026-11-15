// Written with AI assistance (Claude Code). See README "Use of AI tools".
// Rival Race: race three AI rival commanders (or a friend's recorded run) on the same base with the same real
// storms. Leagues from Bronze to Legend, a live standings HUD, a podium, and friend challenge links with no server.
// It talks to the game only through ../hooks: a lobby tile on the title screen, startQuick() to begin a race on a
// given seed, the 'sol' and 'mission-end' events, a HUD extra, and 'xp'. Nothing here runs in the self-playing demo.
//
//   brain.ts    how a rival plays a sol          rivals.ts  the rival commanders and the five leagues
//   race.ts     one race: stepping and results   score.ts   who is ahead (pure, with tie-breaks)
//   code.ts     challenge link codes             callsign.ts safe callsigns ("Brave Comet 42")
//   store.ts    save data ('ev-race-v1')          banter.ts  friendly rival lines
//   hud.ts      live standings                   ui.ts      lobby, intro, podium, share box, flash
//   portrait.ts / art.ts  pixel portraits and icons

import './race.css';
import { addHudExtra, addTitleExtra, emitGame, metaContext, onGame, whenMetaReady, type GameEventMap, type MetaContext } from '../hooks';
import { titleTile } from '../tile';
import { toast } from '../toast';
import { h } from '../../ui/dom';
import type { MissionState } from '../../sim/types';
import { trophy } from './art';
import { banterFor, homeStory } from './banter';
import { randomCallsign } from './callsign';
import { challengeUrl, decodeRun, encodeRun, ghostFromMission, raceParam, type GhostRun } from './code';
import { StandingsHud } from './hud';
import { portrait } from './portrait';
import { createRace, finishRace, isRaceMission, liveRows, newsBetween, syncRivals, type Race } from './race';
import { leagueAt } from './rivals';
import { ordinal, xpForPlace } from './score';
import { applyPlace, loadSave, progressLine, writeSave, type RaceSave } from './store';
import { announce, challengeIntroContent, flash, lobbyContent, overlay, podiumContent, sharePanel, type Overlay } from './ui';

/** Wait this long after the end screen appears before the podium (the level-up card, if any, comes after). */
export const PODIUM_DELAY_MS = 700;
export const PROMOTION_XP = 200;
export const BEAT_FRIEND_XP = 50;

let save: RaceSave | null = null;
let active: Race | null = null;
let hud: StandingsHud | null = null;
let site: 'mars' | 'moon' = 'mars';
let podiumTimer: ReturnType<typeof setTimeout> | null = null;

function data(): RaceSave {
  return (save ??= loadSave());
}
function store(next: RaceSave): void {
  save = next;
  writeSave(next);
}
function reduced(): boolean {
  try {
    return !!metaContext()?.reducedMotion() || document.documentElement.classList.contains('reduce-motion') || !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return true;
  }
}
function getHud(): StandingsHud {
  return (hud ??= new StandingsHud(reduced));
}

// ------------------------------------------------------------------ lobby and starting
export function openLobby(race?: Race): void {
  const ctx = metaContext();
  if (!ctx) return;
  const s = data();
  const r = race ?? createRace({ league: s.league, you: s.callsign, site });
  ctx.modal(
    lobbyContent({
      save: s,
      race: r,
      canStart: !!ctx.startQuick,
      onSite: (next) => {
        site = next;
        r.site = next;
        openLobby(r);
      },
      onStart: () => startRace(ctx, r),
      onBack: () => ctx.showTitle(),
      onShare: () => openShare(),
      onNewCallsign: () => {
        store({ ...s, callsign: randomCallsign() });
        openLobby(r);
      },
    }),
    { label: 'Rival Race', wide: true, onClose: () => ctx.showTitle() },
  );
}

function startRace(ctx: MetaContext, r: Race): void {
  if (!ctx.startQuick) return;
  active = r;
  getHud().reset(r.league, !!r.ghost, r.site);
  ctx.audio.sfx('click');
  ctx.startQuick({ seed: r.seed, site: r.site, difficulty: r.difficulty, eventPool: r.eventPool, lightTimeMin: r.lightTimeMin });
}

/** A friend's link: show who to beat, then race their ghost. */
export function openChallenge(g: GhostRun): void {
  const ctx = metaContext();
  if (!ctx) return;
  const s = data();
  const r = createRace({ league: s.league, you: s.callsign, ghost: g });
  ctx.modal(
    challengeIntroContent({ ghost: g, race: r, canStart: !!ctx.startQuick, onStart: () => startRace(ctx, r), onCancel: () => ctx.showTitle() }),
    { label: 'Friend challenge', wide: true, onClose: () => ctx.showTitle() },
  );
}

// ------------------------------------------------------------------ challenge links
function shareUrl(): string | null {
  const s = data();
  const g = s.lastCode ? decodeRun(s.lastCode) : null;
  return g ? challengeUrl({ ...g, callsign: s.callsign }) : null;
}

function sharePanelFor(redraw: () => void): HTMLElement {
  const url = shareUrl();
  return url
    ? sharePanel({
        url,
        callsign: data().callsign,
        onNewCallsign: () => {
          store({ ...data(), callsign: randomCallsign() });
          redraw();
        },
      })
    : h('p', null, 'Finish a race or a quick mission first, then challenge a friend to beat it.');
}

/** The share box in its own overlay (from the lobby or the end screen). */
export function openShare(): Overlay {
  const ov: Overlay = overlay('Challenge a friend', null, () => {});
  const draw = () => ov.fill([h('div', { class: 'kicker' }, 'Challenge a friend'), h('h2', null, 'Can they beat your run?'), sharePanelFor(draw)]);
  draw();
  return ov;
}

/**
 * Only a fresh crew on Gale Crater or the Moon can be replayed exactly from a link. A mission seeded by a class code
 * (capital letters) is never shared: the link would show the class code to people outside the class.
 */
function shareable(m: MissionState): boolean {
  return m.config.expedition === 1 && m.config.landing !== 'arcadia' && !m.config.scenario && m.log.length > 0 && /^[a-z0-9]{1,24}$/.test(m.config.seed);
}

/** Add "Challenge a friend" to the end screen the game just drew. */
function addEndButton(): void {
  setTimeout(() => {
    const dlg = [...document.querySelectorAll<HTMLElement>('#modal-root [role="dialog"]')].pop();
    const rows = dlg ? [...dlg.querySelectorAll<HTMLElement>('.actions')] : [];
    const row = rows[rows.length - 1];
    if (!row || row.querySelector('.race-end-share')) return;
    row.append(h('button', { class: 'btn cyan race-end-share', type: 'button', onclick: () => openShare() }, 'Challenge a friend'));
  }, 0);
}

// ------------------------------------------------------------------ during a race
function onSol(p: GameEventMap['sol']): void {
  const r = active;
  if (p.demo || p.mode !== 'quick' || !r || r.status === 'done' || !isRaceMission(r, p.after)) return;
  syncRivals(r, p.before);
  const before = liveRows(r, p.before);
  syncRivals(r, p.after);
  const after = liveRows(r, p.after);
  const news = newsBetween(before, after);
  const banter = banterFor(r.seed, p.report.sol, after, news, !!p.report.storm);
  const overtakes = news.filter((n) => n.kind === 'overtake');
  getHud().update(after, { sols: p.after.log.length, banter, overtaken: overtakes.map((n) => n.racer.id) });
  const ctx = metaContext();
  let flashed = false;
  if (overtakes.length && p.after.status === 'playing') {
    const who = overtakes.map((n) => n.racer.name).join(' and ');
    flash('OVERTAKE!', `You passed ${who}!`, overtakes[0].racer.face, reduced());
    flashed = true;
    ctx?.audio.sfx('good');
    announce(`Overtake! You passed ${who}. You are now ${ordinal(after.find((x) => x.id === 'you')!.place)}.`);
  }
  for (const n of news) {
    if (n.kind === 'home') {
      const story = homeStory(n.racer.name, n.reason, n.storm);
      if (!flashed) flash('CREW HEADING HOME', `${n.racer.name}'s crew is safe`, n.racer.face, reduced());
      flashed = true;
      toast(`${n.racer.name} is out of the race`, story, { tone: 'amber', ms: 6500, icon: h('span', null, portrait(n.racer.face, { size: 28 })) });
      announce(story);
    } else if (n.kind === 'launch') {
      toast(`${n.racer.name} launched!`, p.after.status === 'playing' ? 'Keep going: there are more places on the podium.' : 'What a race!', { tone: 'cyan', ms: 4500, icon: h('span', null, portrait(n.racer.face, { size: 28 })) });
      announce(`${n.racer.name} launched on ${r.site === 'moon' ? 'day' : 'sol'} ${n.sols}.`);
    } else if (n.kind === 'passed') {
      announce(`${n.racer.name} passed you.`);
    }
  }
}

function onMissionEnd(p: GameEventMap['mission-end']): void {
  if (p.demo || p.mode !== 'quick') return;
  const s = data();
  const m = p.mission;
  const r = active;
  const inRace = !!r && r.status !== 'done' && isRaceMission(r, m);
  if (shareable(m)) {
    store({ ...s, lastCode: encodeRun(ghostFromMission(m, s.callsign)) });
    addEndButton();
  }
  if (!inRace || !r) return;
  const results = finishRace(r, m);
  const me = results.find((x) => x.racer.kind === 'you')!;
  const ghost = results.find((x) => x.racer.kind === 'ghost');
  const beatFriend = ghost ? me.place < ghost.place : null;
  const applied = applyPlace(data(), me.place);
  const next = applied.save;
  let xp = xpForPlace(me.place, r.league);
  if (beatFriend) {
    next.friendsBeaten += 1;
    xp += BEAT_FRIEND_XP;
  }
  store(next);
  getHud().update(liveRows(r, m), { sols: m.log.length, banter: null });
  emitGame('xp', { amount: xp, reason: `Rival Race: ${ordinal(me.place)} place${beatFriend ? ', and you beat your friend' : ''}` });
  if (applied.outcome.promoted) emitGame('xp', { amount: PROMOTION_XP, reason: `Promoted to the ${leagueAt(next.league).name} League` });
  if (podiumTimer) clearTimeout(podiumTimer);
  // The game draws its end screen right after telling us. Show the podium over it, but only if the player is still
  // looking at that screen (not if they already went back to the title or started something else).
  let endScreen: Element | null = null;
  setTimeout(() => (endScreen = document.querySelector('#modal-root [role="dialog"]')), 0);
  podiumTimer = setTimeout(() => {
    podiumTimer = null;
    if (endScreen && !endScreen.isConnected) return;
    showPodium(r, results, xp, applied.outcome, beatFriend);
  }, PODIUM_DELAY_MS);
}

function showPodium(r: Race, results: ReturnType<typeof finishRace>, xp: number, outcome: ReturnType<typeof applyPlace>['outcome'], beatFriend: boolean | null): void {
  document.querySelectorAll('.race-overlay').forEach((e) => e.remove());
  const ctx = metaContext();
  const me = results.find((x) => x.racer.kind === 'you')!;
  if (me.place === 1) ctx?.audio.sfx('win');
  const ov: Overlay = overlay(
    'Race results',
    podiumContent({
      race: r,
      results,
      xp,
      outcome,
      save: data(),
      beatFriend,
      onRaceAgain: () => {
        ov.close();
        openLobby();
      },
      onShare: () => {
        const draw = () =>
          ov.fill([
            h('div', { class: 'kicker' }, 'Challenge a friend'),
            h('h2', null, 'Can they beat your run?'),
            sharePanelFor(draw),
            h('div', { class: 'actions' }, h('button', { class: 'btn', type: 'button', onclick: () => ov.close() }, 'Done')),
          ]);
        draw();
      },
      onClose: () => ov.close(),
    }),
    () => {},
  );
  ov.el.classList.add('race-podium');
  announce(`Race over. You finished ${ordinal(me.place)}.`);
}

// ------------------------------------------------------------------ wiring
onGame('sol', onSol);
onGame('mission-end', onMissionEnd);

addHudExtra({
  id: 'race',
  render: (m, mode) => {
    const r = active;
    if (mode !== 'quick' || !r || !isRaceMission(r, m)) return null;
    const hd = getHud();
    if (r.status !== 'done' && hd.drawnAt !== m.log.length) {
      syncRivals(r, m);
      hd.update(liveRows(r, m), { sols: m.log.length });
    }
    hd.maybeAnimate();
    return hd.root;
  },
});

addTitleExtra({
  id: 'race',
  order: 12,
  render: () => {
    const s = data();
    const lg = leagueAt(s.league);
    return titleTile({
      id: 'race',
      name: 'Rival Race',
      sub: `${lg.name} League · ${progressLine(s)}`,
      icon: trophy(lg.color, 48),
      badge: s.races === 0 ? 'NEW' : undefined,
      accent: 'red',
      onClick: () => {
        metaContext()?.audio.sfx('click');
        openLobby();
      },
    });
  },
});

/** A challenge link (?race=CODE): clean the address, then show the challenge over the title screen. */
export function handleLink(): void {
  const code = raceParam(location.search);
  if (code === null) return;
  try {
    const url = new URL(location.href);
    url.searchParams.delete('race');
    history.replaceState(history.state, '', `${url.pathname}${url.search}${url.hash}`);
  } catch {
    /* an address we cannot rewrite: harmless */
  }
  const g = decodeRun(code);
  if (!g) {
    toast('That challenge link did not work', 'It may be cut off. Ask your friend to copy the whole link again.', { ms: 6000 });
    return;
  }
  // Only over the title screen: never over a class room, a teacher dashboard or the presenter demo.
  if (!document.querySelector('[aria-label="Escape Velocity title screen"]')) return;
  openChallenge(g);
}
whenMetaReady(() => setTimeout(handleLink, 0));

/** Tests: forget everything in memory. */
export function resetRace(): void {
  save = null;
  active = null;
  hud = null;
  site = 'mars';
  if (podiumTimer) clearTimeout(podiumTimer);
  podiumTimer = null;
  document.querySelectorAll('.race-overlay, .race-flash, .race-live').forEach((e) => e.remove());
}

export function activeRace(): Race | null {
  return active;
}
