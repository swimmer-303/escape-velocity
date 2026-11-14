// Written with AI assistance (Claude Code). See README "Use of AI tools".
// Heads-up display: POWER, LIFE SUPPORT, RADIATION and the FUEL TANK goal.
// Every meter has an icon, a text label, a number, and a color: never color alone.

import { h, clear, fmt1 } from './dom';
import { icon } from './icons';
import type { Snapshot } from '../sim/types';
import { siteText, type Site } from '../sim/site';

export interface HudModel {
  sol: number;
  windowSol: number;
  cellsTotal: number;
  cellsLeft: number;
  now: Snapshot;
  /** Projected values after the sol (shown as ghost bars), if planning. */
  next?: Snapshot;
  doseBudget: number;
  crew: number;
  /** e.g. "CREW 2 OF 3" */
  label: string;
  /** Moon missions count Earth days instead of sols. */
  site?: Site;
}

const LIFE_SCALE = 8; // days shown as a full bar

function bar(cls: string, pct: number, ghostPct?: number, ghostCls = '') {
  const clamp = (x: number) => Math.max(0, Math.min(100, x));
  return h(
    'div',
    { class: `bar ticks ${cls}` },
    ghostPct !== undefined ? h('div', { class: `ghost ${ghostCls}`, style: `width:${clamp(ghostPct)}%` }) : null,
    h('div', { class: `fill ${ghostCls}`, style: `width:${clamp(pct)}%` }),
  );
}

export function renderHud(root: HTMLElement, m: HudModel, right: HTMLElement[]) {
  clear(root);
  const lifeNow = Math.min(m.now.air, m.now.food);
  const lifeNext = m.next ? Math.min(m.next.air, m.next.food) : undefined;
  const lowest = m.now.air <= m.now.food ? 'Air' : 'Food';

  const power = h(
    'section',
    { class: 'meter power', 'aria-label': `Power: ${m.cellsLeft} of ${m.cellsTotal} cells left to place` },
    h('div', { class: 'meter-head' }, icon('power', 20), 'Power', h('span', { class: 'meter-value px' }, `${m.cellsLeft}/${m.cellsTotal}`)),
    h('div', { class: 'pips', 'aria-hidden': 'true' }, Array.from({ length: m.cellsTotal }, (_, i) => h('span', { class: `pip ${i >= m.cellsLeft ? 'used' : ''}` }))),
  );

  const lifeDanger = lifeNow < 1.5 || (lifeNext !== undefined && lifeNext < 1);
  const life = h(
    'section',
    {
      class: `meter life ${lifeDanger ? 'danger' : ''}`,
      'aria-label': `Life support: ${fmt1(lifeNow)} days. Air ${fmt1(m.now.air)} days, food ${fmt1(m.now.food)} days.`,
    },
    h('div', { class: 'meter-head' }, icon('air', 20), 'Life support', h('span', { class: 'meter-value px' }, `${fmt1(lifeNow)} d`)),
    h(
      'div',
      { class: 'mini-bars' },
      h('span', null, 'AIR'),
      miniBar('air', m.now.air, m.next?.air),
      h('span', null, 'FOOD'),
      miniBar('food', m.now.food, m.next?.food),
    ),
    h('div', { class: 'sr-only' }, `${lowest} is lowest.`),
  );

  const dosePct = (m.now.dose / m.doseBudget) * 100;
  const doseNextPct = m.next ? (m.next.dose / m.doseBudget) * 100 : undefined;
  const dose = h(
    'section',
    { class: `meter dose ${dosePct > 75 ? 'danger' : ''}`, 'aria-label': `Radiation dose ${fmt1(m.now.dose)} of a ${m.doseBudget} budget` },
    h('div', { class: 'meter-head' }, icon('radiation', 20), 'Dose', h('span', { class: 'meter-value px' }, `${fmt1(m.now.dose)}/${m.doseBudget}`)),
    bar('', dosePct, doseNextPct),
    h('div', { class: 'meter-sub' }, 'Radiation budget (mSv)'),
  );

  const fuelNextPct = m.next ? m.next.fuel : undefined;
  const fuel = h(
    'section',
    { class: 'meter fuel', 'aria-label': `Fuel tank ${Math.floor(m.now.fuel)} percent full` },
    h('div', { class: 'meter-head' }, icon('rocket', 20), 'Fuel tank: goal', h('span', { class: 'meter-value px' }, `${Math.floor(m.now.fuel)}%`)),
    bar('', m.now.fuel, fuelNextPct),
    h('div', { class: 'meter-sub' }, 'Fill it to launch home'),
  );

  const t = siteText(m.site);
  const sol = h(
    'div',
    { class: 'sol-chip', 'aria-label': `${m.label}, ${m.crew} astronauts, ${t.turn} ${m.sol} of ${m.windowSol}` },
    h('small', null, m.label),
    `${t.TURN} ${m.sol}`,
    h('small', null, `${m.crew} crew · window ${t.turn} ${m.windowSol}`),
  );

  root.append(power, life, dose, fuel, h('div', { class: 'hud-right' }, sol, ...right));
}

function miniBar(kind: 'air' | 'food', now: number, next?: number) {
  const clamp = (x: number) => Math.max(0, Math.min(100, x));
  const pct = (now / LIFE_SCALE) * 100;
  const nextPct = next !== undefined ? (next / LIFE_SCALE) * 100 : pct;
  // Ghost shows the change: white for a gain, red for a loss.
  const ghostColor = nextPct < pct ? 'var(--red)' : 'var(--ink)';
  return h(
    'div',
    { class: 'bar', title: `${fmt1(now)} days${next !== undefined ? ` (after today: ${fmt1(next)})` : ''}` },
    h('div', { class: `ghost ${kind}`, style: `width:${clamp(Math.max(pct, nextPct))}%; background:${ghostColor}` }),
    h('div', { class: `fill ${kind}`, style: `width:${clamp(Math.min(pct, nextPct))}%` }),
  );
}
