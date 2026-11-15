// Written with AI assistance (Claude Code). See README "Use of AI tools".
// Mission Control: the whole class runs one Mars base together.
// The teacher's screen (on the projector) shows the room code, who is at which station, the
// 3D base, the HUD and the whole plan, and has the Run sol / Next buttons. Each student's
// screen (Chromebook or phone) shows the same plan, but only their station's modules can be
// changed. The server holds the real mission; this controller only draws what it sends.
// App (src/ui/app.ts) hands over the stage, HUD, dock and dialog area, and gets them back on exit.

import { h, clear, type Child } from '../dom';
import { icon } from '../icons';
import { renderHud } from '../hud';
import { BudgetDock } from '../budget';
import { briefMini, runBeats } from '../views';
import type { GameAudio } from '../audio';
import type { Stage } from '../../render/stage';
import { emptyAlloc, getBriefing, previewSol, snapshot, totalCells, windowSol, checkAlloc } from '../../sim/sim';
import { emptyLevels, nextCost } from '../../sim/upgrades';
import { checkClassCode, type CodeProblem } from '../../sim/classcode';
import { MODULE_IDS, type Allocation, type CrateId, type ModuleId, type Snapshot } from '../../sim/types';
import { checkNameFormat, LIMITS, NAME_PROBLEM, STATION_OF, STATIONS, STATION_IDS, type ClosedReason, type PingId, type PlayerAction, type RoomView, type StationId, type TeacherAction } from '../../room/protocol';
import { api, ApiFailure, ActionQueue, openLive, seats, type LinkStatus, type Seat } from './net';
import {
  briefingCards,
  crewLabel,
  debriefContent,
  endContent,
  pingButtons,
  pingToast,
  readyCount,
  runBlockers,
  stationBoard,
  stationNames,
  stationTag,
  workshopList,
  STATION_ICON,
} from './screens';

export interface MissionControlHost {
  stage: Stage;
  hud: HTMLElement;
  dock: HTMLElement;
  modalRoot: HTMLElement;
  audio: GameAudio;
  reducedMotion: boolean;
  /** Give the screen back to the game's title screen. */
  exit(): void;
}

type Overlay = 'briefing' | 'workshop' | 'menu' | 'players' | 'help' | null;

const CODE_PROBLEM: Record<CodeProblem, string> = {
  empty: 'Type the room code from the board.',
  length: 'A room code has 5 letters and numbers. Check the board and try again.',
  letters: 'That code has a letter or number room codes never use (like O, I or 0). Check the board.',
};

const CLOSED_TEXT: Record<ClosedReason | 'gone', string> = {
  ended: 'Your teacher closed the room. Thanks for playing!',
  expired: 'This room closed because nobody used it for 3 hours.',
  kicked: 'Your teacher took you out of this room.',
  left: 'You left the room.',
  gone: 'This screen lost its place in the room. Join again with your name.',
};

/** Open Mission Control. With a room code (from ?room=CODE) it rejoins or fills in the code. */
export function openMissionControl(host: MissionControlHost, code?: string | null): MissionControl {
  const mc = new MissionControl(host);
  mc.start(code ?? null);
  return mc;
}

export class MissionControl {
  private role: 'teacher' | 'student' | null = null;
  private code = '';
  private token = '';
  private seat: Seat | null = null;
  private view: RoomView | null = null;
  private live: { close(): void } | null = null;
  private link: LinkStatus = 'live';
  private queue = new ActionQueue();
  /** The plan as this student just changed it, until the server's state catches up. */
  private mine: Allocation | null = null;
  private waitV = 0;
  private failed = false;
  private budget: BudgetDock;
  private toasts: HTMLElement;
  private seenPing = -1;
  private overlay: Overlay = null;
  private sawPlan = '';
  private animated = '';
  private animating: { key: string; skip(): void } | null = null;
  private launched = '';
  private confirm: string | null = null;
  private closedNote: string | null = null;
  private stopped = false;

  constructor(private host: MissionControlHost) {
    this.budget = new BudgetDock(host.dock, {
      onChange: (a) => this.onDockChange(a),
      onRun: () => undefined,
      onOpenWorkshop: () => this.openOverlay('workshop'),
      sfx: (n) => host.audio.sfx(n),
      canEdit: (id) => this.canEdit(id),
      actions: (left) => this.dockActions(left),
    });
    this.toasts = h('div', { class: 'mc-toasts', 'aria-live': 'polite' });
    document.body.append(this.toasts);
  }

  // ------------------------------------------------------------------ entry

  start(code: string | null) {
    const c = code ? checkClassCode(code) : null;
    const room = c?.ok ? c.code : null;
    if (room) {
      const teacher = seats.teacher(room);
      if (teacher) return this.enterTeacher(room, teacher);
      const seat = seats.player(room);
      if (seat) {
        void this.rejoin(room, seat);
        return;
      }
    }
    this.showEntry(room ?? '');
  }

  private async rejoin(code: string, seat: Seat) {
    this.waiting('Rejoining your room...');
    try {
      const j = await api.join(code, { token: seat.token });
      if (j.playerId !== seat.playerId) seats.setPlayer(code, { playerId: j.playerId, token: j.token, name: j.name });
      this.enterStudent(code, { playerId: j.playerId, token: j.token, name: j.name });
    } catch (e) {
      seats.setPlayer(code, null);
      this.showEntry(code, (e as Error).message, seat.name);
    }
  }

  private waiting(text: string) {
    this.modal([h('div', { class: 'kicker' }, 'Mission Control'), h('p', null, text)], { label: 'Mission Control' });
  }

  private showEntry(code = '', message = '', name = '') {
    this.role = null;
    this.prepareScreen();
    const codeIn = h('input', {
      class: 'cc-input',
      id: 'mc-code',
      value: code,
      maxlength: '9',
      autocomplete: 'off',
      autocapitalize: 'characters',
      spellcheck: 'false',
      placeholder: 'e.g. K7RZQ',
      'aria-describedby': 'mc-join-msg',
    }) as HTMLInputElement;
    const nameIn = h('input', {
      class: 'cc-input mc-name-input',
      id: 'mc-name',
      value: name,
      maxlength: String(LIMITS.nameMax),
      autocomplete: 'off',
      autocapitalize: 'words',
      spellcheck: 'false',
      placeholder: 'First name or nickname',
      'aria-describedby': 'mc-join-msg',
    }) as HTMLInputElement;
    const msg = h('p', { class: `cc-msg ${message ? 'bad' : ''}`, id: 'mc-join-msg', role: 'status' }, message);
    const go = h('button', { class: 'btn primary', type: 'submit' }, 'Join the mission', h('span', { class: 'arrow' }));
    const form = h(
      'form',
      { class: 'class-code mc-join', novalidate: true },
      h('div', { class: 'kicker' }, 'Students: join your class'),
      h('label', { for: 'mc-code' }, 'Room code (on the board)'),
      codeIn,
      h('label', { for: 'mc-name', style: 'margin-top:8px' }, `Your first name or a nickname (up to ${LIMITS.nameMax} letters)`),
      nameIn,
      msg,
      h('div', { class: 'actions end' }, go),
    );
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      void this.join(codeIn.value, nameIn.value, msg, go);
    });
    this.modal(
      [
        h('div', { class: 'kicker' }, 'Class mission'),
        h('h2', null, 'Mission Control'),
        h(
          'p',
          null,
          'Your whole class runs one Mars base together. Everyone works a station, and all the stations share the same power cells. Talk, agree on a plan, and get the crew home.',
        ),
        form,
        h(
          'div',
          { class: 'card mc-teacher-start' },
          h('b', null, 'Teacher? '),
          'Open a room on the projector, then students join from their own devices.',
          h('div', { class: 'actions' }, h('button', { class: 'btn cyan', onclick: () => this.showCreate() }, 'Start a room for my class')),
        ),
        h(
          'div',
          { class: 'actions end' },
          h('button', { class: 'btn small', onclick: () => this.showHelp(() => this.showEntry(codeIn.value, '', nameIn.value)) }, 'How it works'),
          h('button', { class: 'btn small', onclick: () => this.exit() }, 'Back'),
        ),
      ],
      { label: 'Mission Control: join' },
    );
    (code ? nameIn : codeIn).focus();
  }

  private async join(rawCode: string, rawName: string, msg: HTMLElement, btn: HTMLButtonElement) {
    const say = (t: string) => {
      msg.textContent = t;
      msg.className = 'cc-msg bad';
      this.host.audio.sfx('deny');
    };
    const c = checkClassCode(rawCode);
    if (!c.ok) return say(CODE_PROBLEM[c.problem]);
    const n = checkNameFormat(rawName);
    if (!n.ok) return say(NAME_PROBLEM[n.problem]);
    btn.disabled = true;
    msg.className = 'cc-msg';
    msg.textContent = 'Joining...';
    try {
      const j = await api.join(c.code, { name: n.name });
      const seat = { playerId: j.playerId, token: j.token, name: j.name };
      seats.setPlayer(c.code, seat);
      this.host.audio.sfx('click');
      this.enterStudent(c.code, seat);
    } catch (e) {
      btn.disabled = false;
      say((e as Error).message);
    }
  }

  private showCreate(diff: 'cadet' | 'commander' = 'cadet', mode: 'quick' | 'campaign' = 'quick', message = '') {
    const choice = <T extends string>(value: T, current: T, title: string, text: string, pick: (v: T) => void) =>
      h('button', { class: 'crate', 'aria-pressed': String(value === current), onclick: () => pick(value) }, h('b', null, title), h('span', null, text));
    this.modal(
      [
        h('div', { class: 'kicker' }, 'Mission Control · for teachers'),
        h('h2', null, 'Open a room for your class'),
        h(
          'p',
          null,
          'Put this screen on the projector. Students join with a room code and their first name, and each one runs a station. Nothing is saved: the room closes when you close it, or after 3 hours with nothing happening.',
        ),
        h('h3', null, 'Difficulty'),
        h(
          'div',
          { class: 'crates', role: 'group', 'aria-label': 'Difficulty' },
          choice('cadet', diff, 'Cadet', 'Recommended for classes. More time, fewer storms.', (v) => this.showCreate(v, mode)),
          choice('commander', diff, 'Commander', 'Less time, more storms, and a radio blackout.', (v) => this.showCreate(v, mode)),
        ),
        h('h3', null, 'Length'),
        h(
          'div',
          { class: 'crates', role: 'group', 'aria-label': 'Length' },
          choice('quick', mode, 'One crew', 'About 15 to 25 minutes.', (v) => this.showCreate(diff, v)),
          choice('campaign', mode, 'Three crews', 'About 45 to 60 minutes. The base carries over to each new crew.', (v) => this.showCreate(diff, v)),
        ),
        message ? h('p', { class: 'cc-msg bad', role: 'status' }, message) : null,
        h(
          'div',
          { class: 'actions end' },
          h('button', { class: 'btn small', onclick: () => this.showEntry() }, 'Back'),
          h(
            'button',
            {
              class: 'btn primary',
              'data-autofocus': true,
              onclick: async (e: Event) => {
                (e.currentTarget as HTMLButtonElement).disabled = true;
                try {
                  const r = await api.create({ difficulty: diff, mode });
                  seats.setTeacher(r.code, r.teacherToken);
                  this.host.audio.sfx('click');
                  this.enterTeacher(r.code, r.teacherToken);
                } catch (err) {
                  this.showCreate(diff, mode, (err as Error).message);
                }
              },
            },
            'Open the room',
            h('span', { class: 'arrow' }),
          ),
        ),
      ],
      { label: 'Mission Control: open a room' },
    );
  }

  private enterTeacher(code: string, teacherToken: string) {
    this.role = 'teacher';
    this.code = code;
    this.token = teacherToken;
    this.connect({ teacher: teacherToken });
  }

  private enterStudent(code: string, seat: Seat) {
    this.role = 'student';
    this.code = code;
    this.token = seat.token;
    this.seat = seat;
    this.host.audio.stopMusic();
    this.connect({ token: seat.token });
  }

  private connect(auth: { token: string } | { teacher: string }) {
    this.prepareScreen();
    setRoomParam(this.code);
    const roleClass = this.role === 'teacher' ? 'mc-teacher' : 'mc-student';
    document.getElementById('app')?.classList.add('mc', roleClass);
    this.toasts.classList.add(roleClass);
    this.waiting('Connecting to Mission Control...');
    this.live?.close();
    this.live = openLive(this.code, auth, {
      state: (v) => this.onState(v),
      closed: (reason) => this.onClosed(reason),
      status: (s) => {
        if (s === this.link) return;
        this.link = s;
        if (this.view) this.renderHudOnly();
      },
    });
  }

  private prepareScreen() {
    clear(this.host.dock);
    clear(this.host.hud);
    this.host.hud.append(h('div', { class: 'hud-right' }, this.hudButtons()));
    this.host.stage.setScene({ sol: 0, weather: 'clear', alloc: emptyAlloc(), fuel: 0, sheltered: false, levels: emptyLevels(), crew: 4 });
  }

  /** Leave Mission Control and give the screen back to the game. */
  exit() {
    if (this.stopped) return;
    this.stopped = true;
    this.live?.close();
    this.live = null;
    this.animating?.skip();
    this.toasts.remove();
    document.getElementById('app')?.classList.remove('mc', 'mc-teacher', 'mc-student');
    setRoomParam(null);
    clear(this.host.modalRoot);
    clear(this.host.dock);
    this.host.exit();
  }

  private onClosed(reason: ClosedReason | 'gone') {
    this.live = null;
    if (this.role === 'student') seats.setPlayer(this.code, null);
    if (this.role === 'teacher') seats.setTeacher(this.code, null);
    if (reason === 'left') return this.exit();
    if (reason === 'gone' && this.role === 'student') {
      const name = this.seat?.name ?? '';
      this.view = null;
      this.showEntry(this.code, CLOSED_TEXT.gone, name);
      return;
    }
    this.closedNote = CLOSED_TEXT[reason];
    this.animating?.skip();
    clear(this.host.dock);
    this.modal(
      [
        h('div', { class: 'kicker' }, 'Mission Control'),
        h('h2', null, 'The room has closed'),
        h('p', null, this.closedNote),
        h('div', { class: 'actions end' }, h('button', { class: 'btn primary', 'data-autofocus': true, onclick: () => this.exit() }, 'Back to the title screen')),
      ],
      { label: 'Room closed' },
    );
  }

  // ------------------------------------------------------------------ state from the server

  private onState(v: RoomView) {
    if (this.stopped || this.closedNote) return;
    const prev = this.view;
    this.view = v;
    this.showPings(v);
    if (this.role === 'student' && !this.me()) return; // removed: the stream's 'closed' message follows
    if (prev?.phase !== v.phase) {
      this.overlay = null;
      this.confirm = null;
      this.onPhase(v);
    }
    this.render();
  }

  private onPhase(v: RoomView) {
    const teacher = this.role === 'teacher';
    if (!teacher) return;
    if (v.phase === 'lobby') this.host.audio.playMusic('title');
    else if (v.phase === 'briefing') {
      this.host.audio.playMusic('mission');
      if (v.mission && getBriefing(v.mission).warning) this.host.audio.sfx('alarm');
    } else if (v.phase === 'plan') this.host.audio.sfx('click');
  }

  private me() {
    return this.view?.players.find((p) => p.id === this.seat?.playerId) ?? null;
  }

  private myStations(): StationId[] {
    return this.me()?.stations ?? [];
  }

  private canEdit(id: ModuleId): boolean {
    return this.role === 'student' && this.myStations().includes(STATION_OF[id]);
  }

  /** The plan to show: the student's own just-made changes until the server has them. */
  private shownAlloc(): Allocation {
    const v = this.view!;
    if (this.mine && (this.queue.pending > 0 || v.v < this.waitV)) return this.mine;
    this.mine = null;
    return v.alloc;
  }

  private render() {
    const v = this.view;
    if (!v || this.stopped) return;
    // A sol is playing out on screen: let it finish (or skip) before showing what came next.
    if (this.animating) {
      if (!(v.phase === 'debrief' && this.reportKey(v) === this.animating.key)) this.animating.skip();
      return;
    }
    switch (v.phase) {
      case 'lobby':
        return this.renderLobby(v);
      case 'briefing':
        return this.renderBriefing(v);
      case 'plan':
        return this.renderPlan(v);
      case 'debrief':
        return this.renderDebrief(v);
      case 'end':
        return void this.renderEnd(v);
    }
  }

  // ------------------------------------------------------------------ HUD

  private hudButtons(): HTMLElement[] {
    const a = this.host.audio;
    return [
      this.view
        ? h(
            'span',
            { class: `data-badge ${this.view.data.status}`, title: 'Where the solar storms come from' },
            h('span', { class: 'dot' }),
            this.view.data.status === 'live' ? 'LIVE NASA DONKI' : 'ARCHIVE NASA DONKI',
          )
        : null,
      this.code ? h('span', { class: `mc-room-chip ${this.link === 'live' ? '' : 'lost'}`, title: 'Room code' }, this.link === 'live' ? `ROOM ${this.code}` : 'RECONNECTING...') : null,
      h(
        'button',
        {
          class: 'btn small icon-only',
          'aria-label': a.muted ? 'Sound is off. Turn sound on' : 'Sound is on. Turn sound off',
          'aria-pressed': String(!a.muted),
          onclick: () => {
            a.setMuted(!a.muted);
            if (!a.muted && this.role === 'student') a.stopMusic();
            this.renderHudOnly();
          },
        },
        icon(a.muted ? 'mute' : 'sound', 24),
      ),
      this.code ? h('button', { class: 'btn small', onclick: () => this.openOverlay('menu') }, 'Menu') : null,
    ].filter((x): x is HTMLElement => !!x);
  }

  private renderHudOnly(next?: Snapshot) {
    const v = this.view;
    const m = v?.mission;
    if (!v || !m) {
      clear(this.host.hud);
      this.host.hud.append(h('div', { class: 'hud-right' }, this.hudButtons()));
      return;
    }
    const b = getBriefing(m);
    const used = totalCells(v.phase === 'plan' ? this.shownAlloc() : emptyAlloc());
    renderHud(
      this.host.hud,
      {
        sol: Math.min(m.sol, windowSol(m)),
        windowSol: windowSol(m),
        cellsTotal: b.cells,
        cellsLeft: v.phase === 'plan' ? b.cells - used : b.cells,
        now: snapshot(m),
        next,
        doseBudget: m.doseBudget,
        crew: m.crew,
        label: crewLabel(v),
      },
      this.hudButtons(),
    );
  }

  private stageScene(alloc: Allocation) {
    const m = this.view?.mission;
    if (!m) {
      this.host.stage.setScene({ sol: 0, weather: 'clear', alloc: emptyAlloc(), fuel: 0, sheltered: false, levels: emptyLevels(), crew: 4 });
      return;
    }
    const b = getBriefing(m);
    const p = m.base.project;
    const cost = p ? nextCost(p, m.base.levels) : null;
    this.host.stage.setScene({
      sol: m.sol,
      weather: b.weather,
      alloc,
      fuel: m.fuel,
      sheltered: alloc.shelter > 0,
      levels: m.base.levels,
      crew: m.crew,
      project: p,
      projectProgress: p && cost ? Math.min(1, (m.base.progress[p] + alloc.build) / cost) : undefined,
    });
  }

  // ------------------------------------------------------------------ lobby

  private renderLobby(v: RoomView) {
    clear(this.host.dock);
    this.renderHudOnly();
    this.stageScene(emptyAlloc());
    if (this.overlay) return this.renderOverlay();
    if (this.role === 'teacher') {
      const link = `${location.origin}/?room=${v.code}`;
      this.modal(
        [
          h('div', { class: 'kicker' }, `Mission Control · ${v.difficulty === 'cadet' ? 'Cadet' : 'Commander'} · ${v.crews > 1 ? 'three crews' : 'one crew'}`),
          h('h2', null, 'Join the mission!'),
          h('p', { class: 'mc-join-how' }, 'Open ', h('b', null, location.host || 'the game'), ', press ', h('b', null, 'Class mission'), ', and type this code:'),
          h('div', { class: 'cc-big mc-code', 'aria-label': `Room code ${v.code.split('').join(' ')}` }, v.code),
          h(
            'div',
            { class: 'cc-row' },
            h('input', { class: 'cc-link-text', value: link, readonly: true, 'aria-label': 'Link to this room', onfocus: (e: Event) => (e.target as HTMLInputElement).select() }),
            h(
              'button',
              {
                class: 'btn small',
                onclick: (e: Event) => {
                  const btn = e.currentTarget as HTMLButtonElement;
                  void navigator.clipboard?.writeText(link).then(
                    () => (btn.textContent = 'Copied'),
                    () => (btn.textContent = 'Copy failed'),
                  );
                },
              },
              'Copy link',
            ),
          ),
          h('p', { class: 'title-foot' }, `Students use a first name or nickname. ${v.players.length} of ${LIMITS.maxPlayers} joined.`),
          stationBoard(v),
          h(
            'div',
            { class: 'actions' },
            h('button', { class: 'btn primary', 'data-autofocus': true, disabled: v.players.length ? undefined : true, onclick: () => this.teach({ type: 'start' }) }, v.players.length ? 'Start the mission' : 'Waiting for students...', h('span', { class: 'arrow' })),
            h('button', { class: 'btn', disabled: v.players.length > 1 ? undefined : true, onclick: () => this.teach({ type: 'autoAssign' }) }, 'Share out stations'),
            h('button', { class: 'btn', onclick: () => this.openOverlay('players') }, 'Manage players'),
            h('button', { class: 'btn small', onclick: () => this.openOverlay('help') }, 'How it works'),
          ),
        ],
        { wide: true, label: 'Mission Control lobby' },
      );
      return;
    }
    const me = this.me()!;
    this.modal(
      [
        h('div', { class: 'kicker' }, `Room ${v.code}`),
        h('h2', null, `You're in, ${me.name}!`),
        this.stationCard(me.stations),
        h('p', null, 'Everyone shares the same power cells. Use the quick messages to ask for cells or warn about storms.'),
        stationBoard(v, { meId: me.id }),
        h('p', { class: 'mc-wait' }, 'Waiting for your teacher to start the mission.'),
        h('div', { class: 'actions end' }, h('button', { class: 'btn small', onclick: () => this.openOverlay('help') }, 'How it works')),
      ],
      { wide: true, label: 'Mission Control: waiting to start' },
    );
  }

  private stationCard(stations: StationId[]): HTMLElement {
    return h(
      'div',
      { class: `card mc-my-station st-${stations[0] ?? 'o2'}` },
      h('div', { class: 'kicker' }, stations.length > 1 ? 'Your stations' : 'Your station'),
      h('div', { class: 'mc-my-name' }, stations.map((s) => h('span', { class: 'mc-my-chip' }, icon(STATION_ICON[s], 20), STATIONS[s].name))),
      stations.map((s) => h('p', null, STATIONS[s].job)),
    );
  }

  // ------------------------------------------------------------------ briefing

  private briefingContent(v: RoomView, closable: boolean): Child[] {
    const m = v.mission!;
    const shop = this.role === 'student' && this.myStations().includes('shop');
    return [
      h('div', { class: 'kicker' }, `${crewLabel(v)} · Sol ${m.sol} of ${windowSol(m)} · Morning briefing`),
      ...briefingCards(v, { canChooseCrate: shop, onCrate: (id) => this.crate(id) }),
      shop && v.phase !== 'end' ? h('div', { class: 'actions' }, h('button', { class: 'btn small', onclick: () => this.openOverlay('workshop') }, 'Choose the Workshop project')) : null,
      closable ? h('div', { class: 'actions end' }, h('button', { class: 'btn primary', 'data-autofocus': true, onclick: () => this.closeOverlay() }, 'Back to the plan')) : null,
    ];
  }

  private renderBriefing(v: RoomView) {
    clear(this.host.dock);
    this.renderHudOnly();
    this.stageScene(emptyAlloc());
    this.host.stage.setTimeOfDay(0.02);
    if (this.overlay) return this.renderOverlay();
    const teacher = this.role === 'teacher';
    this.modal(
      [
        ...this.briefingContent(v, false),
        teacher
          ? h(
              'div',
              { class: 'actions end' },
              h('button', { class: 'btn small', onclick: () => this.openOverlay('players') }, 'Players'),
              h('button', { class: 'btn primary', 'data-autofocus': true, onclick: () => this.teach({ type: 'plan' }) }, 'Start planning', h('span', { class: 'arrow' })),
            )
          : [h('p', { class: 'mc-wait' }, 'Read the briefing together. Your teacher will start the planning.'), pingButtons((p) => this.ping(p))],
      ],
      { label: `Sol ${v.mission!.sol} morning briefing` },
    );
  }

  // ------------------------------------------------------------------ planning

  private renderPlan(v: RoomView) {
    const m = v.mission!;
    const b = getBriefing(m);
    const alloc = this.shownAlloc();
    const check = checkAlloc(m, alloc);
    const preview = previewSol(m, alloc, v.crate ?? undefined);
    this.sawPlan = `${v.expedition}:${m.sol}`;
    this.renderHudOnly(preview.after);
    this.stageScene(alloc);
    this.budget.set(m, b, alloc, preview, this.side(v, briefMini(m, b, check.remaining)));
    if (this.overlay) this.renderOverlay();
    else clear(this.host.modalRoot);
  }

  private side(v: RoomView, mini: HTMLElement[]): HTMLElement[] {
    if (this.role === 'teacher') return [...mini, stationBoard(v, { showReady: true, compact: true })];
    const me = this.me()!;
    const m = v.mission!;
    const needCrate = me.stations.includes('shop') && getBriefing(m).resupply && !v.crate;
    return [
      h(
        'div',
        { class: `mc-side-station st-${me.stations[0]}` },
        h('span', { class: 'kicker' }, me.stations.length > 1 ? 'Your stations' : 'Your station'),
        h('b', null, stationNames(me.stations)),
      ),
      needCrate
        ? h('button', { class: 'btn small primary', onclick: () => this.openOverlay('briefing') }, 'Choose the cargo crate')
        : null,
      ...mini,
      pingButtons((p) => this.ping(p)),
    ].filter((x): x is HTMLElement => !!x);
  }

  private dockActions(left: number): HTMLElement[] {
    const v = this.view;
    if (!v) return [];
    const { ready, online } = readyCount(v);
    if (this.role === 'teacher') {
      const blockers = runBlockers(v);
      return [
        h(
          'button',
          { class: 'btn go mc-run', disabled: blockers.length ? true : undefined, onclick: () => this.teach({ type: 'run' }), 'aria-label': `Run sol ${v.mission?.sol ?? ''}` },
          `Run sol ${v.mission?.sol ?? ''}`,
          h('span', { class: 'arrow' }),
        ),
        h('div', { class: 'run-hint' }, blockers[0] ?? `Ready: ${ready} of ${online}. Every cell has a job.`),
        h(
          'div',
          { class: 'mc-teacher-tools' },
          h(
            'button',
            {
              class: 'btn small',
              'aria-pressed': String(v.autoRun),
              title: 'Run the sol by itself as soon as every connected student is ready and every cell is placed.',
              onclick: () => this.teach({ type: 'autoRun', on: !v.autoRun }),
            },
            v.autoRun ? 'Auto-run: on' : 'Auto-run: off',
          ),
          h('button', { class: 'btn small', onclick: () => this.openOverlay('briefing') }, 'Briefing'),
          h('button', { class: 'btn small', onclick: () => this.openOverlay('players') }, 'Players'),
        ),
      ];
    }
    const me = this.me();
    const isReady = !!me?.ready;
    return [
      h(
        'button',
        { class: `btn ${isReady ? 'go' : 'primary'} mc-ready`, 'aria-pressed': String(isReady), onclick: () => this.setReady(!isReady) },
        isReady ? 'Ready!' : "I'm ready",
      ),
      h('div', { class: 'run-hint' }, `${ready} of ${online} ready. ${left > 0 ? `${left} cell${left === 1 ? '' : 's'} still to place.` : 'All cells placed.'}`),
      h('div', { class: 'mc-teacher-tools' }, h('button', { class: 'btn small', onclick: () => this.openOverlay('briefing') }, 'Briefing')),
    ];
  }

  private onDockChange(next: Allocation) {
    const v = this.view;
    if (!v || v.phase !== 'plan' || this.role !== 'student') return;
    const prev = this.shownAlloc();
    const plus = MODULE_IDS.filter((id) => next[id] > prev[id]);
    const minus = MODULE_IDS.filter((id) => next[id] < prev[id]);
    let a: PlayerAction | null = null;
    if (plus.length === 1 && minus.length === 1) a = { type: 'move', from: minus[0], to: plus[0] };
    else if (plus.length === 1 && !minus.length) a = { type: 'place', module: plus[0] };
    else if (minus.length === 1 && !plus.length) a = { type: 'remove', module: minus[0] };
    if (!a) return;
    this.mine = next;
    this.send(a);
    this.renderPlan(v);
  }

  private send(a: PlayerAction) {
    void this.queue
      .push(() => api.action(this.code, this.token, a))
      .then(
        (r) => {
          this.waitV = Math.max(this.waitV, r.v);
        },
        (e: ApiFailure) => {
          this.failed = true;
          if (e.status === 403 && e.code === 'not-a-player') return;
          this.host.audio.sfx('deny');
          this.toast(e.message, 'error');
        },
      )
      .finally(() => {
        if (this.queue.pending > 0) return;
        if (this.failed) {
          this.failed = false;
          this.mine = null;
        }
        if (this.view?.phase === 'plan' && !this.animating) this.renderPlan(this.view);
      });
  }

  private setReady(on: boolean) {
    this.host.audio.sfx('click');
    this.send({ type: 'ready', ready: on });
  }

  private crate(id: CrateId) {
    this.host.audio.sfx('click');
    this.send({ type: 'crate', crate: id });
  }

  private lastPing = 0;
  private ping(id: PingId) {
    if (Date.now() - this.lastPing < LIMITS.pingGapMs) return this.toast('Wait a moment before sending another message.', 'error');
    this.lastPing = Date.now();
    this.send({ type: 'ping', ping: id });
  }

  private teach(a: TeacherAction) {
    this.host.audio.sfx(a.type === 'run' ? 'run' : 'click');
    void api.teacher(this.code, this.token, a).catch((e: ApiFailure) => {
      this.host.audio.sfx('deny');
      this.toast(e.message, 'error');
    });
  }

  // ------------------------------------------------------------------ the sol plays out

  private reportKey(v: RoomView) {
    return v.report ? `${v.expedition}:${v.report.sol}` : '';
  }

  private renderDebrief(v: RoomView) {
    const key = this.reportKey(v);
    // Only screens that watched the planning play the day: late joiners go straight to the debrief.
    if (key && key !== this.animated && key === this.sawPlan) {
      this.animated = key;
      void this.playSol(v, key);
      return;
    }
    this.animated = key;
    const m = v.mission!;
    clear(this.host.dock);
    this.renderHudOnly();
    this.stageScene(emptyAlloc());
    if (this.overlay) return this.renderOverlay();
    const over = m.status !== 'playing';
    const teacher = this.role === 'teacher';
    this.modal(
      [
        h('div', { class: 'kicker' }, `${crewLabel(v)} · Sol ${v.report!.sol} · Debrief`),
        ...debriefContent(v),
        teacher
          ? h(
              'div',
              { class: 'actions end' },
              h(
                'button',
                { class: 'btn primary', 'data-autofocus': true, onclick: () => this.teach({ type: 'next' }) },
                over ? (m.status === 'won' ? 'Launch!' : 'See what happened') : `Start sol ${m.sol}`,
                h('span', { class: 'arrow' }),
              ),
            )
          : h('p', { class: 'mc-wait' }, over ? 'The mission is over. Look at the big screen!' : 'Talk about it with your class. Your teacher will start the next sol.'),
      ],
      { label: `Sol ${v.report!.sol} debrief` },
    );
  }

  private async playSol(v: RoomView, key: string) {
    const r = v.report!;
    const m = v.mission!;
    const teacher = this.role === 'teacher';
    clear(this.host.modalRoot);
    clear(this.host.dock);
    this.host.stage.setScene({
      sol: r.sol,
      weather: r.weather,
      alloc: r.alloc,
      fuel: r.before.fuel,
      sheltered: r.alloc.shelter > 0,
      levels: m.base.levels,
      crew: m.crew,
    });
    const clock = h('div', { class: 'clock' }, '06:00');
    const fill = h('div', { class: 'fill', style: 'width:0%' });
    const logLine = h('div', { class: 'run-log', 'aria-live': 'polite' }, 'Sunrise at the outpost.');
    let ff = false;
    const skip = h('button', { class: 'btn small', onclick: () => (ff = true) }, 'Skip', h('span', { class: 'arrow' }));
    this.host.dock.append(h('div', { class: 'run-bar' }, clock, h('div', { class: 'bar' }, fill), skip), logLine);
    this.animating = { key, skip: () => (ff = true) };
    const duration = this.host.reducedMotion ? 2000 : 8000;
    const beats = runBeats(r);
    const start = performance.now();
    let fired = 0;
    let firstFrame = true;
    await new Promise<void>((resolve) => {
      const tick = (now: number) => {
        if (this.stopped) return resolve();
        const t = ff ? 1 : Math.min(1, (now - start) / duration);
        this.host.stage.setTimeOfDay(t);
        const mins = Math.floor((6 * 60 + t * 24.66 * 60) % (24 * 60));
        clock.textContent = `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
        fill.style.width = `${t * 100}%`;
        while (fired < beats.length && beats[fired].at <= t) {
          const ev = beats[fired++];
          logLine.textContent = ev.text;
          if (ev.cue && !ff) this.host.stage.cue?.(ev.cue);
          if (ev.storm && !ff) {
            this.host.stage.storm(ev.storm);
            if (teacher) this.host.audio.sfx('storm');
          }
        }
        const lerp = (a: number, b: number) => a + (b - a) * t;
        renderHud(
          this.host.hud,
          {
            sol: r.sol,
            windowSol: windowSol(m),
            cellsTotal: r.cells,
            cellsLeft: 0,
            now: { air: lerp(r.before.air, r.after.air), food: lerp(r.before.food, r.after.food), dose: lerp(r.before.dose, r.after.dose), fuel: lerp(r.before.fuel, r.after.fuel) },
            doseBudget: m.doseBudget,
            crew: m.crew,
            label: crewLabel(v),
          },
          // New buttons on the first frame only: then a press on Menu or Sound that spans a frame still lands.
          firstFrame ? this.hudButtons() : 'keep',
        );
        firstFrame = false;
        if (t < 1) requestAnimationFrame(tick);
        else resolve();
      };
      requestAnimationFrame(tick);
    });
    this.animating = null;
    if (this.stopped) return;
    if (teacher) this.host.audio.sfx(r.built ? 'good' : r.storm && !r.storm.shelterCells ? 'bad' : 'click');
    this.render();
  }

  // ------------------------------------------------------------------ the end

  private async renderEnd(v: RoomView) {
    const m = v.mission!;
    const key = `${v.expedition}:end`;
    clear(this.host.dock);
    this.renderHudOnly();
    if (m.status === 'won' && this.launched !== key) {
      this.launched = key;
      clear(this.host.modalRoot);
      if (this.role === 'teacher') {
        this.host.audio.playMusic('launch');
        this.host.audio.sfx('win');
      }
      this.animating = { key: 'launch', skip: () => undefined };
      await this.host.stage.launch();
      this.animating = null;
      // Draw whatever the room is showing now (the launch is not shown again).
      return this.render();
    }
    this.launched = key;
    if (this.overlay) return this.renderOverlay();
    const teacher = this.role === 'teacher';
    const more = v.crews > 1 && v.results.length < v.crews;
    this.modal(
      [
        ...endContent(v),
        teacher
          ? h(
              'div',
              { class: 'actions' },
              more ? h('button', { class: 'btn primary', 'data-autofocus': true, onclick: () => this.teach({ type: 'next' }) }, 'Send the next crew', h('span', { class: 'arrow' })) : null,
              h('button', { class: `btn ${more ? '' : 'primary'}`, 'data-autofocus': more ? undefined : true, onclick: () => this.teach({ type: 'restart' }) }, 'Play again (same Mars)'),
              this.closeRoomButton(),
            )
          : [
              h('p', { class: 'mc-wait' }, more ? 'Talk about it. Your teacher will send the next crew.' : 'Thanks for playing! Talk about it with your class.'),
              h('div', { class: 'actions end' }, h('button', { class: 'btn small', onclick: () => this.leave() }, 'Leave the room')),
            ],
      ],
      { label: m.status === 'won' ? 'Mission complete' : 'Mission over' },
    );
  }

  // ------------------------------------------------------------------ dialogs on top of the plan

  private openOverlay(o: Overlay) {
    this.host.audio.sfx('click');
    this.overlay = o;
    this.confirm = null;
    this.renderOverlay();
  }

  private closeOverlay() {
    this.overlay = null;
    this.confirm = null;
    clear(this.host.modalRoot);
    this.render();
  }

  private renderOverlay() {
    const v = this.view;
    if (!v) return;
    switch (this.overlay) {
      case 'briefing':
        if (!v.mission) return this.closeOverlay();
        this.modal(this.briefingContent(v, true), { label: 'Briefing', onClose: () => this.closeOverlay() });
        return;
      case 'workshop': {
        const m = v.mission;
        if (!m) return this.closeOverlay();
        const canPick = this.role === 'student' && this.myStations().includes('shop') && (v.phase === 'plan' || v.phase === 'briefing');
        this.modal(
          [
            h('div', { class: 'kicker' }, 'Workshop'),
            h('h2', null, 'Build the base'),
            h(
              'p',
              null,
              'Cells in the Workshop build upgrades that last for every crew after you. A cell spent building is a cell not making air, food or fuel today. Changing the project hands the Workshop cells back to the shared pool.',
            ),
            workshopList(m, canPick, (id) => {
              this.host.audio.sfx('click');
              this.send({ type: 'project', project: id });
            }),
            h('div', { class: 'actions end' }, h('button', { class: 'btn primary', 'data-autofocus': true, onclick: () => this.closeOverlay() }, 'Done')),
          ],
          { wide: true, label: 'Workshop', onClose: () => this.closeOverlay() },
        );
        return;
      }
      case 'players':
        this.modal(this.playersContent(v), { wide: true, label: 'Players', onClose: () => this.closeOverlay() });
        return;
      case 'help':
        this.showHelp(() => this.closeOverlay());
        return;
      case 'menu':
        this.modal(
          [
            h('div', { class: 'kicker' }, `Room ${v.code}`),
            h('h2', null, 'Mission Control menu'),
            h(
              'div',
              { class: 'actions' },
              h('button', { class: 'btn primary', 'data-autofocus': true, onclick: () => this.closeOverlay() }, 'Back'),
              v.mission ? h('button', { class: 'btn', onclick: () => this.openOverlay('briefing') }, 'Briefing') : null,
              v.mission ? h('button', { class: 'btn', onclick: () => this.openOverlay('workshop') }, 'Workshop') : null,
              this.role === 'teacher' ? h('button', { class: 'btn', onclick: () => this.openOverlay('players') }, 'Players') : null,
              h('button', { class: 'btn', onclick: () => this.openOverlay('help') }, 'How it works'),
              this.role === 'teacher' ? this.closeRoomButton() : h('button', { class: 'btn', onclick: () => this.leave() }, 'Leave the room'),
            ),
            this.role === 'teacher' && v.phase !== 'lobby'
              ? h('p', { class: 'title-foot' }, `Students can still join with code ${v.code}: they go to the station with the fewest players.`)
              : null,
          ],
          { label: 'Mission Control menu', onClose: () => this.closeOverlay() },
        );
        return;
      default:
        return;
    }
  }

  private closeRoomButton(): HTMLElement {
    const sure = this.confirm === 'close';
    return h(
      'button',
      {
        class: `btn ${sure ? 'primary' : ''}`,
        onclick: () => {
          if (!sure) {
            this.confirm = 'close';
            return this.overlay ? this.renderOverlay() : this.render();
          }
          this.teach({ type: 'end' });
        },
      },
      sure ? 'Tap again to close the room for everyone' : 'Close the room',
    );
  }

  /** The teacher's player list: move students between stations, or remove a name. */
  private playersContent(v: RoomView): Child[] {
    return [
      h('div', { class: 'kicker' }, `Room ${v.code} · ${v.players.length} of ${LIMITS.maxPlayers} players`),
      h('h2', null, 'Players and stations'),
      h('p', null, 'Tap a station to move a student there. Every station always keeps at least one student. Removing a player also blocks that name in this room.'),
      v.players.length
        ? h(
            'div',
            { class: 'mc-table-wrap' },
            h(
              'table',
              { class: 'log mc-players' },
              h('thead', null, h('tr', null, h('th', null, 'Name'), h('th', null, 'Station'), h('th', null, ''))),
              h(
                'tbody',
                null,
                v.players.map((p) =>
                  h(
                    'tr',
                    null,
                    h('td', null, h('b', null, p.name), h('div', { class: 'title-foot', style: 'margin:0' }, p.online ? (p.ready ? 'ready' : 'connected') : 'not connected')),
                    h(
                      'td',
                      null,
                      h(
                        'div',
                        { class: 'mc-assign', role: 'group', 'aria-label': `Station for ${p.name}` },
                        STATION_IDS.map((s) =>
                          h(
                            'button',
                            {
                              class: `btn small st-${s}`,
                              'aria-pressed': String(p.stations.includes(s)),
                              'aria-label': `Move ${p.name} to ${STATIONS[s].name}`,
                              onclick: () => this.teach({ type: 'assign', playerId: p.id, station: s }),
                            },
                            STATIONS[s].name,
                          ),
                        ),
                      ),
                    ),
                    h(
                      'td',
                      null,
                      h(
                        'button',
                        {
                          class: `btn small ${this.confirm === p.id ? 'primary' : ''}`,
                          'aria-label': this.confirm === p.id ? `Tap again to remove ${p.name}` : `Remove ${p.name}`,
                          onclick: () => {
                            if (this.confirm !== p.id) {
                              this.confirm = p.id;
                              return this.renderOverlay();
                            }
                            this.confirm = null;
                            this.teach({ type: 'kick', playerId: p.id });
                          },
                        },
                        this.confirm === p.id ? 'Tap again' : 'Remove',
                      ),
                    ),
                  ),
                ),
              ),
            ),
          )
        : h('p', { class: 'mc-wait' }, 'Nobody has joined yet.'),
      h(
        'div',
        { class: 'actions end' },
        h('button', { class: 'btn', disabled: v.players.length > 1 ? undefined : true, onclick: () => this.teach({ type: 'autoAssign' }) }, 'Share out stations evenly'),
        h('button', { class: 'btn primary', 'data-autofocus': true, onclick: () => this.closeOverlay() }, 'Done'),
      ),
    ];
  }

  private showHelp(back: () => void) {
    this.modal(
      [
        h('div', { class: 'kicker' }, 'How it works'),
        h('h2', null, 'Mission Control'),
        h('p', null, 'The whole class runs one Mars base. Each sol (a Mars day) the solar panels make a few power cells, and every cell must go somewhere.'),
        h(
          'ul',
          { class: 'clean' },
          STATION_IDS.map((s) => h('li', null, stationTag(s), ' ', STATIONS[s].job)),
        ),
        h(
          'ol',
          { class: 'clean' },
          h('li', null, h('b', null, 'Read the briefing together. '), 'Weather, power, and news from Earth.'),
          h('li', null, h('b', null, 'Plan. '), 'You can only move cells in your own station, but everyone shares the same cells. Agree who gets them!'),
          h('li', null, h('b', null, 'Send quick messages '), 'like "I need more cells!" or "Storm warning: shelter!". There is no chat.'),
          h('li', null, h('b', null, "Press I'm ready "), 'when your station is done. Your teacher runs the sol.'),
          h('li', null, h('b', null, 'Watch the sol, '), 'then read the debrief and talk about what happened.'),
        ),
        h('div', { class: 'actions end' }, h('button', { class: 'btn primary', 'data-autofocus': true, onclick: back }, 'Got it')),
      ],
      { label: 'How Mission Control works', onClose: back },
    );
  }

  private leave() {
    this.host.audio.sfx('click');
    const code = this.code;
    const token = this.token;
    seats.setPlayer(code, null);
    void api.action(code, token, { type: 'leave' }).catch(() => undefined);
    this.exit();
  }

  // ------------------------------------------------------------------ pings and notes

  private showPings(v: RoomView) {
    const newest = v.pings.reduce((a, p) => Math.max(a, p.n), 0);
    // First message after joining: don't replay pings from before we arrived.
    if (this.seenPing < 0) {
      this.seenPing = newest;
      return;
    }
    for (const p of v.pings) {
      if (p.n <= this.seenPing) continue;
      this.toasts.append(pingToast(p.from, p.stations, p.ping));
      this.host.audio.sfx(p.ping === 'storm' ? 'alarm' : 'click');
    }
    this.seenPing = Math.max(this.seenPing, newest);
    this.trimToasts();
  }

  private toast(text: string, kind: 'error' | 'info' = 'info') {
    this.toasts.append(h('div', { class: `mc-ping mc-note ${kind}`, role: 'status' }, h('span', { class: 'mc-ping-text' }, text)));
    this.trimToasts();
  }

  private trimToasts() {
    const items = [...this.toasts.children] as HTMLElement[];
    for (const el of items.slice(0, Math.max(0, items.length - 4))) el.remove();
    for (const el of items) {
      if (el.dataset.timer) continue;
      el.dataset.timer = '1';
      setTimeout(() => el.remove(), LIMITS.pingShowMs - 1000);
    }
  }

  // ------------------------------------------------------------------ dialogs

  private modal(content: Child, opts: { wide?: boolean; label: string; onClose?: () => void }) {
    const root = this.host.modalRoot;
    const prev = root.querySelector<HTMLElement>('.modal');
    const same = prev?.getAttribute('aria-label') === opts.label;
    const keep = same ? { box: prev!.scrollTop, root: root.scrollTop } : null;
    const active = document.activeElement as HTMLElement | null;
    const focusKey = same && active && root.contains(active) ? (active.getAttribute('aria-label') ?? active.textContent) : null;
    clear(root);
    const box = h(
      'div',
      { class: `modal mc-modal ${opts.wide ? 'wide' : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': opts.label },
      opts.onClose ? h('button', { class: 'btn small icon-only close-x', 'aria-label': 'Close', onclick: opts.onClose }, 'X') : null,
      content,
    );
    root.append(box);
    if (keep) {
      // Redrawing the same dialog (someone joined, a crate was picked): stay where the reader was.
      box.scrollTop = keep.box;
      root.scrollTop = keep.root;
      if (focusKey) {
        const again = [...box.querySelectorAll<HTMLElement>('button, input')].find((el) => (el.getAttribute('aria-label') ?? el.textContent) === focusKey);
        again?.focus({ preventScroll: true });
      }
      return;
    }
    (box.querySelector<HTMLElement>('[data-autofocus]') ?? box.querySelector<HTMLElement>('button.primary, button'))?.focus({ preventScroll: true });
  }
}

/** Put ?room=CODE in the address (so a refresh comes back to the room), or take it out. */
function setRoomParam(code: string | null) {
  try {
    const url = new URL(location.href);
    if (code) url.searchParams.set('room', code);
    else url.searchParams.delete('room');
    history.replaceState(history.state, '', url.toString());
  } catch {
    /* not important */
  }
}
