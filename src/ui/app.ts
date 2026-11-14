// Written with AI assistance (Claude Code). See README "Use of AI tools".
// Game flow: title -> (briefing -> budget -> run -> debrief) x N sols -> launch or early return.

import { h, clear, $, fmt1, prefersReducedMotion, type Child } from './dom';
import { icon } from './icons';
import { renderHud } from './hud';
import { BudgetDock } from './budget';
import { GameAudio } from './audio';
import { createMission, emptyAlloc, getBriefing, previewSol, runSol, windowSol, checkAlloc } from '../sim/sim';
import { explainSol, endingFor, eventName, eventDate, type Debrief } from '../sim/explain';
import { REAL, TUNING, SUN_EARTH_LIGHT_MIN, EARTH_PROCESSING_MIN, type Difficulty } from '../sim/constants';
import type { Allocation, Briefing, CrateId, MissionConfig, MissionState, Snapshot, SolReport, SpaceWeatherEvent } from '../sim/types';
import { earthMarsLightTime, type LightTime } from '../data/lighttime';
import { loadSpaceWeather, buildEventPool, may2024Pool, countByClass, earthStormsOn, type SpaceWeatherFeed, MAY2024_SNAPSHOT } from '../data/donki';
import { MAY2024_START } from '../sim/plan';
import { factFor, FACTS, type ScienceFact } from '../data/science';
import type { Stage } from '../render/stage';
import { RADLAB_ISS, RADLAB_ISS_MAY2024 } from '../data/radlab';
import { renderScienceLog } from './sciencelog';
import { renderCredits } from './credits';

type Phase = 'title' | 'briefing' | 'plan' | 'running' | 'debrief' | 'end';

interface Settings {
  muted: boolean;
  reducedMotion: boolean;
}

function loadSettings(): Settings {
  const base = { muted: false, reducedMotion: prefersReducedMotion() };
  try {
    const raw = localStorage.getItem('ev-settings');
    return raw ? { ...base, ...JSON.parse(raw) } : base;
  } catch {
    return base;
  }
}
function saveSettings(s: Settings) {
  try {
    localStorage.setItem('ev-settings', JSON.stringify(s));
  } catch {
    /* private mode: fine */
  }
}

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
  private mission: MissionState | null = null;
  private alloc: Allocation = emptyAlloc();
  private crate: CrateId | undefined;
  private lastReport: SolReport | null = null;
  private ff = false;

  constructor(stage: Stage) {
    this.stage = stage;
    this.stage.mount(this.stageEl);
    this.audio = new GameAudio(this.settings.muted);
    this.applyMotion();
    this.budget = new BudgetDock(this.dock, {
      onChange: (a) => {
        this.alloc = a;
        this.renderPlan();
      },
      onRun: () => this.run(),
      sfx: (n) => this.audio.sfx(n),
    });
    this.feedReady = loadSpaceWeather().then((f) => {
      this.feed = f;
      if (this.phase === 'title') this.showTitle();
    });
    window.addEventListener('keydown', (e) => this.onKey(e));
    this.showTitle();
  }

  // ------------------------------------------------------------------ helpers
  private applyMotion() {
    document.documentElement.classList.toggle('reduce-motion', this.settings.reducedMotion);
    this.stage.setReducedMotion(this.settings.reducedMotion);
  }

  private modal(content: Child, opts: { wide?: boolean; label: string; onClose?: () => void } = { label: 'Dialog' }) {
    clear(this.modalRoot);
    const box = h(
      'div',
      { class: `modal ${opts.wide ? 'wide' : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': opts.label },
      opts.onClose ? h('button', { class: 'btn small icon-only close-x', 'aria-label': 'Close', onclick: opts.onClose }, 'X') : null,
      content,
    );
    this.modalRoot.append(box);
    const focusable = box.querySelector<HTMLElement>('[data-autofocus]') ?? box.querySelector<HTMLElement>('button.primary, button.go, button');
    focusable?.focus();
    return box;
  }

  private closeModal() {
    clear(this.modalRoot);
  }

  private dataBadge(): HTMLElement {
    const f = this.feed;
    let text: string;
    if (f.status === 'live') {
      const t = new Date(f.fetchedAt ?? Date.now()).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
      text = `LIVE from NASA DONKI · fetched ${t}`;
    } else if (f.status === 'archive' && f.snapshot) {
      text = `ARCHIVE · real DONKI data ${shortRange(f.snapshot.startDate, f.snapshot.endDate)}`;
    } else if (f.status === 'none' && f.error) {
      text = 'NO SPACE-WEATHER DATA · offline';
    } else {
      text = 'Checking NASA DONKI...';
    }
    if (this.mission?.config.scenario === 'may2024' && MAY2024_SNAPSHOT) text = 'ARCHIVE · real DONKI data from May 2024';
    return h(
      'button',
      {
        class: `data-badge ${this.mission?.config.scenario === 'may2024' ? 'archive' : f.status}`,
        title: 'Where the space-weather data comes from',
        onclick: () => this.showScienceLog(),
      },
      h('span', { class: 'dot' }),
      text,
    );
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
        now: { air: m.air, food: m.food, dose: m.dose, fuel: m.fuel },
        next,
        doseBudget: m.doseBudget,
      },
      this.hudButtons(),
    );
  }

  private onKey(e: KeyboardEvent) {
    if (e.key === 'Escape' && this.modalRoot.firstChild && this.phase !== 'briefing' && this.phase !== 'debrief' && this.phase !== 'title' && this.phase !== 'end') {
      this.closeModal();
    }
    if (this.phase === 'running' && (e.key === 'f' || e.key === 'F')) this.ff = true;
  }

  // ------------------------------------------------------------------ title
  showTitle() {
    this.phase = 'title';
    this.mission = null;
    clear(this.dock);
    this.refreshHud();
    this.audio.playMusic('title');
    const lt = this.light;
    const pool = buildEventPool(this.feed);
    const counts = this.feed.snapshot ? countByClass(this.feed.snapshot) : null;
    this.modal(
      h(
        'div',
        { class: 'title-screen' },
        h('div', { class: 'art' }, h('img', { src: '/art/title.png', alt: 'A tiny outpost on Mars with a rocket on its launch pad (AI-generated art)' })),
        h('h1', null, 'Escape Velocity'),
        h('p', { class: 'tagline' }, 'Command a tiny outpost on Mars. Make air to breathe and oxygen for your rocket, then blast home.'),
        h(
          'div',
          { class: 'menu' },
          h('button', { class: 'btn primary', 'data-autofocus': true, onclick: () => this.start('cadet') }, 'Start mission', h('span', { class: 'arrow' })),
          h(
            'div',
            { class: 'menu-row' },
            h('button', { class: 'btn', onclick: () => this.start('commander') }, 'Commander'),
            h('button', { class: 'btn cyan', onclick: () => this.start('cadet', 'may2024'), disabled: MAY2024_SNAPSHOT ? undefined : true }, 'May 2024 storms'),
          ),
          h(
            'div',
            { class: 'menu-row' },
            h('button', { class: 'btn small', onclick: () => this.showHowTo(() => this.showTitle()) }, 'How to play'),
            h('button', { class: 'btn small', onclick: () => this.showScienceLog() }, 'Science Log'),
          ),
          h('button', { class: 'btn small', onclick: () => this.showCredits() }, 'Credits and AI use'),
        ),
        h(
          'p',
          { class: 'title-foot' },
          `Today Mars is about ${Math.round(lt.distanceKm / 1e6)} million km from Earth, so messages take about ${Math.round(lt.oneWayMinutes)} minutes to arrive (approximate). `,
          counts
            ? `${this.feed.status === 'live' ? 'Live' : 'Archived'} NASA data: ${counts.X} X-class and ${counts.M} M-class solar flares in the last 30 days.`
            : pool.length
              ? ''
              : 'Space-weather data is not available right now; storms will be quiet.',
        ),
      ),
      { label: 'Escape Velocity title screen' },
    );
  }

  showHowTo(back: () => void) {
    this.modal(
      [
        h('div', { class: 'kicker' }, 'How to play'),
        h('h2', null, 'One turn = one sol (a Mars day)'),
        h(
          'ol',
          { class: 'clean' },
          h('li', null, h('b', null, 'Read the morning briefing. '), 'Weather, power, and messages from Earth (they arrive late).'),
          h('li', null, h('b', null, 'Place your power cells. '), 'Drag them onto modules, or tap a slot. Every cell must go somewhere, and every choice costs something.'),
          h('li', null, h('b', null, 'Watch the sol play out. '), 'Your crew breathes, eats, and the Sun does what the Sun does.'),
          h('li', null, h('b', null, 'Read the debrief. '), 'See what your choices caused, then plan the next sol.'),
        ),
        h(
          'div',
          { class: 'card' },
          h('b', null, 'The big trade-off: '),
          'your O2 plant makes the air your crew breathes AND the oxygen your rocket needs to fly home. Every cell you spend on heat, food or shelter is a cell that is not filling the fuel tank.',
        ),
        h(
          'div',
          { class: 'card' },
          h('b', null, 'Win: '),
          'fill the fuel tank before the launch window closes. ',
          h('b', null, 'Mission over: '),
          'if air or food runs out, or the crew\'s radiation dose goes over budget.',
        ),
        h('div', { class: 'actions end' }, h('button', { class: 'btn primary', onclick: back }, 'Got it')),
      ],
      { label: 'How to play' },
    );
  }

  showScienceLog() {
    const prev = this.phase;
    const back = () => {
      if (prev === 'title') this.showTitle();
      else this.resume();
    };
    this.modal(renderScienceLog({ feed: this.feed, light: this.light, difficulty: this.mission?.config.difficulty ?? 'cadet' }), {
      wide: true,
      label: 'Science Log',
      onClose: back,
    });
  }

  showCredits() {
    const prev = this.phase;
    this.modal(renderCredits(), {
      wide: true,
      label: 'Credits',
      onClose: () => (prev === 'title' ? this.showTitle() : this.resume()),
    });
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
        ),
        h(
          'div',
          { class: 'actions' },
          h('button', { class: 'btn primary', onclick: () => this.resume() }, 'Resume'),
          h('button', { class: 'btn', onclick: () => this.showHowTo(() => this.resume()) }, 'How to play'),
          h('button', { class: 'btn', onclick: () => this.showScienceLog() }, 'Science Log'),
          h('button', { class: 'btn', onclick: () => this.showCredits() }, 'Credits'),
          h('button', { class: 'btn', onclick: () => this.showTitle() }, 'Quit to title'),
        ),
        this.mission ? h('p', { class: 'title-foot' }, `Mission seed: ${this.mission.config.seed} (${this.mission.config.difficulty})`) : null,
      ],
      { label: 'Menu', onClose: () => this.resume() },
    );
  }

  private resume() {
    this.closeModal();
    if (this.phase === 'briefing') this.showBriefing();
    else if (this.phase === 'debrief' && this.lastReport) this.showDebrief(this.lastReport);
    else if (this.phase === 'end') this.showEnd();
    else if (this.phase === 'title') this.showTitle();
  }

  // ------------------------------------------------------------------ mission
  private async start(difficulty: Difficulty, scenario?: 'may2024') {
    this.audio.sfx('click');
    await Promise.race([this.feedReady, new Promise((r) => setTimeout(r, 2500))]);
    const params = new URLSearchParams(location.search);
    const seed = params.get('seed') ?? Math.random().toString(36).slice(2, 8);
    const config: MissionConfig = {
      seed,
      difficulty,
      lightTimeMin: this.light.oneWayMinutes,
      eventPool: scenario === 'may2024' ? may2024Pool() : buildEventPool(this.feed),
      scenario,
    };
    this.mission = createMission(config);
    this.audio.playMusic('mission');
    this.showBriefing();
  }

  private showBriefing() {
    const m = this.mission!;
    this.phase = 'briefing';
    this.alloc = emptyAlloc();
    this.crate = undefined;
    const b = getBriefing(m);
    this.stage.setScene({ sol: m.sol, weather: b.weather, alloc: this.alloc, fuel: m.fuel, sheltered: false });
    this.stage.setTimeOfDay(0.02);
    clear(this.dock);
    this.refreshHud();
    if (b.warning) this.audio.sfx('alarm');

    const art = briefingArt(b);
    const cards: HTMLElement[] = [];
    cards.push(
      h(
        'div',
        { class: `card ${b.weather !== 'clear' ? 'event' : ''}` },
        icon(b.weather === 'clear' ? 'sun' : 'dust', 20),
        ' ',
        h('b', null, weatherLine(b)),
        ` Your solar panels make `,
        h('b', null, `${b.cells} power cells`),
        ' today.',
        b.powerNotes.length ? h('div', { class: 'title-foot', style: 'margin-top:4px' }, b.powerNotes.join(' · ')) : null,
      ),
    );
    if (m.config.scenario === 'may2024') {
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
    if (b.coldSnap) cards.push(h('div', { class: 'card event' }, icon('heater', 20), ' ', h('b', null, 'Extra-cold night ahead. '), 'The heaters need 2 cells tonight.'));
    if (b.dustTomorrow) cards.push(h('div', { class: 'card event' }, icon('dust', 20), ' ', h('b', null, 'Orbiters spot a dust storm coming. '), 'Tomorrow you will have less solar power.'));

    // Messages from Earth.
    const delay = `Messages from Earth take about ${Math.round(m.config.lightTimeMin)} minutes to reach you (approximate).`;
    if (b.outlook === 'none') {
      cards.push(h('div', { class: 'card danger' }, icon('antenna', 20), ' ', h('b', null, 'No messages from Earth. '), 'The Sun is between Earth and Mars (solar conjunction), so radio signals cannot get through. Only your own radiation monitor can warn you now.'));
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
            ? `forecasters say the Sun is active${region ? ` (sunspot region ${region} is busy)` : ''}. A solar storm could come in the next few sols.`
            : 'forecasters say the Sun looks quiet for now.',
          h('div', { class: 'title-foot', style: 'margin-top:4px' }, delay),
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
          h('b', null, w.source === 'monitor' ? 'YOUR MONITOR: particle levels are climbing! ' : `MESSAGE FROM EARTH (sent ${Math.round(m.config.lightTimeMin)} min ago): `),
          'a radiation storm will hit the outpost today. Power the storm shelter to protect your crew.',
          eventCard(w.event),
        ),
      );
    }
    if (b.monitorOnline && !b.warning) cards.push(h('div', { class: 'card good' }, icon('monitor', 20), ' ', h('b', null, 'Your monitor: '), 'no storm particles on the way today.'));

    let crateRow: HTMLElement | null = null;
    if (b.resupply) {
      const crates: Array<[CrateId, string, string]> = [
        ['food', 'Food crates', '+3 days of food'],
        ['parts', 'Spare parts', 'Repair 1 damaged battery and reset wear'],
        ['panel', 'Solar panel', '+1 power cell every sol from tomorrow'],
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
                  this.showBriefing2(art, cards, crateRow);
                },
              },
              h('b', null, name),
              h('span', null, desc),
            ),
          ),
        ),
      );
    }
    this.showBriefing2(art, cards, crateRow);
  }

  private showBriefing2(art: string, cards: HTMLElement[], crateRow: HTMLElement | null) {
    const m = this.mission!;
    const b = getBriefing(m);
    // Re-render crate pressed state.
    crateRow?.querySelectorAll<HTMLButtonElement>('.crate').forEach((btn, i) => {
      btn.setAttribute('aria-pressed', String((['food', 'parts', 'panel'] as const)[i] === this.crate));
    });
    const needCrate = b.resupply && !this.crate;
    this.modal(
      [
        h('div', { class: 'kicker' }, `Sol ${m.sol} of ${windowSol(m)} · Morning briefing`),
        h('div', { class: 'art' }, h('img', { src: `/art/${art}.png`, alt: 'Illustration of today\'s conditions (AI-generated)' })),
        ...cards,
        crateRow,
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
      { label: `Sol ${m.sol} morning briefing` },
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
    this.stage.setScene({ sol: m.sol, weather: b.weather, alloc: this.alloc, fuel: m.fuel, sheltered: this.alloc.shelter > 0 });
    this.budget.set(m, b, this.alloc, preview, briefMini(m, b, check.remaining));
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
    const { next, report } = runSol(m, this.alloc, this.crate);
    this.lastReport = report;

    // Play the sol out.
    clear(this.dock);
    const clock = h('div', { class: 'clock' }, '06:00');
    const fill = h('div', { class: 'fill', style: 'width:0%' });
    const logLine = h('div', { class: 'run-log', 'aria-live': 'polite' }, 'Sunrise at the outpost.');
    const ffBtn = h('button', { class: 'btn small', onclick: () => (this.ff = true) }, 'Skip', h('span', { class: 'arrow' }));
    this.dock.append(h('div', { class: 'run-bar' }, clock, h('div', { class: 'bar' }, fill), ffBtn), logLine);
    this.ff = false;
    const duration = this.settings.reducedMotion ? 1800 : 4200;
    const start = performance.now();
    const events = runBeats(report);
    let fired = 0;
    await new Promise<void>((resolve) => {
      const tick = (now: number) => {
        let t = Math.min(1, (now - start) / duration);
        if (this.ff) t = 1;
        this.stage.setTimeOfDay(t);
        const mins = Math.floor((6 * 60 + t * 24.66 * 60) % (24 * 60));
        clock.textContent = `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
        fill.style.width = `${t * 100}%`;
        while (fired < events.length && events[fired].at <= t) {
          const ev = events[fired++];
          logLine.textContent = ev.text;
          if (ev.storm) {
            this.stage.storm(ev.storm);
            this.audio.sfx('storm');
          }
        }
        // Meters glide from before to after.
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
          },
          this.hudButtons(),
        );
        if (t < 1) requestAnimationFrame(tick);
        else resolve();
      };
      requestAnimationFrame(tick);
    });

    this.mission = next;
    this.showDebrief(report);
  }

  private showDebrief(report: SolReport) {
    const m = this.mission!;
    this.phase = 'debrief';
    clear(this.dock);
    this.refreshHud();
    const d: Debrief = explainSol(report);
    this.audio.sfx(d.tone === 'good' ? 'good' : d.tone === 'bad' ? 'bad' : 'click');
    const fact =
      m.config.scenario === 'may2024' && report.storm?.event.kind === 'cme' ? FACTS[0] : factFor(d.topic, report.sol + m.config.seed.length);
    const over = m.status !== 'playing';
    this.modal(
      [
        h('div', { class: 'kicker' }, `Sol ${report.sol} · Debrief`),
        h('p', { class: `headline tone-${d.tone}`, 'aria-live': 'polite' }, d.headline),
        report.storm ? eventCard(report.storm.event, report.storm.lateByMin ? { lateBy: report.storm.lateByMin, lightMin: m.config.lightTimeMin } : undefined) : null,
        d.details.length ? h('ul', { class: 'clean' }, d.details.map((x) => h('li', null, x))) : null,
        scienceCard(fact),
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
                if (over) this.showEnd();
                else this.showBriefing();
              },
            },
            over ? (m.status === 'won' ? 'Launch!' : 'See what happened') : `Start sol ${m.sol}`,
            h('span', { class: 'arrow' }),
          ),
        ),
      ],
      { label: `Sol ${report.sol} debrief` },
    );
  }

  private async showEnd() {
    const m = this.mission!;
    this.phase = 'end';
    clear(this.dock);
    this.refreshHud();
    if (m.status === 'won') {
      this.closeModal();
      this.audio.playMusic('launch');
      this.audio.sfx('win');
      await this.stage.launch();
    }
    const end = endingFor(m);
    const won = m.status === 'won';
    this.modal(
      [
        h('div', { class: 'art' }, h('img', { src: won ? '/art/launch.png' : '/art/lose.png', alt: won ? 'The rocket launches from Mars (AI-generated art)' : 'The crew boards a lander to head home (AI-generated art)' })),
        h('div', { class: 'kicker' }, won ? `Mission complete · ${m.config.difficulty}` : `Mission over · ${m.config.difficulty}`),
        h('h2', { class: won ? 'tone-good' : '' }, end.title),
        won ? h('p', null, `Mars' escape velocity is about ${REAL.marsEscapeKms.toFixed(1)} km/s: the speed your rocket needs to break free of Mars' gravity.`) : null,
        h('h3', null, 'What happened'),
        h('ul', { class: 'clean' }, end.happened.map((x) => h('li', null, x))),
        h('div', { class: 'card good' }, h('b', null, won ? 'Next challenge: ' : 'Try this next time: '), end.tip),
        compareCard(m),
        end.badges.length
          ? [h('h3', null, 'Badges'), h('div', { class: 'badges' }, end.badges.map((b) => h('div', { class: 'badge' }, h('b', null, b.name), h('span', null, b.why))))]
          : null,
        h(
          'div',
          { class: 'actions' },
          h('button', { class: 'btn primary', 'data-autofocus': true, onclick: () => this.start(m.config.difficulty, m.config.scenario) }, 'Play again'),
          h('button', { class: 'btn', onclick: () => this.showTitle() }, 'Title screen'),
          h('button', { class: 'btn', onclick: () => this.showScienceLog() }, 'Science Log'),
        ),
        h('p', { class: 'title-foot' }, `Seed ${m.config.seed} · difficulty ${m.config.difficulty} · dose budget ${TUNING[m.config.difficulty].doseBudget} mSv (game value)`),
      ],
      { label: won ? 'Mission complete' : 'Mission over' },
    );
  }
}

// ------------------------------------------------------------------ pure-ish view helpers

function shortRange(a: string, b: string) {
  const f = (s: string) => new Date(`${s}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  return `${f(a)} to ${f(b)}`;
}

function weatherLine(b: Briefing) {
  if (b.weather === 'storm') return 'A huge dust storm is blocking the Sun!';
  if (b.weather === 'dusty') return 'Dust storm: the sky is hazy.';
  return 'Clear skies.';
}

function briefingArt(b: Briefing): string {
  if (b.warning) return 'event-flare';
  if (b.outlook === 'none') return 'event-blackout';
  if (b.resupply) return 'event-resupply';
  if (b.weather !== 'clear') return 'event-dust';
  if (b.powerNotes.some((n) => n.startsWith('Wind'))) return 'event-cleaning';
  if (b.coldSnap) return 'event-cold';
  return 'title';
}

function upcomingRegion(m: MissionState): number | null {
  for (let s = m.sol; s <= m.sol + 3 && s <= m.plan.length; s++) {
    const r = m.plan[s - 1].storm?.event.activeRegionNum;
    if (r) return r;
  }
  return null;
}

function briefMini(m: MissionState, b: Briefing, remaining: number): HTMLElement[] {
  const lines: HTMLElement[] = [];
  lines.push(h('div', { class: 'line px' }, `SOL ${m.sol} PLAN`));
  if (b.warning) lines.push(h('div', { class: 'line bad' }, icon('radiation', 16), 'Storm today: power the shelter!'));
  else if (b.outlook === 'active') lines.push(h('div', { class: 'line warn' }, icon('sun', 16), 'Sun is active: storms possible.'));
  else if (b.outlook === 'none') lines.push(h('div', { class: 'line warn' }, icon('antenna', 16), 'No messages from Earth.'));
  if (b.coldSnap) lines.push(h('div', { class: 'line warn' }, icon('heater', 16), 'Cold night: heaters need 2.'));
  if (b.weather !== 'clear') lines.push(h('div', { class: 'line warn' }, icon('dust', 16), 'Dusty: less power.'));
  if (m.air < 2) lines.push(h('div', { class: 'line bad' }, icon('air', 16), `Air is low (${fmt1(m.air)} days).`));
  if (m.food < 2) lines.push(h('div', { class: 'line bad' }, icon('food', 16), `Food is low (${fmt1(m.food)} days).`));
  lines.push(h('div', { class: 'line' }, icon('cell', 16), remaining > 0 ? `${remaining} cell${remaining === 1 ? '' : 's'} left` : 'All cells placed'));
  return lines;
}

function eventCard(e: SpaceWeatherEvent, late?: { lateBy: number; lightMin: number }): HTMLElement {
  const where = e.activeRegionNum ? ` from sunspot region ${e.activeRegionNum}` : '';
  const what =
    e.kind === 'flare'
      ? `${article(eventName(e))} erupted${where} on ${eventDate(e)}.`
      : e.kind === 'cme'
        ? `${article(eventName(e))} blasted off the Sun on ${eventDate(e)}.`
        : `A solar particle storm was recorded on ${eventDate(e)}.`;
  return h(
    'div',
    { class: 'card event' },
    h('span', { class: `tag ${e.origin}` }, e.origin === 'live' ? 'LIVE' : 'ARCHIVE'),
    h('span', { class: 'tag real' }, 'REAL EVENT'),
    h('div', { style: 'margin-top:6px' }, what, e.linkedSep ? ' NASA also recorded a burst of fast particles from it.' : ''),
    e.note ? h('div', { class: 'title-foot' }, h('span', { class: 'tag game' }, 'NOTE'), e.note) : null,
    late
      ? h(
          'div',
          { class: 'title-foot' },
          `Why the warning was late: light from the flare took ${Math.round(SUN_EARTH_LIGHT_MIN)} minutes to reach Earth, forecasters needed about ${EARTH_PROCESSING_MIN} minutes to check it, and their message took ${Math.round(late.lightMin)} more minutes to reach Mars. The fastest particles got there about ${late.lateBy} minutes before the warning (game estimate).`,
        )
      : null,
    h('div', { class: 'title-foot' }, 'Source: NASA DONKI (Space Weather Database). ', e.link ? h('a', { href: e.link, target: '_blank', rel: 'noopener' }, 'See the record') : null),
  );
}

function article(name: string) {
  return /^[AEFHILMNORSX]/.test(name) ? `An ${name}` : `A ${name}`;
}

function scienceCard(f: ScienceFact): HTMLElement {
  return h(
    'details',
    { class: 'science' },
    h('summary', { class: 'kicker', style: 'cursor:pointer' }, `Real Science: ${f.title}`),
    f.art ? h('div', { class: 'art', style: 'margin-top:8px' }, h('img', { src: `/art/${f.art}.png`, alt: `${f.title} (AI-generated illustration)`, loading: 'lazy' })) : null,
    h('p', null, f.body),
    h('div', { class: 'src' }, 'Source: ', h('a', { href: f.url, target: '_blank', rel: 'noopener' }, f.source)),
  );
}

interface Beat {
  at: number;
  text: string;
  storm?: number;
}

function runBeats(r: SolReport): Beat[] {
  const beats: Beat[] = [{ at: 0, text: 'Sunrise. The solar panels wake up.' }];
  const on = (id: keyof Allocation) => r.alloc[id] > 0;
  if (on('fuel')) beats.push({ at: 0.12, text: `The O2 plant hums: ${r.alloc.fuel} cell${r.alloc.fuel === 1 ? '' : 's'} filling the rocket.` });
  if (on('greenhouse')) beats.push({ at: 0.22, text: 'The greenhouse glows under its grow lights.' });
  if (r.storm) {
    beats.push({
      at: 0.38,
      text: r.storm.shelterCells ? 'SOLAR STORM! The crew is safe in the shelter.' : 'SOLAR STORM! Fast particles rain down on the outpost.',
      storm: r.storm.shelterCells >= 2 ? 0.4 : 1,
    });
  }
  if (r.weather !== 'clear') beats.push({ at: 0.3, text: 'Dust dims the sky. The panels struggle.' });
  beats.push({ at: 0.5, text: 'Sunset. Mars sunsets are blue!' });
  beats.push({ at: 0.62, text: r.heaterShortfall ? 'Night falls. It is freezing, and the heaters are short of power...' : 'Night falls. The heaters keep the batteries warm.' });
  if (r.alloc.monitor) beats.push({ at: 0.8, text: 'The radiation monitor watches the Sun.' });
  beats.push({ at: 0.97, text: 'A new sol begins.' });
  return beats.sort((a, b) => a.at - b.at);
}

/** Real radiation comparison: ISS (NASA OSDR RadLab) vs. Mars surface vs. the May 2024 storm (Curiosity RAD). */
function compareCard(m: MissionState): HTMLElement | null {
  const iss = m.config.scenario === 'may2024' ? (RADLAB_ISS_MAY2024 ?? RADLAB_ISS) : RADLAB_ISS;
  if (!iss) return null;
  const rows: Array<[string, number, string]> = [
    [`A day on the ISS (${shortRange(iss.startDate, iss.endDate)})`, iss.meanDoseRatePerDay, 'var(--air)'],
    ['A normal day at Gale Crater, Mars', REAL.marsSurfaceUgyPerDay, 'var(--oxide)'],
    ['The May 20, 2024 storm at Gale Crater', REAL.may2024EventUgy, 'var(--red)'],
  ];
  const max = Math.max(...rows.map((r) => r[1]));
  const sols = m.log.length;
  return h(
    'div',
    { class: 'card' },
    h('div', { class: 'kicker' }, 'Real data: how much radiation?'),
    rows.map(([label, v, color]) =>
      h(
        'div',
        { style: 'margin:6px 0' },
        h('div', { style: 'display:flex; justify-content:space-between; gap:8px; font-size:15px' }, h('span', null, label), h('b', { class: 'px' }, `${Math.round(v).toLocaleString('en-US')} µGy`)),
        h('div', { class: 'bar' }, h('div', { class: 'fill', style: `width:${Math.max(1.5, (v / max) * 100)}%; background:${color}` })),
      ),
    ),
    h(
      'p',
      { style: 'margin-top:8px' },
      `Your crew spent ${sols} sol${sols === 1 ? '' : 's'} on Mars. From the steady background alone, that is about ${(sols * REAL.marsSurfaceUgyPerDay).toLocaleString('en-US')} micrograys: similar to ${sols} days on the ISS. One big solar storm adds as much as ${Math.round(REAL.may2024EventUgy / REAL.marsSurfaceUgyPerDay)} normal days at once. That's why shelters and early warnings matter.`,
    ),
    h(
      'div',
      { class: 'title-foot' },
      'µGy (microgray) measures radiation energy absorbed by a detector. ISS: DOSTEL detector, NASA OSDR RadLab (archived readings). Mars: Curiosity RAD (Hassler et al. 2014; NASA/JPL 2024).',
    ),
  );
}
