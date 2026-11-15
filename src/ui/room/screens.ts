// Written with AI assistance (Claude Code). See README "Use of AI tools".
// Mission Control screen pieces shared by the teacher's projector view and the students' view:
// the station board, the shared briefing, debrief and end screens, the Workshop list, and pings.

import { h, type Child } from '../dom';
import { icon } from '../icons';
import { eventCard, scienceCard, weatherLine, upcomingRegion, compareCard, briefingArt, builtList } from '../views';
import { missionChartFor, crewCharts } from '../charts';
import { crewSays } from '../crew';
import { checkAlloc, getBriefing, planFor, windowSol } from '../../sim/sim';
import { explainSol, endingFor } from '../../sim/explain';
import { starsFor, STAR_INFO, type StarId } from '../../sim/campaign';
import { EXPEDITIONS, REAL, SYNODIC_MONTHS } from '../../sim/constants';
import { UPGRADES, UPGRADE_IDS, maxLevel, nextCost, type UpgradeId } from '../../sim/upgrades';
import { factFor } from '../../data/science';
import type { CrateId, MissionState } from '../../sim/types';
import { PINGS, PING_IDS, STATIONS, STATION_IDS, type PingId, type PlayerView, type RoomView, type StationId } from '../../room/protocol';

export const STATION_ICON: Record<StationId, Parameters<typeof icon>[0]> = { o2: 'o2', green: 'greenhouse', rad: 'shelter', shop: 'crate' };

export function stationNames(list: readonly StationId[]): string {
  const names = list.map((s) => STATIONS[s].name);
  return names.length <= 2 ? names.join(' and ') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

export function stationTag(s: StationId): HTMLElement {
  return h('span', { class: `mc-tag st-${s}` }, STATIONS[s].name);
}

/** Who is at which station, with ready marks. Big enough to read on a projector. */
export function stationBoard(view: RoomView, opts: { meId?: string; showReady?: boolean; compact?: boolean } = {}): HTMLElement {
  return h(
    'div',
    { class: `mc-board ${opts.compact ? 'compact' : ''}` },
    STATION_IDS.map((s) => {
      const crew = view.players.filter((p) => p.stations.includes(s));
      return h(
        'section',
        { class: `mc-station st-${s}`, 'aria-label': `${STATIONS[s].name} station: ${crew.length} player${crew.length === 1 ? '' : 's'}` },
        h('div', { class: 'mc-station-head' }, icon(STATION_ICON[s], 18), h('span', null, STATIONS[s].name), h('b', { class: 'mc-count' }, String(crew.length))),
        crew.length
          ? h(
              'ul',
              { class: 'mc-names' },
              crew.map((p) => playerLine(p, opts)),
            )
          : h('p', { class: 'mc-empty' }, 'Nobody yet'),
      );
    }),
  );
}

function playerLine(p: PlayerView, opts: { meId?: string; showReady?: boolean }): HTMLElement {
  const me = p.id === opts.meId;
  const state = !p.online ? 'away' : opts.showReady ? (p.ready ? 'ready' : 'thinking') : 'here';
  const label = state === 'away' ? 'not connected' : state === 'ready' ? 'ready' : state === 'thinking' ? 'still planning' : 'here';
  return h(
    'li',
    { class: `mc-name ${state} ${me ? 'me' : ''}`, title: label },
    h('span', { class: 'mc-dot', 'aria-hidden': 'true' }),
    h('span', null, p.name, me ? ' (you)' : ''),
    state === 'ready' ? h('span', { class: 'mc-ready-tag' }, 'READY') : null,
    h('span', { class: 'sr-only' }, `: ${label}`),
  );
}

export function readyCount(view: RoomView): { ready: number; online: number } {
  const online = view.players.filter((p) => p.online);
  return { ready: online.filter((p) => p.ready).length, online: online.length };
}

/** Why the class can't run the sol yet (the server checks the same things). */
export function runBlockers(view: RoomView): string[] {
  const m = view.mission;
  if (!m || view.phase !== 'plan') return ['Start planning first.'];
  const out: string[] = [];
  const check = checkAlloc(m, view.alloc);
  if (check.remaining > 0) out.push(`Place every power cell (${check.remaining} left).`);
  else if (!check.ok) out.push(...check.problems);
  if (planFor(m).resupply && !view.crate) out.push(`The ${STATIONS.shop.name} station must choose a cargo crate.`);
  return out;
}

export function crewLabel(view: RoomView): string {
  return view.crews > 1 ? `CREW ${view.expedition} OF ${view.crews}` : 'CLASS MISSION';
}

// ---------------------------------------------------------------- briefing

const CRATES: Array<[CrateId, string, string]> = [
  ['food', 'Food crates', '+3 days of food for the crew'],
  ['parts', 'Spare parts', 'Repair 1 damaged battery and reset wear'],
  ['panel', 'Solar panel', '+1 power cell every sol, for this crew'],
];

export interface BriefingOptions {
  /** This screen may choose the crate (Workshop and Battery station). */
  canChooseCrate: boolean;
  onCrate(id: CrateId): void;
}

/** The shared morning briefing, as cards. */
export function briefingCards(view: RoomView, opts: BriefingOptions): Child[] {
  const m = view.mission!;
  const b = getBriefing(m);
  const out: Child[] = [];
  out.push(h('div', { class: 'art' }, h('img', { src: `/art/${briefingArt(b)}.png`, alt: "Illustration of today's conditions (AI-generated)" })));
  if (m.sol === 1) out.push(crewIntro(view, m));
  out.push(
    h(
      'div',
      { class: `card ${b.weather !== 'clear' ? 'event' : ''}` },
      icon(b.weather === 'clear' ? 'sun' : 'dust', 20),
      ' ',
      h('b', null, weatherLine(b)),
      ' The class has ',
      h('b', null, `${b.cells} power cells`),
      ' to share today.',
      b.powerNotes.length ? h('div', { class: 'title-foot', style: 'margin-top:4px' }, b.powerNotes.join(' · ')) : null,
    ),
  );
  if (b.coldSnap) out.push(h('div', { class: 'card event' }, icon('heater', 20), ' ', h('b', null, 'Extra-cold night ahead. '), `The heaters need ${b.heaterNeed} cells tonight.`));
  if (b.dustTomorrow)
    out.push(
      h(
        'div',
        { class: 'card event' },
        icon('dust', 20),
        ' ',
        h('b', null, 'Orbiters spot a dust storm coming. '),
        b.hasBattery ? 'Tomorrow you will have less solar power. Store cells in the battery today?' : 'Tomorrow you will have less solar power. Stock up on air and food today.',
      ),
    );
  if (b.outlook === 'none') {
    out.push(
      h(
        'div',
        { class: 'card danger' },
        icon('antenna', 20),
        ' ',
        h('b', null, 'No messages from Earth. '),
        'The Sun is between Earth and Mars, so radio signals cannot get through. Only your own radiation monitor can warn you now.',
      ),
    );
  } else {
    const region = upcomingRegion(m);
    out.push(
      h(
        'div',
        { class: 'card' },
        icon('antenna', 20),
        ' ',
        h('b', null, 'Space weather from Earth: '),
        b.outlook === 'active'
          ? `forecasters say the Sun is active${region ? ` (sunspot region ${region} is busy)` : ''}. A solar storm could come in the next few sols.${b.hasMonitor ? ' Power the monitor tonight?' : ''}`
          : 'forecasters say the Sun looks quiet for now.',
        h('div', { class: 'title-foot', style: 'margin-top:4px' }, `Messages from Earth take about ${Math.round(m.config.lightTimeMin)} minutes to reach you (approximate).`),
      ),
    );
  }
  if (b.warning) {
    out.push(
      h(
        'div',
        { class: 'card danger' },
        icon('radiation', 20),
        ' ',
        h('b', null, b.warning.source === 'monitor' ? 'YOUR MONITOR: particle levels are climbing! ' : `MESSAGE FROM EARTH (sent ${Math.round(m.config.lightTimeMin)} min ago): `),
        `a radiation storm will hit the outpost today. The ${STATIONS.rad.name} station should power the storm shelter.`,
        eventCard(b.warning.event),
      ),
    );
  }
  if (b.monitorOnline && !b.warning) out.push(h('div', { class: 'card good' }, icon('monitor', 20), ' ', h('b', null, 'Your monitor: '), 'no storm particles on the way today.'));
  if (b.resupply) out.push(crateCard(view, opts));
  const p = m.base.project;
  out.push(
    h(
      'div',
      { class: 'card' },
      icon('crate', 20),
      ' ',
      h('b', null, 'Workshop: '),
      p ? `building ${UPGRADES[p].name} (${m.base.progress[p]} of ${nextCost(p, m.base.levels)} cells). ` : 'everything is built! ',
      `The ${STATIONS.shop.name} station picks the project.`,
    ),
  );
  return out;
}

function crewIntro(view: RoomView, m: MissionState): HTMLElement {
  const spec = EXPEDITIONS[m.config.expedition - 1];
  return h(
    'div',
    { class: 'card good' },
    h('div', { class: 'kicker' }, view.crews > 1 ? `Crew ${view.expedition} of ${view.crews}: ${spec.name}` : spec.name),
    view.expedition > 1 ? h('p', null, `${SYNODIC_MONTHS} months later, a new crew lands at the base the last crew left behind.`) : null,
    h('p', null, spec.blurb),
    h(
      'p',
      null,
      h('b', null, `Crew: ${m.crew} astronauts. `),
      `Goal: fill the rocket and launch home by sol ${windowSol(m)}, when the launch window closes.`,
      m.config.prefillPct ? ` The robot O2 plant already filled the tank to ${m.config.prefillPct}%.` : '',
    ),
  );
}

function crateCard(view: RoomView, opts: BriefingOptions): HTMLElement {
  return h(
    'div',
    { class: 'card event' },
    icon('crate', 20),
    ' ',
    h('b', null, 'Cargo lander arriving! '),
    opts.canChooseCrate ? 'It only has room for one crate. Your station chooses:' : `It only has room for one crate. The ${STATIONS.shop.name} station chooses.`,
    h(
      'div',
      { class: 'crates', role: 'group', 'aria-label': 'Choose one crate' },
      CRATES.map(([id, name, desc]) =>
        h(
          'button',
          {
            class: 'crate',
            'aria-pressed': String(view.crate === id),
            disabled: opts.canChooseCrate ? undefined : true,
            onclick: () => opts.onCrate(id),
          },
          h('b', null, name),
          h('span', null, desc),
        ),
      ),
    ),
    view.crate ? null : h('div', { class: 'title-foot' }, 'No crate chosen yet. The sol cannot run until one is picked.'),
  );
}

// ---------------------------------------------------------------- Workshop

/** The Workshop's upgrades. Only the Workshop and Battery station can change the project. */
export function workshopList(m: MissionState, canPick: boolean, onPick: (id: UpgradeId) => void): HTMLElement {
  return h(
    'div',
    { class: 'upgrade-list' },
    UPGRADE_IDS.map((id) => {
      const u = UPGRADES[id];
      const lvl = m.base.levels[id];
      const cost = nextCost(id, m.base.levels);
      const active = m.base.project === id;
      return h(
        'div',
        { class: `card upgrade ${active ? 'event' : ''} ${cost === null ? 'good' : ''}` },
        h(
          'div',
          { class: 'upgrade-head' },
          h('b', { class: 'px' }, u.name.toUpperCase()),
          maxLevel(id) > 1 ? h('span', { class: 'title-foot' }, `built ${lvl} of ${maxLevel(id)}`) : lvl ? h('span', { class: 'tag live' }, 'BUILT') : null,
          cost !== null ? h('span', { class: 'cost' }, icon('cell', 16), ` ${m.base.progress[id]}/${cost} cells`) : null,
        ),
        h('div', null, u.effect),
        u.catch ? h('div', { class: 'tone-warn', style: 'font-size:15px' }, 'The catch: ', u.catch) : null,
        cost !== null && canPick
          ? h('button', { class: `btn small ${active ? 'go' : ''}`, disabled: active ? true : undefined, onclick: () => onPick(id) }, active ? 'Working on it' : 'Work on this')
          : active
            ? h('span', { class: 'tag game' }, 'WORKING ON IT')
            : null,
      );
    }),
  );
}

// ---------------------------------------------------------------- debrief and end

export function debriefContent(view: RoomView): Child[] {
  const m = view.mission!;
  const r = view.report!;
  const d = explainSol(r);
  return [
    h('p', { class: `headline tone-${d.tone}`, 'aria-live': 'polite' }, d.headline),
    r.storm ? eventCard(r.storm.event, r.storm.lateByMin ? { lateBy: r.storm.lateByMin, lightMin: m.config.lightTimeMin } : undefined) : null,
    d.details.length ? h('ul', { class: 'clean' }, d.details.map((x) => h('li', null, x))) : null,
    planSummary(view),
    scienceCard(factFor(d.topic, r.sol + m.config.seed.length + m.config.expedition)),
  ];
}

/** "Where the class put its cells": one line per station. */
function planSummary(view: RoomView): HTMLElement | null {
  const r = view.report;
  if (!r) return null;
  return h(
    'div',
    { class: 'card mc-summary' },
    h('div', { class: 'kicker' }, `Sol ${r.sol}: where the class put its ${r.cells} cells`),
    h(
      'ul',
      { class: 'clean' },
      STATION_IDS.map((s) => {
        const parts = STATIONS[s].modules.filter((id) => r.alloc[id] > 0).map((id) => `${r.alloc[id]} on ${MOD_NAME[id]}`);
        const total = STATIONS[s].modules.reduce((a, id) => a + r.alloc[id], 0);
        return h('li', null, h('b', null, `${STATIONS[s].name}: `), total ? parts.join(', ') : 'no cells');
      }),
    ),
  );
}

const MOD_NAME: Record<string, string> = {
  air: 'air',
  fuel: 'fuel',
  greenhouse: 'the greenhouse',
  heaters: 'heaters',
  shelter: 'the shelter',
  monitor: 'the monitor',
  build: 'the Workshop',
  battery: 'the battery',
};

export function starRow(stars: StarId[], compact = false): HTMLElement {
  return h(
    'div',
    { class: `stars ${compact ? 'compact' : ''}`, 'aria-label': `${stars.length} of 3 stars` },
    (Object.keys(STAR_INFO) as StarId[]).map((id) =>
      h('span', { class: `star ${stars.includes(id) ? 'on' : ''}`, title: STAR_INFO[id].how }, icon('sun', compact ? 14 : 22), compact ? null : h('span', null, STAR_INFO[id].name)),
    ),
  );
}

/** Questions about sharing one power budget. */
export const TEAM_TALK: string[] = [
  'Which station wanted the most cells? How did your class decide who got them?',
  'Was there a sol when one station had to give up cells for another? Was that fair?',
  'Real mission controllers work in teams like this. Why is it hard to share one power budget?',
  'What would you tell your station next time?',
];

export function endContent(view: RoomView): Child[] {
  const m = view.mission!;
  const won = m.status === 'won';
  const end = endingFor(m);
  const campaignOver = view.crews > 1 && view.results.length >= view.crews;
  return [
    h('div', { class: 'art' }, h('img', { src: won ? '/art/launch.png' : '/art/lose.png', alt: won ? 'The rocket launches from Mars (AI-generated art)' : 'The crew boards a lander to head home (AI-generated art)' })),
    h('div', { class: 'kicker' }, `${crewLabel(view)} · ${won ? 'Mission complete' : 'Heading home early'}`),
    h('h2', { class: won ? 'tone-good' : '' }, end.title),
    won ? h('p', null, `Mars' escape velocity is about ${REAL.marsEscapeKms.toFixed(1)} km/s: the speed your rocket needs to break free of Mars' gravity.`) : null,
    crewSays(m.config.expedition, won),
    starRow(starsFor(m)),
    h('h3', null, 'What happened'),
    h('ul', { class: 'clean' }, end.happened.map((x) => h('li', null, x))),
    m.log.length ? missionChartFor(m) : null,
    m.builtThisExpedition.length
      ? h('div', { class: 'card good' }, h('b', null, 'Your class built: '), builtList(m.builtThisExpedition), view.crews > 1 && !campaignOver ? '. The next crew inherits all of it.' : '.')
      : null,
    h('div', { class: 'card' }, h('b', null, won ? 'Next challenge: ' : 'Try this next time: '), end.tip),
    campaignOver ? crewCharts(view.results) : null,
    compareCard(m),
    h('div', { class: 'card event' }, h('div', { class: 'kicker' }, 'Talk about it'), h('ul', { class: 'clean' }, TEAM_TALK.map((q) => h('li', null, q)))),
  ];
}

// ---------------------------------------------------------------- pings

export function pingButtons(onPing: (id: PingId) => void, disabled = false): HTMLElement {
  return h(
    'div',
    { class: 'mc-pingpad', role: 'group', 'aria-label': 'Quick messages' },
    PING_IDS.map((id) => h('button', { class: `btn small mc-ping-btn p-${id}`, disabled: disabled ? true : undefined, onclick: () => onPing(id) }, PINGS[id])),
  );
}

export function pingToast(from: string, stations: StationId[], ping: PingId): HTMLElement {
  const first = stations[0] ?? 'o2';
  return h(
    'div',
    { class: `mc-ping st-${first}`, role: 'status' },
    h('b', null, from),
    h('span', { class: 'mc-ping-st' }, stations.length ? stationNames(stations) : ''),
    h('span', { class: 'mc-ping-text' }, PINGS[ping]),
  );
}
