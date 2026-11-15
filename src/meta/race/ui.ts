// Written with AI assistance (Claude Code). See README "Use of AI tools".
// Rival Race screens: the lobby (league, rivals, world), the friend-challenge intro, the podium, the "Challenge a
// friend" link box, and the OVERTAKE! flash. Plain DOM. Every overlay is keyboard friendly (focus moves in, Tab
// stays inside, Escape closes, focus goes back) and has no motion with reduced motion on.

import { h, clear, append, type Child } from '../../ui/dom';
import { trophy, statusIcon } from './art';
import { callsignText, type Callsign } from './callsign';
import { portrait } from './portrait';
import { LEAGUES, leagueAt } from './rivals';
import { ordinal } from './score';
import { progressLine, type LeagueOutcome, type RaceSave } from './store';
import type { GhostRun } from './code';
import type { Race, Result } from './race';

// ------------------------------------------------------------------ small helpers
let live: HTMLElement | null = null;
/** Say something to screen readers. */
export function announce(text: string): void {
  if (!live || !live.isConnected) {
    live = h('div', { class: 'sr-only race-live', role: 'status', 'aria-live': 'polite' });
    document.body.append(live);
  }
  live.textContent = text;
}

/** A big pixel banner over everything for a moment ("OVERTAKE!"). Never blocks clicks. */
export function flash(title: string, sub: string, face?: string, reduced = false): HTMLElement {
  document.querySelectorAll('.race-flash').forEach((e) => e.remove());
  const el = h(
    'div',
    { class: `race-flash${reduced ? ' still' : ''}`, 'aria-hidden': 'true' },
    h('b', null, title),
    h('span', null, face ? portrait(face, { size: 28 }) : null, sub),
  );
  document.body.append(el);
  window.setTimeout(() => el.remove(), 1900);
  return el;
}

export function leagueBadge(index: number, size = 32): HTMLElement {
  const lg = leagueAt(index);
  return h('span', { class: 'race-badge', style: `--lg:${lg.color}` }, trophy(lg.color, size), h('span', null, `${lg.name}`));
}

function ladder(save: RaceSave): HTMLElement {
  return h(
    'ol',
    { class: 'race-ladder', 'aria-label': 'Leagues' },
    LEAGUES.map((lg, i) =>
      h(
        'li',
        { class: i === save.league ? 'now' : i < save.league ? 'done' : 'locked', style: `--lg:${lg.color}`, 'aria-current': i === save.league ? 'step' : null },
        trophy(i <= save.league ? lg.color : '#4a3f7a', 24),
        h('span', null, lg.name),
      ),
    ),
  );
}

function progressBar(save: RaceSave): HTMLElement {
  const lg = leagueAt(save.league);
  const need = lg.promote;
  return h(
    'div',
    { class: 'race-progress' },
    need > 0
      ? h(
          'div',
          { class: 'rp-pips', role: 'img', 'aria-label': `${save.progress} of ${need} top-2 finishes` },
          Array.from({ length: need }, (_, i) => h('span', { class: i < save.progress ? 'on' : '' })),
        )
      : null,
    h('span', null, progressLine(save)),
  );
}

function rivalCard(r: Race['racers'][number]): HTMLElement {
  return h(
    'div',
    { class: `race-rival k-${r.kind}` },
    portrait(r.face, { size: 48, ghost: r.kind === 'ghost' }),
    h('div', null, h('b', null, r.name), h('span', { class: 'rr-style' }, r.style ?? ''), h('p', null, r.about ?? '')),
  );
}

// ------------------------------------------------------------------ lobby
export interface LobbyOpts {
  save: RaceSave;
  callsign: Callsign;
  /** The callsign comes from the Player Card (change it there). */
  fromCard: boolean;
  race: Race;
  canStart: boolean;
  onSite(site: 'mars' | 'moon'): void;
  onStart(): void;
  onBack(): void;
  onShare(): void;
  onNewCallsign(): void;
}

export function lobbyContent(o: LobbyOpts): Child {
  const lg = leagueAt(o.save.league);
  const rivals = o.race.racers.filter((r) => r.kind !== 'you');
  return [
    h('div', { class: 'kicker' }, 'Rival Race'),
    h('div', { class: 'race-lobby-head' }, leagueBadge(o.save.league, 40), h('div', null, h('h2', null, `${lg.name} League`), progressBar(o.save))),
    ladder(o.save),
    h(
      'p',
      null,
      'Race three rival commanders on the ',
      h('b', null, 'same base with the same real storms'),
      '. First crew to fill the rocket and launch with everyone safe wins! Ties go to fewer sols, then less radiation, then more air and food left.',
    ),
    h('p', { class: 'title-foot' }, "Races use the real NASA DONKI storm records stored in the game (the last month, plus May 2024), so every racer, and every friend you challenge, meets the same storms."),
    lg.difficulty === 'commander' ? h('div', { class: 'card danger' }, h('b', null, `${lg.name} races are on Commander difficulty: `), 'more and bigger storms. Watch your radiation!') : null,
    h('h3', null, 'Your rivals'),
    h('div', { class: 'race-rivals' }, rivals.map(rivalCard)),
    h('h3', null, 'Where do we race?'),
    h(
      'div',
      { class: 'crates site-pick race-site', role: 'group', 'aria-label': 'Where to race' },
      (['mars', 'moon'] as const).map((site) =>
        h(
          'button',
          { class: 'crate', type: 'button', 'aria-pressed': String(o.race.site === site), onclick: () => o.onSite(site) },
          h('b', null, site === 'mars' ? 'Mars' : 'The Moon'),
          h('span', null, site === 'mars' ? 'Dust storms and late warnings from Earth.' : 'A long, cold lunar night with no sunlight.'),
        ),
      ),
    ),
    h(
      'div',
      { class: 'actions end' },
      h('button', { class: 'btn small', type: 'button', onclick: () => o.onBack() }, 'Back'),
      h(
        'button',
        { class: 'btn primary', type: 'button', 'data-autofocus': true, disabled: !o.canStart, onclick: () => o.onStart() },
        'Start race',
        h('span', { class: 'arrow' }),
      ),
    ),
    h('h3', null, 'Challenge a friend'),
    h(
      'div',
      { class: 'card race-friend' },
      h('p', null, 'Your callsign is ', h('b', { class: 'race-callsign' }, callsignText(o.callsign)), o.fromCard ? ' (from your Player Card)' : '', '. Links show your callsign, never your name.'),
      h(
        'div',
        { class: 'actions' },
        o.save.lastCode
          ? h('button', { class: 'btn cyan small', type: 'button', onclick: () => o.onShare() }, 'Share my last run')
          : h('span', { class: 'race-note' }, 'Finish a race or a quick mission to get a challenge link.'),
        o.fromCard ? null : h('button', { class: 'btn small', type: 'button', onclick: () => o.onNewCallsign() }, 'New callsign'),
      ),
    ),
    h('p', { class: 'title-foot' }, `Races: ${o.save.races} · Trophies: ${o.save.trophies} · League points: ${o.save.points}`),
  ];
}

// ------------------------------------------------------------------ friend challenge intro
export function challengeIntroContent(o: { ghost: GhostRun; race: Race; canStart: boolean; onStart(): void; onCancel(): void }): Child {
  const g = o.ghost;
  const name = callsignText(g.callsign);
  const turn = g.site === 'moon' ? 'day' : 'sol';
  const result =
    g.status === 'won'
      ? `Their crew launched on ${turn} ${g.fuel.length} with ${g.dose.toFixed(1)} mSv of radiation.`
      : `Their crew headed home early on ${turn} ${g.fuel.length} with the rocket ${g.fuel[g.fuel.length - 1] ?? 0}% full.`;
  return [
    h('div', { class: 'kicker' }, 'Friend challenge'),
    h('div', { class: 'race-lobby-head' }, portrait(`friend|${name}`, { size: 64, ghost: true }), h('div', null, h('h2', null, g.status === 'won' ? `Beat ${name}'s time!` : `Can you beat ${name}?`), h('p', null, result))),
    h(
      'p',
      null,
      `You race their recorded run (a "ghost") on the same ${g.site === 'moon' ? 'Moon base' : 'Mars base'}, seed ${g.seed}, on ${g.difficulty === 'commander' ? 'Commander' : 'Cadet'} difficulty. Two rivals from your league join in.`,
    ),
    o.race.sameStorms
      ? h('div', { class: 'card good' }, h('b', null, 'Fair race: '), 'you meet exactly the same real NASA storms they did.')
      : h('div', { class: 'card' }, h('b', null, 'Heads up: '), "this game has newer space-weather records than your friend's, so some storms may be different."),
    h('div', { class: 'race-rivals' }, o.race.racers.filter((r) => r.kind !== 'you').map(rivalCard)),
    h(
      'div',
      { class: 'actions end' },
      h('button', { class: 'btn small', type: 'button', onclick: () => o.onCancel() }, 'Not now'),
      h('button', { class: 'btn primary', type: 'button', 'data-autofocus': true, disabled: !o.canStart, onclick: () => o.onStart() }, 'Start the challenge', h('span', { class: 'arrow' })),
    ),
  ];
}

// ------------------------------------------------------------------ overlays (podium, share box)
/** A full-screen layer above the game's dialogs (below the level-up card). */
export interface Overlay {
  el: HTMLElement;
  close(): void;
  /** Replace what the overlay shows (e.g. the podium becomes the share box). */
  fill(content: Child): void;
}

export function overlay(label: string, content: Child, onClose: () => void): Overlay {
  const back = document.activeElement as HTMLElement | null;
  const card = h('div', { class: 'race-ov-card' });
  const el = h('div', { class: 'race-overlay', role: 'dialog', 'aria-modal': 'true', 'aria-label': label }, card);
  const close = () => {
    if (!el.isConnected) return;
    el.remove();
    try {
      if (back && back.isConnected) back.focus({ preventScroll: true });
    } catch {
      /* ignore */
    }
    onClose();
  };
  card.append(h('button', { class: 'btn small icon-only race-x', type: 'button', 'aria-label': 'Close', onclick: close }, 'X'));
  const body = h('div', { class: 'race-ov-body' });
  card.append(body);
  const fill = (c: Child) => {
    clear(body);
    append(body, [c]);
    (body.querySelector<HTMLElement>('[data-autofocus]') ?? body.querySelector<HTMLElement>('button'))?.focus({ preventScroll: true });
  };
  fill(content);
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
    } else if (e.key === 'Tab') {
      const f = [...el.querySelectorAll<HTMLElement>('button:not([disabled]), input, [href]')];
      if (!f.length) return;
      const first = f[0];
      const last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  });
  document.body.append(el);
  (el.querySelector<HTMLElement>('[data-autofocus]') ?? el.querySelector<HTMLElement>('button.primary') ?? el.querySelector<HTMLElement>('button'))?.focus({ preventScroll: true });
  return { el, close, fill };
}

/** The "Challenge a friend" box: the link, a Copy button (with a fallback when the clipboard is blocked). */
export function sharePanel(o: { url: string; callsign: Callsign; onNewCallsign: (() => void) | null }): HTMLElement {
  const input = h('input', { class: 'race-link', type: 'text', readonly: true, value: o.url, 'aria-label': 'Challenge link' }) as HTMLInputElement;
  input.value = o.url;
  const msg = h('p', { class: 'race-copy-msg', role: 'status' });
  const copy = async () => {
    input.focus();
    input.select();
    let ok = false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(o.url);
        ok = true;
      }
    } catch {
      ok = false;
    }
    if (!ok) {
      try {
        ok = document.execCommand?.('copy') ?? false;
      } catch {
        ok = false;
      }
    }
    msg.textContent = ok ? 'Copied! Send it to a friend (ask a grown-up first).' : 'The link is selected: press Ctrl+C (or Cmd+C) to copy it, or long-press it on a tablet.';
  };
  input.addEventListener('focus', () => input.select());
  return h(
    'div',
    { class: 'race-share' },
    h('p', null, 'Your friend races your run on the same base with the same storms. The link shows your callsign ', h('b', null, callsignText(o.callsign)), ', never your name.'),
    h('div', { class: 'race-share-row' }, input, h('button', { class: 'btn cyan', type: 'button', 'data-autofocus': true, onclick: () => void copy() }, 'Copy link')),
    msg,
    o.onNewCallsign ? h('div', { class: 'actions' }, h('button', { class: 'btn small', type: 'button', onclick: () => o.onNewCallsign?.() }, 'New callsign')) : null,
  );
}

export interface PodiumOpts {
  race: Race;
  results: Result[];
  xp: number;
  outcome: LeagueOutcome;
  save: RaceSave;
  beatFriend: boolean | null;
  onRaceAgain(): void;
  onShare(): void;
  onClose(): void;
}

function step(r: Result | undefined, cls: string, turn: string): HTMLElement | null {
  if (!r) return null;
  const who = r.racer.kind === 'you' ? 'You' : r.racer.name;
  return h(
    'li',
    { class: `rp-step p${r.place} ${cls} k-${r.racer.kind}` },
    portrait(r.racer.face, { size: r.place === 1 ? 64 : 48, ghost: r.racer.kind === 'ghost' }),
    h('b', { class: 'rp-name' }, who),
    h('span', { class: 'rp-how' }, statusIcon(r.launched ? 'won' : 'lost', 12), r.launched ? ` ${turn} ${r.sols}` : ` Home, ${Math.floor(r.fuel)}%`),
    h('span', { class: 'rp-block' }, ordinal(r.place)),
  );
}

/** One honest, useful tip from how the race went (what the player can try next time). */
export function raceTip(results: Result[], site: 'mars' | 'moon'): string {
  const me = results.find((r) => r.racer.kind === 'you')!;
  const turn = site === 'moon' ? 'day' : 'sol';
  const winner = results.find((r) => r.place === 1 && r.racer.kind !== 'you');
  if (!me.launched) {
    if (me.loseReason === 'dose') return 'Tip: when a storm warning comes, power the storm shelter. Radiation adds up!';
    if (me.loseReason === 'air' || me.loseReason === 'food') return 'Tip: keep about two days of air and food in store, and keep the heaters on so the batteries stay warm.';
    return 'Tip: put more cells into FUEL every sol, so the rocket fills before the launch window closes.';
  }
  if (!winner) return 'Great flying, commander! Win more races to move up a league.';
  if (winner.launched && winner.sols < me.sols) {
    const d = me.sols - winner.sols;
    return `Tip: ${winner.racer.kind === 'ghost' ? 'your friend' : winner.racer.name} launched ${d} ${turn}${d === 1 ? '' : 's'} sooner. On calm ${turn}s, try more cells on FUEL and just enough air and food.`;
  }
  if (winner.launched && winner.sols === me.sols) return `So close: you launched on the same ${turn}! The tie went to the crew with less radiation, then more air and food left. Shelter from storms to win ties.`;
  return 'Great race! Try again to beat your best.';
}

export function podiumContent(o: PodiumOpts): Child {
  const me = o.results.find((r) => r.racer.kind === 'you')!;
  const lgNow = leagueAt(o.save.league);
  const head = me.place === 1 ? 'You won the race!' : `You finished ${ordinal(me.place)}!`;
  const top = o.results.slice(0, 3);
  const turn = o.race.site === 'moon' ? 'day' : 'sol';
  const rest = o.results.slice(3);
  return [
    h('div', { class: 'kicker' }, o.race.ghost ? 'Friend challenge' : `Rival Race · ${leagueAt(o.race.league).name} League`),
    h('h2', { class: me.place === 1 ? 'tone-good' : '' }, head),
    h('ol', { class: 'rp-podium', 'aria-label': 'Podium' }, step(top[1], 'second', turn === 'day' ? 'Day' : 'Sol'), step(top[0], 'first', turn === 'day' ? 'Day' : 'Sol'), step(top[2], 'third', turn === 'day' ? 'Day' : 'Sol')),
    rest.length
      ? h(
          'ol',
          { class: 'rp-rest', start: '4' },
          rest.map((r) => h('li', null, portrait(r.racer.face, { size: 24, ghost: r.racer.kind === 'ghost' }), h('b', null, r.racer.kind === 'you' ? 'You' : r.racer.name), r.launched ? ` launched on ${turn} ${r.sols}` : ` went home early (rocket ${Math.floor(r.fuel)}% full)`)),
        )
      : null,
    o.beatFriend === true ? h('div', { class: 'card good' }, h('b', null, 'You beat your friend! '), 'Send them a link back and see if they can beat you.') : null,
    o.beatFriend === false ? h('div', { class: 'card' }, h('b', null, 'Your friend is ahead this time. '), 'Same base, same storms: try a new plan!') : null,
    h(
      'div',
      { class: 'rp-rewards' },
      h('span', { class: 'rp-xp' }, `+${o.xp} XP`),
      h('span', null, `+${o.outcome.points} league ${o.outcome.points === 1 ? 'point' : 'points'}`),
      o.outcome.trophy ? h('span', { class: 'rp-trophy' }, trophy(leagueAt(o.race.league).color, 20), ' Trophy!') : null,
    ),
    o.outcome.promoted
      ? h('div', { class: 'card good rp-promo' }, trophy(lgNow.color, 40), h('div', null, h('b', null, `Promoted to ${lgNow.name} League!`), h('p', null, 'Your new rivals are smarter and faster. Good luck, commander!')))
      : h('div', { class: 'rp-league' }, leagueBadge(o.save.league, 28), progressBar(o.save)),
    h('p', { class: 'rp-tip' }, raceTip(o.results, o.race.site)),
    h('p', { class: 'rp-rule' }, 'First to launch with the crew safe wins. Ties: fewer sols, then less radiation, then more air and food left.'),
    h(
      'div',
      { class: 'actions' },
      h('button', { class: 'btn primary', type: 'button', 'data-autofocus': true, onclick: () => o.onRaceAgain() }, 'Race again', h('span', { class: 'arrow' })),
      h('button', { class: 'btn cyan', type: 'button', onclick: () => o.onShare() }, 'Challenge a friend'),
      h('button', { class: 'btn', type: 'button', onclick: () => o.onClose() }, 'See my mission report'),
    ),
  ];
}
