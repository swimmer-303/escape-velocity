// Written with AI assistance (Claude Code). See README "Use of AI tools".
// Space Lab screens: the lab itself (six dials with live readouts, the fair-test switch, a hypothesis and Run), the
// Lab Notebook, the result card on the end screen, the Settings dialog section and the HUD badge. The 3D base behind
// the lab reacts as the dials move (the world, dust in the sky, the Sun's brightness, how many astronauts walk about).

import './lab.css';
import { h } from '../../ui/dom';
import { metaContext, type MetaContext } from '../hooks';
import { emptyAlloc } from '../../sim/sim';
import { emptyLevels } from '../../sim/upgrades';
import { earthMarsLightTime, heliocentric } from '../../data/lighttime';
import {
  DUST_LEVELS,
  DUST_TAU,
  LAB_CREW,
  LAB_DELAY,
  LAB_WORLDS,
  ORBIT_LEVELS,
  SUN_LEVELS,
  changedDials,
  defaultLab,
  isMarsLab,
  labLanding,
  labSite,
  labStageLook,
  sanitizeLab,
  type Hypothesis,
  type LabSettings,
  type RunSummary,
} from '../../sim/lab';
import {
  DUST_NAME,
  ORBIT_NAME,
  PERI_APH_PCT,
  SUN_NAME,
  WORLD_NAME,
  changesList,
  crewReadout,
  delayReadout,
  dustReadout,
  oneAtATimeNote,
  orbitReadout,
  quickStartFor,
  scienceLine,
  summaryLine,
  sunReadout,
  worldReadout,
} from './experiment';
import { LAB_XP, LAB_XP_PER_DAY, NOTEBOOK_MAX, loadSave, newSeed, storeSave, type LabSave, type NotebookEntry } from './store';

export const LAB_LABEL = 'Space Lab';
export const NOTEBOOK_LABEL = 'Lab Notebook';
/** The one-line reward rule, shown on the lab screen. */
export const REWARD_RULE = `Lab missions are for learning: no stars, races, daily board or season. Each finished experiment gives ${LAB_XP} XP, up to ${LAB_XP_PER_DAY} a day.`;

const HYPOTHESIS_WORDS: Record<Hypothesis, string> = { sooner: 'launch sooner', later: 'launch later', not: 'not make it' };
const LOSE_WORDS: Record<string, string> = { air: 'ran out of air', food: 'ran out of food', dose: 'took too much radiation', window: 'the launch window closed' };

/** The hypothesis written down for the experiment now running (the end screen checks it). */
let pending: { hypothesis: Hypothesis | null } | null = null;
export function pendingHypothesis(): Hypothesis | null {
  return pending?.hypothesis ?? null;
}
export function setPending(hypothesis: Hypothesis | null): void {
  pending = { hypothesis };
}

// ------------------------------------------------------------------ pictures
const NS = 'http://www.w3.org/2000/svg';
const r = (x: number, y: number, w: number, hh: number, fill: string) => `<rect x="${x}" y="${y}" width="${w}" height="${hh}" fill="${fill}"/>`;
/** A pixel lab flask with a little planet bubbling out (12 x 12). Decoration only. */
export function flaskIcon(size = 48): SVGSVGElement {
  const el = document.createElementNS(NS, 'svg');
  el.setAttribute('viewBox', '0 0 12 12');
  el.setAttribute('width', String(size));
  el.setAttribute('height', String(size));
  el.setAttribute('shape-rendering', 'crispEdges');
  el.setAttribute('aria-hidden', 'true');
  el.setAttribute('focusable', 'false');
  el.innerHTML =
    r(4, 1, 4, 1, '#e9e3d6') +
    r(5, 2, 2, 3, '#e9e3d6') +
    r(4, 5, 4, 1, '#e9e3d6') +
    r(3, 6, 6, 1, '#e9e3d6') +
    r(2, 7, 8, 4, '#e9e3d6') +
    r(3, 7, 6, 3, '#5ef2e6') +
    r(3, 8, 6, 2, '#2fb8ad') +
    r(4, 8, 1, 1, '#ffffff') +
    r(7, 9, 1, 1, '#ffffff') +
    r(9, 0, 2, 2, '#c2562a') +
    r(10, 0, 1, 1, '#ffb627') +
    r(8, 3, 1, 1, '#5ef2e6');
  return el;
}

// ------------------------------------------------------------------ the 3D view
/** Show these settings on the 3D base behind the lab (does nothing if the stage has no 3D). */
export function previewOnStage(ctx: MetaContext, lab: LabSettings): void {
  const look = labStageLook(lab, 'clear');
  try {
    ctx.stage.setScene({
      sol: 0,
      weather: look.weather,
      labSun: look.labSun,
      alloc: emptyAlloc(),
      fuel: 0,
      sheltered: false,
      levels: emptyLevels(),
      crew: lab.crew,
      site: labSite(lab),
      landing: labLanding(lab),
    });
    ctx.stage.setTimeOfDay(0.22);
  } catch {
    /* the picture is a bonus: the lab works without it */
  }
}

// ------------------------------------------------------------------ controls
let uid = 0;

interface Slider<T> {
  el: HTMLElement;
  input: HTMLInputElement;
  set(v: T): void;
  disable(off: boolean): void;
}

/** A big slider over a few named steps (with clickable labels under it). Screen readers hear the step's name. */
function stepSlider<T extends string>(o: { label: string; levels: readonly T[]; names: Record<T, string>; value: T; describedBy: string; onChange: (v: T) => void }): Slider<T> {
  const id = `lab-in-${++uid}`;
  const input = h('input', {
    type: 'range',
    id,
    class: 'lab-range',
    min: 0,
    max: o.levels.length - 1,
    step: 1,
    value: o.levels.indexOf(o.value),
    'aria-describedby': o.describedBy,
    'aria-valuetext': o.names[o.value],
  }) as HTMLInputElement;
  const ticks = o.levels.map((lv, i) =>
    h('button', { type: 'button', class: 'lab-tick', tabindex: '-1', 'aria-hidden': 'true', 'data-i': i, onclick: () => pick(lv) }, o.names[lv]),
  );
  const tickRow = h('div', { class: `lab-ticks n${o.levels.length}` }, ticks);
  const set = (v: T) => {
    const i = o.levels.indexOf(v);
    input.value = String(i);
    input.setAttribute('aria-valuetext', o.names[v]);
    ticks.forEach((t, k) => t.classList.toggle('on', k === i));
  };
  const pick = (v: T) => {
    if (input.disabled) return;
    set(v);
    o.onChange(v);
  };
  input.addEventListener('input', () => pick(o.levels[Math.max(0, Math.min(o.levels.length - 1, Number(input.value)))]));
  set(o.value);
  return {
    el: h('div', { class: 'lab-control' }, h('label', { class: 'sr-only', for: id }, o.label), input, tickRow),
    input,
    set,
    disable(off) {
      input.disabled = off;
      tickRow.classList.toggle('off', off);
    },
  };
}

/** A big slider over whole numbers, with its value shown large beside it. */
function numberSlider(o: { label: string; min: number; max: number; value: number; unit: (n: number) => string; describedBy: string; onChange: (n: number) => void }): Slider<number> & { big: HTMLElement } {
  const id = `lab-in-${++uid}`;
  const big = h('span', { class: 'lab-big', 'aria-hidden': 'true' });
  const input = h('input', { type: 'range', id, class: 'lab-range', min: o.min, max: o.max, step: 1, value: o.value, 'aria-describedby': o.describedBy }) as HTMLInputElement;
  const set = (n: number) => {
    input.value = String(n);
    input.setAttribute('aria-valuetext', o.unit(n));
    big.textContent = o.unit(n);
  };
  input.addEventListener('input', () => {
    const n = Math.round(Number(input.value));
    set(n);
    o.onChange(n);
  });
  set(o.value);
  return {
    el: h(
      'div',
      { class: 'lab-control' },
      h('label', { class: 'sr-only', for: id }, o.label),
      h('div', { class: 'lab-num-row' }, input, big),
      h('div', { class: 'lab-ticks ends', 'aria-hidden': 'true' }, h('span', null, o.unit(o.min)), h('span', null, o.unit(o.max))),
    ),
    input,
    big,
    set,
    disable(off) {
      input.disabled = off;
    },
  };
}

function source(href: string, text: string): HTMLElement {
  return h('a', { href, target: '_blank', rel: 'noopener', class: 'lab-src' }, text);
}

/** One dial: a name, what it is in one sentence, the control, the live readout, and the real numbers with a source. */
function dialCard(o: { key: string; title: string; marsOnly?: boolean; what: string; control: HTMLElement; readout: HTMLElement; off: HTMLElement; facts: Array<string | HTMLElement> }): HTMLElement {
  return h(
    'section',
    { class: 'lab-dial', 'data-dial': o.key, 'aria-labelledby': `lab-h-${o.key}` },
    h('h3', { id: `lab-h-${o.key}` }, o.title, o.marsOnly ? h('span', { class: 'lab-tag' }, 'Mars only') : null),
    h('p', { class: 'lab-what' }, o.what),
    o.control,
    o.off,
    o.readout,
    h('details', { class: 'lab-facts' }, h('summary', null, 'The real numbers'), h('p', null, o.facts)),
  );
}

// ------------------------------------------------------------------ the lab
export function openLab(): void {
  const ctx = metaContext();
  if (!ctx) return;
  let save = loadSave();
  const todayMin = earthMarsLightTime().oneWayMinutes;
  const lab = () => save.settings;
  const persist = () => storeSave(save);

  const readouts = {
    world: h('p', { class: 'lab-readout', id: 'lab-ro-world' }),
    sun: h('p', { class: 'lab-readout', id: 'lab-ro-sun' }),
    orbit: h('p', { class: 'lab-readout', id: 'lab-ro-orbit' }),
    dust: h('p', { class: 'lab-readout', id: 'lab-ro-dust' }),
    delay: h('p', { class: 'lab-readout', id: 'lab-ro-delay' }),
    crew: h('p', { class: 'lab-readout', id: 'lab-ro-crew' }),
  };
  const none = () => h('span');
  const summary = h('p', { class: 'lab-summary' });
  // One polite announcement per change (the changed dial's readout), instead of six readouts talking at once.
  const announce = h('p', { class: 'sr-only', 'aria-live': 'polite' });
  const seedText = h('span', { class: 'lab-seed' });

  const update = (redraw3d = true) => {
    const l = lab();
    readouts.world.textContent = worldReadout(l);
    readouts.sun.textContent = sunReadout(l);
    readouts.orbit.textContent = orbitReadout(l);
    readouts.dust.textContent = dustReadout(l);
    readouts.delay.textContent = delayReadout(l, todayMin);
    readouts.crew.textContent = crewReadout(l);
    const mars = isMarsLab(l);
    orbit.disable(!mars);
    dust.disable(!mars);
    delay.disable(!mars);
    todayBtn.disabled = !mars || l.delayMin === null;
    // On the Moon the Mars-only dials go gray; their readouts say why ("Off on the Moon: ...").
    for (const k of ['orbit', 'dust', 'delay'] as const) dials.querySelector(`[data-dial="${k}"]`)?.classList.toggle('is-off', !mars);
    const n = changedDials(l).length;
    summary.textContent = n ? `${summaryLine(l)} ${n === 1 ? 'You changed 1 thing: a fair test.' : `You changed ${n} things.`}` : summaryLine(l);
    seedText.textContent = `Storm set: ${l.seed}`;
    resetBtn.disabled = n === 0;
    if (redraw3d) previewOnStage(ctx, l);
  };
  const change = (patch: Partial<LabSettings>) => {
    save = { ...save, settings: sanitizeLab({ ...save.settings, ...patch }) };
    persist();
    ctx.audio.sfx('place');
    update();
    const key = 'world' in patch ? 'world' : 'sun' in patch ? 'sun' : 'orbit' in patch ? 'orbit' : 'dust' in patch ? 'dust' : 'delayMin' in patch ? 'delay' : 'crew' in patch ? 'crew' : null;
    announce.textContent = key ? readouts[key].textContent : summary.textContent;
  };

  // World: three real places, as big radio buttons.
  const worldGroup = h(
    'div',
    { class: 'lab-seg', role: 'radiogroup', 'aria-label': 'World', 'aria-describedby': 'lab-ro-world' },
    LAB_WORLDS.map((w) =>
      h(
        'label',
        { class: 'lab-seg-opt' },
        h('input', { type: 'radio', name: 'lab-world', value: w, checked: lab().world === w, onchange: () => change({ world: w }) }),
        h('span', null, WORLD_NAME[w]),
      ),
    ),
  );
  const sun = stepSlider({ label: 'Sun activity', levels: SUN_LEVELS, names: SUN_NAME, value: lab().sun, describedBy: 'lab-ro-sun', onChange: (v) => change({ sun: v }) });
  const orbit = stepSlider({ label: 'Mars in its orbit', levels: ORBIT_LEVELS, names: ORBIT_NAME, value: lab().orbit, describedBy: 'lab-ro-orbit', onChange: (v) => change({ orbit: v }) });
  const dust = stepSlider({ label: 'Dust in the air', levels: DUST_LEVELS, names: DUST_NAME, value: lab().dust, describedBy: 'lab-ro-dust', onChange: (v) => change({ dust: v }) });
  const delay = numberSlider({
    label: 'Message delay from Earth, minutes',
    min: LAB_DELAY.min,
    max: LAB_DELAY.max,
    value: lab().delayMin ?? Math.round(todayMin),
    unit: (n) => `${n} min`,
    describedBy: 'lab-ro-delay',
    onChange: (n) => change({ delayMin: n }),
  });
  const todayBtn = h(
    'button',
    {
      type: 'button',
      class: 'btn small',
      onclick: () => {
        delay.set(Math.round(todayMin));
        change({ delayMin: null });
      },
    },
    `Use today's: ${Math.round(todayMin)} min`,
  ) as HTMLButtonElement;
  const crew = numberSlider({
    label: 'Crew size',
    min: LAB_CREW.min,
    max: LAB_CREW.max,
    value: lab().crew,
    unit: (n) => `${n} crew`,
    describedBy: 'lab-ro-crew',
    onChange: (n) => change({ crew: n }),
  });

  const marsToday = heliocentric('mars', Date.now()).rAU * 149.598;
  const dials = h(
    'div',
    { class: 'lab-dials' },
    dialCard({
      key: 'world',
      title: 'World',
      what: 'Where is your base? All three are real places that NASA studies.',
      control: worldGroup,
      off: none(),
      readout: readouts.world,
      facts: [
        'Gale Crater is where the Curiosity rover landed. Arcadia Planitia has ice under the ground (NASA SWIM). The Moon\'s south pole is where Artemis astronauts will explore. Solar power: 7 cells at Gale, 6 at Arcadia (game values). ',
        source('https://nssdc.gsfc.nasa.gov/planetary/factsheet/marsfact.html', 'NASA Mars Fact Sheet'),
      ],
    }),
    dialCard({
      key: 'sun',
      title: 'Sun activity',
      what: 'The Sun has busy years and quiet years. Busy years bring more flares and radiation storms.',
      control: sun.el,
      off: none(),
      readout: readouts.sun,
      facts: [
        'The Sun goes from quiet (solar minimum) to busy (solar maximum) and back about every 11 years. On October 15, 2024, NASA and NOAA announced that "the Sun has reached its solar maximum period." Every storm in the lab is a real one from NASA\'s DONKI records (stored copies, not live). How many you meet is a game value. ',
        source('https://science.nasa.gov/science-research/heliophysics/nasa-noaa-sun-reaches-maximum-phase-in-11-year-solar-cycle/', 'NASA, Oct 15 2024'),
      ],
    }),
    dialCard({
      key: 'orbit',
      title: 'Mars in its orbit',
      marsOnly: true,
      what: 'Mars\' path around the Sun is an oval, so sometimes it is closer to the Sun and gets more sunlight.',
      control: orbit.el,
      off: none(),
      readout: readouts.orbit,
      facts: [
        `Closest: 206.65 million km. Farthest: 249.26 million km. Sunlight spreads out with distance squared: (249.26 / 206.65) x (249.26 / 206.65) = 1.45, so about ${PERI_APH_PCT}% more sunlight at the closest point. Today Mars is about ${Math.round(marsToday)} million km from the Sun (our estimate). Near the closest point is also dust storm season: "Southern spring and summer have long been recognized as the dustiest part of the Martian year" (JPL). `,
        source('https://nssdc.gsfc.nasa.gov/planetary/factsheet/marsfact.html', 'NASA Mars Fact Sheet'),
        ' ',
        source('https://www.jpl.nasa.gov/news/nasa-mars-orbiters-reveal-seasonal-dust-storm-pattern/', 'JPL, 2016'),
      ],
    }),
    dialCard({
      key: 'dust',
      title: 'Dust in the air',
      marsOnly: true,
      what: 'Fine red dust floats in Mars\' sky. Scientists call how thick it is "tau": a bigger tau lets less sunlight through.',
      control: dust.el,
      off: none(),
      readout: readouts.dust,
      facts: [
        `Tau: clear ${DUST_TAU.clear}, hazy ${DUST_TAU.hazy}, dusty ${DUST_TAU.dusty}, dust storm ${DUST_TAU.storm} (game approximations), planet-wide storm ${DUST_TAU.global} (measured over the Opportunity rover in June 2018, JPL). On its darkest day Opportunity made about 22 watt-hours, compared with about 700 on a normal day (The Planetary Society). The power curve between those points is a game approximation. `,
        source('https://www.jpl.nasa.gov/news/six-things-about-opportunitys-recovery-efforts/', 'JPL'),
        ' ',
        source('https://www.planetary.org/articles/06-mer-update-opportunity-dust-storm-sleep', 'The Planetary Society'),
      ],
    }),
    dialCard({
      key: 'delay',
      title: 'Message delay from Earth',
      marsOnly: true,
      what: 'Radio messages travel at the speed of light, but Mars is so far away they still take minutes to arrive.',
      control: h('div', null, delay.el, h('div', { class: 'lab-row' }, todayBtn)),
      off: none(),
      readout: readouts.delay,
      facts: [
        `One way, a message takes about ${LAB_DELAY.min} minutes when Mars is closest to Earth and about ${LAB_DELAY.max} minutes when it is farthest. Today it is about ${Math.round(todayMin)} minutes (our estimate from the planets' orbits). Earth also needs time to spot a storm and send the warning (about 10 minutes, a game value). `,
        source('https://nssdc.gsfc.nasa.gov/planetary/factsheet/marsfact.html', 'NASA Mars Fact Sheet'),
      ],
    }),
    dialCard({
      key: 'crew',
      title: 'Crew size',
      what: 'More astronauts can do more, but every one of them needs air to breathe and food to eat.',
      control: crew.el,
      off: none(),
      readout: readouts.crew,
      facts: [
        'NASA plans for each astronaut to use about 0.9 kg of oxygen a day (0.895 kg, NASA Life Support Baseline Values and Assumptions, 2022). The rocket still needs the same fuel. ',
        source('https://ntrs.nasa.gov/api/citations/20210024855/downloads/BVAD_2.15.22-final.pdf', 'NASA BVAD'),
      ],
    }),
  );

  // Fair test: the same storms every run unless the player asks for new ones.
  const same = h('input', {
    type: 'checkbox',
    id: 'lab-same',
    checked: save.sameStorms,
    onchange: (e: Event) => {
      save = { ...save, sameStorms: (e.target as HTMLInputElement).checked };
      persist();
    },
  });
  const fair = h(
    'div',
    { class: 'lab-fair card' },
    h('p', { class: 'lab-tip' }, h('b', null, 'Be a real scientist: '), 'change one thing at a time. Then you know which change made the difference.'),
    h(
      'div',
      { class: 'lab-row' },
      h('label', { class: 'lab-check', for: 'lab-same' }, same, h('span', null, 'Same storms each run')),
      h(
        'button',
        {
          type: 'button',
          class: 'btn small',
          onclick: () => {
            change({ seed: newSeed() });
            ctx.audio.sfx('click');
          },
        },
        'New storms',
      ),
      seedText,
    ),
  );

  // Hypothesis: a guess before the experiment.
  const hyp = h(
    'fieldset',
    { class: 'lab-hyp' },
    h('legend', null, 'My hypothesis: I think my crew will...'),
    h(
      'div',
      { class: 'lab-seg' },
      (['sooner', 'later', 'not', null] as Array<Hypothesis | null>).map((v) =>
        h(
          'label',
          { class: 'lab-seg-opt' },
          h('input', {
            type: 'radio',
            name: 'lab-hyp',
            value: v ?? 'none',
            checked: save.hypothesis === v,
            onchange: () => {
              save = { ...save, hypothesis: v };
              persist();
            },
          }),
          h('span', null, v ? HYPOTHESIS_WORDS[v] : 'no guess'),
        ),
      ),
    ),
    h('p', { class: 'lab-small' }, '...compared with real conditions and the same storms.'),
  );

  const resetBtn = h(
    'button',
    {
      type: 'button',
      class: 'btn',
      onclick: () => {
        const d = { ...defaultLab(lab().seed), world: lab().world };
        save = { ...save, settings: d };
        persist();
        sun.set(d.sun);
        orbit.set(d.orbit);
        dust.set(d.dust);
        delay.set(Math.round(todayMin));
        crew.set(d.crew);
        ctx.audio.sfx('remove');
        update();
      },
    },
    'Reset to real',
  ) as HTMLButtonElement;

  const run = () => {
    const l = save.sameStorms ? lab() : { ...lab(), seed: newSeed() };
    if (!save.sameStorms) save = { ...save, settings: l };
    persist();
    setPending(save.hypothesis);
    peekOff();
    ctx.startQuick?.(quickStartFor(l));
  };

  // Children of the dialog itself, so the Back / Run row stays pinned to its bottom (.modal > .actions.sticky).
  const root = [
    h('div', { class: 'kicker' }, 'Space Lab'),
    h('h2', null, 'What if...?'),
    h('p', { class: 'lab-intro' }, 'Change the world around your base, then run a mission and see what happens. This is a what-if lab built on the game\'s own model with real NASA numbers. It is not a real NASA simulation.'),
    h('p', { class: 'lab-rule' }, REWARD_RULE),
    summary,
    announce,
    h(
      'div',
      { class: 'lab-tools' },
      resetBtn,
      h('button', { type: 'button', class: 'btn lab-peek-btn', onclick: () => peekOn() }, 'See the base in 3D'),
      h('button', { type: 'button', class: 'btn cyan', onclick: () => openNotebook() }, `${NOTEBOOK_LABEL} (${save.notebook.length})`),
    ),
    dials,
    fair,
    hyp,
    h(
      'div',
      { class: 'actions end sticky lab-actions' },
      h('button', { type: 'button', class: 'btn', onclick: () => ctx.showTitle() }, 'Back'),
      h('button', { type: 'button', class: 'btn primary', 'data-autofocus': true, disabled: !ctx.startQuick, onclick: run }, h('span', { class: 'lab-run-long' }, 'Run the experiment'), h('span', { class: 'lab-run-short' }, 'Run it'), h('span', { class: 'arrow' })),
    ),
  ];
  ctx.modal(root, { label: LAB_LABEL, wide: true, onClose: () => ctx.showTitle() }).classList.add('lab-screen');
  update();
}

// ------------------------------------------------------------------ peek at the 3D base
let peekStop: (() => void) | null = null;
function peekOff(): void {
  peekStop?.();
  peekStop = null;
  document.documentElement.classList.remove('ev-lab-peek');
  document.querySelectorAll('.lab-peek-back').forEach((e) => e.remove());
}
function peekOn(): void {
  peekOff();
  document.documentElement.classList.add('ev-lab-peek');
  const back = h('button', { type: 'button', class: 'btn primary lab-peek-back', onclick: () => peekOff() }, 'Back to the Space Lab');
  document.body.append(back);
  back.focus();
  // Escape comes back to the lab (instead of closing it unseen), and anything else that changes the dialog ends the peek.
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopImmediatePropagation();
    peekOff();
  };
  window.addEventListener('keydown', onKey, true);
  const root = document.getElementById('modal-root');
  const watch = root && typeof MutationObserver === 'function' ? new MutationObserver(() => peekOff()) : null;
  if (root) watch?.observe(root, { childList: true });
  peekStop = () => {
    window.removeEventListener('keydown', onKey, true);
    watch?.disconnect();
  };
}

// ------------------------------------------------------------------ notebook
function runWords(r: RunSummary | undefined, turn: string): string {
  if (!r) return 'not run';
  return r.won ? `launched on ${turn} ${r.sols}` : `home early on ${turn} ${r.sols}`;
}

function entryCard(e: NotebookEntry): HTMLElement {
  const turn = e.settings.world === 'moon' ? 'day' : 'sol';
  const changes = changesList(e.settings);
  const when = new Date(e.at);
  const date = Number.isNaN(when.getTime()) ? '' : when.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  return h(
    'li',
    { class: `lab-entry ${e.won ? 'won' : 'lost'}` },
    h('div', { class: 'lab-entry-head' }, h('b', null, WORLD_NAME[e.settings.world]), h('span', null, date)),
    h('div', null, changes.length ? `Changed: ${changes.join('; ')}` : 'Control run: real conditions'),
    h('div', null, h('b', null, 'Your crew: '), e.won ? `launched on ${turn} ${e.sols}` : `came home early on ${turn} ${e.sols}${e.loseReason && LOSE_WORDS[e.loseReason] ? ` (${LOSE_WORDS[e.loseReason]})` : ''}`, `. Radiation ${e.dose.toFixed(1)} of ${e.doseBudget} mSv, fuel ${Math.round(e.fuel)}%.`),
    e.autoReal && e.autoLab ? h('div', null, h('b', null, 'Autopilot: '), `real ${runWords(e.autoReal, turn)}, lab ${runWords(e.autoLab, turn)}.`) : null,
    e.hypothesis ? h('div', null, h('b', null, 'Guess: '), `${HYPOTHESIS_WORDS[e.hypothesis]}. `, e.held ? h('span', { class: 'lab-held' }, 'It held!') : h('span', { class: 'lab-missed' }, 'Not this time.')) : null,
  );
}

export function openNotebook(): void {
  const ctx = metaContext();
  if (!ctx) return;
  const save = loadSave();
  const entries = [...save.notebook].reverse();
  ctx.modal(
    [
      h('div', { class: 'kicker' }, 'Space Lab'),
      h('h2', null, NOTEBOOK_LABEL),
      h('p', null, `Your last ${NOTEBOOK_MAX} experiments, newest first. Compare them: which dial made the biggest difference?`),
      entries.length ? h('ol', { class: 'lab-notebook' }, entries.map(entryCard)) : h('p', { class: 'lab-small' }, 'No experiments yet. Change a dial and run one!'),
      h('div', { class: 'actions end sticky' }, h('button', { type: 'button', class: 'btn primary', 'data-autofocus': true, onclick: () => openLab() }, 'Back to the Space Lab')),
    ],
    { label: NOTEBOOK_LABEL, wide: true, onClose: () => openLab() },
  );
}

// ------------------------------------------------------------------ the result card (end screen)
export function resultCard(e: NotebookEntry, xpLeftToday: number): HTMLElement {
  const turn = e.settings.world === 'moon' ? 'day' : 'sol';
  const changes = changesList(e.settings);
  const note = oneAtATimeNote(e.settings);
  const held = e.hypothesis ? !!e.held : null;
  return h(
    'section',
    { class: 'card lab-result', 'aria-label': 'Lab result' },
    h('div', { class: 'kicker' }, 'Lab result'),
    h('h3', null, 'What you changed'),
    changes.length ? h('ul', { class: 'clean' }, changes.map((c) => h('li', null, c))) : h('p', null, 'Nothing: a control run with real conditions. Now change one dial and compare!'),
    h('h3', null, 'What happened'),
    h(
      'p',
      null,
      e.won ? `Your crew launched on ${turn} ${e.sols}. ` : `Your crew came home early on ${turn} ${e.sols}${e.loseReason && LOSE_WORDS[e.loseReason] ? `: they ${LOSE_WORDS[e.loseReason]}` : ''}. `,
      `Radiation: ${e.dose.toFixed(1)} of ${e.doseBudget} mSv. Rocket fuel: ${Math.round(e.fuel)}%.`,
    ),
    e.autoReal && e.autoLab
      ? [
          h('h3', null, 'Fair test'),
          h('p', null, `The autopilot flew the same storms twice. Real conditions: ${runWords(e.autoReal, turn)}. Your lab: ${runWords(e.autoLab, turn)}. Only the dials were different.`),
        ]
      : null,
    h(
      'p',
      { class: `lab-verdict ${held === null ? '' : held ? 'held' : 'missed'}` },
      e.hypothesis
        ? [h('b', null, `Your hypothesis: ${HYPOTHESIS_WORDS[e.hypothesis]}. `), held ? 'It held!' : 'Not this time. Surprises are how scientists learn.']
        : 'Next time, write down a guess before you run it. That is your hypothesis.',
    ),
    h('p', { class: 'lab-science' }, h('b', null, 'The science: '), scienceLine(e.settings)),
    note ? h('p', { class: 'lab-small' }, note) : null,
    h('p', { class: 'lab-small' }, e.xp ? `+${e.xp} XP for a finished experiment (${xpLeftToday} more today).` : `No XP this time: ${LAB_XP_PER_DAY} experiments a day give XP. Keep experimenting anyway!`),
    h(
      'div',
      { class: 'actions' },
      h('button', { type: 'button', class: 'btn cyan', onclick: () => openLab() }, 'Back to the Space Lab'),
      h('button', { type: 'button', class: 'btn', onclick: () => openNotebook() }, NOTEBOOK_LABEL),
    ),
  );
}

// ------------------------------------------------------------------ Settings dialog section
export function settingsSection(): HTMLElement {
  const s: LabSave = loadSave();
  // From the mission menu: the lab starts its own mission, so it waits until this one is finished or left.
  const busy = !!metaContext()?.missionActive?.();
  return h(
    'section',
    { class: 'settings-sec lab-settings-section', 'aria-labelledby': 'lab-settings-h' },
    h('h3', { id: 'lab-settings-h' }, LAB_LABEL),
    h('p', null, 'Change the Sun, the dust, Mars\' orbit and more, and see what happens to your base. Lab missions never change your normal game.'),
    h('p', { class: 'lab-summary' }, h('b', null, 'Now: '), summaryLine(s.settings)),
    h(
      'button',
      {
        type: 'button',
        class: 'btn cyan',
        disabled: busy,
        onclick: () => {
          metaContext()?.audio.sfx('click');
          openLab();
        },
      },
      'Open the Space Lab',
    ),
    busy ? h('p', { class: 'lab-small' }, 'Finish or leave this mission first: the Space Lab runs its own missions.') : null,
  );
}

// ------------------------------------------------------------------ HUD badge
let badge: HTMLElement | null = null;
export function hudBadge(): HTMLElement {
  badge ??= h(
    'span',
    { class: 'lab-hud-badge', role: 'note', title: 'A Space Lab experiment: it does not count for stars, races or the daily board.' },
    flaskIcon(18),
    h('span', null, 'SPACE LAB'),
  );
  return badge;
}
