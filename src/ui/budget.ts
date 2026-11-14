// Written with AI assistance (Claude Code). See README "Use of AI tools".
// The power-budget dock: drag chunky power cells onto modules (mouse, touch),
// or tap empty/filled slots, or use the keyboard.

import { h, clear, fmt1 } from './dom';
import { icon, type IconName } from './icons';
import { RATES } from '../sim/constants';
import { moduleCap, airPerCell, foodPerGreenhouseCell, fuelPctPerCell, type Preview } from '../sim/sim';
import { UPGRADES, nextCost, upgradeDef } from '../sim/upgrades';
import { MOON_BATTERY } from '../sim/constants';
import { siteText, type Site } from '../sim/site';
import type { Allocation, Briefing, ModuleId, MissionState } from '../sim/types';

interface SlotDef {
  id: ModuleId;
  label: string;
  icon: IconName;
}
interface ModuleDef {
  key: string;
  name: string;
  icon: IconName;
  desc: string;
  slots: SlotDef[];
  /** Only shown once built. */
  needs?: 'monitor' | 'battery';
  /** Different wording for a Moon base. */
  moonDesc?: string;
}

export const MODULES: ModuleDef[] = [
  {
    key: 'o2',
    name: 'O2 Plant',
    icon: 'o2',
    desc: 'Pulls oxygen out of Mars air. Same machine, two jobs: air to breathe OR oxygen for the rocket.',
    moonDesc: 'Bakes oxygen out of Moon soil (regolith). Same machine, two jobs: air to breathe OR oxygen for the rocket.',
    slots: [
      { id: 'air', label: 'Air', icon: 'air' },
      { id: 'fuel', label: 'Fuel', icon: 'rocket' },
    ],
  },
  { key: 'greenhouse', name: 'Greenhouse', icon: 'greenhouse', desc: 'Grow lights make food, plus a little air.', slots: [{ id: 'greenhouse', label: 'Grow', icon: 'food' }] },
  {
    key: 'heaters',
    name: 'Heaters',
    icon: 'heater',
    desc: 'Keep the batteries warm through the freezing night.',
    moonDesc: 'Keep the base and batteries warm. The lunar night is far colder, so heaters need more then.',
    slots: [{ id: 'heaters', label: 'Heat', icon: 'heater' }],
  },
  { key: 'shelter', name: 'Storm Shelter', icon: 'shelter', desc: 'Shields the crew from solar storms. Only works when powered.', slots: [{ id: 'shelter', label: 'Shield', icon: 'shelter' }] },
  {
    key: 'monitor',
    name: 'Radiation Monitor',
    icon: 'monitor',
    desc: 'Watches the Sun tonight: your own storm warning tomorrow.',
    slots: [{ id: 'monitor', label: 'Watch', icon: 'monitor' }],
    needs: 'monitor',
  },
  {
    key: 'battery',
    name: 'Battery',
    icon: 'cell',
    desc: 'Store cells today, get them back tomorrow.',
    moonDesc: `Save cells for the lunar night (holds ${MOON_BATTERY.capacity}). Each night it gives back up to ${MOON_BATTERY.releasePerNight}.`,
    slots: [{ id: 'battery', label: 'Store', icon: 'cell' }],
    needs: 'battery',
  },
  { key: 'build', name: 'Workshop', icon: 'crate', desc: 'Build upgrades that stay with the base for every crew after you.', slots: [{ id: 'build', label: 'Build', icon: 'crate' }] },
];

export const MODULE_LABEL: Record<ModuleId, string> = {
  air: 'Air',
  fuel: 'Rocket fuel',
  greenhouse: 'Greenhouse',
  heaters: 'Heaters',
  shelter: 'Storm shelter',
  monitor: 'Radiation monitor',
  build: 'Workshop',
  battery: 'Battery',
};

export interface BudgetCallbacks {
  onChange(alloc: Allocation): void;
  onRun(): void;
  onOpenWorkshop(): void;
  sfx?(name: 'place' | 'remove' | 'deny'): void;
  /** Mission Control: may this player move cells in this module? Others are shown locked. Default: every module. */
  canEdit?(id: ModuleId): boolean;
  /** Mission Control: what goes under the side panel instead of the Run button (e.g. a Ready button). */
  actions?(left: number): HTMLElement[];
}

export class BudgetDock {
  private root: HTMLElement;
  private alloc!: Allocation;
  private briefing!: Briefing;
  private state!: MissionState;
  private preview?: Preview;
  private cb: BudgetCallbacks;
  private side: HTMLElement[] = [];
  private drag: { from: ModuleId | 'tray'; ghost: HTMLElement; startX: number; startY: number; moved: boolean; srcEl: HTMLElement } | null = null;

  constructor(root: HTMLElement, cb: BudgetCallbacks) {
    this.root = root;
    this.cb = cb;
    window.addEventListener('pointermove', (e) => this.onMove(e));
    window.addEventListener('pointerup', (e) => this.onUp(e));
    window.addEventListener('pointercancel', () => this.cancelDrag());
  }

  set(state: MissionState, briefing: Briefing, alloc: Allocation, preview: Preview | undefined, side: HTMLElement[]) {
    this.state = state;
    this.briefing = briefing;
    this.alloc = alloc;
    this.preview = preview;
    this.side = side;
    this.render();
  }

  private left() {
    return this.briefing.cells - Object.values(this.alloc).reduce((a, b) => a + b, 0);
  }

  private get site(): Site {
    return siteText(this.state.config).site;
  }

  private cap(id: ModuleId) {
    return moduleCap(this.state, id);
  }

  private editable(id: ModuleId) {
    return this.cb.canEdit ? this.cb.canEdit(id) : true;
  }

  add(id: ModuleId) {
    if (!this.editable(id) || this.left() <= 0 || this.alloc[id] >= this.cap(id)) {
      this.cb.sfx?.('deny');
      return false;
    }
    this.alloc = { ...this.alloc, [id]: this.alloc[id] + 1 };
    this.cb.sfx?.('place');
    this.cb.onChange(this.alloc);
    return true;
  }

  remove(id: ModuleId) {
    if (!this.editable(id) || this.alloc[id] <= 0) return false;
    this.alloc = { ...this.alloc, [id]: this.alloc[id] - 1 };
    this.cb.sfx?.('remove');
    this.cb.onChange(this.alloc);
    return true;
  }

  move(from: ModuleId, to: ModuleId) {
    if (from === to) return;
    if (!this.editable(from) || !this.editable(to) || this.alloc[to] >= this.cap(to)) {
      this.cb.sfx?.('deny');
      return;
    }
    this.alloc = { ...this.alloc, [from]: this.alloc[from] - 1, [to]: this.alloc[to] + 1 };
    this.cb.sfx?.('place');
    this.cb.onChange(this.alloc);
  }

  private effectFor(id: ModuleId): { text: HTMLElement | string; cls: string } {
    const a = this.alloc[id];
    const s = this.state;
    const crew = s.crew;
    switch (id) {
      case 'air': {
        const d = (a * airPerCell(s)) / crew;
        return {
          text: a ? h('span', null, h('b', null, `+${fmt1(d)}`), ` day${Math.abs(d - 1) < 0.05 ? '' : 's'} of air (crew uses 1 a ${siteText(this.site).turn})`) : 'No air made',
          cls: a ? 'good' : 'warn',
        };
      }
      case 'fuel':
        return { text: a ? h('span', null, h('b', null, `+${fmt1(a * fuelPctPerCell(s))}%`), ' rocket fuel') : 'No fuel made', cls: a ? 'good' : '' };
      case 'greenhouse':
        return {
          text: a
            ? h('span', null, h('b', null, `+${fmt1((a * foodPerGreenhouseCell(s)) / crew)}`), ' days food, ', h('b', null, `+${fmt1((a * RATES.airPerGreenhouseCell) / crew)}`), ' air')
            : 'No food grown',
          cls: a ? 'good' : 'warn',
        };
      case 'heaters': {
        const need = this.briefing.heaterNeed;
        if (a >= need) return { text: h('span', null, h('b', null, `${a}/${need}`), ' Warm tonight'), cls: 'good' };
        return { text: h('span', null, h('b', null, `${a}/${need}`), ` Cold! −${need - a} cell${need - a === 1 ? '' : 's'} tomorrow`), cls: 'bad' };
      }
      case 'shelter': {
        const block = this.briefing.shelterBlock;
        const pct = Math.round(block[Math.min(a, block.length - 1)] * 100);
        const full = this.preview?.stormDoseIfMajorUnsheltered ?? 0;
        const taken = this.preview?.stormDoseIfMajor ?? full;
        return {
          text: a
            ? h('span', null, 'Blocks ', h('b', null, `${pct}%`), ` of a storm (big storm: ${fmt1(taken)} dose, not ${fmt1(full)})`)
            : h('span', null, 'Off: a big storm would add ', h('b', null, fmt1(full)), ' dose'),
          cls: a ? 'good' : this.briefing.warning ? 'bad' : '',
        };
      }
      case 'monitor':
        return { text: a ? 'ON: warns you tomorrow' : 'Off', cls: a ? 'good' : '' };
      case 'battery': {
        if (this.site === 'moon') {
          const held = (this.briefing.batteryHeld ?? 0) + a;
          return {
            text: h('span', null, h('b', null, `${held}/${MOON_BATTERY.capacity}`), a ? ' saved for the night, nothing today' : ' saved for the night'),
            cls: a ? 'good' : '',
          };
        }
        return { text: a ? h('span', null, h('b', null, `+${a}`), ` cell${a === 1 ? '' : 's'} tomorrow, nothing today`) : 'Empty', cls: a ? 'good' : '' };
      }
      case 'build': {
        const p = s.base.project;
        if (!p) return { text: 'Everything is built!', cls: 'good' };
        const cost = nextCost(p, s.base.levels) ?? 0;
        const done = s.base.progress[p] + a;
        return {
          text: h(
            'span',
            null,
            h('b', null, `${Math.min(done, cost)}/${cost}`),
            done >= cost ? ` Finishes tonight!${done > cost ? ` +${done - cost} toward the next project` : ''}` : ' cells built',
          ),
          cls: done >= cost ? 'good' : a ? 'good' : '',
        };
      }
    }
  }

  private render() {
    // Re-rendering must not move the player: keep scroll positions and keyboard focus.
    const prevScroll = this.root.querySelector<HTMLElement>('.dock-left')?.scrollTop ?? 0;
    const pageScroll = window.scrollY;
    const active = document.activeElement as HTMLElement | null;
    const focusLabel = active && this.root.contains(active) ? active.getAttribute('aria-label') : null;
    this.renderDock();
    const dockLeft = this.root.querySelector<HTMLElement>('.dock-left');
    if (dockLeft) dockLeft.scrollTop = prevScroll;
    if (window.scrollY !== pageScroll) window.scrollTo({ top: pageScroll });
    if (focusLabel) {
      const same = this.root.querySelector<HTMLElement>(`[aria-label="${CSS.escape(focusLabel)}"]`);
      same?.focus({ preventScroll: true });
    }
  }

  private renderDock() {
    clear(this.root);
    const left = this.left();
    const tray = h(
      'div',
      { class: 'tray', 'data-drop': 'tray', 'aria-label': `${left} power cells left to place` },
      h('span', { class: 'tray-label' }, 'POWER CELLS'),
      left > 0
        ? h(
            'div',
            { class: 'tray-cells' },
            Array.from({ length: left }, () => {
              const el = h('div', { class: 'cell-token', role: 'img', 'aria-label': 'Power cell' });
              if (!this.cb.canEdit || MODULES.some((m) => m.slots.some((s) => this.editable(s.id))))
                el.addEventListener('pointerdown', (e) => this.startDrag(e, 'tray', el));
              return el;
            }),
          )
        : h('span', { class: 'tray-empty' }, `All cells placed. Ready to run the ${siteText(this.site).turn}!`),
      h('span', { class: 'tray-hint' }, left > 0 ? 'Drag a cell onto a module, or tap a slot.' : ''),
    );

    const visible = MODULES.filter((m) => !m.needs || (m.needs === 'monitor' ? this.briefing.hasMonitor : this.briefing.hasBattery));
    const modules = h(
      'div',
      { class: 'modules', style: `--cols:${visible.length}` },
      visible.map((m) => {
        const short = m.key === 'heaters' && this.alloc.heaters < this.briefing.heaterNeed;
        const isBuild = m.key === 'build';
        const project = this.state.base.project;
        const mine = m.slots.some((s) => this.editable(s.id));
        const lock = this.cb.canEdit ? (mine ? 'mine' : 'locked') : '';
        return h(
          'section',
          { class: `module ${m.key} ${short ? 'short' : ''} ${lock}`, 'data-drop': m.slots[0].id, 'aria-label': m.name },
          h('div', { class: 'module-head' }, icon(m.icon, 22), m.name.toUpperCase()),
          isBuild
            ? h(
                'div',
                { class: 'module-desc' },
                project ? h('b', null, UPGRADES[project].name) : 'All projects done',
                project ? h('div', null, upgradeDef(project, this.site).effect) : null,
                project ? this.progressBar() : null,
                mine ? h('button', { class: 'btn small', style: 'margin-top:6px', onclick: () => this.cb.onOpenWorkshop() }, 'Choose project') : null,
              )
            : h('div', { class: 'module-desc' }, this.site === 'moon' && m.moonDesc ? m.moonDesc : m.desc),
          m.slots.map((s) => this.slotRow(s, m.slots.length > 1)),
        );
      }),
    );

    const run = h(
      'button',
      { class: 'btn go', disabled: left > 0 ? true : undefined, onclick: () => this.cb.onRun(), 'aria-label': `Run ${siteText(this.site).turn} ${this.briefing.sol}` },
      `Run ${siteText(this.site).turn} ${this.briefing.sol}`,
      h('span', { class: 'arrow' }),
    );
    const hint = h('div', { class: 'run-hint' }, left > 0 ? `Place ${left} more cell${left === 1 ? '' : 's'} first.` : 'Every cell has a job. Go!');

    this.root.append(
      h(
        'div',
        { class: 'dock' },
        h('div', { class: 'dock-left' }, tray, modules),
        h('div', { class: 'dock-right' }, h('div', { class: 'brief-mini' }, this.side), h('div', null, this.cb.actions ? this.cb.actions(left) : [run, hint])),
      ),
    );
  }

  private progressBar() {
    const p = this.state.base.project;
    if (!p) return null;
    const cost = nextCost(p, this.state.base.levels) ?? 1;
    const done = this.state.base.progress[p];
    const adding = this.alloc.build;
    return h(
      'div',
      { class: 'bar', style: 'margin-top:6px', 'aria-label': `${done} of ${cost} cells built` },
      h('div', { class: 'ghost', style: `width:${Math.min(100, ((done + adding) / cost) * 100)}%; background: var(--green)` }),
      h('div', { class: 'fill', style: `width:${Math.min(100, (done / cost) * 100)}%; background: var(--green)` }),
    );
  }

  private slotRow(s: SlotDef, showLabel: boolean) {
    const fullCap = this.cap(s.id);
    // The Workshop has no limit: show the cells placed plus room for a few more, growing as you add.
    const cap = s.id === 'build' ? Math.min(fullCap, Math.max(3, this.alloc.build + Math.min(2, this.left()))) : fullCap;
    const a = this.alloc[s.id];
    const need = s.id === 'heaters' ? this.briefing.heaterNeed : 0;
    const eff = this.effectFor(s.id);
    const editable = this.editable(s.id);
    const boxes = h(
      'div',
      { class: 'slot-boxes' },
      Array.from({ length: cap }, (_, i) => {
        const filled = i < a;
        const box = h('button', {
          class: `slot-box ${filled ? 'filled' : ''} ${!filled && i < need ? 'need' : ''}`,
          'aria-label': editable
            ? filled
              ? `Remove a cell from ${MODULE_LABEL[s.id]}`
              : `Add a cell to ${MODULE_LABEL[s.id]}`
            : `${MODULE_LABEL[s.id]}: ${filled ? 'cell placed' : 'empty'} (another station)`,
          'data-drop': s.id,
          disabled: editable ? undefined : true,
        });
        // Another station's module (Mission Control) is shown, but has no controls.
        if (editable && filled) {
          box.addEventListener('pointerdown', (e) => this.startDrag(e, s.id, box));
          box.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              this.remove(s.id);
            }
          });
        } else if (editable) {
          box.addEventListener('click', () => this.add(s.id));
        }
        return box;
      }),
    );
    return h(
      'div',
      { class: 'slot-row', 'data-drop': s.id },
      showLabel ? h('span', { class: 'slot-label' }, icon(s.icon, 16), s.label.toUpperCase()) : null,
      cap ? boxes : h('span', { class: 'split-note' }, s.id === 'build' ? 'Nothing to build right now.' : ''),
      h('div', { class: `effect ${eff.cls}`, style: 'flex-basis:100%' }, eff.text),
    );
  }

  // ---------------- Drag and drop ----------------
  private startDrag(e: PointerEvent, from: ModuleId | 'tray', srcEl: HTMLElement) {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    e.preventDefault();
    const ghost = h('div', { class: 'cell-token cell-ghost' });
    ghost.style.left = `${e.clientX}px`;
    ghost.style.top = `${e.clientY}px`;
    this.drag = { from, ghost, startX: e.clientX, startY: e.clientY, moved: false, srcEl };
  }

  private dropTargetAt(x: number, y: number): string | null {
    const el = document.elementFromPoint(x, y) as HTMLElement | null;
    const t = el?.closest('[data-drop]') as HTMLElement | null;
    return t?.dataset.drop ?? null;
  }

  private onMove(e: PointerEvent) {
    const d = this.drag;
    if (!d) return;
    if (!d.moved && Math.hypot(e.clientX - d.startX, e.clientY - d.startY) > 6) {
      d.moved = true;
      document.body.append(d.ghost);
      d.srcEl.classList.add('dragging');
    }
    if (!d.moved) return;
    d.ghost.style.left = `${e.clientX}px`;
    d.ghost.style.top = `${e.clientY}px`;
    this.root.querySelectorAll('.drop-hot').forEach((n) => n.classList.remove('drop-hot'));
    const el = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest('.module, .tray');
    el?.classList.add('drop-hot');
  }

  private onUp(e: PointerEvent) {
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    d.ghost.remove();
    d.srcEl.classList.remove('dragging');
    this.root.querySelectorAll('.drop-hot').forEach((n) => n.classList.remove('drop-hot'));
    if (!d.moved) {
      if (d.from !== 'tray') this.remove(d.from);
      return;
    }
    const target = this.dropTargetAt(e.clientX, e.clientY);
    if (d.from === 'tray') {
      if (target && target !== 'tray') this.add(target as ModuleId);
    } else {
      if (!target || target === 'tray') this.remove(d.from);
      else this.move(d.from, target as ModuleId);
    }
  }

  private cancelDrag() {
    if (!this.drag) return;
    this.drag.ghost.remove();
    this.drag.srcEl.classList.remove('dragging');
    this.drag = null;
  }
}
