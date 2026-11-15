// Written with AI assistance (Claude Code). See README "Use of AI tools".
// Game flow.
//   Campaign:  title -> [expedition intro -> (briefing -> budget -> run -> debrief) x sols -> expedition end -> 26 months later] x 3 -> campaign end
//   Quick:     one expedition.   History: the real May 2024 storms.

import { emitGame, runInterstitial, renderTitleExtras, setMetaContext, type InterstitialContext } from '../meta/hooks';
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
import { initAccess, decorateDialog, statusButton, accessPanel, accessButtonText, ACCESS_DEFAULTS, type AccessSettings } from './access';
import { certForMission, certForCampaign, certificateView, type CertData } from './certificate';
import { tripHomeLine } from './planner/tiein';
// The Hook: the lobby, the cold open, and game feel (juice, perfect-sol streaks, the end-screen score).
import { addTitleExtra } from '../meta/hooks';
import { titleTile } from '../meta/tile';
import { decorateLobby, lobbyExtras, loadLobby, countIntro, markOpened } from './lobby';
import { runColdOpen } from './coldopen';
import * as juice from './juice';
import { isPerfectSol, streakXp, scoreMission, recordBest, GRADE_WORDS, type MissionScore } from './score';
import { crewFor } from '../data/crew';
import { crewPortrait } from './crew';

type Phase = 'title' | 'intro' | 'briefing' | 'plan' | 'running' | 'debrief' | 'end' | 'interlude' | 'finale' | 'room' | 'dashboard';
type Mode = 'campaign' | 'quick' | 'history' | 'daily';

interface Settings extends AccessSettings {
  muted: boolean;
  reducedMotion: boolean;
  /** 3D outpost on (default) or the simple view for slow devices. */
  view3d: boolean;
}

const SETTINGS_KEY = 'ev-settings';
const SAVE_KEY = 'ev-save-v1';
/** The presenter demo (/demo): a fixed seed so every rehearsal plays the same, and a rocket already 78% full. */
export const SHORT_DEMO_SEED = 'short-demo';
/** Our public code repository, linked front and center on the title screen. */
export const REPO_URL = 'https://github.com/swimmer-303/escape-velocity';
/** GitHub's mark (Octicons "mark-github"), drawn in the button's text color. */
function githubMark(): HTMLElement {
  const s = document.createElement('span');
  s.className = 'gh-mark';
  s.setAttribute('aria-hidden', 'true');
  s.innerHTML =
    '<svg viewBox="0 0 16 16" width="22" height="22" focusable="false"><path fill="currentColor" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>';
  return s;
}
export const SHORT_DEMO_PREFILL = 78;
/** playescapevelocity.com/demo (or ?short) opens the 3-sol presenter demo. */
export function isShortDemoUrl(loc: { pathname: string; search: string }): boolean {
  return /^\/demo\/?$/.test(loc.pathname) || new URLSearchParams(loc.search).has('short');
}

function loadSettings(): Settings {
  const base: Settings = { muted: false, reducedMotion: prefersReducedMotion(), view3d: true, ...ACCESS_DEFAULTS };
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
  /** The 3-sol presenter demo (/demo): the May 2024 replay with the rocket already mostly full. */
  private shortDemo = false;
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

  /** `intro`: main.ts asks for the cold open (the real game in a browser; never in tests). */
  constructor(stage: Stage, opts: { intro?: boolean } = {}) {
    this.stage = stage;
    this.stage.mount(this.stageEl);
    this.audio = new GameAudio(this.settings.muted);
    // Read aloud and display options (larger text, high contrast, dyslexia-friendly spacing): see access.ts.
    initAccess(this.settings, () => saveSettings(this.settings), { duck: (on) => this.audio.duck(on), reducedMotion: () => this.settings.reducedMotion });
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
      // Placing cells one after another climbs the scale (see juice.ts).
      sfx: (n) => (n === 'place' ? this.audio.sfx('pop', this.combo.next()) : (n === 'remove' && this.combo.reset(), this.audio.sfx(n))),
      onPlaced: (id) => this.cellPlaced(id),
    });
    // Tapping a module in 3D highlights its card in the dock.
    this.stage.onPick = (key) => this.budget.highlight(key);
    this.feedReady = loadSpaceWeather().then((f) => {
      this.feed = f;
      // Refresh the title screen with the new data only if it is the dialog on screen right now:
      // never redraw over the difficulty/site chooser (or any other dialog) the player opened.
      const onTitle = this.modalRoot.querySelector('[aria-label="Escape Velocity title screen"]');
      if (this.phase === 'title' && onTitle && !this.demoActive) this.showTitle();
      else this.refreshHud();
    });
    window.addEventListener('keydown', (e) => this.onKey(e));
    // Meta features (rank, Storm Cards, mini-games, Hangar) reach the game only through this context.
    setMetaContext({
      stage: this.stage,
      audio: this.audio,
      modal: (content, opts) => this.modal(content, opts),
      closeModal: () => this.closeModal(),
      showTitle: () => this.showTitle(),
      reducedMotion: () => this.settings.reducedMotion,
    });
    // The planning panel must fit under the HUD, which wraps to two rows on narrower screens (style.css reads --hud-h).
    if (typeof ResizeObserver === 'function') {
      new ResizeObserver(() => document.documentElement.style.setProperty('--hud-h', `${this.hud.offsetHeight}px`)).observe(this.hud);
    }
    // A Mission Control join link (?room=CODE) goes straight to the class room;
    // a teacher dashboard link (?dashboard=CODE&key=KEY) opens the class board instead of the game.
    // The game's own modes are lobby tiles, sorted in with the meta features' tiles (see lobby.ts).
    this.registerLobbyTiles();
    const room = roomParam(location.search);
    const dash = dashboardParams(location.search);
    if (dash) this.openDashboard(dash);
    else if (room) this.openRoom(room);
    else if (isShortDemoUrl(location)) this.startShortDemo();
    else {
      this.showTitle();
      // ?demo: the attract mode for an event table or a screen recording.
      if (new URLSearchParams(location.search).has('demo')) void this.startDemo();
      else if (opts.intro && !this.settings.reducedMotion) this.coldOpen();
    }
  }

  // ------------------------------------------------------------------ helpers
  private applyMotion() {
    document.documentElement.classList.toggle('reduce-motion', this.settings.reducedMotion);
    this.stage.setReducedMotion(this.settings.reducedMotion);
  }

  private modal(content: Child, opts: { wide?: boolean; label: string; onClose?: () => void; autoRead?: boolean; lobby?: boolean } = { label: 'Dialog' }) {
    // Re-drawing the same dialog (e.g. picking a Workshop project) keeps its scroll position.
    const prev = this.modalRoot.querySelector<HTMLElement>('.modal');
    const sameDialog = prev?.getAttribute('aria-label') === opts.label;
    const keepScroll = sameDialog ? { box: prev!.scrollTop, root: this.modalRoot.scrollTop } : null;
    clear(this.modalRoot);
    this.modalRoot.classList.toggle('lobby-root', !!opts.lobby);
    document.documentElement.classList.toggle('ev-lobby', !!opts.lobby);
    const box = h(
      'div',
      { class: `modal ${opts.wide ? 'wide' : ''}${opts.lobby ? ' lobby' : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': opts.label },
      opts.onClose ? h('button', { class: 'btn small icon-only close-x', 'aria-label': 'Close', onclick: opts.onClose }, 'X') : null,
      content,
    );
    this.modalRoot.append(box);
    if (keepScroll) {
      decorateDialog(box);
      box.scrollTop = keepScroll.box;
      this.modalRoot.scrollTop = keepScroll.root;
      return box;
    }
    const focusable = box.querySelector<HTMLElement>('[data-autofocus]') ?? box.querySelector<HTMLElement>('button.primary, button.go, button');
    // "Read to me" (and auto read-aloud for briefings and debriefs). Added after picking the focus, so focus stays put.
    decorateDialog(box, { autoRead: opts.autoRead });
    // Focus the main button without scrolling to it: a long dialog (the title screen, a busy briefing) must open at its top.
    focusable?.focus({ preventScroll: true });
    box.scrollTop = 0;
    this.modalRoot.scrollTop = 0;
    return box;
  }

  private closeModal() {
    clear(this.modalRoot);
    this.modalRoot.classList.remove('lobby-root');
    document.documentElement.classList.remove('ev-lobby');
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
    const status = this.mission ? statusButton(this.hud) : null;
    return [
      this.dataBadge(),
      ...(status ? [status] : []),
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
    return this.mode === 'history' ? (this.shortDemo ? 'SHORT DEMO · MAY 2024' : 'MAY 2024') : this.mode === 'campaign' ? `CREW ${m.config.expedition} OF ${EXPEDITIONS.length}` : 'QUICK MISSION';
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
    // Planning: bars glide to the plan's new values (a sol's own frames move on their own).
    if (this.phase === 'plan') juice.easeMeters(this.hud, this.settings.reducedMotion);
    else juice.resetMeters();
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
      warning: this.phase === 'briefing' || this.phase === 'plan' ? (b.warning?.source ?? null) : null,
    });
  }

  // ------------------------------------------------------------------ the hook: lobby, cold open, game feel
  /** Placing cells in a row climbs the scale. */
  private combo = new juice.PlaceCombo();
  /** PLAY from a brand-new player's first lobby: a short, friendly crew intro. */
  private firstRun = false;
  /** Perfect sols in a row this mission (see score.ts), and whether the last sol was one. */
  private streak = 0;
  private lastPerfect = false;
  /** The plan's projected meters, to flash a meter when a change pushes it across a line. */
  private planMeters: juice.MeterSnapshot | null = null;
  /** The end screen's score, worked out once per mission (redrawing the end screen keeps it). */
  private endScore: { mission: MissionState; score: MissionScore; isNew: boolean; previous: number | null } | null = null;

  private registerLobbyTiles() {
    for (const extra of lobbyExtras({
      quick: () => this.startQuick(),
      campaign: () => this.chooseDifficulty(),
      daily: () => void this.startDaily(),
      history: () => this.startHistory(),
      historyReady: !!MAY2024_SNAPSHOT,
      classMission: () => this.openRoom(),
      radar: () => this.showRadar(),
      planner: () => this.showPlanner(() => this.showTitle()),
      scienceLog: () => this.showScienceLog(),
    }))
      addTitleExtra(extra);
  }

  /** The big PLAY button: straight into a quick mission (Mars unless the player last picked the Moon). */
  private playNow() {
    markOpened('play');
    this.firstRun = !Coach.seen();
    this.launchQuick();
  }

  /** First visit: the full cold open. Later visits: a short camera dolly. Never with reduced motion. */
  private coldOpen() {
    // Only the swappable stage can bring the 3D view (a bare simple stage, as in tests, never gets a cold open).
    if (typeof (this.stage as Stage & { canFlyIn?(): boolean }).canFlyIn !== 'function') return;
    const full = loadLobby().intros === 0;
    if (full) countIntro();
    runColdOpen({
      stage: this.stage as Stage & { canFlyIn?(): boolean },
      audio: this.audio,
      full,
      onTitle: () => this.phase === 'title' && !this.demoActive,
      reveal: () => this.modalRoot.querySelector<HTMLElement>('.play-big')?.focus({ preventScroll: true }),
    });
  }

  /** A cell landed in a slot: it pops. When the last cell is placed, the Run button lights up. */
  private cellPlaced(id: string) {
    const reduced = this.settings.reducedMotion;
    const boxes = this.dock.querySelectorAll<HTMLElement>(`.slot-row[data-drop="${id}"] .slot-box.filled`);
    juice.popCell(boxes[boxes.length - 1], reduced);
    const run = this.dock.querySelector<HTMLElement>('.btn.go.ready');
    if (run) {
      juice.bounce(run, reduced);
      this.audio.sfx('sparkle');
    }
  }

  /** Flash a HUD meter when the plan pushes it across a line (life under a day, dose over 75%, a full tank). */
  private flashPlanMeters(next: Snapshot, doseBudget: number) {
    const now: juice.MeterSnapshot = { life: Math.min(next.air, next.food), dose: next.dose, fuel: next.fuel };
    for (const c of juice.crossings(this.planMeters, now, doseBudget)) juice.flashMeter(this.hud, c.meter, c.tone);
    this.planMeters = now;
  }

  /** What one crew member says at a big moment of the sol (a portrait and a short line over the 3D view). */
  private crewSay(m: MissionState, k: number, text: string) {
    const roster = crewFor(m.config.expedition);
    const i = (m.sol + k) % roster.members.length;
    juice.crewBubble(crewPortrait(roster, i), roster.members[i].name, text, { reduced: this.settings.reducedMotion });
  }

  /** Storm, shelter, cargo and build moments during a sol: screen edges, sparkle, the shelter's clang, crew lines. */
  private solMoment(m: MissionState, report: SolReport, kind: 'storm' | 'lander' | 'built' | 'full') {
    const reduced = this.settings.reducedMotion;
    const mid = this.stageEl.getBoundingClientRect();
    const x = mid.left + mid.width / 2;
    const y = mid.top + mid.height * 0.38;
    if (kind === 'storm' && report.storm) {
      const s = report.storm;
      if (s.shelterCells > 0) {
        juice.vignette('shield', reduced);
        window.setTimeout(() => this.audio.sfx('clang'), 260);
        const held = s.doseTaken <= s.doseUnsheltered * 0.5;
        juice.floatText(x, y, held ? 'SHELTER HELD!' : 'SHELTER HELPED', { tone: 'cyan', big: true, reduced });
        this.crewSay(m, 0, held ? 'Phew! The shelter blocked it.' : 'The shelter helped. More power next time!');
      } else {
        juice.vignette('storm', reduced);
        juice.floatText(x, y, 'STORM HIT!', { tone: 'red', big: true, reduced });
        this.crewSay(m, 0, 'Ouch! We felt that one. Power the shelter next time?');
      }
    } else if (kind === 'lander') {
      juice.sparkle(null, reduced);
      this.audio.sfx('sparkle');
      this.crewSay(m, 1, 'Supplies are here!');
    } else if (kind === 'built') {
      juice.sparkle(null, reduced, 'UPGRADE BUILT!');
      this.audio.sfx('sparkle');
      this.crewSay(m, 2, 'We built it! The next crew will love this.');
    } else {
      juice.sparkle(null, reduced, 'TANK FULL!');
      this.audio.sfx('sparkle');
    }
  }

  /** After a sol: count perfect sols in a row (game feel only; it never changes the mission). */
  private trackStreak(report: SolReport, next: MissionState) {
    const perfect = isPerfectSol(report, next, windowSol(next));
    this.streak = perfect ? (report.sol === 1 ? 1 : this.streak + 1) : 0;
    this.lastPerfect = perfect;
    const xp = streakXp(this.streak);
    if (xp && !this.demoActive && !this.shortDemo) emitGame('xp', { amount: xp, reason: `Perfect ${siteText(next.config).turn} streak x${this.streak}` });
  }

  /** The debrief's "Perfect sol" banner and what the sol made, counting up. */
  private solFlair(report: SolReport, fresh: boolean): HTMLElement[] {
    const reduced = this.settings.reducedMotion;
    const out: HTMLElement[] = [];
    if (this.lastPerfect) {
      const n = this.streak;
      out.push(
        h(
          'div',
          { class: 'streak-banner', role: 'status' },
          h('b', null, `PERFECT ${siteText(this.mission?.config ?? this.site).TURN}`),
          n >= 2 ? h('span', { class: `streak-chip${n >= 5 ? ' blaze' : n >= 3 ? ' hot' : ''}` }, `x${n} STREAK`) : null,
          h(
            'span',
            { class: 'title-foot' },
            n >= 2 ? `${n} perfect in a row: everyone safe and the tank on pace. Bonus XP!` : 'Everyone stayed safe and the tank is on pace. Do it again for a streak!',
          ),
        ),
      );
      // The chime climbs with the streak (only when the debrief first opens, not when it is redrawn).
      if (fresh) window.setTimeout(() => this.audio.sfx('streak', Math.pow(2, Math.min(n - 1, 6) / 12)), 280);
    }
    const a = report.after;
    const b = report.before;
    const items: Array<{ cls: string; label: string; delta: number; unit: string; digits: number }> = [
      { cls: 'fuel', label: 'Fuel', delta: a.fuel - b.fuel, unit: '%', digits: 0 },
      { cls: a.air >= b.air ? 'up' : 'down', label: 'Air', delta: a.air - b.air, unit: ' d', digits: 1 },
      { cls: a.food >= b.food ? 'up' : 'down', label: 'Food', delta: a.food - b.food, unit: ' d', digits: 1 },
      { cls: a.dose - b.dose > 0.05 ? 'down' : 'up', label: 'Dose', delta: a.dose - b.dose, unit: '', digits: 1 },
    ];
    const tally = h('div', { class: 'sol-tally', 'aria-label': 'What this sol changed' });
    for (const it of items) {
      const num = h('b', null, '0');
      tally.append(h('span', { class: it.cls }, num, it.label));
      const fmt = (v: number) => `${v >= 0 ? '+' : ''}${it.digits ? v.toFixed(it.digits) : Math.round(v)}${it.unit}`;
      juice.countUp(num, it.delta, { ms: fresh ? 700 : 0, format: fmt, reduced: reduced || !fresh, onTick: fresh && it.cls === 'fuel' ? () => this.audio.sfx('tick') : undefined });
    }
    out.push(tally);
    return out;
  }

  /** The end screen's score: a count-up, a letter grade, stars, and a personal best. */
  private scorePanel(m: MissionState, first: boolean): HTMLElement {
    const reduced = this.settings.reducedMotion;
    if (!this.endScore || this.endScore.mission !== m) {
      const score = scoreMission(m, windowSol(m), `${siteText(m.config).Turn}s`);
      const save = first && !this.demoActive && !this.shortDemo;
      const key = `${this.mode ?? 'quick'}-${siteOf(m.config)}`;
      const best = save ? recordBest(key, score.score) : { isNew: false, previous: null };
      this.endScore = { mission: m, score, isNew: best.isNew, previous: best.previous };
    }
    const { score, isNew, previous } = this.endScore;
    const num = h('span', { class: 'score-num' }, '0');
    const panel = h(
      'div',
      { class: 'score-panel', role: 'group', 'aria-label': `Score ${score.score}, grade ${score.grade}` },
      h('div', { class: `grade g-${score.grade}`, 'aria-hidden': 'true' }, score.grade),
      h('div', { class: 'score-main' }, h('span', { class: 'score-label' }, 'Score'), num, h('span', { class: 'score-words' }, GRADE_WORDS[score.grade])),
      h(
        'div',
        { class: 'score-main' },
        isNew ? h('span', { class: 'score-pb' }, 'New personal best!') : null,
        !isNew && previous !== null ? h('span', { class: 'score-prev' }, `Your best: ${previous.toLocaleString('en-US')}`) : null,
      ),
      h(
        'ul',
        { class: 'score-parts' },
        score.parts.filter((p) => p.points > 0).map((p) => h('li', null, `${p.label} `, h('b', null, `+${p.points.toLocaleString('en-US')}`))),
      ),
    );
    juice.countUp(num, score.score, { ms: first ? 1100 : 400, reduced, onTick: first ? () => this.audio.sfx('tick') : undefined });
    if (first) {
      window.setTimeout(() => {
        const stars = this.modalRoot.querySelector('.stars');
        if (stars?.querySelector('.star.on')) juice.sparkle(stars, reduced);
        this.audio.sfx(isNew ? 'streak' : 'sparkle');
      }, 1250);
    }
    return panel;
  }

  /** One or two other modes to try next, as lobby tiles. */
  private tryNext(m: MissionState): HTMLElement {
    const moon = siteOf(m.config) === 'moon';
    const daily = { id: 'daily', name: 'Daily challenge', sub: 'Same mission for everyone today', go: () => void this.startDaily() };
    const otherWorld = {
      id: 'quick',
      name: moon ? 'Fly to Mars' : 'Try the Moon',
      sub: moon ? 'A quick mission at a Mars base' : 'A quick mission with a two-week night',
      go: () => {
        this.site = moon ? 'mars' : 'moon';
        this.launchQuick();
      },
    };
    const history = { id: 'history', name: 'May 2024 storms', sub: 'Face the real storms of May 2024', go: () => this.startHistory() };
    const options = this.mode === 'daily' ? [otherWorld, history] : this.mode === 'history' ? [daily, otherWorld] : [daily, MAY2024_SNAPSHOT ? history : otherWorld];
    return h(
      'section',
      { class: 'end-try', 'aria-label': 'Try next' },
      h('h3', null, 'Try next'),
      h(
        'div',
        { class: 'end-next' },
        options.map((o) =>
          titleTile({
            id: `next-${o.id}`,
            name: o.name,
            sub: o.sub,
            accent: 'cyan',
            onClick: () => {
              markOpened(o.id);
              o.go();
            },
          }),
        ),
      ),
    );
  }

  // ------------------------------------------------------------------ title
  showTitle() {
    if (this.demoActive) this.stopDemo();
    if (this.coach.active) this.coach.stop(false);
    this.shortDemo = false;
    this.phase = 'title';
    this.mission = null;
    this.mode = null;
    this.firstRun = false;
    this.streak = 0;
    juice.clearCrewBubbles();
    clear(this.dock);
    this.refreshHud();
    this.audio.playMusic('title');
    this.stage.setScene({ sol: 0, weather: 'clear', alloc: emptyAlloc(), fuel: 0, sheltered: false, levels: emptyLevels(), crew: 4 });
    const lt = this.light;
    const counts = this.feed.snapshot ? countByClass(this.feed.snapshot) : null;
    const saved = readSave();
    const canContinue = saved && !campaignDone(saved.campaign);
    // The lobby (see lobby.ts): the team logo and a big PLAY over the live 3D outpost, then the player's strip and a grid
    // of mode tiles (the game's own modes and every meta feature's tile, sorted by order), then the links and the real data.
    const box = this.modal(
      h(
        'div',
        { class: 'title-screen lobby' },
        h(
          'div',
          { class: 'lobby-hero' },
          h('h1', { class: 'lobby-logo' }, h('span', { class: 'sr-only' }, 'Escape Velocity'), h('img', { class: 'logo-img', src: '/art/logo.png', alt: '', width: 413, height: 424 })),
          h(
            'div',
            { class: 'lobby-hero-text' },
            h('p', { class: 'tagline' }, 'Build a base on Mars, crew after crew. Make air to breathe and oxygen for the rocket home, and leave the base better for the next crew.'),
            this.codes.titleNote(),
          ),
          h(
            'div',
            { class: 'menu' },
            canContinue
              ? h(
                  'button',
                  { class: 'btn primary play-big', 'data-autofocus': true, onclick: () => this.continueCampaign(saved) },
                  h('span', { class: 'play-word' }, 'PLAY'),
                  h(
                    'span',
                    { class: 'play-sub' },
                    `Continue: crew ${saved.campaign.expedition} of ${EXPEDITIONS.length}${saved.mission ? `, ${siteText(saved.campaign).turn} ${saved.mission.sol}` : ''}${saved.campaign.site === 'moon' ? ' (Moon)' : ''}`,
                  ),
                )
              : h(
                  'button',
                  { class: 'btn primary play-big', 'data-autofocus': true, onclick: () => this.playNow() },
                  h('span', { class: 'play-word' }, 'PLAY'),
                  h('span', { class: 'play-sub' }, `One crew on ${this.site === 'moon' ? 'the Moon' : 'Mars'}, about 10 minutes`),
                ),
            h(
              'a',
              { class: 'btn github', href: REPO_URL, target: '_blank', rel: 'noopener', title: 'All of our code, the tests, and every AI prompt we used' },
              githubMark(),
              'See the code on GitHub',
            ),
          ),
        ),
        h(
          'div',
          { class: 'lobby-panel' },
          this.settings.view3d ? null : h('div', { class: 'art' }, h('img', { src: '/art/title.png', alt: 'A tiny outpost on Mars with a rocket on its launch pad (AI-generated art)' })),
          // Rank first (full width), then tiles: quick mission, campaign, daily, May 2024, Storm Cards, Hangar, Flight school...
          h('div', { class: 'title-meta' }, ...renderTitleExtras()),
          h(
            'div',
            { class: 'menu-links' },
            h('button', { class: 'btn small', onclick: () => this.showHowTo(() => this.showTitle()) }, 'How to play'),
            h('button', { class: 'btn small', title: 'The game plays itself for about 30 seconds', onclick: () => void this.startDemo() }, 'Watch a demo'),
            h('button', { class: 'btn small', onclick: () => this.showTodaysBest(() => this.showTitle()) }, "Today's best"),
            h('a', { class: 'btn small', href: '/teacher/', target: '_blank', rel: 'noopener' }, 'For teachers'),
            h('button', { class: 'btn small', onclick: () => this.showAccess() }, accessButtonText()),
            h('button', { class: 'btn small', onclick: () => this.showCredits() }, 'Credits and AI use'),
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
            'AI disclosure: the illustrations, crew portraits and music in this game are AI-generated (Higgsfield), the logo was made with Claude, and the code was written with AI assistance (Claude Code). The picture of the Sun is real NASA imagery, and all data comes from NASA. ',
            h('button', { class: 'linklike', onclick: () => this.showCredits() }, 'Details'),
          ),
        ),
      ),
      { label: 'Escape Velocity title screen', lobby: true },
    );
    // NEW badges on modes the player has not opened yet (after the first-sol tutorial, so a first lobby stays calm).
    decorateLobby(box, Coach.seen());
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

  /** Space weather radar (loaded on demand): real DONKI CMEs flying past Earth and Mars. */
  showRadar(replay = false) {
    this.audio.sfx('click');
    import('./radar/radar')
      .then(({ renderRadar }) =>
        this.modal(renderRadar({ feed: this.feed, replay, reducedMotion: this.settings.reducedMotion }), { wide: true, label: 'Space weather radar', onClose: () => this.resume() }),
      )
      .catch(() => undefined);
  }

  /** The Trip planner (real Mars-to-Earth trajectories), loaded only when opened. */
  showPlanner(back: () => void) {
    this.audio.sfx('click');
    import('./planner/planner')
      .then(({ renderPlanner }) => this.modal(renderPlanner({ reducedMotion: this.settings.reducedMotion, back }).el, { wide: true, label: 'Trip planner', onClose: back }))
      .catch(() => back());
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
        accessPanel(),
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
          h('button', { class: 'btn', onclick: () => this.showRadar(this.mode === 'history') }, 'Space weather radar'),
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

  /** Text and voice settings, from the title screen (in a game they are in the menu). */
  private showAccess() {
    this.modal(
      [
        h('div', { class: 'kicker' }, 'Settings'),
        h('h2', null, accessButtonText()),
        accessPanel(),
        h('div', { class: 'actions end' }, h('button', { class: 'btn primary', 'data-autofocus': true, onclick: () => this.resume() }, 'Done')),
      ],
      { label: 'Text and voice settings', onClose: () => this.resume() },
    );
  }

  /** The Junior Astronaut certificate (after a win, and at the campaign finale). Back returns to the end screen. */
  private showCertificate(data: CertData) {
    this.audio.sfx('click');
    this.modal(certificateView(data, () => this.resume()), { wide: true, label: 'Junior Astronaut certificate', onClose: () => this.resume() });
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
  // ------------------------------------------------------------------ demo (attract mode)
  /** The game plays itself with the "Suggest a plan" advisor: for demo videos and event tables. */
  private demoActive = false;
  private demoTimer = 0;
  private demoRunTimer = 0;
  private demoBanner: HTMLElement | null = null;
  private demoStopper: ((e: Event) => void) | null = null;
  /** Tests speed the demo up. */
  private demoSpeed = 1;

  private async startDemo() {
    this.stopDemo();
    this.audio.sfx('click');
    this.demoActive = true;
    this.mode = 'quick';
    const pool = await this.pool();
    // The player picked something else on the title screen while the data loaded.
    if (!this.demoActive || this.phase !== 'title') {
      this.demoActive = false;
      return;
    }
    // A short showcase: the robot O2 plant has already filled half the tank, so the crew launches in a few sols.
    const c = { ...newCampaign(`demo-${Math.random().toString(36).slice(2, 7)}`, 'cadet'), prefillPct: 55 };
    this.campaign = c;
    this.campaignAtStart = c;
    this.mission = createMission(missionConfigFor(c, this.light.oneWayMinutes, pool));
    this.demoBanner?.remove();
    this.demoBanner = h('div', { class: 'demo-banner', role: 'status' }, h('b', null, 'DEMO'), ' The game is playing itself. Tap or press any key to play.');
    document.body.append(this.demoBanner);
    const stop = (e: Event) => {
      if (!this.demoActive) return;
      e.preventDefault();
      e.stopPropagation();
      this.stopDemo();
      this.showTitle();
    };
    this.demoStopper = stop;
    window.setTimeout(() => {
      if (this.demoStopper !== stop) return;
      window.addEventListener('pointerdown', stop, true);
      window.addEventListener('keydown', stop, true);
    }, 0);
    this.showBriefing();
    this.demoStep();
  }

  private stopDemo() {
    this.demoActive = false;
    window.clearTimeout(this.demoTimer);
    window.clearTimeout(this.demoRunTimer);
    this.demoBanner?.remove();
    this.demoBanner = null;
    if (this.demoStopper) {
      window.removeEventListener('pointerdown', this.demoStopper, true);
      window.removeEventListener('keydown', this.demoStopper, true);
      this.demoStopper = null;
    }
  }

  private demoStep() {
    if (!this.demoActive) return;
    const later = (ms: number, fn: () => void) => {
      window.clearTimeout(this.demoTimer);
      this.demoTimer = window.setTimeout(() => this.demoActive && fn(), ms * this.demoSpeed);
    };
    const m = this.mission;
    switch (this.phase) {
      case 'briefing':
        if (m && getBriefing(m).resupply && !this.crate) this.crate = 'food';
        return later(2200, () => {
          this.plan();
          this.demoStep();
        });
      case 'plan':
        if (m) {
          const advice = advise(m);
          this.alloc = advice.alloc;
          this.advice = advice.reasons;
          this.renderPlan();
        }
        return later(2200, () => {
          window.clearTimeout(this.demoRunTimer);
          // Let each sol play for a few seconds, then skip to its end.
          this.demoRunTimer = window.setTimeout(() => (this.ff = true), 3500 * this.demoSpeed);
          void this.run();
          this.demoStep();
        });
      case 'debrief':
        return later(2600, () => {
          if (this.mission && this.mission.status !== 'playing') void this.showEnd(true);
          else this.showBriefing();
          this.demoStep();
        });
      case 'end':
        // Loop for event tables: after the ending, start a fresh demo.
        return later(11000, () => void this.startDemo());
      default:
        return later(400, () => this.demoStep());
    }
  }

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
    this.shortDemo = false;
    this.campaign = newCampaign(this.seed(), 'cadet', 'mars');
    const config: MissionConfig = { ...missionConfigFor(this.campaign, this.light.oneWayMinutes, may2024Pool()), scenario: 'may2024' };
    this.campaignAtStart = this.campaign;
    this.mission = createMission(config);
    this.audio.playMusic('mission');
    this.showBriefing();
  }

  /**
   * The presenter demo at /demo: three sols you can play live in about two minutes. It is the real May 2024
   * replay (ARCHIVE data), with the rocket pre-filled so the crew can launch on sol 3, right after the real
   * X-class flare of May 8, 2024. Put about 4 cells on FUEL on sols 1 and 2, then shelter on sol 3.
   */
  private startShortDemo() {
    this.stopDemo();
    if (this.coach.active) this.coach.stop(false);
    this.mode = 'history';
    this.shortDemo = true;
    this.campaign = { ...newCampaign(SHORT_DEMO_SEED, 'cadet', 'mars'), prefillPct: SHORT_DEMO_PREFILL };
    this.campaignAtStart = this.campaign;
    this.mission = createMission({ ...missionConfigFor(this.campaign, this.light.oneWayMinutes, may2024Pool()), scenario: 'may2024' });
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
    // A brand-new player who pressed PLAY: the goal in one line and the crew's faces, then straight to the landing.
    if (this.firstRun && this.mode === 'quick') {
      const roster = crewFor(c.expedition);
      this.modal(
        [
          h('div', { class: 'kicker' }, 'Your first mission'),
          h('h2', null, spec.name),
          t.site === 'mars' ? h('div', { class: 'art' }, h('img', { src: '/art/title.png', alt: 'The Mars outpost (AI-generated art)' })) : null,
          h(
            'p',
            { class: 'first-goal' },
            h('b', null, 'Your goal: '),
            `fill the rocket with fuel and fly your ${spec.crew} astronauts home by ${t.turn} ${windowSols}. Keep them safe from solar storms!`,
          ),
          h(
            'ul',
            { class: 'first-crew', 'aria-label': 'Your crew' },
            roster.members.map((mem, i) => h('li', null, crewPortrait(roster, i), h('span', null, mem.name))),
          ),
          h('div', { class: 'actions end' }, h('button', { class: 'btn primary', 'data-autofocus': true, onclick: () => this.landCrew() }, 'Land the crew', h('span', { class: 'arrow' }))),
        ],
        { label: `${spec.name} introduction` },
      );
      return;
    }
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
    this.firstRun = false;
    const c = this.campaign!;
    this.audio.sfx('click');
    this.modalRoot.querySelectorAll('button').forEach((b) => b.setAttribute('disabled', ''));
    const pool = await this.pool().finally(() => (this.landing = false));
    this.campaignAtStart = c;
    this.mission = createMission(this.mode === 'daily' && this.daily ? dailyMissionConfig(this.daily.config) : missionConfigFor(c, this.light.oneWayMinutes, pool));
    this.save();
    if (!this.demoActive) {
      this.closeModal();
      await runInterstitial('landing', this.interstitialContext());
    }
    this.showBriefing();
    // First time playing: a one-minute guided first sol.
    if (!Coach.seen() && c.expedition === 1 && (this.mode === 'campaign' || this.mode === 'quick' || this.mode === 'daily')) this.startTutorial();
  }

  private interstitialContext(): InterstitialContext {
    const m = this.mission!;
    return { mission: m, mode: this.mode ?? 'quick', site: siteOf(m.config), root: this.modalRoot, stage: this.stage, audio: this.audio, reducedMotion: this.settings.reducedMotion };
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
    if (this.shortDemo && m.sol === 1)
      cards.push(
        h(
          'div',
          { class: 'card good' },
          icon('o2', 20),
          ' ',
          h('b', null, `Short demo: three sols. `),
          `While the base was empty, the O2 plant filled the rocket to ${SHORT_DEMO_PREFILL}%. Put about 4 cells on FUEL today and tomorrow, keep the heaters on, and watch for the real solar storms of May 2024.`,
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
          h('button', { class: 'linkish', onclick: () => this.showRadar(this.mode === 'history') }, 'See it on the radar'),
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
      { label: `${t.Turn} ${m.sol} morning briefing`, autoRead: true },
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
    this.planMeters = null;
    this.combo.reset();
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
    this.flashPlanMeters(preview.after, m.doseBudget);
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
    const duration = this.settings.reducedMotion ? 2000 : this.shortDemo ? 6000 : 9000;
    const start = performance.now();
    // Mars: one sol (24 h 39 min) from sunrise to sunrise. Moon: one Earth day, with the Sun barely moving.
    const hours = site === 'moon' ? 24 : 24.66;
    let fired = 0;
    // Game feel: a crate landing, a storm hitting (or the shelter holding), an upgrade finished, a full tank.
    const moments: Array<{ at: number; kind: 'storm' | 'lander' | 'built' | 'full' }> = [];
    if (report.crate) moments.push({ at: 0.1, kind: 'lander' });
    if (report.storm) moments.push({ at: 0.38, kind: 'storm' });
    if (report.built) moments.push({ at: 0.74, kind: 'built' });
    if (report.after.fuel >= 100 && report.before.fuel < 100) moments.push({ at: 0.86, kind: 'full' });
    moments.sort((a, b) => a.at - b.at);
    let momentsFired = 0;
    await new Promise<void>((resolve) => {
      const tick = (now: number) => {
        // The player left mid-sol (back to the title, or tapped out of the demo): stop drawing.
        if (this.phase !== 'running' || this.mission !== m) return resolve();
        let t = Math.min(1, (now - start) / duration);
        if (this.ff) t = 1;
        this.stage.setTimeOfDay(site === 'moon' ? moonSky(m, m.sol, t) : t);
        const mins = Math.floor((6 * 60 + t * hours * 60) % (24 * 60));
        clock.textContent = `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
        fill.style.width = `${t * 100}%`;
        while (fired < beats.length && beats[fired].at <= t) {
          const ev = beats[fired++];
          logLine.textContent = ev.text;
          if (ev.cue) this.stage.cue?.(ev.cue);
          if (ev.storm) {
            this.stage.storm(ev.storm);
            this.audio.sfx('storm');
          }
        }
        // Skipping to the end shows only the last big moment, not a pile of them.
        if (t >= 1 && momentsFired < moments.length - 1) momentsFired = moments.length - 1;
        while (momentsFired < moments.length && moments[momentsFired].at <= t) this.solMoment(m, report, moments[momentsFired++].kind);
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
    if (this.phase !== 'running' || this.mission !== m) return;

    this.mission = next;
    emitGame('sol', { before: m, after: next, report, mode: this.mode ?? 'quick', demo: this.demoActive });
    this.trackStreak(report, next);
    if (report.built) this.audio.sfx('good');
    this.save();
    this.showDebrief(report, true);
  }

  private showDebrief(report: SolReport, fresh = false) {
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
        ...this.solFlair(report, fresh),
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
      { label: `${t.Turn} ${report.sol} debrief`, autoRead: true },
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
        if (!this.demoActive) await runInterstitial('launch', this.interstitialContext());
        this.audio.playMusic('launch');
        this.audio.sfx('win');
        await this.stage.launch();
      }
      if (this.mode === 'campaign' && this.campaign) {
        this.campaign = finishExpedition(this.campaign, m);
        this.save();
      }
      emitGame('mission-end', { mission: m, won, mode: this.mode ?? 'quick', stars: starsFor(m), demo: this.demoActive });
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
        this.scorePanel(m, first),
        won
          ? h(
              'p',
              null,
              siteOf(m.config) === 'moon'
                ? `The Moon's escape velocity is about ${REAL.moonEscapeKms.toFixed(1)} km/s: the speed your rocket needs to break free of the Moon's gravity. On Mars it is about ${REAL.marsEscapeKms.toFixed(1)} km/s.`
                : `Mars' escape velocity is about ${REAL.marsEscapeKms.toFixed(1)} km/s: the speed your rocket needs to break free of Mars' gravity.`,
            )
          : null,
        won && siteOf(m.config) !== 'moon' && this.mode !== 'history' ? tripHomeLine(this.mode === 'campaign' ? m.config.expedition : 1) : null,
        crewSays(m.config.expedition, won),
        this.mode !== 'history' ? starRow(stars) : null,
        this.mode !== 'history' ? classCodeLine(this.campaign?.classCode) : null,
        this.mode !== 'history' ? classBoard.card(this.campaign?.classCode) : null,
        this.mode === 'daily' && this.daily ? dailyEndPanel(this.daily, m) : null,
        // Play again (or the next crew) right under the score, then other modes to try; the full story follows.
        h(
          'div',
          { class: 'actions end-actions' },
          isCampaign && !last ? h('button', { class: 'btn primary play-again', 'data-autofocus': true, onclick: () => this.showInterlude() }, 'Send the next crew', h('span', { class: 'arrow' })) : null,
          isCampaign && last ? h('button', { class: 'btn primary', 'data-autofocus': true, onclick: () => this.showFinale() }, 'See your base', h('span', { class: 'arrow' })) : null,
          won
            ? h(
                'button',
                { class: 'btn cyan', onclick: () => this.showCertificate(certForMission(m, { campaign: isCampaign ? this.campaign : null, history: this.mode === 'history' })) },
                'Get my certificate',
              )
            : null,
          isCampaign ? h('button', { class: 'btn', onclick: () => this.retryExpedition() }, 'Try this crew again') : null,
          !isCampaign
            ? h(
                'button',
                { class: 'btn primary play-again', 'data-autofocus': true, onclick: () => (this.mode === 'history' ? (this.shortDemo ? this.startShortDemo() : this.startHistory()) : this.mode === 'daily' ? void this.startDaily() : this.startQuick()) },
                'Play again',
              )
            : null,
          !isCampaign ? h('button', { class: 'btn', onclick: () => this.chooseDifficulty() }, 'Start a campaign') : null,
          h('button', { class: 'btn', onclick: () => this.showTitle() }, 'Title screen'),
        ),
        isCampaign && !last ? null : this.tryNext(m),
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
        moon ? null : h('button', { class: 'btn small cyan', onclick: () => this.showPlanner(() => this.showInterlude()) }, 'Why 26 months? Open the trip planner'),
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
    if (this.phase !== 'finale' && !this.demoActive) emitGame('campaign-complete', { campaign: c });
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
          h('button', { class: 'btn cyan', onclick: () => this.showCertificate(certForCampaign(c)) }, 'Get my certificate'),
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
