// Written with AI assistance (Claude Code). See README "Use of AI tools".
// Game flow.
//   Campaign:  title -> [expedition intro -> (briefing -> budget -> run -> debrief) x sols -> expedition end -> 26 months later] x 3 -> campaign end
//   Quick:     one expedition.   History: the real May 2024 storms.

import { h, clear, $, prefersReducedMotion, type Child } from './dom';
import { icon } from './icons';
import { renderHud } from './hud';
import { BudgetDock } from './budget';
import { GameAudio } from './audio';
import { createMission, emptyAlloc, getBriefing, previewSol, runSol, windowSol, checkAlloc, setProject, expeditionSpec } from '../sim/sim';
import { explainSol, endingFor, eventDate, type Debrief } from '../sim/explain';
import { REAL, EXPEDITIONS, SYNODIC_MONTHS, tuningFor, siteOf, landingOf, type Difficulty, type Landing } from '../sim/constants';
import { UPGRADES, UPGRADE_IDS, nextCost, maxLevel, emptyLevels, upgradeDef, upgradesFor, type UpgradeId } from '../sim/upgrades';
import { siteText, type Site } from '../sim/site';
import { SITE_CHOICES, MOON_DIFFICULTY, MOON_TALK_ABOUT_IT, nightCards, moonSky, landingPicker, landingCard } from './sitecopy';
import {
  newCampaign,
  missionConfigFor,
  finishExpedition,
  campaignDone,
  totalStars,
  starsFor,
  serialize,
  deserialize,
  STAR_INFO,
  type Campaign,
  type StarId,
} from '../sim/campaign';
import type { Allocation, CrateId, MissionConfig, MissionState, Snapshot, SolReport, SpaceWeatherEvent } from '../sim/types';
import { earthMarsLightTime, type LightTime } from '../data/lighttime';
import { loadSpaceWeather, buildEventPool, may2024Pool, countByClass, earthStormsOn, type SpaceWeatherFeed, MAY2024_SNAPSHOT } from '../data/donki';
import { MAY2024_START } from '../sim/plan';
import { factFor, FACTS } from '../data/science';
import type { Stage } from '../render/stage';
import { renderScienceLog } from './sciencelog';
import { renderCredits } from './credits';
import { meetCrew, crewSays } from './crew';
import { sunPanel } from './sunpanel';
import { Coach, type CoachPhase } from './tutorial';
import { briefingArt, weatherLine, upcomingRegion, briefMini, eventCard, scienceCard, runBeats, compareCard, shortRange, planWarnings, adviceLines, todayBanner, earthCard } from './views';
import { advise } from '../sim/advisor';
import { ClassCodes, classCodeLine } from './classcode';
import { campaignWithCode } from '../sim/classcode';
import { missionChartFor, crewCharts } from './charts';
import { roomParam } from '../room/protocol';
import { classBoard } from './classboard';
import { dashboardParams, type DashboardLink } from '../class/protocol';
import { dailyMissionConfig } from '../daily/replay';
import { loadDaily, type DailySession } from './daily/net';
import { dailyBadge, dailyEndPanel, dailyHudLabel, dailyIntroCard, dailyKicker, todaysBest } from './daily/screens';

type Phase = 'title' | 'intro' | 'briefing' | 'plan' | 'running' | 'debrief' | 'end' | 'interlude' | 'finale' | 'room' | 'dashboard';
type Mode = 'campaign' | 'quick' | 'history' | 'daily';

interface Settings {
  muted: boolean;
  reducedMotion: boolean;
  /** 3D outpost on (default) or the simple view for slow devices. */
  view3d: boolean;
}

const SETTINGS_KEY = 'ev-settings';
const SAVE_KEY = 'ev-save-v1';

function loadSettings(): Settings {
  const base = { muted: false, reducedMotion: prefersReducedMotion(), view3d: true };
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw ? { ...base, ...JSON.parse(raw) } : base;
  } catch {
    return base;
  }
}
function saveSettings(s: Settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    /* private mode: fine */
  }
}

interface SaveGame {
  campaign: Campaign;
  mission: MissionState | null;
}

function readSave(): SaveGame | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { campaign: string; mission: MissionState | null };
    const campaign = deserialize(parsed.campaign);
    return campaign ? { campaign, mission: parsed.mission ?? null } : null;
  } catch {
    return null;
  }
}

/** Questions for the class at each break between crews. */
export const TALK_ABOUT_IT: Record<number, string[]> = {
  1: [
    'What did your crew spend the most power on? Was that a good choice?',
    'The O2 plant makes air to breathe AND oxygen for the rocket. Why is that a hard choice?',
    'If you could leave one message for the next crew, what would it say?',
  ],
  2: [
    'Did the upgrades from the first crew help the second crew? How?',
    'What would happen if no crew ever built anything for the next one?',
    'Why might a Mars base want a nuclear reactor instead of only solar panels?',
  ],
  3: [
    'Real NASA planners make these same trade-offs. Which one was hardest for you, and why?',
    'How did messages from Earth arriving late change your decisions?',
    'If you were designing the next Mars base, what would you build first?',
  ],
};

export class App {
  private hud = $('#hud');
  private dock = $('#dock');
  private modalRoot = $('#modal-root');
  private stageEl = $('#stage');
  private stage: Stage;
  private budget: BudgetDock;
  private audio: GameAudio;
  private settings = loadSettings();
  private feed: SpaceWeatherFeed = { status: 'none', snapshot: null, fetchedAt: null, via: null };
  private feedReady: Promise<void>;
  private light: LightTime = earthMarsLightTime();

  private phase: Phase = 'title';
  private mode: Mode | null = null;
  private campaign: Campaign | null = null;
  /** Campaign as it was when the current expedition started (for "try again"). */
  private campaignAtStart: Campaign | null = null;
  private mission: MissionState | null = null;
  private alloc: Allocation = emptyAlloc();
  private crate: CrateId | undefined;
  private lastReport: SolReport | null = null;
  private ff = false;
  private coach = new Coach();
  /** Reasons behind a "Suggest a plan" fill, shown until the player changes something. */
  private advice: Array<{ id: string; text: string }> = [];
  /** The class code new campaigns and quick missions use (from `?code=` or typed in). */
  private codes = new ClassCodes();
  /** Mars or the Moon, as picked in the mission chooser. */
  private site: Site = 'mars';
  /** Today's daily challenge (from our server, or the bundled snapshot when offline). */
  private daily: DailySession | null = null;

  /** Mars only: the landing site picked in the mission chooser (Gale Crater unless the player picks the ice site). */
  private landingSite: Landing = 'gale';

  /** Where new campaigns and quick missions go: the chosen world, plus the landing site on Mars (only Arcadia is written down). */
  private place(): { site: Site; landing?: Landing } {
    return this.site === 'mars' && this.landingSite === 'arcadia' ? { site: 'mars', landing: 'arcadia' } : { site: this.site };
  }

  constructor(stage: Stage) {
    this.stage = stage;
    this.stage.mount(this.stageEl);
    this.audio = new GameAudio(this.settings.muted);
    this.applyMotion();
    this.budget = new BudgetDock(this.dock, {
      onChange: (a) => {
        this.alloc = a;
        this.advice = [];
        this.renderPlan();
      },
      onSuggest: () => {
        if (!this.mission) return;
        const advice = advise(this.mission);
        this.alloc = advice.alloc;
        this.advice = advice.reasons;
        this.audio.sfx('place');
        this.renderPlan();
      },
      onClear: () => {
        this.alloc = emptyAlloc();
        this.advice = [];
        this.audio.sfx('remove');
        this.renderPlan();
      },
      onRun: () => this.run(),
      onOpenWorkshop: () => this.showWorkshop(() => this.closeModalAndPlan()),
      sfx: (n) => this.audio.sfx(n),
    });
    this.feedReady = loadSpaceWeather().then((f) => {
      this.feed = f;
      // Refresh the title screen with the new data only if it is the dialog on screen right now:
      // never redraw over the difficulty/site chooser (or any other dialog) the player opened.
      const onTitle = this.modalRoot.querySelector('[aria-label="Escape Velocity title screen"]');
      if (this.phase === 'title' && onTitle) this.showTitle();
      else this.refreshHud();
    });
    window.addEventListener('keydown', (e) => this.onKey(e));
    // A Mission Control join link (?room=CODE) goes straight to the class room;
    // a teacher dashboard link (?dashboard=CODE&key=KEY) opens the class board instead of the game.
    const room = roomParam(location.search);
    const dash = dashboardParams(location.search);
    if (dash) this.openDashboard(dash);
    else if (room) this.openRoom(room);
    else this.showTitle();
  }

  // ------------------------------------------------------------------ helpers
  private applyMotion() {
    document.documentElement.classList.toggle('reduce-motion', this.settings.reducedMotion);
    this.stage.setReducedMotion(this.settings.reducedMotion);
  }

  private modal(content: Child, opts: { wide?: boolean; label: string; onClose?: () => void } = { label: 'Dialog' }) {
    // Re-drawing the same dialog (e.g. picking a Workshop project) keeps its scroll position.
    const prev = this.modalRoot.querySelector<HTMLElement>('.modal');
    const sameDialog = prev?.getAttribute('aria-label') === opts.label;
    const keepScroll = sameDialog ? { box: prev!.scrollTop, root: this.modalRoot.scrollTop } : null;
    clear(this.modalRoot);
    const box = h(
      'div',
      { class: `modal ${opts.wide ? 'wide' : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': opts.label },
      opts.onClose ? h('button', { class: 'btn small icon-only close-x', 'aria-label': 'Close', onclick: opts.onClose }, 'X') : null,
      content,
    );
    this.modalRoot.append(box);
    if (keepScroll) {
      box.scrollTop = keepScroll.box;
      this.modalRoot.scrollTop = keepScroll.root;
      return box;
    }
    const focusable = box.querySelector<HTMLElement>('[data-autofocus]') ?? box.querySelector<HTMLElement>('button.primary, button.go, button');
    focusable?.focus();
    return box;
  }

  private closeModal() {
    clear(this.modalRoot);
  }

  private closeModalAndPlan() {
    this.closeModal();
    if (this.phase === 'plan') this.renderPlan();
    else if (this.phase === 'briefing') this.showBriefing();
  }

  private save() {
    if (this.mode !== 'campaign' || !this.campaign) return;
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({ campaign: serialize(this.campaign), mission: this.mission?.status === 'playing' ? this.mission : null }));
    } catch {
      /* storage full or blocked: the game still works, it just can't resume later */
    }
  }

  private clearSave() {
    try {
      localStorage.removeItem(SAVE_KEY);
    } catch {
      /* ignore */
    }
  }

  private dataBadge(): HTMLElement {
    if (this.mode === 'daily' && this.daily) return dailyBadge(this.daily.config, () => this.showScienceLog());
    const f = this.feed;
    let text: string;
    let cls: string = f.status;
    if (this.mode === 'history') {
      text = 'ARCHIVE · real DONKI data from May 2024';
      cls = 'archive';
    } else if (f.status === 'live') {
      const t = new Date(f.fetchedAt ?? Date.now()).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
      text = `LIVE from NASA DONKI · fetched ${t}`;
    } else if (f.status === 'archive' && f.snapshot) {
      text = `ARCHIVE · real DONKI data, ${shortRange(f.snapshot.startDate, f.snapshot.endDate)}`;
    } else if (f.status === 'none' && f.error) {
      text = 'NO SPACE-WEATHER DATA · offline';
    } else {
      text = 'Checking NASA DONKI...';
    }
    return h('button', { class: `data-badge ${cls}`, title: 'Where the space-weather data comes from', onclick: () => this.showScienceLog() }, h('span', { class: 'dot' }), text);
  }

  private hudButtons(): HTMLElement[] {
    return [
      this.dataBadge(),
      h(
        'button',
        {
          class: 'btn small icon-only',
          'aria-label': this.settings.muted ? 'Sound is off. Turn sound on' : 'Sound is on. Turn sound off',
          'aria-pressed': String(!this.settings.muted),
          onclick: () => this.toggleMute(),
        },
        icon(this.settings.muted ? 'mute' : 'sound', 24),
      ),
      h('button', { class: 'btn small', onclick: () => this.showMenu(), 'aria-label': 'Menu' }, 'Menu'),
    ];
  }

  private toggleMute() {
    this.settings.muted = !this.settings.muted;
    saveSettings(this.settings);
    this.audio.setMuted(this.settings.muted);
    this.refreshHud();
  }

  /** Words for the current base: Mars or the Moon. */
  private st() {
    return siteText(this.mission?.config ?? this.campaign ?? this.site);
  }

  private hudLabel(m: MissionState) {
    if (this.mode === 'daily' && this.daily) return dailyHudLabel(this.daily.config);
    return this.mode === 'history' ? 'MAY 2024' : this.mode === 'campaign' ? `CREW ${m.config.expedition} OF ${EXPEDITIONS.length}` : 'QUICK MISSION';
  }

  private refreshHud(next?: Snapshot) {
    const m = this.mission;
    if (!m) {
      clear(this.hud);
      this.hud.append(h('div', { class: 'hud-right' }, ...this.hudButtons()));
      return;
    }
    const b = getBriefing(m);
    const used = Object.values(this.alloc).reduce((a, c) => a + c, 0);
    renderHud(
      this.hud,
      {
        sol: Math.min(m.sol, windowSol(m)),
        windowSol: windowSol(m),
        cellsTotal: b.cells,
        cellsLeft: this.phase === 'plan' ? b.cells - used : this.phase === 'running' ? 0 : b.cells,
        now: { air: m.air / m.crew, food: m.food / m.crew, dose: m.dose, fuel: m.fuel },
        next,
        doseBudget: m.doseBudget,
        crew: m.crew,
        label: this.hudLabel(m),
        site: siteOf(m.config),
      },
      this.hudButtons(),
    );
  }

  private onKey(e: KeyboardEvent) {
    if (e.key === 'Escape' && this.modalRoot.firstChild && this.phase === 'plan') this.closeModalAndPlan();
    if (this.phase === 'running' && (e.key === 'f' || e.key === 'F')) this.ff = true;
  }

  private coachPhase(): CoachPhase {
    return this.phase === 'briefing' || this.phase === 'plan' || this.phase === 'running' || this.phase === 'debrief' ? this.phase : 'other';
  }

  private coachUpdate() {
    if (!this.coach.active) return;
    const heaterNeed = this.mission ? getBriefing(this.mission).heaterNeed : 1;
    this.coach.update({ phase: this.coachPhase(), alloc: this.alloc, heaterNeed, site: siteOf(this.mission?.config) });
  }

  private startTutorial() {
    const heaterNeed = this.mission ? getBriefing(this.mission).heaterNeed : 1;
    this.coach.start({ phase: this.coachPhase(), alloc: this.alloc, heaterNeed, site: siteOf(this.mission?.config) });
  }

  private stageScene() {
    const m = this.mission;
    if (!m) return;
    const b = getBriefing(m);
    const p = m.base.project;
    const cost = p ? nextCost(p, m.base.levels) : null;
    this.stage.setScene({
      sol: m.sol,
      weather: b.weather,
      alloc: this.alloc,
      fuel: m.fuel,
      sheltered: this.alloc.shelter > 0,
      levels: m.base.levels,
      crew: m.crew,
      project: p,
      projectProgress: p && cost ? Math.min(1, (m.base.progress[p] + (this.phase === 'plan' ? this.alloc.build : 0)) / cost) : undefined,
      site: siteOf(m.config),
      landing: landingOf(m.config),
    });
  }

  // ------------------------------------------------------------------ title
  showTitle() {
    if (this.coach.active) this.coach.stop(false);
    this.phase = 'title';
    this.mission = null;
    this.mode = null;
    clear(this.dock);
    this.refreshHud();
    this.audio.playMusic('title');
    this.stage.setScene({ sol: 0, weather: 'clear', alloc: emptyAlloc(), fuel: 0, sheltered: false, levels: emptyLevels(), crew: 4 });
    const lt = this.light;
    const counts = this.feed.snapshot ? countByClass(this.feed.snapshot) : null;
    const saved = readSave();
    const canContinue = saved && !campaignDone(saved.campaign);
    this.modal(
      h(
        'div',
        { class: 'title-screen' },
        h('div', { class: 'art' }, h('img', { src: '/art/title.png', alt: 'A tiny outpost on Mars with a rocket on its launch pad (AI-generated art)' })),
        h('h1', null, 'Escape Velocity'),
        h('p', { class: 'tagline' }, 'Build a base on Mars, crew after crew. Make air to breathe and oxygen for the rocket home, and leave the base better for the next crew.'),
        this.codes.titleNote(),
        h(
          'div',
          { class: 'menu' },
          canContinue
            ? h(
                'button',
                { class: 'btn primary', 'data-autofocus': true, onclick: () => this.continueCampaign(saved) },
                `Continue: crew ${saved.campaign.expedition} of ${EXPEDITIONS.length}${saved.mission ? `, ${siteText(saved.campaign).turn} ${saved.mission.sol}` : ''}${saved.campaign.site === 'moon' ? ' (Moon)' : ''}`,
                h('span', { class: 'arrow' }),
              )
            : null,
          h(
            'button',
            { class: `btn ${canContinue ? '' : 'primary'}`, 'data-autofocus': canContinue ? undefined : true, onclick: () => this.chooseDifficulty() },
            'New campaign: 3 crews',
            h('span', { class: 'arrow' }),
          ),
          h('div', { class: 'title-foot', style: 'margin:-4px 0 4px' }, 'About 35 minutes. Saves after every sol, so a class can stop and pick up later.'),
          h(
            'div',
            { class: 'menu-row' },
            h('button', { class: 'btn', onclick: () => this.startQuick() }, 'Quick mission'),
            h('button', { class: 'btn cyan', onclick: () => this.startHistory(), disabled: MAY2024_SNAPSHOT ? undefined : true }, 'May 2024 storms'),
          ),
          h(
            'div',
            { class: 'menu-row' },
            h('button', { class: 'btn go', onclick: () => void this.startDaily() }, 'Daily challenge'),
            h('button', { class: 'btn', onclick: () => this.showTodaysBest(() => this.showTitle()) }, "Today's best"),
          ),
          h('button', { class: 'btn', onclick: () => this.openRoom() }, 'Class mission: Mission Control'),
          h(
            'div',
            { class: 'menu-row' },
            h('button', { class: 'btn small', onclick: () => this.showHowTo(() => this.showTitle()) }, 'How to play'),
            h('button', { class: 'btn small', onclick: () => this.showScienceLog() }, 'Science Log'),
          ),
          h(
            'div',
            { class: 'menu-row' },
            h('a', { class: 'btn small', href: '/teacher/', target: '_blank', rel: 'noopener' }, 'For teachers'),
            h('button', { class: 'btn small', onclick: () => this.showCredits() }, 'Credits and AI use'),
          ),
        ),
        sunPanel(this.feed),
        h(
          'p',
          { class: 'title-foot' },
          `Today Mars is about ${Math.round(lt.distanceKm / 1e6)} million km from Earth, so messages take about ${Math.round(lt.oneWayMinutes)} minutes to arrive (approximate). `,
          counts ? `${this.feed.status === 'live' ? 'Live' : 'Archived'} NASA data: ${counts.X} X-class and ${counts.M} M-class solar flares in the last 30 days.` : '',
        ),
        h(
          'p',
          { class: 'ai-disclosure' },
          'AI disclosure: the illustrations, crew portraits and music in this game are AI-generated (Higgsfield), and the code was written with AI assistance (Claude Code). The picture of the Sun is real NASA imagery, and all data comes from NASA. ',
          h('button', { class: 'linklike', onclick: () => this.showCredits() }, 'Details'),
        ),
      ),
      { label: 'Escape Velocity title screen' },
    );
  }

  /** Mission Control (class team play) borrows the stage, HUD, dock and dialogs, and hands them back on exit. */
  private openRoom(code: string | null = null) {
    if (this.coach.active) this.coach.stop(false);
    this.audio.sfx('click');
    this.phase = 'room';
    this.mission = null;
    this.mode = null;
    this.closeModal();
    clear(this.dock);
    import('./room/mission-control')
      .then(({ openMissionControl }) =>
        openMissionControl(
          { stage: this.stage, hud: this.hud, dock: this.dock, modalRoot: this.modalRoot, audio: this.audio, reducedMotion: this.settings.reducedMotion, exit: () => this.showTitle() },
          code,
        ),
      )
      .catch(() => this.showTitle());
  }

  /** The teacher dashboard is its own page; the game stays hidden. */
  private openDashboard(link: DashboardLink) {
    this.phase = 'dashboard';
    import('./dashboard/page').then(({ openDashboard }) => openDashboard(link)).catch(() => this.showTitle());
  }

  /** Pick Mars or the Moon, then a difficulty (campaign) or just go (quick mission). */
  private chooseDifficulty(kind: 'campaign' | 'quick' = 'campaign') {
    this.audio.sfx('click');
    const moon = this.site === 'moon';
    const sitePicker = h(
      'div',
      { class: 'crates site-pick', role: 'group', 'aria-label': 'Where to build' },
      SITE_CHOICES.map((c) =>
        h(
          'button',
          { class: 'crate', 'aria-pressed': String(this.site === c.site), onclick: () => ((this.site = c.site), this.chooseDifficulty(kind)) },
          h('b', null, c.name),
          h('span', null, c.blurb),
        ),
      ),
    );
    this.modal(
      [
        h('div', { class: 'kicker' }, kind === 'quick' ? 'Quick mission' : 'New campaign'),
        h('h2', null, 'Where will you build?'),
        sitePicker,
        moon ? null : landingPicker(this.landingSite, (l) => ((this.landingSite = l), this.chooseDifficulty(kind))),
        kind === 'quick'
          ? [
              h('p', null, `One crew of 4 on Cadet difficulty, about 10 minutes, on ${moon ? 'the Moon' : this.landingSite === 'arcadia' ? 'Mars, at Arcadia Planitia' : 'Mars'}.`),
              h(
                'div',
                { class: 'actions end' },
                h('button', { class: 'btn small', onclick: () => this.showTitle() }, 'Back'),
                h('button', { class: 'btn primary', 'data-autofocus': true, onclick: () => this.launchQuick() }, 'Start quick mission', h('span', { class: 'arrow' })),
              ),
            ]
          : [
              h('h3', null, 'Choose your difficulty'),
              h(
                'div',
                { class: 'crates' },
                h(
                  'button',
                  { class: 'crate', 'data-autofocus': true, onclick: () => this.startCampaign('cadet') },
                  h('b', null, 'Cadet'),
                  h('span', null, moon ? MOON_DIFFICULTY.cadet : 'Recommended for a first game and for classes. More time, fewer storms.'),
                ),
                h(
                  'button',
                  { class: 'crate', onclick: () => this.startCampaign('commander') },
                  h('b', null, 'Commander'),
                  h('span', null, moon ? MOON_DIFFICULTY.commander : 'Less time, more and bigger storms, and the Sun blocks your messages for a few sols.'),
                ),
              ),
              this.codes.panel({ hint: 'Now pick the same difficulty as your class.', sfx: (n) => this.audio.sfx(n) }),
              readSave() ? h('p', { class: 'title-foot' }, 'Starting a new campaign replaces your saved one.') : null,
              h('div', { class: 'actions end' }, h('button', { class: 'btn small', onclick: () => this.showTitle() }, 'Back')),
            ],
      ],
      { label: kind === 'quick' ? 'Choose quick mission' : 'Choose difficulty' },
    );
  }

  showHowTo(back: () => void) {
    this.modal(
      [
        h('div', { class: 'kicker' }, 'How to play'),
        h('h2', null, `One turn = ${this.st().turnIs}`),
        h(
          'ol',
          { class: 'clean' },
          h('li', null, h('b', null, 'Read the morning briefing. '), `Weather, power, and messages from Earth (${this.st().site === 'moon' ? 'they take about 1.3 seconds' : 'they arrive late'}).`),
          h('li', null, h('b', null, 'Place your power cells. '), 'Drag them onto modules, or tap a slot. Every cell must go somewhere, and every choice costs something.'),
          h('li', null, h('b', null, `Watch the ${this.st().turn} play out, `), 'then read the debrief to see what your choices caused.'),
          h(
            'li',
            null,
            h('b', null, 'Build the base. '),
            'Cells in the Workshop build upgrades: solar panels, a radiation monitor, batteries, even a nuclear reactor. They stay for every crew after you.',
          ),
        ),
        h(
          'div',
          { class: 'card' },
          h('b', null, 'The big trade-off: '),
          'your O2 plant makes the air your crew breathes AND the oxygen your rocket needs to fly home. Every cell you spend on heat, food, shelter or building is a cell that is not filling the fuel tank today.',
        ),
        h(
          'div',
          { class: 'card' },
          h('b', null, 'A campaign has 3 crews. '),
          `Each crew must fill the rocket and fly home before the launch window closes. Then${this.st().site === 'moon' ? '' : ', 26 months later,'} a bigger crew arrives at the base you left them. Earn up to 3 stars per crew: `,
          (Object.keys(STAR_INFO) as StarId[]).map((s, i) => [i ? '; ' : '', h('b', null, STAR_INFO[s].name), ` (${STAR_INFO[s].how.replace(/\.$/, '').toLowerCase()})`]),
          '.',
        ),
        h('div', { class: 'actions end' }, h('button', { class: 'btn primary', onclick: back }, 'Got it')),
      ],
      { label: 'How to play' },
    );
  }

  showScienceLog() {
    this.modal(renderScienceLog({ feed: this.feed, light: this.light, difficulty: this.mission?.config.difficulty ?? 'cadet' }), {
      wide: true,
      label: 'Science Log',
      onClose: () => this.resume(),
    });
  }

  showCredits() {
    this.modal(renderCredits(), { wide: true, label: 'Credits', onClose: () => this.resume() });
  }

  showMenu() {
    if (this.phase === 'title') return;
    const s = this.settings;
    this.modal(
      [
        h('div', { class: 'kicker' }, 'Paused'),
        h('h2', null, 'Mission menu'),
        h(
          'div',
          { class: 'toggle-row' },
          h('button', { class: 'btn small', 'aria-pressed': String(!s.muted), onclick: () => (this.toggleMute(), this.showMenu()) }, s.muted ? 'Sound: off' : 'Sound: on'),
          h(
            'button',
            {
              class: 'btn small',
              'aria-pressed': String(s.reducedMotion),
              onclick: () => {
                s.reducedMotion = !s.reducedMotion;
                saveSettings(s);
                this.applyMotion();
                this.showMenu();
              },
            },
            s.reducedMotion ? 'Reduced motion: on' : 'Reduced motion: off',
          ),
          h(
            'button',
            {
              class: 'btn small',
              'aria-pressed': String(s.view3d),
              title: 'Turn off on slow computers. The page reloads; your campaign is saved.',
              onclick: () => {
                s.view3d = !s.view3d;
                saveSettings(s);
                this.save();
                location.reload();
              },
            },
            s.view3d ? '3D view: on' : '3D view: off',
          ),
        ),
        h(
          'div',
          { class: 'actions' },
          h('button', { class: 'btn primary', onclick: () => this.resume() }, 'Resume'),
          this.mission ? h('button', { class: 'btn', onclick: () => this.showWorkshop(() => this.resume()) }, 'Workshop') : null,
          this.mission
            ? h(
                'button',
                {
                  class: 'btn',
                  onclick: () => {
                    this.resume();
                    this.startTutorial();
                  },
                },
                'Replay tutorial',
              )
            : null,
          h('button', { class: 'btn', onclick: () => this.showHowTo(() => this.resume()) }, 'How to play'),
          h('button', { class: 'btn', onclick: () => this.showScienceLog() }, 'Science Log'),
          h('button', { class: 'btn', onclick: () => this.showCredits() }, 'Credits'),
          h('button', { class: 'btn', onclick: () => this.showTitle() }, this.mode === 'campaign' ? 'Save and quit' : 'Quit to title'),
        ),
        this.mode !== 'history' ? classCodeLine(this.campaign?.classCode) : null,
        this.mission
          ? h(
              'p',
              { class: 'title-foot' },
              `Seed ${this.mission.config.seed} · ${this.mission.config.difficulty}${siteOf(this.mission.config) === 'moon' ? ' · Moon' : ''}${this.mode === 'campaign' ? ` · your campaign saves after every ${this.st().turn}` : ''}`,
            )
          : null,
      ],
      { label: 'Menu', onClose: () => this.resume() },
    );
  }

  private resume() {
    this.closeModal();
    switch (this.phase) {
      case 'title':
        return this.showTitle();
      case 'intro':
        return this.showExpeditionIntro();
      case 'briefing':
        return this.showBriefing();
      case 'plan':
        return this.renderPlan();
      case 'debrief':
        return this.lastReport ? this.showDebrief(this.lastReport) : undefined;
      case 'end':
        return void this.showEnd(false);
      case 'interlude':
        return this.showInterlude();
      case 'finale':
        return this.showFinale();
      default:
        return undefined;
    }
  }

  // ------------------------------------------------------------------ starting
  private seed() {
    return new URLSearchParams(location.search).get('seed') ?? Math.random().toString(36).slice(2, 8);
  }

  private async pool(): Promise<SpaceWeatherEvent[]> {
    await Promise.race([this.feedReady, new Promise((r) => setTimeout(r, 2500))]);
    return buildEventPool(this.feed);
  }

  private startCampaign(difficulty: Difficulty) {
    this.audio.sfx('click');
    this.clearSave();
    this.mode = 'campaign';
    this.campaign = { ...campaignWithCode(this.codes.active, this.seed(), difficulty), ...this.place() };
    this.showExpeditionIntro();
  }

  private continueCampaign(saved: SaveGame) {
    this.audio.sfx('click');
    this.mode = 'campaign';
    this.campaign = saved.campaign;
    this.campaignAtStart = saved.campaign;
    this.site = siteOf(saved.campaign);
    this.landingSite = landingOf(saved.campaign);
    if (saved.mission && saved.mission.status === 'playing') {
      this.mission = saved.mission;
      this.audio.playMusic('mission');
      this.showBriefing();
    } else {
      this.showExpeditionIntro();
    }
  }

  /** Quick mission: first pick Mars or the Moon. */
  private startQuick() {
    this.chooseDifficulty('quick');
  }

  private launchQuick() {
    this.audio.sfx('click');
    this.mode = 'quick';
    this.campaign = { ...campaignWithCode(this.codes.active, this.seed(), 'cadet'), ...this.place() };
    this.showExpeditionIntro();
  }

  /** Daily challenge: today's config from our server (or the bundled snapshot), then the usual crew intro. */
  private async startDaily() {
    this.audio.sfx('click');
    this.modal([h('div', { class: 'kicker' }, 'Daily challenge'), h('p', null, "Getting today's challenge...")], { label: 'Daily challenge' });
    const from = this.phase;
    const session = await loadDaily();
    if (this.phase !== from) return; // the player went somewhere else while we waited
    this.mode = 'daily';
    this.daily = session;
    this.campaign = newCampaign(session.config.seed, 'cadet', session.config.site);
    this.showExpeditionIntro();
  }

  private showTodaysBest(back: () => void) {
    this.audio.sfx('click');
    this.modal(todaysBest({ back, play: () => void this.startDaily() }), { label: "Today's best", onClose: back });
  }

  private startHistory() {
    this.audio.sfx('click');
    this.mode = 'history';
    this.campaign = newCampaign(this.seed(), 'cadet', 'mars');
    const config: MissionConfig = { ...missionConfigFor(this.campaign, this.light.oneWayMinutes, may2024Pool()), scenario: 'may2024' };
    this.campaignAtStart = this.campaign;
    this.mission = createMission(config);
    this.audio.playMusic('mission');
    this.showBriefing();
  }

  private showExpeditionIntro() {
    const c = this.campaign!;
    this.phase = 'intro';
    this.mission = null;
    clear(this.dock);
    this.refreshHud();
    this.audio.playMusic('mission');
    this.stage.setScene({ sol: 0, weather: 'clear', alloc: emptyAlloc(), fuel: c.prefillPct, sheltered: false, levels: c.base.levels, crew: 0, site: siteOf(c), landing: landingOf(c) });
    const spec = expeditionSpec(c);
    const built = UPGRADE_IDS.filter((id) => c.base.levels[id] > 0);
    const isCampaign = this.mode === 'campaign';
    const windowSols = spec.windowSol + tuningFor(c.difficulty, c.site).windowBonus;
    const t = siteText(c);
    this.modal(
      [
        h('div', { class: 'kicker' }, isCampaign ? `Crew ${c.expedition} of ${EXPEDITIONS.length}` : this.mode === 'daily' && this.daily ? dailyKicker(this.daily.config) : 'Quick mission'),
        h('h2', null, spec.name),
        t.site === 'mars'
          ? h('div', { class: 'art' }, h('img', { src: c.expedition === 1 ? '/art/title.png' : '/art/event-resupply.png', alt: 'The Mars outpost (AI-generated art)' }))
          : null,
        h('p', null, spec.blurb),
        landingCard(c),
        meetCrew(c.expedition),
        h(
          'div',
          { class: 'card' },
          h('b', null, `Crew: ${spec.crew} astronauts. `),
          `Each one breathes about ${REAL.o2PerCrewKgPerDay.toFixed(1)} kg of oxygen a day. `,
          h('b', null, 'Goal: '),
          `fill the rocket and launch home by ${t.turn} ${windowSols}, when the launch window closes.`,
        ),
        t.site === 'moon'
          ? h(
              'div',
              { class: 'card' },
              icon('sun', 20),
              ' ',
              h('b', null, 'One turn is one Earth day. '),
              "Partway through your mission the Sun sets, and the lunar night begins: no solar power, and colder than ever. The briefing tells you days ahead, so you can stock up. The Moon also gets about twice Mars' daily radiation, but Earth's storm warnings arrive in about 1.3 seconds.",
            )
          : null,
        c.prefillPct
          ? h(
              'div',
              { class: 'card good' },
              icon('o2', 20),
              ' ',
              h('b', null, `Your tank is already ${c.prefillPct}% full. `),
              t.site === 'moon'
                ? 'While the base was empty, the robot O2 plant kept baking oxygen out of Moon soil and pre-filled the rocket.'
                : 'While the base was empty, the O2 plant kept running on solar power and pre-filled the rocket. Real Mars plans work this way: the propellant plant runs for over a year before astronauts arrive.',
            )
          : null,
        h(
          'div',
          { class: 'card' },
          h('b', null, 'Your base: '),
          built.length
            ? [built.map((id, i) => [i ? ', ' : '', `${UPGRADES[id].name}${maxLevel(id) > 1 ? ` x${c.base.levels[id]}` : ''}`]), ', plus the basics.']
            : 'just the basics: a habitat, an O2 plant, a greenhouse, heaters, a storm shelter and a solar array.',
        ),
        isCampaign || this.mode === 'daily'
          ? h(
              'div',
              { class: 'card' },
              h('b', null, 'Earn stars: '),
              (Object.keys(STAR_INFO) as StarId[]).map((s) => h('div', null, icon('sun', 14), ' ', h('b', null, STAR_INFO[s].name), `: ${STAR_INFO[s].how}`)),
            )
          : null,
        this.mode === 'quick'
          ? this.codes.panel({
              sfx: (n) => this.audio.sfx(n),
              onChange: (code) => (this.campaign = { ...campaignWithCode(code, this.seed(), 'cadet'), ...this.place() }),
            })
          : null,
        this.mode === 'daily' && this.daily ? dailyIntroCard(this.daily, () => this.showTodaysBest(() => this.showExpeditionIntro())) : null,
        h('div', { class: 'actions end' }, h('button', { class: 'btn primary', 'data-autofocus': true, onclick: () => this.landCrew() }, 'Land the crew', h('span', { class: 'arrow' }))),
      ],
      { label: `${spec.name} introduction` },
    );
  }

  private landing = false;

  private async landCrew() {
    if (this.landing) return;
    this.landing = true;
    const c = this.campaign!;
    this.audio.sfx('click');
    this.modalRoot.querySelectorAll('button').forEach((b) => b.setAttribute('disabled', ''));
    const pool = await this.pool().finally(() => (this.landing = false));
    this.campaignAtStart = c;
    this.mission = createMission(this.mode === 'daily' && this.daily ? dailyMissionConfig(this.daily.config) : missionConfigFor(c, this.light.oneWayMinutes, pool));
    this.save();
    this.showBriefing();
    // First time playing: a one-minute guided first sol.
    if (!Coach.seen() && c.expedition === 1 && (this.mode === 'campaign' || this.mode === 'quick' || this.mode === 'daily')) this.startTutorial();
  }

  // ------------------------------------------------------------------ one sol
  private showBriefing() {
    const m = this.mission!;
    this.phase = 'briefing';
    this.alloc = emptyAlloc();
    this.advice = [];
    this.crate = undefined;
    const b = getBriefing(m);
    const t = siteText(m.config);
    this.stageScene();
    this.stage.setTimeOfDay(t.site === 'moon' ? moonSky(m, m.sol, 0) : 0.02);
    clear(this.dock);
    this.refreshHud();
    if (b.warning) this.audio.sfx('alarm');

    const art = briefingArt(b, t.site);
    const cards: HTMLElement[] = [];
    cards.push(
      h(
        'div',
        { class: `card ${b.weather !== 'clear' ? 'event' : ''}` },
        icon(b.night ? 'heater' : b.weather === 'clear' ? 'sun' : 'dust', 20),
        ' ',
        h('b', null, weatherLine(b, t.site)),
        ' You have ',
        h('b', null, `${b.cells} power cells`),
        ' today.',
        b.powerNotes.length ? h('div', { class: 'title-foot', style: 'margin-top:4px' }, b.powerNotes.join(' · ')) : null,
      ),
    );
    if (this.mode === 'history') {
      const day = new Date(MAY2024_START + (m.sol - 1) * 86_400_000).toISOString().slice(0, 10);
      for (const g of earthStormsOn(day)) {
        cards.push(
          h(
            'div',
            { class: 'card' },
            h('span', { class: 'tag archive' }, 'ARCHIVE'),
            h('span', { class: 'tag real' }, 'REAL EVENT'),
            h('b', null, ` News from Earth, ${eventDate({ time: g.startTime ?? day } as SpaceWeatherEvent)}: `),
            g.maxKp && g.maxKp >= 9
              ? `a geomagnetic storm reached Kp ${g.maxKp}, the top of the scale, and people saw auroras far from the poles. Mars has no global magnetic field, so it gets no storm like this one.`
              : `a geomagnetic storm reached Kp ${g.maxKp ?? '?'} at Earth.`,
            h('div', { class: 'title-foot' }, 'Source: NASA DONKI geomagnetic storm record. ', g.link ? h('a', { href: g.link, target: '_blank', rel: 'noopener' }, 'See the record') : null),
          ),
        );
      }
    }
    if (b.coldSnap) cards.push(h('div', { class: 'card event' }, icon('heater', 20), ' ', h('b', null, 'Extra-cold night ahead. '), `The heaters need ${b.heaterNeed} cells tonight.`));
    if (t.site === 'moon') cards.push(...nightCards(m, b));
    if (b.dustTomorrow)
      cards.push(
        h(
          'div',
          { class: 'card event' },
          icon('dust', 20),
          ' ',
          h('b', null, 'Orbiters spot a dust storm coming. '),
          b.hasBattery ? 'Tomorrow you will have less solar power. Store cells in the battery today?' : 'Tomorrow you will have less solar power. Stock up on air and food today.',
        ),
      );

    const delay = `Messages from Earth take ${t.delay(m.config.lightTimeMin)} to reach you (approximate).${t.site === 'moon' ? ' Storm warnings always arrive in time.' : ''}`;
    if (b.outlook === 'none') {
      cards.push(
        h(
          'div',
          { class: 'card danger' },
          icon('antenna', 20),
          ' ',
          h('b', null, 'No messages from Earth. '),
          'The Sun is between Earth and Mars (solar conjunction), so radio signals cannot get through. Only your own radiation monitor can warn you now.',
        ),
      );
    } else {
      const region = upcomingRegion(m);
      cards.push(
        h(
          'div',
          { class: 'card' },
          icon('antenna', 20),
          ' ',
          h('b', null, 'Space weather from Earth: '),
          b.outlook === 'active'
            ? `forecasters say the Sun is active${region ? ` (sunspot region ${region} is busy)` : ''}. A solar storm could come in the next few ${t.turns}.${b.hasMonitor ? ' Power your monitor tonight?' : ''}`
            : 'forecasters say the Sun looks quiet for now.',
          h('div', { class: 'title-foot', style: 'margin-top:4px' }, delay),
          this.mode === 'history' ? null : sunPanel(this.feed, { compact: true }),
        ),
      );
    }
    if (b.warning) {
      const w = b.warning;
      cards.push(
        h(
          'div',
          { class: 'card danger' },
          icon('radiation', 20),
          ' ',
          h('b', null, w.source === 'monitor' ? 'YOUR MONITOR: particle levels are climbing! ' : `MESSAGE FROM EARTH (sent ${t.site === 'moon' ? `${REAL.moonLightSec} seconds` : `${Math.round(m.config.lightTimeMin)} min`} ago): `),
          'a radiation storm will hit the outpost today. Power the storm shelter to protect your crew.',
          eventCard(w.event),
        ),
      );
    }
    if (b.monitorOnline && !b.warning) cards.push(h('div', { class: 'card good' }, icon('monitor', 20), ' ', h('b', null, 'Your monitor: '), 'no storm particles on the way today.'));

    let crateRow: HTMLElement | null = null;
    if (b.resupply) {
      const crates: Array<[CrateId, string, string]> = [
        ['food', 'Food crates', '+3 days of food for the crew'],
        ['parts', 'Spare parts', 'Repair 1 damaged battery and reset wear'],
        ['panel', 'Solar panel', t.site === 'moon' ? '+1 power cell every day while the Sun is up, for this crew' : '+1 power cell every sol, for this crew'],
      ];
      crateRow = h(
        'div',
        { class: 'card event' },
        icon('crate', 20),
        ' ',
        h('b', null, 'Cargo lander arriving! '),
        'It only has room for one crate. Choose:',
        h(
          'div',
          { class: 'crates', role: 'group', 'aria-label': 'Choose one crate' },
          crates.map(([id, name, desc]) =>
            h(
              'button',
              {
                class: 'crate',
                'aria-pressed': String(this.crate === id),
                onclick: () => {
                  this.crate = id;
                  this.audio.sfx('click');
                  this.renderBriefing(art, cards, crateRow);
                },
              },
              h('b', null, name),
              h('span', null, desc),
            ),
          ),
        ),
      );
    }
    this.renderBriefing(art, cards, crateRow);
  }

  private renderBriefing(art: string | null, cards: HTMLElement[], crateRow: HTMLElement | null) {
    const m = this.mission!;
    const b = getBriefing(m);
    const t = siteText(m.config);
    crateRow?.querySelectorAll<HTMLButtonElement>('.crate').forEach((btn, i) => {
      btn.setAttribute('aria-pressed', String((['food', 'parts', 'panel'] as const)[i] === this.crate));
    });
    const needCrate = b.resupply && !this.crate;
    const p = m.base.project;
    this.modal(
      [
        h('div', { class: 'kicker' }, `${this.hudLabel(m)} · ${t.Turn} ${m.sol} of ${windowSol(m)} · Morning briefing`),
        todayBanner(m, b),
        art ? h('div', { class: 'art' }, h('img', { src: `/art/${art}.png`, alt: "Illustration of today's conditions (AI-generated)" })) : null,
        ...cards,
        crateRow,
        h(
          'div',
          { class: 'card' },
          icon('crate', 20),
          ' ',
          h('b', null, 'Workshop: '),
          p ? `building ${UPGRADES[p].name} (${m.base.progress[p]} of ${nextCost(p, m.base.levels)} cells). ` : 'everything is built! ',
          h('button', { class: 'btn small', onclick: () => this.showWorkshop(() => this.showBriefing()) }, 'Change'),
        ),
        h(
          'div',
          { class: 'actions end' },
          h(
            'button',
            { class: 'btn primary', 'data-autofocus': true, disabled: needCrate ? true : undefined, onclick: () => this.plan() },
            needCrate ? 'Choose a crate first' : 'Plan the day',
            h('span', { class: 'arrow' }),
          ),
        ),
      ],
      { label: `${t.Turn} ${m.sol} morning briefing` },
    );
    this.coachUpdate();
  }

  private showWorkshop(back: () => void) {
    const m = this.mission;
    const base = m?.base ?? this.campaign?.base;
    if (!base) return;
    const choose = (id: UpgradeId) => {
      if (!this.mission) return;
      this.audio.sfx('click');
      this.mission = setProject(this.mission, id);
      this.alloc = { ...this.alloc, build: 0 };
      this.save();
      this.showWorkshop(back);
    };
    this.modal(
      [
        h('div', { class: 'kicker' }, 'Workshop'),
        h('h2', null, 'Build the base'),
        h(
          'p',
          null,
          'Put power cells into the Workshop to build upgrades. A cell spent building is a cell not making air, food or fuel today, but upgrades last for every crew after you. You can switch projects any time; progress is kept.',
        ),
        this.st().site === 'moon'
          ? h('p', { class: 'title-foot' }, "No radiation monitor on the Moon: Earth's storm warnings arrive in about 1.3 seconds, so they are never late.")
          : null,
        h(
          'div',
          { class: 'upgrade-list' },
          upgradesFor(this.st().site).map((id) => {
            const u = upgradeDef(id, this.st().site);
            const lvl = base.levels[id];
            const cost = nextCost(id, base.levels);
            const active = base.project === id;
            return h(
              'div',
              { class: `card upgrade ${active ? 'event' : ''} ${cost === null ? 'good' : ''}` },
              h(
                'div',
                { class: 'upgrade-head' },
                h('b', { class: 'px' }, u.name.toUpperCase()),
                maxLevel(id) > 1 ? h('span', { class: 'title-foot' }, `built ${lvl} of ${maxLevel(id)}`) : lvl ? h('span', { class: 'tag live' }, 'BUILT') : null,
                cost !== null ? h('span', { class: 'cost' }, icon('cell', 16), ` ${base.progress[id]}/${cost} cells`) : null,
              ),
              h('div', null, u.effect),
              u.catch ? h('div', { class: 'tone-warn', style: 'font-size:15px' }, 'The catch: ', u.catch) : null,
              h('div', { class: 'title-foot' }, h('span', { class: 'tag real' }, 'REAL SCIENCE'), u.science),
              cost !== null && m
                ? h('button', { class: `btn small ${active ? 'go' : ''}`, disabled: active ? true : undefined, onclick: () => choose(id) }, active ? 'Working on it' : 'Work on this')
                : null,
            );
          }),
        ),
        h('div', { class: 'actions end' }, h('button', { class: 'btn primary', 'data-autofocus': true, onclick: back }, 'Done')),
      ],
      { wide: true, label: 'Workshop', onClose: back },
    );
  }

  private plan() {
    this.audio.sfx('click');
    this.closeModal();
    this.phase = 'plan';
    this.renderPlan();
  }

  private renderPlan() {
    const m = this.mission!;
    const b = getBriefing(m);
    const check = checkAlloc(m, this.alloc);
    const preview = previewSol(m, this.alloc, this.crate);
    this.refreshHud(preview.after);
    this.stageScene();
    const mini = briefMini(m, b, check.remaining);
    const side = [mini[0], ...planWarnings(m, b, this.alloc, preview.after), ...adviceLines(this.advice), ...mini.slice(1)];
    this.budget.set(m, b, this.alloc, preview, side);
    this.coachUpdate();
  }

  private async run() {
    const m = this.mission!;
    const check = checkAlloc(m, this.alloc);
    if (!check.ok) {
      this.audio.sfx('deny');
      return;
    }
    this.audio.sfx('run');
    this.phase = 'running';
    this.coachUpdate();
    const { next, report } = runSol(m, this.alloc, this.crate);
    this.lastReport = report;

    clear(this.dock);
    const clock = h('div', { class: 'clock' }, '06:00');
    const fill = h('div', { class: 'fill', style: 'width:0%' });
    const site = siteOf(m.config);
    const beats = runBeats(report, site);
    const logLine = h('div', { class: 'run-log', 'aria-live': 'polite' }, site === 'moon' ? beats[0].text : 'Sunrise at the outpost.');
    const ffBtn = h('button', { class: 'btn small', onclick: () => (this.ff = true) }, 'Skip', h('span', { class: 'arrow' }));
    this.dock.append(h('div', { class: 'run-bar' }, clock, h('div', { class: 'bar' }, fill), ffBtn), logLine);
    this.ff = false;
    const duration = this.settings.reducedMotion ? 2000 : 9000;
    const start = performance.now();
    // Mars: one sol (24 h 39 min) from sunrise to sunrise. Moon: one Earth day, with the Sun barely moving.
    const hours = site === 'moon' ? 24 : 24.66;
    let fired = 0;
    await new Promise<void>((resolve) => {
      const tick = (now: number) => {
        let t = Math.min(1, (now - start) / duration);
        if (this.ff) t = 1;
        this.stage.setTimeOfDay(site === 'moon' ? moonSky(m, m.sol, t) : t);
        const mins = Math.floor((6 * 60 + t * hours * 60) % (24 * 60));
        clock.textContent = `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
        fill.style.width = `${t * 100}%`;
        while (fired < beats.length && beats[fired].at <= t) {
          const ev = beats[fired++];
          logLine.textContent = ev.text;
          if (ev.storm) {
            this.stage.storm(ev.storm);
            this.audio.sfx('storm');
          }
        }
        const lerp = (a: number, b: number) => a + (b - a) * t;
        renderHud(
          this.hud,
          {
            sol: m.sol,
            windowSol: windowSol(m),
            cellsTotal: report.cells,
            cellsLeft: 0,
            now: {
              air: lerp(report.before.air, report.after.air),
              food: lerp(report.before.food, report.after.food),
              dose: lerp(report.before.dose, report.after.dose),
              fuel: lerp(report.before.fuel, report.after.fuel),
            },
            doseBudget: m.doseBudget,
            crew: m.crew,
            label: this.hudLabel(m),
            site,
          },
          this.hudButtons(),
        );
        if (t < 1) requestAnimationFrame(tick);
        else resolve();
      };
      requestAnimationFrame(tick);
    });

    this.mission = next;
    if (report.built) this.audio.sfx('good');
    this.save();
    this.showDebrief(report);
  }

  private showDebrief(report: SolReport) {
    const m = this.mission!;
    this.phase = 'debrief';
    clear(this.dock);
    this.refreshHud();
    this.stageScene();
    const t = siteText(m.config);
    const d: Debrief = explainSol(report, t.site);
    this.audio.sfx(d.tone === 'good' ? 'good' : d.tone === 'bad' ? 'bad' : 'click');
    const fact = this.mode === 'history' && report.storm?.event.kind === 'cme' ? FACTS[0] : factFor(d.topic, report.sol + m.config.seed.length + m.config.expedition, t.site, landingOf(m.config));
    const over = m.status !== 'playing';
    this.modal(
      [
        h('div', { class: 'kicker' }, `${this.hudLabel(m)} · ${t.Turn} ${report.sol} · Debrief`),
        h('p', { class: `headline tone-${d.tone}`, 'aria-live': 'polite' }, d.headline),
        report.storm ? eventCard(report.storm.event, report.storm.lateByMin ? { lateBy: report.storm.lateByMin, lightMin: m.config.lightTimeMin } : undefined) : null,
        d.details.length ? h('ul', { class: 'clean' }, d.details.map((x) => h('li', null, x))) : null,
        scienceCard(fact, t.site),
        h(
          'div',
          { class: 'actions end' },
          h(
            'button',
            {
              class: 'btn primary',
              'data-autofocus': true,
              onclick: () => {
                this.audio.sfx('click');
                if (over) void this.showEnd(true);
                else this.showBriefing();
              },
            },
            over ? (m.status === 'won' ? 'Launch!' : 'See what happened') : `Start ${t.turn} ${m.sol}`,
            h('span', { class: 'arrow' }),
          ),
        ),
      ],
      { label: `${t.Turn} ${report.sol} debrief` },
    );
    this.coachUpdate();
  }

  // ------------------------------------------------------------------ endings
  private async showEnd(first: boolean) {
    const m = this.mission!;
    this.phase = 'end';
    clear(this.dock);
    this.refreshHud();
    const won = m.status === 'won';
    if (first) {
      // Class code: send this crew's result to the teacher's class board (in the background).
      if (this.mode === 'campaign' || this.mode === 'quick') classBoard.report(this.campaign?.classCode, m, this.mode);
      if (won) {
        this.closeModal();
        this.audio.playMusic('launch');
        this.audio.sfx('win');
        await this.stage.launch();
      }
      if (this.mode === 'campaign' && this.campaign) {
        this.campaign = finishExpedition(this.campaign, m);
        this.save();
      }
    }
    const end = endingFor(m);
    const stars = starsFor(m);
    const isCampaign = this.mode === 'campaign';
    const last = isCampaign && !!this.campaign && campaignDone(this.campaign);
    this.modal(
      [
        siteOf(m.config) === 'moon'
          ? null
          : h(
              'div',
              { class: 'art' },
              h('img', { src: won ? '/art/launch.png' : '/art/lose.png', alt: won ? 'The rocket launches from Mars (AI-generated art)' : 'The crew boards a lander to head home (AI-generated art)' }),
            ),
        h('div', { class: 'kicker' }, won ? `${this.hudLabel(m)} · Mission complete` : `${this.hudLabel(m)} · Heading home early`),
        h('h2', { class: won ? 'tone-good' : '' }, end.title),
        won
          ? h(
              'p',
              null,
              siteOf(m.config) === 'moon'
                ? `The Moon's escape velocity is about ${REAL.moonEscapeKms.toFixed(1)} km/s: the speed your rocket needs to break free of the Moon's gravity. On Mars it is about ${REAL.marsEscapeKms.toFixed(1)} km/s.`
                : `Mars' escape velocity is about ${REAL.marsEscapeKms.toFixed(1)} km/s: the speed your rocket needs to break free of Mars' gravity.`,
            )
          : null,
        crewSays(m.config.expedition, won),
        this.mode !== 'history' ? starRow(stars) : null,
        this.mode !== 'history' ? classCodeLine(this.campaign?.classCode) : null,
        this.mode !== 'history' ? classBoard.card(this.campaign?.classCode) : null,
        this.mode === 'daily' && this.daily ? dailyEndPanel(this.daily, m) : null,
        h('h3', null, 'What happened'),
        h('ul', { class: 'clean' }, end.happened.map((x) => h('li', null, x))),
        missionChartFor(m),
        m.builtThisExpedition.length
          ? h(
              'div',
              { class: 'card good' },
              h('b', null, 'Your crew built: '),
              m.builtThisExpedition.map((id, i) => [i ? ', ' : '', UPGRADES[id].name]),
              isCampaign && !last ? '. The next crew inherits all of it.' : '.',
            )
          : null,
        h('div', { class: 'card' }, h('b', null, won ? 'Next challenge: ' : 'Try this next time: '), end.tip),
        compareCard(m),
        earthCard(m),
        end.badges.length ? [h('h3', null, 'Badges'), h('div', { class: 'badges' }, end.badges.map((b) => h('div', { class: 'badge' }, h('b', null, b.name), h('span', null, b.why))))] : null,
        h(
          'div',
          { class: 'actions' },
          isCampaign && !last ? h('button', { class: 'btn primary', 'data-autofocus': true, onclick: () => this.showInterlude() }, 'Send the next crew', h('span', { class: 'arrow' })) : null,
          isCampaign && last ? h('button', { class: 'btn primary', 'data-autofocus': true, onclick: () => this.showFinale() }, 'See your base', h('span', { class: 'arrow' })) : null,
          isCampaign ? h('button', { class: 'btn', onclick: () => this.retryExpedition() }, 'Try this crew again') : null,
          !isCampaign
            ? h(
                'button',
                { class: 'btn primary', 'data-autofocus': true, onclick: () => (this.mode === 'history' ? this.startHistory() : this.mode === 'daily' ? void this.startDaily() : this.startQuick()) },
                'Play again',
              )
            : null,
          !isCampaign ? h('button', { class: 'btn', onclick: () => this.chooseDifficulty() }, 'Start a campaign') : null,
          h('button', { class: 'btn', onclick: () => this.showTitle() }, 'Title screen'),
        ),
        h('p', { class: 'title-foot' }, `Seed ${m.config.seed} · ${m.config.difficulty} · dose budget ${m.doseBudget} mSv (game value)`),
      ],
      { label: won ? 'Mission complete' : 'Mission over' },
    );
  }

  private retryExpedition() {
    if (!this.campaignAtStart) return;
    this.audio.sfx('click');
    this.campaign = this.campaignAtStart;
    this.mission = null;
    this.save();
    this.showExpeditionIntro();
  }

  private showInterlude() {
    const c = this.campaign!;
    const prev = c.results[c.results.length - 1];
    this.phase = 'interlude';
    this.mission = null;
    clear(this.dock);
    this.refreshHud();
    this.audio.sfx('click');
    this.stage.setScene({ sol: 0, weather: 'clear', alloc: emptyAlloc(), fuel: c.prefillPct, sheltered: false, levels: c.base.levels, crew: 0, site: siteOf(c), landing: landingOf(c) });
    const moon = siteOf(c) === 'moon';
    const future = new Date();
    future.setMonth(future.getMonth() + SYNODIC_MONTHS * (c.expedition - 1));
    const lt = earthMarsLightTime(future);
    const questions = (moon ? MOON_TALK_ABOUT_IT : TALK_ABOUT_IT)[prev?.n ?? 1] ?? [];
    this.modal(
      [
        h('div', { class: 'kicker' }, moon ? 'Later' : `${SYNODIC_MONTHS} months later`),
        h('h2', null, 'The base waits for its next crew'),
        moon
          ? h(
              'p',
              null,
              'The Moon is always close to Earth, so crews do not have to wait for the planets to line up. The base sits empty until the next crew is ready. ',
              `Messages from Earth still take only about ${REAL.moonLightSec} seconds to arrive.`,
            )
          : h(
              'p',
              null,
              'Earth and Mars line up for a quick trip only about every 26 months, so that is how long the base sits empty between crews. ',
              `By ${future.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}, messages from Earth will take about ${Math.round(lt.oneWayMinutes)} minutes to arrive (calculated from JPL orbit data).`,
            ),
        h(
          'div',
          { class: 'card good' },
          icon('o2', 20),
          ' ',
          h('b', null, `The robot O2 plant pre-filled the next rocket to ${c.prefillPct}%. `),
          'More power at the base means a fuller tank waiting for the next crew.',
        ),
        h('div', { class: 'card event' }, h('div', { class: 'kicker' }, 'Talk about it'), h('ul', { class: 'clean' }, questions.map((q) => h('li', null, q)))),
        h(
          'div',
          { class: 'actions end' },
          h('button', { class: 'btn primary', 'data-autofocus': true, onclick: () => this.showExpeditionIntro() }, 'Meet the next crew', h('span', { class: 'arrow' })),
        ),
      ],
      { label: 'Between crews' },
    );
  }

  private showFinale() {
    const c = this.campaign!;
    this.phase = 'finale';
    this.mission = null;
    clear(this.dock);
    this.refreshHud();
    this.audio.playMusic('title');
    this.stage.setScene({ sol: 0, weather: 'clear', alloc: emptyAlloc(), fuel: 0, sheltered: false, levels: c.base.levels, crew: 0, site: siteOf(c), landing: landingOf(c) });
    const t = siteText(c);
    const total = totalStars(c);
    const max = EXPEDITIONS.length * 3;
    const built = UPGRADE_IDS.filter((id) => c.base.levels[id] > 0);
    this.modal(
      [
        t.site === 'mars' ? h('div', { class: 'art' }, h('img', { src: '/art/title.png', alt: 'The Mars base (AI-generated art)' })) : null,
        h('div', { class: 'kicker' }, 'Campaign complete'),
        h('h2', null, `${total} of ${max} stars`),
        h(
          'table',
          { class: 'log' },
          h('thead', null, h('tr', null, h('th', null, 'Crew'), h('th', null, 'Result'), h('th', null, t.Turn === 'Sol' ? 'Sols' : 'Days'), h('th', null, 'Stars'), h('th', null, 'Built'))),
          h(
            'tbody',
            null,
            c.results.map((r) =>
              h(
                'tr',
                null,
                h('td', null, `${r.n}: ${EXPEDITIONS[r.n - 1].name} (${EXPEDITIONS[r.n - 1].crew} crew)`),
                h('td', null, r.status === 'won' ? 'Launched home' : 'Came home early'),
                h('td', null, String(r.sols)),
                h('td', null, starRow(r.stars, true)),
                h('td', null, r.built.length ? r.built.map((id) => UPGRADES[id].name).join(', ') : 'nothing'),
              ),
            ),
          ),
        ),
        crewCharts(c.results, c.site ?? 'mars'),
        h(
          'div',
          { class: 'card good' },
          h('b', null, 'Your base today: '),
          built.length ? built.map((id, i) => [i ? ', ' : '', `${UPGRADES[id].name}${maxLevel(id) > 1 ? ` x${c.base.levels[id]}` : ''}`]) : 'the same as the first crew found it',
          '. Three crews, one base: every crew built on the work of the one before. That is how real space stations and bases grow.',
        ),
        classCodeLine(c.classCode),
        classBoard.card(c.classCode),
        h('div', { class: 'card event' }, h('div', { class: 'kicker' }, 'Talk about it'), h('ul', { class: 'clean' }, (t.site === 'moon' ? MOON_TALK_ABOUT_IT : TALK_ABOUT_IT)[3].map((q) => h('li', null, q)))),
        h(
          'div',
          { class: 'actions' },
          h('button', { class: 'btn primary', 'data-autofocus': true, onclick: () => (this.clearSave(), this.chooseDifficulty()) }, 'New campaign'),
          h('button', { class: 'btn', onclick: () => this.showScienceLog() }, 'Science Log'),
          h('button', { class: 'btn', onclick: () => (this.clearSave(), this.showTitle()) }, 'Title screen'),
        ),
      ],
      { label: 'Campaign complete' },
    );
  }
}

function starRow(stars: StarId[], compact = false): HTMLElement {
  return h(
    'div',
    { class: `stars ${compact ? 'compact' : ''}`, 'aria-label': `${stars.length} of 3 stars` },
    (Object.keys(STAR_INFO) as StarId[]).map((id) =>
      h('span', { class: `star ${stars.includes(id) ? 'on' : ''}`, title: STAR_INFO[id].how }, icon('sun', compact ? 14 : 22), compact ? null : h('span', null, STAR_INFO[id].name)),
    ),
  );
}
