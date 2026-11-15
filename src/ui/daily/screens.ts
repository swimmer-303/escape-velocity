// Written with AI assistance (Claude Code). See README "Use of AI tools".
// Daily challenge screens: the intro card, the HUD badge, the board on the end screen (send your
// score with a nickname, see your rank), and the "Today's best" card from the title screen.
// Every name on a board is drawn as plain text, never as HTML.

import { h, append, clear, type Child } from '../dom';
import { icon } from '../icons';
import { shortRange } from '../views';
import { siteText, type SiteText } from '../../sim/site';
import type { MissionState } from '../../sim/types';
import type { Site } from '../../sim/constants';
import { movesFromLog, scoreOf } from '../../daily/replay';
import { DAILY_LIMITS, SITE_RULE, ANONYMOUS, checkNicknameFormat, prettyDate, type DailyConfig, type DailyScore, type DailySubmitResponse, type DailyTop } from '../../daily/protocol';
import { dailyApi, knownPlayerId, playerId, savedNickname, saveNickname, CANT_SEND, type DailySession } from './net';

type Api = Pick<typeof dailyApi, 'config' | 'top' | 'submit'>;

/** "Daily challenge · Nov 15". */
export function dailyKicker(cfg: Pick<DailyConfig, 'date'>): string {
  return `Daily challenge · ${prettyDate(cfg.date)}`;
}

/** The HUD's mission label: "DAILY · NOV 15". */
export function dailyHudLabel(cfg: Pick<DailyConfig, 'date'>): string {
  return `DAILY · ${prettyDate(cfg.date).toUpperCase()}`;
}

function fetchedTime(iso: string | null, withDay = false): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return withDay
    ? d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    : d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

/** Where today's storms come from, in the same words the rest of the game uses. */
export function poolLabel(cfg: DailyConfig, withDay = false): string {
  if (cfg.poolSource === 'live') {
    const t = fetchedTime(cfg.poolFetchedAt, withDay);
    return `LIVE from NASA DONKI${t ? ` · fetched ${t}` : ''}`;
  }
  return cfg.poolStart && cfg.poolEnd ? `ARCHIVE · real DONKI data, ${shortRange(cfg.poolStart, cfg.poolEnd)}` : 'ARCHIVE · real DONKI data';
}

/** The same, as a sentence for the intro card. */
function poolSentence(cfg: DailyConfig): string {
  // The pool also holds the real May 2024 storms (see buildEventPool): say so, since their cards show 2024 dates.
  const may2024 = cfg.eventPool.some((e) => e.time.startsWith('2024-05')) ? ', plus the real storms of May 2024' : '';
  if (cfg.poolSource === 'live') {
    const t = fetchedTime(cfg.poolFetchedAt, true);
    return `Today's storms come from NASA DONKI${t ? `, fetched ${t}` : ''}${may2024}.`;
  }
  return `Today's storms come from our stored NASA DONKI data${cfg.poolStart && cfg.poolEnd ? `, ${shortRange(cfg.poolStart, cfg.poolEnd)}` : ''}${may2024}.`;
}

/** The HUD data badge during a daily challenge (opens the Science Log, like the normal badge). */
export function dailyBadge(cfg: DailyConfig, onclick: () => void): HTMLElement {
  const cls = cfg.poolSource === 'live' ? 'live' : 'archive';
  return h('button', { class: `data-badge ${cls}`, title: "Where today's space-weather data comes from", onclick }, h('span', { class: 'dot' }), poolLabel(cfg));
}

function rankingRule(t: SiteText): string {
  return `The board ranks crews that launched first, then the fewest ${t.turns}, then the lowest radiation dose, then the most stars. Crews that came home early rank by how full their tank was.`;
}

/** The extra card on the crew intro screen of a daily challenge. */
export function dailyIntroCard(session: DailySession, showBest: () => void): HTMLElement {
  const cfg = session.config;
  const t = siteText(cfg.site);
  return h(
    'div',
    { class: 'card daily-intro' },
    h('b', null, 'Everyone plays the same mission today: '),
    `the same crew, the same weather and the same real solar storms. Today you build on ${t.body}. `,
    h('span', { class: 'title-foot' }, SITE_RULE),
    h('div', { class: 'daily-pool' }, h('span', { class: `tag ${cfg.poolSource}` }, cfg.poolSource === 'live' ? 'LIVE' : 'ARCHIVE'), poolSentence(cfg)),
    h('p', { class: 'title-foot' }, rankingRule(t), ' Play as often as you like: the board keeps your best game today.'),
    session.online ? null : h('p', { class: 'tone-warn' }, "We can't reach the scoreboard right now, so today's storms come from our stored NASA data. You can still play, but scores can't be sent."),
    h('div', { class: 'actions' }, h('button', { class: 'btn small', onclick: showBest }, "Today's best")),
  );
}

function resultLine(s: DailyScore, t: SiteText): string {
  const stars = `${s.stars} star${s.stars === 1 ? '' : 's'}`;
  return s.won
    ? `Your crew launched on ${t.turn} ${s.sols} with a radiation dose of ${s.dose.toFixed(1)} mSv and ${stars}.`
    : `Your crew came home early after ${s.sols} ${s.sols === 1 ? t.turn : t.turns}, with the tank ${s.fuel}% full.`;
}

function starIcons(n: number): HTMLElement {
  return h('span', { class: 'daily-stars', 'aria-label': `${n} of 3 stars` }, n ? Array.from({ length: n }, () => icon('sun', 14)) : '0');
}

/** The board as a table. The player's own row is marked, and added at the bottom if it is not in the list. */
export function boardTable(top: DailyTop, site: Site): HTMLElement {
  const t = siteText(site);
  const row = (e: DailyTop['top'][number], mine: boolean) =>
    h(
      'tr',
      { class: mine ? 'you' : undefined },
      h('td', null, String(e.rank)),
      h('td', { class: 'daily-name' }, e.nickname, mine ? h('span', { class: 'daily-you' }, ' (you)') : null),
      h('td', null, e.won ? 'Launched' : `Home early, ${e.fuel}% fuel`),
      h('td', null, String(e.sols)),
      h('td', null, `${e.dose.toFixed(1)} mSv`),
      h('td', null, starIcons(e.stars)),
    );
  const mineInTop = !!top.you && top.top.some((e) => e.rank === top.you!.rank);
  return h(
    'div',
    { class: 'daily-table-wrap' },
    h(
      'table',
      { class: 'log daily-table' },
      h('thead', null, h('tr', null, h('th', null, '#'), h('th', null, 'Name'), h('th', null, 'Result'), h('th', null, t.Turn === 'Sol' ? 'Sols' : 'Days'), h('th', null, 'Dose'), h('th', null, 'Stars'))),
      h(
        'tbody',
        null,
        top.top.map((e) => row(e, !!top.you && e.rank === top.you.rank)),
        top.you && !mineInTop ? [h('tr', { class: 'gap' }, h('td', { colspan: '6' }, '...')), row(top.you, true)] : null,
      ),
    ),
  );
}

// ---------------------------------------------------------------- end screen

interface PanelState {
  phase: 'form' | 'sending' | 'sent';
  message: string;
  nickname: string;
  result?: DailySubmitResponse;
  top?: DailyTop | null;
}

/** Remembered per finished mission, so redrawing the end screen never sends a score twice. */
const panels = new WeakMap<MissionState, PanelState>();

/** The daily board on the end screen: send this game with a nickname, then see your rank and the top 10. */
export function dailyEndPanel(session: DailySession, m: MissionState, api: Api = dailyApi): HTMLElement {
  const cfg = session.config;
  const t = siteText(cfg.site);
  const box = h('div', { class: 'card daily-board' });
  const st = panels.get(m) ?? { phase: 'form', message: '', nickname: savedNickname() };
  panels.set(m, st);

  const send = async (raw: string) => {
    const nick = checkNicknameFormat(raw);
    st.nickname = raw;
    if (!nick.ok) {
      st.message = nick.message;
      render(true);
      return;
    }
    st.phase = 'sending';
    st.message = '';
    render();
    try {
      const id = playerId();
      st.result = await api.submit(cfg.date, { playerId: id, nickname: nick.nickname, moves: movesFromLog(m) });
      saveNickname(nick.nickname);
      st.phase = 'sent';
      st.top = await api.top(cfg.date, 10, id).catch(() => null);
    } catch (e) {
      st.phase = 'form';
      st.message = (e as Error).message || CANT_SEND;
    }
    render(st.phase === 'form');
  };

  const render = (focusName = false) => {
    clear(box);
    box.append(h('div', { class: 'kicker' }, dailyKicker(cfg)), h('h3', null, "Today's board"), h('p', null, resultLine(scoreOf(m), t)));
    if (!session.online) {
      box.append(h('p', { class: 'tone-warn' }, "You played with stored NASA data because the game could not reach our server, so scores can't be sent right now."));
      return;
    }
    if (st.phase === 'sent' && st.result) {
      const r = st.result;
      append(box, [
        h(
          'p',
          { class: 'daily-rank', role: 'status' },
          r.improved ? `You are number ${r.you.rank} of ${r.total} today` : `Your best game today is still number ${r.you.rank} of ${r.total}`,
          r.you.nickname === ANONYMOUS ? ', as Anonymous astronaut.' : `, as ${r.you.nickname}.`,
        ),
        st.top ? boardTable(st.top, cfg.site) : null,
        h('p', { class: 'title-foot' }, 'Play again to beat your best: the board keeps your best game today.'),
      ]);
      return;
    }
    const sending = st.phase === 'sending';
    const input = h('input', {
      class: 'cc-input daily-name-input',
      id: 'daily-name',
      value: st.nickname,
      maxlength: String(DAILY_LIMITS.nicknameMax),
      autocomplete: 'off',
      autocapitalize: 'words',
      spellcheck: 'false',
      placeholder: 'Nickname',
      disabled: sending ? true : undefined,
      'aria-describedby': 'daily-msg',
    }) as HTMLInputElement;
    const form = h(
      'form',
      { class: 'daily-form', novalidate: true },
      h('label', { for: 'daily-name' }, `Put your crew on the board with a nickname (up to ${DAILY_LIMITS.nicknameMax} letters and numbers). Don't use your full name. Leave it empty to be "${ANONYMOUS}".`),
      h(
        'div',
        { class: 'cc-row' },
        input,
        h('button', { class: 'btn primary', type: 'submit', disabled: sending ? true : undefined }, sending ? 'Sending...' : 'Send my score'),
      ),
      h('p', { class: `cc-msg ${st.message ? 'bad' : ''}`, id: 'daily-msg', role: 'status' }, st.message),
    );
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (st.phase !== 'sending') void send(input.value);
    });
    box.append(form, h('p', { class: 'title-foot' }, rankingRule(t)));
    if (focusName) input.focus();
  };

  render();
  return box;
}

// ---------------------------------------------------------------- title screen

/** "Today's best": the top 20 of today's board and this browser's rank. Fills in when the board arrives. */
export function todaysBest(opts: { back: () => void; play: () => void; api?: Api }): Child[] {
  const api = opts.api ?? dailyApi;
  const kicker = h('div', { class: 'kicker' }, 'Daily challenge');
  const body = h('div', { class: 'daily-best', 'aria-live': 'polite' }, h('p', null, "Getting today's board..."));
  void (async () => {
    try {
      const cfg = await api.config();
      kicker.textContent = dailyKicker(cfg);
      const top = await api.top(cfg.date, DAILY_LIMITS.topDefault, knownPlayerId());
      const t = siteText(cfg.site);
      clear(body);
      append(body, [
        h('p', null, `Today's mission is on ${t.body}. `, h('span', { class: 'title-foot' }, SITE_RULE)),
        top.total ? boardTable(top, cfg.site) : h('p', null, 'No crews on the board yet today. Be the first!'),
        top.you ? h('p', { class: 'daily-rank' }, `Your best game today is number ${top.you.rank} of ${top.total}.`) : null,
        h('p', { class: 'title-foot' }, rankingRule(t)),
      ]);
    } catch {
      clear(body);
      body.append(h('p', { class: 'tone-warn' }, "We can't reach the scoreboard right now. You can still play today's challenge."));
    }
  })();
  return [
    kicker,
    h('h2', null, "Today's best"),
    body,
    h(
      'div',
      { class: 'actions end' },
      h('button', { class: 'btn small', onclick: opts.back }, 'Back'),
      h('button', { class: 'btn primary', 'data-autofocus': true, onclick: opts.play }, "Play today's challenge", h('span', { class: 'arrow' })),
    ),
  ];
}
