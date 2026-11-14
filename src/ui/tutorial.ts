// Written with AI assistance (Claude Code). See README "Use of AI tools".
// First-sol tutorial: coach bubbles that point at the real controls and move on when the
// player does the thing (no walls of text). About a minute from start to "Run sol".

import { h, clear } from './dom';
import { icon } from './icons';
import type { Allocation } from '../sim/types';
import { siteText, type Site, type SiteText } from '../sim/site';
import { speakButton, coachShown } from './access';

export type CoachPhase = 'briefing' | 'plan' | 'running' | 'debrief' | 'other';

export interface CoachContext {
  phase: CoachPhase;
  alloc: Allocation;
  heaterNeed: number;
  /** Mars or the Moon: the bubbles say "sol" or "day". */
  site?: Site;
}

interface Step {
  phase: CoachPhase;
  target: string;
  text: string | ((t: SiteText) => string);
  /** Move on automatically when this is true. Without it, the bubble shows a Next button. */
  done?: (c: CoachContext) => boolean;
  nextLabel?: string;
}

const STEPS: Step[] = [
  {
    phase: 'briefing',
    target: '.modal button.primary',
    text: (t) =>
      t.site === 'moon'
        ? 'Good morning, Commander! Every day on the Moon starts with a briefing: power, the coming lunar night, and news from Earth. Tap PLAN THE DAY.'
        : 'Good morning, Commander! Every sol (a Mars day) starts with a briefing: weather, power, and news from Earth. Tap PLAN THE DAY.',
    done: (c) => c.phase === 'plan',
  },
  {
    phase: 'plan',
    target: '.tray',
    text: 'These yellow blocks are today\'s power cells from your solar panels. Every cell must go somewhere, and each cell can do only one job.',
    nextLabel: 'Next',
  },
  {
    phase: 'plan',
    target: '.slot-row[data-drop="air"]',
    text: 'Your crew needs air to breathe. Drag a cell onto AIR, or just tap an empty AIR box.',
    done: (c) => c.alloc.air >= 1,
  },
  {
    phase: 'plan',
    target: '.slot-row[data-drop="fuel"]',
    text: 'Here is the big secret: the same machine also makes oxygen for your rocket home! Put a cell on FUEL.',
    done: (c) => c.alloc.fuel >= 1,
  },
  {
    phase: 'plan',
    target: '.module.greenhouse',
    text: (t) => `Your crew eats every ${t.turn} too. Give the greenhouse 2 cells to grow food.`,
    done: (c) => c.alloc.greenhouse >= 2,
  },
  {
    phase: 'plan',
    target: '.module.heaters',
    text: (t) =>
      t.site === 'moon'
        ? 'The Moon gets far colder than a winter night at home, most of all in the lunar night. Give the heaters a cell, or the batteries get too cold and you get less power tomorrow.'
        : 'Mars nights are freezing, far colder than a winter night at home. Give the heaters a cell, or the batteries get too cold and you get less power tomorrow.',
    done: (c) => c.alloc.heaters >= c.heaterNeed,
  },
  {
    phase: 'plan',
    target: '#hud',
    text: 'Look up! The meters show what your plan will do today. A white bar means you gain; red means you lose.',
    nextLabel: 'Got it',
  },
  {
    phase: 'plan',
    target: '.module.build',
    text: (t) => `Spare cells? The Workshop builds upgrades that stay for every crew after you. Place your last cells anywhere you like, then press RUN ${t.TURN}.`,
    done: (c) => c.phase === 'running' || c.phase === 'debrief',
  },
  {
    phase: 'debrief',
    target: '.modal .headline',
    text: (t) => `After each ${t.turn}, the debrief tells you what your choices caused. Fill the rocket before the launch window closes. You've got this!`,
    nextLabel: 'Let\'s go!',
  },
];

const DONE_KEY = 'ev-tutorial-done';

export class Coach {
  private i = -1;
  private ctx: CoachContext | null = null;
  private ring = h('div', { class: 'coach-ring', 'aria-hidden': 'true' });
  private bubble = h('div', { class: 'coach-bubble', role: 'status', 'aria-live': 'polite' });
  private raf = 0;
  private onFinish?: () => void;

  constructor(onFinish?: () => void) {
    this.onFinish = onFinish;
  }

  static seen(): boolean {
    try {
      return localStorage.getItem(DONE_KEY) === '1';
    } catch {
      return false;
    }
  }

  get active() {
    return this.i >= 0;
  }

  start(ctx: CoachContext) {
    this.ctx = ctx;
    this.i = Math.max(0, STEPS.findIndex((s) => s.phase === ctx.phase));
    document.body.append(this.ring, this.bubble);
    this.render();
    this.track();
  }

  stop(markDone = true) {
    if (markDone) {
      try {
        localStorage.setItem(DONE_KEY, '1');
      } catch {
        /* ignore */
      }
    }
    this.i = -1;
    coachShown(this.bubble, null);
    cancelAnimationFrame(this.raf);
    this.ring.remove();
    this.bubble.remove();
    this.onFinish?.();
  }

  /** Tell the coach what the player just did; it advances when a step is complete. */
  update(ctx: CoachContext) {
    if (!this.active) return;
    this.ctx = ctx;
    let moved = false;
    while (this.active) {
      const s = STEPS[this.i];
      if (s.done && s.done(ctx)) {
        this.i++;
        moved = true;
        if (this.i >= STEPS.length) return this.stop();
      } else break;
    }
    void moved;
    this.render();
  }

  private next() {
    this.i++;
    if (this.i >= STEPS.length) return this.stop();
    if (this.ctx) this.update(this.ctx);
  }

  private render() {
    const s = STEPS[this.i];
    if (!s || !this.ctx) return;
    clear(this.bubble);
    const here = s.phase === this.ctx.phase;
    this.bubble.style.display = here ? '' : 'none';
    this.ring.style.display = here ? '' : 'none';
    this.bubble.append(
      h('div', { class: 'coach-head' }, icon('rocket', 22), h('span', null, `Tutorial ${this.i + 1}/${STEPS.length}`), speakButton(() => [this.bubble], 'coach')),
      h('p', null, typeof s.text === 'function' ? s.text(siteText(this.ctx.site)) : s.text),
      h(
        'div',
        { class: 'coach-actions' },
        h('button', { class: 'btn small', onclick: () => this.stop() }, 'Skip tutorial'),
        s.done ? null : h('button', { class: 'btn small primary', onclick: () => this.next() }, s.nextLabel ?? 'Next'),
      ),
    );
    // Read-aloud: a new tip stops the old one (and is read out if auto read-aloud is on).
    coachShown(this.bubble, here ? String(this.i) : null);
    this.position();
  }

  private track() {
    cancelAnimationFrame(this.raf);
    const loop = () => {
      this.position();
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  private position() {
    const s = STEPS[this.i];
    if (!s) return;
    const target = document.querySelector<HTMLElement>(s.target);
    if (!target || this.bubble.style.display === 'none') {
      this.ring.style.opacity = '0';
      return;
    }
    const r = target.getBoundingClientRect();
    const pad = 6;
    Object.assign(this.ring.style, {
      opacity: '1',
      left: `${r.left - pad}px`,
      top: `${r.top - pad}px`,
      width: `${r.width + pad * 2}px`,
      height: `${r.height + pad * 2}px`,
    });
    const bw = this.bubble.offsetWidth;
    const bh = this.bubble.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const below = r.bottom + 14 + bh < vh;
    const above = r.top - 14 - bh > 0;
    let top = below ? r.bottom + 14 : above ? r.top - 14 - bh : Math.max(8, vh - bh - 8);
    if (!below && !above && r.height > vh * 0.6) top = 8;
    const left = Math.min(vw - bw - 8, Math.max(8, r.left + r.width / 2 - bw / 2));
    this.bubble.style.left = `${left}px`;
    this.bubble.style.top = `${top}px`;
  }
}
