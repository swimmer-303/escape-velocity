// Written with AI assistance (Claude Code). See README "Use of AI tools".
// The live standings in the HUD during a race: 1st to 4th, each crew's rocket fuel, a crew-safe sign, and a
// banter line now and then. The game redraws its HUD many times a second while a sol plays, so this is ONE element
// kept between redraws and updated in place; place changes animate (Web Animations survive the HUD redraws) the
// next time the player can see the HUD (not behind the sol report).

import { h, clear } from '../../ui/dom';
import { statusIcon } from './art';
import { portrait } from './portrait';
import { ordinal, type Placed } from './score';
import type { Row } from './race';
import type { Banter } from './banter';
import { leagueAt } from './rivals';

const ROW_H = 28;

export class StandingsHud {
  readonly root: HTMLElement;
  private list: HTMLOListElement;
  private banterEl: HTMLElement;
  private leagueEl: HTMLElement;
  private order: string[] = [];
  /** Old index of each racer, waiting to animate. */
  private pendingMoves: Map<string, number> | null = null;
  private pendingFlash: Set<string> = new Set();
  /** Player's sols played when the rows were last drawn (-1: never). */
  drawnAt = -1;

  constructor(private reducedMotion: () => boolean) {
    this.leagueEl = h('span', { class: 'rh-league' });
    this.list = h('ol', { class: 'rh-list' });
    this.banterEl = h('p', { class: 'rh-banter', hidden: true });
    this.root = h('section', { class: 'race-hud', 'aria-label': 'Rival Race standings' }, h('div', { class: 'rh-head' }, h('span', { class: 'rh-kicker' }, 'Rival race'), this.leagueEl), this.list, this.banterEl);
  }

  reset(leagueIndex: number, ghost: boolean): void {
    const lg = leagueAt(leagueIndex);
    this.leagueEl.textContent = ghost ? 'Friend challenge' : `${lg.name} league`;
    this.root.style.setProperty('--lg', lg.color);
    this.order = [];
    this.pendingMoves = null;
    this.pendingFlash.clear();
    this.drawnAt = -1;
    clear(this.list);
    this.banterEl.hidden = true;
  }

  update(rows: Array<Placed<Row>>, opts: { sols: number; banter?: Banter | null; overtaken?: string[] } = { sols: 0 }): void {
    const before = new Map(this.order.map((id, i) => [id, i]));
    if (this.order.length && rows.some((r, i) => this.order[i] !== r.id)) this.pendingMoves = before;
    for (const id of opts.overtaken ?? []) this.pendingFlash.add(id);
    this.order = rows.map((r) => r.id);
    this.drawnAt = opts.sols;
    clear(this.list);
    for (const r of rows) {
      const fuel = Math.max(0, Math.min(100, Math.floor(r.fuel + 1e-9)));
      const state = r.status === 'won' ? `launched on sol ${r.sols}` : r.status === 'lost' ? 'crew headed home early, safe' : 'crew safe';
      this.list.append(
        h(
          'li',
          {
            class: `rh-row k-${r.racer.kind} s-${r.status}`,
            'data-racer': r.id,
            'aria-label': `${ordinal(r.place)}: ${r.racer.kind === 'you' ? 'you' : r.racer.name}, rocket ${fuel} percent full, ${state}`,
          },
          h('b', { class: 'rh-place' }, String(r.place)),
          h('span', { class: 'rh-face' }, portrait(r.racer.face, { size: 20, ghost: r.racer.kind === 'ghost' })),
          h('span', { class: 'rh-name' }, r.racer.kind === 'you' ? 'You' : r.racer.name),
          h('span', { class: 'rh-bar', 'aria-hidden': 'true' }, h('i', { style: `width:${fuel}%` })),
          h('span', { class: 'rh-fuel' }, r.status === 'won' ? 'GO!' : `${fuel}%`),
          h('span', { class: 'rh-safe' }, statusIcon(r.status, 14)),
        ),
      );
    }
    if (opts.banter) {
      clear(this.banterEl);
      this.banterEl.append(portrait(opts.banter.racer.face, { size: 16 }), h('b', null, `${opts.banter.racer.name}: `), opts.banter.text);
      this.banterEl.hidden = false;
    } else if (opts.banter === null) this.banterEl.hidden = true;
  }

  /** Play waiting animations, if the HUD is in view (no dialog over it). Called whenever the game redraws the HUD. */
  maybeAnimate(): void {
    if (!this.pendingMoves && !this.pendingFlash.size) return;
    const root = document.getElementById('modal-root');
    if (root && root.childElementCount > 0) return;
    const moves = this.pendingMoves;
    const flash = [...this.pendingFlash];
    this.pendingMoves = null;
    this.pendingFlash.clear();
    if (this.reducedMotion()) return;
    const rows = [...this.list.children] as HTMLElement[];
    rows.forEach((li, i) => {
      const id = li.dataset.racer ?? '';
      const was = moves?.get(id);
      if (typeof li.animate !== 'function') return;
      if (was !== undefined && was !== i) {
        li.animate([{ transform: `translateY(${(was - i) * ROW_H}px)` }, { transform: 'translateY(0)' }], { duration: 600, easing: 'steps(6, end)' });
      }
      if (id === 'you' && moves && was !== undefined && was > i) {
        li.animate([{ backgroundColor: '#7ddc5a88' }, { backgroundColor: 'transparent' }], { duration: 1200, easing: 'steps(4, end)' });
      }
      if (flash.includes(id)) li.animate([{ opacity: 0.3 }, { opacity: 1 }], { duration: 900, easing: 'steps(3, end)', iterations: 2 });
    });
  }
}
