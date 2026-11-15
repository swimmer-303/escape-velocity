// Written with AI assistance (Claude Code). See README "Use of AI tools".
// Outpost Architect: the full-screen builder. The 3D pad fills the screen; around it are the parts palette, the live
// engineering readout, the tools (turn, move, delete, undo, redo, clear), save and share, and the Blueprint card.
// Keyboard, touch and mouse all work: arrow keys move a cursor on the pad, Enter places, R turns, Delete removes,
// Ctrl+Z / Ctrl+Y undo and redo, Q and E turn the view, + and - zoom. Without WebGL (or before 3D has loaded) the
// pad is drawn as a flat grid of squares, so the builder still works everywhere.

import { h, clear, append, prefersReducedMotion, type Child } from '../../ui/dom';
import { decorateDialog } from '../../ui/access';
import { reader } from '../../ui/voice';
import { MOON_TUNING } from '../../sim/constants';
import { emitGame, metaContext } from '../hooks';
import { toast } from '../toast';
import { CATEGORIES, FLAG_DESIGNS, PARTS, PART_IDS, BEDS_PER_HABITAT, SHELTER_SEATS, type Category, type PartId } from './parts';
import { Editor, GRID, SITE_IDS, SITE_NAMES, SITE_SHORT, canPlace, emptyLayout, footprint, partAt, type Fit, type Layout, type Rot, type SiteId } from './layout';
import { readout, type Readout, type StressResult } from './stress';
import { cellsForNeeds } from './engineering';
import { LUNAR_NIGHT_DAYS, CHALLENGES, challengeById, isOpen, scoreChallenge, starTotals, unlockedBy, unlockedParts, xpPerStar, type Challenge } from './challenges';
import { decodeLayout, encodeLayout, shareLink } from './share';
import { deleteSlot, loadCurrent, readSave, recordStars, saveCurrent, saveSlot, starsNow } from './store';
import { arrowIcon, dayIcon, lockIcon, partIcon, starRow, type DayIcon } from './icons';
import type { BuilderScene, Mood } from './scene';

export const BUILDER_LABEL = 'Outpost Architect';

type Mode = { kind: 'browse' } | { kind: 'place'; part: PartId; rot: Rot } | { kind: 'move'; uid: number; rot: Rot };

export interface OpenOptions {
  /** Start with this base (a shared link, or a saved slot) in Free build. */
  layout?: Layout;
  /** Skip the start card and go straight to a Blueprint challenge. */
  challenge?: string;
  /** Show the start card first (the default when nothing else is given). */
  start?: boolean;
  /** Where keyboard focus goes back to when the builder closes. */
  returnFocus?: HTMLElement | null;
}

let open: BuilderView | null = null;

/** Is the builder on screen? */
export function builderOpen(): boolean {
  return !!open;
}

/** Open Outpost Architect over whatever is on screen. Returns the view (or the one already open). */
export function openBuilder(opts: OpenOptions = {}): BuilderView {
  if (open) return open;
  open = new BuilderView(opts);
  return open;
}

function webglOk(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

function sfx(name: Parameters<NonNullable<ReturnType<typeof metaContext>>['audio']['sfx']>[0]) {
  try {
    metaContext()?.audio.sfx(name);
  } catch {
    /* sound is optional */
  }
}

const fmt = (n: number) => (Math.round(n * 10) / 10).toString();

export class BuilderView {
  readonly el: HTMLElement;
  private editor: Editor;
  private mode: Mode = { kind: 'browse' };
  private selected: number | null = null;
  private cursor = { x: Math.floor(GRID / 2) - 1, z: Math.floor(GRID / 2) - 1 };
  private hover: { x: number; z: number } | null = null;
  /** The square a part was just placed on: no ghost there until the pointer or cursor moves on. */
  private rest: { x: number; z: number } | null = null;
  private challenge: Challenge | null = null;
  private stars: Record<string, number>;
  private unlocked: Set<PartId>;
  private flagStyle = 0;
  private cat: Category = 'power';
  private testing = false;
  /** Narrow screens: the readout's details are folded away until asked for. */
  private roOpen = false;
  private skipTest: (() => void) | null = null;
  private scene: BuilderScene | null = null;
  private r: Readout;
  private saveTimer = 0;
  private inertEls: Array<{ el: HTMLElement; had: boolean }> = [];
  /** The game's own 3D stage, hidden behind us (so it renders at its tiny minimum size), and its old display. */
  private gameStage: { el: HTMLElement; display: string } | null = null;
  private returnFocus: HTMLElement | null;
  private reduced: boolean;
  private closed = false;

  // DOM
  private stage: HTMLElement;
  private flat: HTMLElement;
  private palette: HTMLElement;
  private paletteList: HTMLElement;
  private readoutBox: HTMLElement;
  private tools: HTMLElement;
  private goalBox: HTMLElement;
  private siteBox: HTMLElement;
  private hint: HTMLElement;
  private live: HTMLElement;
  private overlay: HTMLElement;
  private timeline: HTMLElement;
  private undoBtn: HTMLButtonElement;
  private redoBtn: HTMLButtonElement;

  constructor(opts: OpenOptions) {
    const ctx = metaContext();
    this.reduced = (ctx?.reducedMotion() ?? false) || prefersReducedMotion() || document.documentElement.classList.contains('reduce-motion');
    this.returnFocus = opts.returnFocus ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    this.stars = starsNow();
    this.unlocked = unlockedParts(this.stars);
    this.editor = new Editor(opts.layout ?? loadCurrent() ?? emptyLayout('gale'));
    this.r = readout(this.editor.layout);

    this.stage = h('div', {
      class: 'evb-stage',
      tabindex: '0',
      role: 'application',
      'aria-roledescription': 'build pad',
      'aria-label': 'Build pad. Arrow keys move the cursor, Enter places or picks, R turns, Delete removes.',
    });
    this.flat = h('div', { class: 'evb-flat', 'aria-hidden': 'true' });
    this.stage.append(this.flat);
    this.paletteList = h('div', { class: 'evb-parts', role: 'list' });
    this.palette = h('nav', { class: 'evb-palette', 'aria-label': 'Parts' });
    this.readoutBox = h('section', { class: 'evb-readout', 'aria-label': 'Engineering readout' });
    this.tools = h('div', { class: 'evb-tools', role: 'toolbar', 'aria-label': 'Tools' });
    this.goalBox = h('section', { class: 'evb-goal', 'aria-label': 'Blueprint goal', hidden: true });
    this.siteBox = h('div', { class: 'evb-sites', role: 'radiogroup', 'aria-label': 'Where to build' });
    this.hint = h('div', { class: 'evb-hint', 'aria-hidden': 'true' });
    this.live = h('div', { class: 'sr-only', role: 'status', 'aria-live': 'polite' });
    this.overlay = h('div', { class: 'evb-overlay', hidden: true });
    this.timeline = h('div', { class: 'evb-timeline', hidden: true, 'aria-hidden': 'true' });
    this.undoBtn = h('button', { class: 'btn small', type: 'button', 'aria-keyshortcuts': 'Control+Z', onclick: () => this.undo() }, 'Undo');
    this.redoBtn = h('button', { class: 'btn small', type: 'button', 'aria-keyshortcuts': 'Control+Y', onclick: () => this.redo() }, 'Redo');

    const top = h(
      'div',
      { class: 'evb-top' },
      h('div', { class: 'evb-title' }, h('b', null, BUILDER_LABEL), this.siteBox),
      h(
        'div',
        { class: 'evb-top-actions' },
        this.undoBtn,
        this.redoBtn,
        h('button', { class: 'btn small', type: 'button', onclick: () => this.clearPad() }, 'Clear'),
        h('button', { class: 'btn small', type: 'button', onclick: () => this.showBases() }, 'Save / Share'),
        h('button', { class: 'btn small', type: 'button', onclick: () => this.showStart() }, 'Blueprints'),
        h('button', { class: 'btn small evb-close', type: 'button', 'aria-keyshortcuts': 'Escape', onclick: () => this.close() }, 'Close'),
      ),
    );

    this.el = h(
      'div',
      { class: `ev-builder${this.reduced ? ' calm' : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': BUILDER_LABEL, tabindex: '-1' },
      this.stage,
      top,
      this.goalBox,
      this.palette,
      this.readoutBox,
      this.timeline,
      this.tools,
      this.hint,
      this.live,
      this.overlay,
    );
    document.body.append(this.el);
    for (const el of [document.getElementById('app'), document.getElementById('modal-root')]) {
      if (!el || el.contains(this.el)) continue;
      this.inertEls.push({ el, had: el.hasAttribute('inert') });
      el.setAttribute('inert', '');
    }
    // Our layer covers everything: hide the game's stage so its renderer shrinks to almost nothing (Chromebooks).
    const gs = document.getElementById('stage');
    if (gs) {
      this.gameStage = { el: gs, display: gs.style.display };
      gs.style.display = 'none';
    }
    this.el.addEventListener('keydown', this.onKey);
    this.flat.addEventListener('click', this.onFlatClick);
    this.flat.addEventListener('mousemove', this.onFlatMove);

    this.renderSites();
    this.renderPalette();
    this.refresh();
    void this.load3d();

    if (opts.challenge && challengeById(opts.challenge)) this.startChallenge(challengeById(opts.challenge)!);
    else if (opts.layout) {
      this.say('Here is the shared base. Change anything you like!');
      this.stage.focus();
    } else if (opts.start !== false) this.showStart();
    else this.stage.focus();
  }

  // ---------------------------------------------------------------- 3D
  private async load3d() {
    if (!webglOk()) return;
    try {
      const { BuilderScene } = await import('./scene');
      if (this.closed) return;
      this.scene = new BuilderScene(this.stage, { reduced: this.reduced, onCell: (c, kind) => this.onCell(c, kind) });
      this.stage.classList.add('has-3d');
      this.scene.sync(this.editor.layout);
      this.paintGhost();
    } catch (e) {
      console.warn('[builder] 3D view unavailable; using the flat pad.', e);
      this.scene = null;
    }
  }

  // ---------------------------------------------------------------- the pad
  private get layout(): Layout {
    return this.editor.layout;
  }

  /** The ghost for whatever is in hand at a square. */
  private ghostAt(c: { x: number; z: number }): { part: PartId; x: number; z: number; rot: Rot; style?: number; fit: Fit } | null {
    if (this.mode.kind === 'place') {
      const { part, rot } = this.mode;
      const { w, d } = footprint(part, rot);
      const x = Math.max(0, Math.min(GRID - w, c.x));
      const z = Math.max(0, Math.min(GRID - d, c.z));
      return { part, x, z, rot, style: this.flagStyle, fit: canPlace(this.layout, part, x, z, rot, undefined, this.unlocked) };
    }
    if (this.mode.kind === 'move') {
      const uid = this.mode.uid;
      const p = this.layout.parts.find((q) => q.uid === uid);
      if (!p) return null;
      const { w, d } = footprint(p.part, this.mode.rot);
      const x = Math.max(0, Math.min(GRID - w, c.x));
      const z = Math.max(0, Math.min(GRID - d, c.z));
      return { part: p.part, x, z, rot: this.mode.rot, style: p.style, fit: canPlace(this.layout, p.part, x, z, this.mode.rot, uid) };
    }
    return null;
  }

  private paintGhost() {
    const at = this.hover ?? this.cursor;
    const resting = !!this.rest && this.rest.x === at.x && this.rest.z === at.z;
    const g = resting ? null : this.ghostAt(at);
    if (this.scene) {
      if (g) this.scene.setGhost({ part: g.part, x: g.x, z: g.z, rot: g.rot, style: g.style, ok: g.fit.ok });
      else this.scene.setCursor(this.testing || resting ? null : at);
      const sel = this.selected !== null ? this.layout.parts.find((p) => p.uid === this.selected) ?? null : null;
      this.scene.setSelected(sel);
    }
    this.renderFlat(g);
    this.hint.textContent = g && !g.fit.ok ? g.fit.reason : this.defaultHint();
    this.hint.classList.toggle('bad', !!g && !g.fit.ok);
  }

  private defaultHint(): string {
    if (this.testing) return '';
    if (this.mode.kind === 'place') return `Tap the pad to place the ${PARTS[this.mode.part].name}. R turns it.`;
    if (this.mode.kind === 'move') return 'Tap where it should go.';
    if (this.selected !== null) return 'Turn it, move it or delete it.';
    return this.layout.parts.length ? 'Pick a part, or tap a building to change it.' : 'Pick a part on the left, then tap the pad.';
  }

  private renderFlat(g: ReturnType<BuilderView['ghostAt']>) {
    if (this.scene) {
      if (this.flat.childElementCount) clear(this.flat);
      return;
    }
    const ghost = new Set<string>();
    if (g) for (let i = 0; i < footprint(g.part, g.rot).w; i++) for (let j = 0; j < footprint(g.part, g.rot).d; j++) ghost.add(`${g.x + i},${g.z + j}`);
    const cells: HTMLElement[] = [];
    for (let z = 0; z < GRID; z++) {
      for (let x = 0; x < GRID; x++) {
        const p = partAt(this.layout, x, z);
        const cls = ['evb-cell'];
        if (ghost.has(`${x},${z}`)) cls.push(g!.fit.ok ? 'ghost' : 'ghost bad');
        if (!g && x === (this.hover ?? this.cursor).x && z === (this.hover ?? this.cursor).z) cls.push('cursor');
        if (p && p.uid === this.selected) cls.push('sel');
        const cell = h('div', { class: cls.join(' '), 'data-x': String(x), 'data-z': String(z), title: p ? PARTS[p.part].name : '' });
        if (p) cell.style.background = PARTS[p.part].color;
        cells.push(cell);
      }
    }
    this.flat.replaceChildren(...cells);
  }

  private onFlatClick = (e: MouseEvent) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>('.evb-cell');
    if (!t) return;
    this.onCell({ x: Number(t.dataset.x), z: Number(t.dataset.z) }, 'tap');
  };

  private onFlatMove = (e: MouseEvent) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>('.evb-cell');
    if (!t) return;
    const c = { x: Number(t.dataset.x), z: Number(t.dataset.z) };
    if (this.hover && this.hover.x === c.x && this.hover.z === c.z) return;
    this.onCell(c, 'hover');
  };

  /** A square was tapped (place / pick) or hovered (move the ghost). */
  onCell(c: { x: number; z: number } | null, kind: 'tap' | 'hover') {
    if (this.testing || this.closed) return;
    if (kind === 'hover') {
      if (c && this.rest && (c.x !== this.rest.x || c.z !== this.rest.z)) this.rest = null;
      this.hover = c;
      this.paintGhost();
      return;
    }
    if (!c) {
      // Tapped the ground off the pad: put down what's in hand.
      if (this.selected !== null || this.mode.kind !== 'browse') this.cancel();
      return;
    }
    this.cursor = { ...c };
    this.act(c);
  }

  /** Do the main thing at a square: place, move there, or pick what's there. */
  private act(c: { x: number; z: number }) {
    const g = this.ghostAt(c);
    if (this.mode.kind === 'place' && g) {
      const res = this.editor.place(g.part, g.x, g.z, g.rot, this.unlocked, this.flagStyle);
      if ('uid' in res) {
        sfx('place');
        this.rest = { ...c };
        this.changed(res.uid);
        this.say(`${PARTS[g.part].name} placed.`);
      } else {
        sfx('deny');
        this.hover = c;
        this.paintGhost();
        this.say(res.reason);
      }
      return;
    }
    if (this.mode.kind === 'move' && g) {
      const uid = this.mode.uid;
      const res = this.editor.move(uid, g.x, g.z, g.rot);
      if (res.ok) {
        sfx('place');
        this.mode = { kind: 'browse' };
        this.selected = uid;
        this.changed(uid);
        this.say('Moved.');
      } else {
        sfx('deny');
        this.say(res.reason);
      }
      return;
    }
    const p = partAt(this.layout, c.x, c.z);
    if (p) {
      sfx('click');
      this.selected = p.uid;
      this.say(`${PARTS[p.part].name} picked. Turn it, move it or delete it.`);
    } else this.selected = null;
    this.renderTools();
    this.paintGhost();
  }

  private changed(dropUid?: number) {
    this.scene?.sync(this.layout, dropUid);
    this.refresh();
    if (!this.challenge) {
      window.clearTimeout(this.saveTimer);
      this.saveTimer = window.setTimeout(() => saveCurrent(this.layout), 300);
    }
  }

  /** Recompute the readout and redraw everything that depends on the pad. */
  private refresh() {
    this.r = readout(this.layout);
    if (this.selected !== null && !this.layout.parts.some((p) => p.uid === this.selected)) this.selected = null;
    this.renderReadout();
    this.renderGoal();
    this.renderTools();
    this.renderSites();
    this.undoBtn.disabled = !this.editor.canUndo || this.testing;
    this.redoBtn.disabled = !this.editor.canRedo || this.testing;
    this.paintGhost();
  }

  private say(text: string) {
    this.live.textContent = '';
    this.live.append(document.createTextNode(text));
  }

  // ---------------------------------------------------------------- actions
  pick(part: PartId) {
    if (this.testing) return;
    if (!this.unlocked.has(part)) {
      sfx('deny');
      const by = unlockedBy(part);
      this.say(by ? `Locked. Finish the blueprint "${by.title}" to unlock it.` : 'Locked.');
      toast('Locked part', by ? `Finish the blueprint "${by.title}" to unlock the ${PARTS[part].name}.` : '', { tone: 'cyan' });
      return;
    }
    sfx('click');
    const rot = this.mode.kind === 'place' && this.mode.part === part ? this.mode.rot : 0;
    this.mode = { kind: 'place', part, rot };
    this.selected = null;
    this.rest = null;
    this.renderPalette();
    this.renderTools();
    this.paintGhost();
    this.say(`${PARTS[part].name} in hand. ${PARTS[part].blurb}`);
  }

  rotate() {
    if (this.testing) return;
    if (this.mode.kind === 'place' || this.mode.kind === 'move') {
      this.mode = { ...this.mode, rot: ((this.mode.rot + 1) % 4) as Rot };
      sfx('click');
      this.paintGhost();
      return;
    }
    if (this.selected !== null) {
      const res = this.editor.rotate(this.selected);
      if (res.ok) {
        sfx('place');
        this.changed();
        this.say('Turned.');
      } else {
        sfx('deny');
        this.say(`It doesn't fit turned. ${res.reason}`);
        this.hint.textContent = res.reason;
      }
    }
  }

  startMove() {
    if (this.selected === null || this.testing) return;
    const p = this.layout.parts.find((q) => q.uid === this.selected);
    if (!p) return;
    this.mode = { kind: 'move', uid: p.uid, rot: p.rot };
    this.cursor = { x: p.x, z: p.z };
    sfx('click');
    this.renderTools();
    this.paintGhost();
    this.say('Moving. Tap or press Enter where it should go.');
  }

  remove() {
    if (this.selected === null || this.testing) return;
    const p = this.layout.parts.find((q) => q.uid === this.selected);
    if (!p || !this.editor.remove(p.uid)) return;
    sfx('remove');
    this.selected = null;
    this.changed();
    this.say(`${PARTS[p.part].name} removed.`);
  }

  restyle() {
    if (this.selected === null) return;
    if (this.editor.restyle(this.selected, FLAG_DESIGNS.length)) {
      const p = this.layout.parts.find((q) => q.uid === this.selected);
      this.flagStyle = p?.style ?? 0;
      sfx('click');
      this.changed();
      this.say(`Flag: ${FLAG_DESIGNS[this.flagStyle].name}.`);
    }
  }

  cancel() {
    this.mode = { kind: 'browse' };
    this.selected = null;
    this.renderPalette();
    this.renderTools();
    this.paintGhost();
  }

  undo() {
    if (this.testing || !this.editor.undo()) return;
    sfx('click');
    this.mode = this.mode.kind === 'move' ? { kind: 'browse' } : this.mode;
    this.changed();
    this.say('Undone.');
  }

  redo() {
    if (this.testing || !this.editor.redo()) return;
    sfx('click');
    this.changed();
    this.say('Redone.');
  }

  clearPad() {
    if (this.testing || !this.layout.parts.length) return;
    this.editor.clear();
    sfx('remove');
    this.selected = null;
    this.changed();
    this.say('The pad is clear. Undo brings it back.');
  }

  setSite(site: SiteId) {
    if (this.testing || this.challenge || site === this.layout.site) return;
    this.editor.setSite(site);
    sfx('click');
    this.changed();
    this.say(`Now building at ${SITE_NAMES[site]}.`);
  }

  // ---------------------------------------------------------------- panels
  private renderSites() {
    const lockSite = !!this.challenge;
    const btns = SITE_IDS.map((s) => {
      const on = this.layout.site === s;
      return h(
        'button',
        {
          class: `btn small evb-site${on ? ' on' : ''}`,
          type: 'button',
          role: 'radio',
          'aria-checked': on ? 'true' : 'false',
          disabled: lockSite && !on ? true : undefined,
          onclick: () => this.setSite(s),
        },
        SITE_SHORT[s],
      );
    });
    this.siteBox.replaceChildren(...btns);
  }

  private renderPalette() {
    const tabs = h(
      'div',
      { class: 'evb-cats', role: 'tablist', 'aria-label': 'Part groups' },
      ...CATEGORIES.map((c) =>
        h(
          'button',
          {
            class: `btn small evb-cat${c.id === this.cat ? ' on' : ''}`,
            type: 'button',
            role: 'tab',
            'aria-selected': c.id === this.cat ? 'true' : 'false',
            onclick: () => {
              this.cat = c.id;
              this.renderPalette();
              this.palette.querySelector<HTMLElement>('.evb-cat.on')?.focus();
            },
          },
          c.name,
        ),
      ),
    );
    const items = PART_IDS.filter((id) => PARTS[id].cat === this.cat).map((id) => {
      const p = PARTS[id];
      const unlocked = this.unlocked.has(id);
      const inHand = this.mode.kind === 'place' && this.mode.part === id;
      const by = unlocked ? null : unlockedBy(id);
      const moonNote = id === 'monitor' && this.layout.site === 'moon' ? ' Not needed on the Moon: Earth\'s warning takes 1.3 seconds.' : '';
      return h(
        'button',
        {
          class: `evb-part${unlocked ? '' : ' locked'}${inHand ? ' on' : ''}`,
          type: 'button',
          role: 'listitem',
          'data-part': id,
          'aria-pressed': inHand ? 'true' : 'false',
          'aria-label': `${p.name}. ${unlocked ? p.blurb + moonNote : `Locked. ${by ? `Finish "${by.title}" to unlock.` : ''}`}`,
          onclick: () => this.pick(id),
        },
        partIcon(id),
        h('span', { class: 'evb-part-text' }, h('b', null, p.name), h('small', null, unlocked ? p.blurb : by ? `Finish "${by.title}"` : 'Locked')),
        unlocked ? null : h('span', { class: 'evb-lock' }, lockIcon()),
      );
    });
    this.paletteList.replaceChildren(...items);
    this.palette.replaceChildren(tabs, this.paletteList);
  }

  private renderTools() {
    const b = (label: string, fn: () => void, opts: { key?: string; aria?: string; cls?: string; disabled?: boolean } = {}, ...kids: Child[]) =>
      h('button', { class: `btn small ${opts.cls ?? ''}`, type: 'button', 'aria-keyshortcuts': opts.key, 'aria-label': opts.aria, disabled: opts.disabled || this.testing ? true : undefined, onclick: fn }, ...kids, label);
    const row: HTMLElement[] = [];
    const sel = this.selected !== null ? this.layout.parts.find((p) => p.uid === this.selected) : null;
    if (this.mode.kind !== 'browse') {
      row.push(b('Turn', () => this.rotate(), { key: 'R' }), b('Done', () => this.cancel(), { key: 'Escape', cls: 'cyan' }));
    } else if (sel) {
      row.push(h('span', { class: 'evb-sel-name' }, PARTS[sel.part].name));
      row.push(b('Turn', () => this.rotate(), { key: 'R' }), b('Move', () => this.startMove(), { key: 'M' }), b('Delete', () => this.remove(), { key: 'Delete', cls: 'primary' }));
      if (sel.part === 'flag') row.push(b('Flag design', () => this.restyle(), { key: 'F' }));
      row.push(b('Done', () => this.cancel(), { cls: 'cyan' }));
    }
    const cam = h(
      'div',
      { class: 'evb-cam', role: 'group', 'aria-label': 'View' },
      b('', () => this.scene?.orbitBy(0.4), { key: 'Q', aria: 'Turn the view left (Q)', cls: 'icon-only' }, arrowIcon('left')),
      b('', () => this.scene?.orbitBy(-0.4), { key: 'E', aria: 'Turn the view right (E)', cls: 'icon-only' }, arrowIcon('right')),
      b('', () => this.scene?.zoomBy(0.8), { key: '+', aria: 'Zoom in (+)', cls: 'icon-only' }, arrowIcon('in')),
      b('', () => this.scene?.zoomBy(1.25), { key: '-', aria: 'Zoom out (-)', cls: 'icon-only' }, arrowIcon('out')),
      b('', () => this.scene?.resetView(), { aria: 'Reset the view', cls: 'icon-only' }, arrowIcon('home')),
    );
    cam.hidden = !this.scene;
    this.tools.replaceChildren(...row, cam);
  }

  private renderReadout() {
    const r = this.r;
    const b = r.counts;
    const s = r.sunny;
    const moon = b.site === 'moon';
    const day = moon ? 'turn' : 'sol';
    const crewUse = cellsForNeeds(s);
    const seg = (cls: string, n: number, label: string) => (n > 0 ? h('span', { class: `seg ${cls}`, style: `flex-grow:${n}`, title: `${label}: ${n}` }) : null);
    const bar = h(
      'div',
      { class: 'evb-bar', role: 'img', 'aria-label': `Power on a sunny ${day}: making ${s.cells} cells. Crew needs ${crewUse}, batteries ${s.use.battery}, rocket fuel ${s.use.fuel}, spare ${s.spare}.` },
      seg('need', crewUse, 'Crew needs'),
      seg('bat', s.use.battery, 'Into batteries'),
      seg('fuel', s.use.fuel, 'Rocket fuel'),
      seg('spare', s.spare, 'Spare'),
    );
    const hard = r.hardest;
    const hp = hard?.plan;
    const row = (label: string, value: string, ok: boolean | null) =>
      h('div', { class: `evb-row${ok === false ? ' bad' : ok ? ' ok' : ''}` }, h('span', null, label), h('b', null, value));
    const shelterText =
      b.crew === 0
        ? 'No crew yet'
        : b.shelters === 0
          ? 'No shelter'
          : b.seats < b.crew
            ? `Fits ${b.seats} of ${b.crew}`
            : (() => {
                const st = r.stress.sols.find((x) => x.day.storm);
                if (!st) return `Fits ${b.crew}`;
                if (!st.plan.warned) return 'No warning in time';
                return st.plan.sheltered >= b.crew ? `${Math.round(st.plan.block * 100)}% blocked` : 'Not enough power';
              })();
    const verdict = r.verdict;
    clear(this.readoutBox);
    this.readoutBox.classList.toggle('open', this.roOpen);
    append(this.readoutBox, [
      h(
        'div',
        { class: 'evb-ro-head' },
        h('b', null, 'Engineering readout'),
        h('span', null, SITE_NAMES[b.site]),
        h(
          'button',
          {
            class: 'btn small evb-ro-toggle',
            type: 'button',
            'aria-expanded': this.roOpen ? 'true' : 'false',
            onclick: () => {
              this.roOpen = !this.roOpen;
              this.renderReadout();
              this.readoutBox.querySelector<HTMLElement>('.evb-ro-toggle')?.focus();
            },
          },
          this.roOpen ? 'Less' : 'More',
        ),
      ),
      h('div', { class: 'evb-ro-label' }, `Power on a sunny ${day}: making `, h('b', null, String(s.cells)), ' cells'),
      bar,
      h(
        'div',
        { class: 'evb-legend', 'aria-hidden': 'true' },
        h('span', { class: 'k need' }, `Crew ${crewUse}`),
        s.use.battery ? h('span', { class: 'k bat' }, `Battery ${s.use.battery}`) : null,
        h('span', { class: 'k fuel' }, `Fuel ${s.use.fuel}`),
        s.spare ? h('span', { class: 'k spare' }, `Spare ${s.spare}`) : null,
      ),
      hard && hp && b.crew > 0
        ? h(
            'div',
            { class: `evb-hard${hp.heatShort > 0 || hp.airMade + 1e-9 < hp.airNeed || hp.foodMade + 1e-9 < hp.foodNeed ? ' bad' : ''}` },
            dayIconFor(hard.day),
            h('span', null, `Hardest ${day}: ${hard.day.label}. Making `, h('b', null, String(hp.cells)), `, crew needs `, h('b', null, String(cellsForNeeds(hp) + missingCells(hp))), '.'),
          )
        : null,
      row('Crew beds', `${b.crew}`, b.crew > 0),
      row(`Air per ${day}`, `${fmt(s.airMade)} of ${fmt(s.airNeed)}`, b.crew > 0 ? s.airMade + 1e-9 >= s.airNeed : null),
      row(`Food per ${day}`, `${fmt(s.foodMade)} of ${fmt(s.foodNeed)}`, b.crew > 0 ? s.foodMade + 1e-9 >= s.foodNeed : null),
      row('Heat', `${s.use.heat} of ${s.heatNeed} cells`, b.crew > 0 ? s.heatShort === 0 : null),
      row('Storm shelter', shelterText, b.crew > 0 ? shelterText.endsWith('blocked') : null),
      row('Rocket', !b.rocket ? 'No rocket' : r.solsToFill ? `Full in ${r.solsToFill} ${day}s` : 'No spare power', b.rocket ? !!r.solsToFill : null),
      h('p', { class: `evb-verdict ${verdict.tone}`, role: 'status' }, verdict.text),
      h(
        'button',
        { class: 'btn go evb-test-btn', type: 'button', disabled: this.testing ? true : undefined, onclick: () => void this.runTest() },
        'Run stress test',
      ),
      h(
        'p',
        { class: 'evb-fine' },
        `Numbers come from the game's own simulation (air, food, fuel and power per cell, dust, cold, radiation). Builder rules: ${BEDS_PER_HABITAT} beds per Habitat, ${SHELTER_SEATS} seats per shelter.`,
      ),
    ]);
  }

  private renderGoal() {
    const ch = this.challenge;
    if (!ch) {
      this.goalBox.hidden = true;
      this.el.classList.remove('has-goal');
      return;
    }
    const score = scoreChallenge(ch, { layout: this.layout, r: this.r });
    const best = this.stars[ch.id] ?? 0;
    const item = (ok: boolean, text: string, star?: number) =>
      h('li', { class: ok ? 'ok' : '' }, h('span', { class: 'evb-tick', 'aria-hidden': 'true' }, ok ? '+' : '-'), h('span', { class: 'sr-only' }, ok ? 'Done: ' : 'Not yet: '), star ? h('b', null, `Star ${star}: `) : null, text);
    // Keep the read-aloud bar when only the ticks change.
    const list = h(
      'ul',
      { class: 'evb-checks' },
      ...score.needs.map((n) => item(n.ok, n.text)),
      item(score.star2, ch.star2.text, 2),
      item(score.star3, ch.star3.text, 3),
    );
    const head = this.goalBox.querySelector('.evb-goal-text');
    if (head && this.goalBox.dataset.id === ch.id) {
      this.goalBox.querySelector('.evb-checks')?.replaceWith(list);
      this.goalBox.querySelector('.evb-goal-best')?.replaceWith(h('span', { class: 'evb-goal-best' }, starRow(best, 14), h('span', { class: 'sr-only' }, `Best: ${best} of 3 stars`)));
      return;
    }
    this.goalBox.dataset.id = ch.id;
    clear(this.goalBox);
    this.goalBox.append(
      h(
        'div',
        { class: 'evb-goal-head' },
        h('span', { class: 'kicker' }, `Blueprint ${CHALLENGES.indexOf(ch) + 1} of ${CHALLENGES.length}`),
        h('span', { class: 'evb-goal-best' }, starRow(best, 14), h('span', { class: 'sr-only' }, `Best: ${best} of 3 stars`)),
      ),
      h('h3', null, ch.title),
      h('p', { class: 'evb-goal-text' }, ch.goal),
      list,
      h('p', { class: 'evb-goal-tip' }, h('b', null, 'Tip: '), ch.tip),
      h('p', { class: 'evb-goal-note' }, 'Run the stress test to collect your stars.'),
    );
    try {
      decorateDialog(this.goalBox);
    } catch {
      /* read-aloud is optional */
    }
    this.goalBox.hidden = false;
    this.el.classList.add('has-goal');
  }

  private showPanel(content: Child, label: string, opts: { dismiss?: boolean; focus?: string } = {}) {
    try {
      if (reader.owner === 'dialog') reader.stop();
    } catch {
      /* nothing reading */
    }
    clear(this.overlay);
    const card = h('div', { class: 'evb-card', role: 'group', 'aria-label': label }, content);
    this.overlay.append(card);
    this.overlay.hidden = false;
    this.overlay.dataset.dismiss = opts.dismiss === false ? 'no' : 'yes';
    this.el.classList.add('has-overlay');
    try {
      decorateDialog(card);
    } catch {
      /* read-aloud is optional */
    }
    const first = (opts.focus ? card.querySelector<HTMLElement>(opts.focus) : null) ?? card.querySelector<HTMLElement>('button, input, a[href]');
    first?.focus();
  }

  private hidePanel() {
    try {
      if (reader.owner === 'dialog') reader.stop();
    } catch {
      /* nothing reading */
    }
    this.overlay.hidden = true;
    clear(this.overlay);
    this.el.classList.remove('has-overlay');
    this.stage.focus();
  }

  /** The start card: Free build, the Blueprints and saved bases. */
  showStart() {
    if (this.testing) return;
    this.stars = starsNow();
    const tot = starTotals(this.stars);
    const cards = CHALLENGES.map((c, i) => {
      const openNow = isOpen(i, this.stars);
      const n = this.stars[c.id] ?? 0;
      return h(
        'li',
        null,
        h(
          'button',
          {
            class: `evb-bp${openNow ? '' : ' locked'}${n ? ' done' : ''}`,
            type: 'button',
            'data-challenge': c.id,
            'aria-label': `Blueprint ${i + 1}: ${c.title}, at ${SITE_SHORT[c.site]}. ${openNow ? `${n} of 3 stars.` : `Locked: get a star on "${CHALLENGES[i - 1]?.title}" first.`}`,
            onclick: () => {
              if (!openNow) {
                sfx('deny');
                this.say(`Get a star on "${CHALLENGES[i - 1]?.title}" first.`);
                return;
              }
              this.startChallenge(c);
            },
          },
          h('span', { class: 'evb-bp-n' }, String(i + 1)),
          h('span', { class: 'evb-bp-text' }, h('b', null, c.title), h('small', null, SITE_SHORT[c.site])),
          openNow ? starRow(n, 12) : h('span', { class: 'evb-lock' }, lockIcon()),
        ),
      );
    });
    this.showPanel(
      h(
        'div',
        { class: 'evb-start' },
        h('div', { class: 'kicker' }, BUILDER_LABEL),
        h('h2', null, 'Design your own base'),
        h(
          'p',
          null,
          'Build on real ground at Gale Crater, the icy plains of Arcadia, or the Moon. The readout checks your design with the game\'s real numbers: power, air, food, heat and storm safety.',
        ),
        h(
          'div',
          { class: 'actions' },
          h('button', { class: 'btn go evb-free', type: 'button', onclick: () => this.freeBuild() }, 'Free build'),
          h('button', { class: 'btn small', type: 'button', onclick: () => this.showBases() }, 'My bases'),
          h('button', { class: 'btn small', type: 'button', onclick: () => this.close() }, 'Close'),
        ),
        h('h3', null, 'Blueprints ', h('span', { class: 'evb-count' }, `${tot.done} of ${CHALLENGES.length} done, ${tot.got} of ${tot.max} stars`)),
        h('ul', { class: 'evb-bps' }, ...cards),
      ),
      'Outpost Architect start',
      { focus: '.evb-free' },
    );
  }

  freeBuild() {
    sfx('click');
    const wasChallenge = !!this.challenge;
    this.challenge = null;
    // A fresh undo history: Undo never brings back a Blueprint's base.
    if (wasChallenge) this.editor = new Editor(loadCurrent() ?? emptyLayout(this.layout.site));
    this.mode = { kind: 'browse' };
    this.selected = null;
    this.hidePanel();
    this.changed();
    this.say('Free build. Pick a part and tap the pad.');
  }

  startChallenge(c: Challenge) {
    sfx('click');
    if (!this.challenge) saveCurrent(this.layout);
    this.challenge = c;
    // A fresh pad and undo history at the Blueprint's site.
    this.editor = new Editor(emptyLayout(c.site));
    this.mode = { kind: 'browse' };
    this.selected = null;
    this.goalBox.dataset.id = '';
    this.hidePanel();
    this.changed();
    this.say(`Blueprint: ${c.title}. ${c.goal}`);
  }

  /** Save and share: the slots, the share code and link, and opening a code. */
  showBases(msg = '') {
    if (this.testing) return;
    const save = readSave();
    const nameIn = h('input', { class: 'evb-name', type: 'text', maxlength: '24', value: this.challenge ? this.challenge.title : 'My base', 'aria-label': 'Base name' });
    const slots = save.slots.map((s, i) =>
      h(
        'li',
        { class: 'evb-slot' },
        h('span', { class: 'evb-slot-name' }, s ? h('b', null, s.name) : h('i', null, `Empty slot ${i + 1}`), s ? h('small', null, slotInfo(s.code)) : null),
        h('button', { class: 'btn small go', type: 'button', onclick: () => this.saveTo(i, nameIn.value) }, s ? 'Save over' : 'Save here'),
        s ? h('button', { class: 'btn small cyan', type: 'button', onclick: () => this.loadFrom(s.code, s.name) }, 'Load') : null,
        s
          ? h(
              'button',
              {
                class: 'btn small',
                type: 'button',
                'aria-label': `Delete ${s.name}`,
                onclick: () => {
                  deleteSlot(i);
                  sfx('remove');
                  this.showBases(`Deleted ${s.name}.`);
                },
              },
              'Delete',
            )
          : null,
      ),
    );
    const code = encodeLayout(this.layout);
    const link = shareLink(this.layout);
    const linkIn = h('input', { class: 'evb-link', type: 'text', readonly: true, value: link, 'aria-label': 'Share link' });
    const codeIn = h('input', { class: 'evb-code-in', type: 'text', maxlength: '800', placeholder: 'Paste a base code or link', 'aria-label': 'Open a base code' });
    const status = h('p', { class: 'evb-msg', role: 'status' }, msg);
    this.showPanel(
      h(
        'div',
        { class: 'evb-bases' },
        h('div', { class: 'kicker' }, 'Save and share'),
        h('h2', null, 'My bases'),
        h('label', { class: 'evb-field' }, 'Name: ', nameIn),
        h('ul', { class: 'evb-slots' }, ...slots),
        h('h3', null, 'Share this base'),
        h('p', null, 'Anyone with this link can open a copy of your base and remix it. The code holds only the base, nothing about you.'),
        h('div', { class: 'evb-share' }, linkIn, h('button', { class: 'btn small cyan', type: 'button', onclick: () => void this.copy(link, status) }, 'Copy link')),
        h('p', { class: 'evb-code' }, 'Code: ', h('code', null, code)),
        h('h3', null, 'Open a friend\'s base'),
        h(
          'div',
          { class: 'evb-share' },
          codeIn,
          h(
            'button',
            {
              class: 'btn small',
              type: 'button',
              onclick: () => {
                const raw = codeIn.value.trim();
                const m = /[?&]base=([0-9a-zA-Z]+)/.exec(raw);
                const l = decodeLayout(m ? m[1] : raw);
                if (!l) {
                  sfx('deny');
                  status.textContent = 'That code did not work. Check it and try again.';
                  return;
                }
                this.loadFrom(encodeLayout(l), 'Shared base');
              },
            },
            'Open',
          ),
        ),
        status,
        h('div', { class: 'actions end' }, h('button', { class: 'btn small', type: 'button', onclick: () => this.hidePanel() }, 'Back to building')),
      ),
      'Save and share',
    );
  }

  private saveTo(i: number, name: string) {
    saveSlot(i, name, this.layout);
    sfx('good');
    this.showBases(`Saved in slot ${i + 1}.`);
  }

  private loadFrom(code: string, name: string) {
    const l = decodeLayout(code);
    if (!l) return;
    this.challenge = null;
    this.editor.load(l);
    this.mode = { kind: 'browse' };
    this.selected = null;
    sfx('place');
    this.hidePanel();
    this.changed();
    this.say(`Loaded ${name}. Undo goes back.`);
  }

  private async copy(text: string, status: HTMLElement) {
    try {
      await navigator.clipboard.writeText(text);
      status.textContent = 'Link copied!';
      sfx('good');
    } catch {
      const input = this.overlay.querySelector<HTMLInputElement>('.evb-link');
      input?.focus();
      input?.select();
      status.textContent = 'Press Ctrl+C (or Cmd+C) to copy the selected link.';
    }
  }

  // ---------------------------------------------------------------- stress test
  async runTest() {
    if (this.testing) return;
    const res: StressResult = this.r.stress;
    this.testing = true;
    this.mode = { kind: 'browse' };
    this.selected = null;
    this.el.classList.add('testing');
    this.refresh();
    const moon = this.layout.site === 'moon';
    const chips = res.sols.map((s) =>
      h('li', { class: 'evb-chip' }, dayIconFor(s.day), h('span', null, `${moon ? 'Turn' : 'Sol'} ${s.day.sol}`), h('small', null, s.day.label)),
    );
    const meters = h('div', { class: 'evb-meters' });
    const line = h('p', { class: 'evb-tl-line' });
    clear(this.timeline);
    this.timeline.append(
      h('div', { class: 'evb-tl-head' }, h('b', null, 'Stress test'), h('span', null, 'A simplified test using the game\'s numbers'), h('button', { class: 'btn small', type: 'button', onclick: () => this.skipTest?.() }, 'Skip')),
      h('ol', { class: 'evb-chips' }, ...chips),
      line,
      meters,
    );
    this.timeline.hidden = false;
    this.timeline.removeAttribute('aria-hidden');
    sfx('run');
    this.say('Stress test started.');
    const step = this.reduced ? 450 : 1100;
    let skipped = false;
    const wait = (ms: number) =>
      new Promise<void>((resolve) => {
        const t = window.setTimeout(resolve, ms);
        this.skipTest = () => {
          skipped = true;
          window.clearTimeout(t);
          resolve();
        };
      });
    const crew = Math.max(1, res.crew);
    for (let i = 0; i < res.sols.length && !skipped && !this.closed; i++) {
      const s = res.sols[i];
      chips.forEach((c, j) => c.classList.toggle('now', j === i));
      chips[i].classList.toggle('bad', s.plan.heatShort > 0 || s.plan.airMade + 1e-9 < s.plan.airNeed || s.plan.foodMade + 1e-9 < s.plan.foodNeed || (!!s.day.storm && s.plan.block < 0.5));
      const need = cellsForNeeds(s.plan) + missingCells(s.plan);
      const mood: Partial<Mood> = {
        dust: s.day.weather === 'storm' ? 1 : s.day.weather === 'dusty' ? 0.55 : 0,
        night: s.day.night ? 1 : s.day.coldSnap ? 0.7 : 0,
        cold: s.day.coldSnap || s.day.night ? 1 : 0,
        storm: s.day.storm ? 1 : 0,
        shelter: s.day.storm && s.plan.sheltered > 0 ? 1 : 0,
        power: need > 0 ? Math.min(1, s.plan.cells / need) : 1,
      };
      this.scene?.setMood(mood, !!s.day.storm);
      if (s.day.storm) sfx('storm');
      else if (mood.power! < 1) sfx('alarm');
      else sfx('click');
      meters.replaceChildren(
        meter('Air', `${fmt(s.air / crew)} days`, Math.min(1, s.air / crew / 8), s.air <= 1e-9 ? 'bad' : 'air'),
        meter('Food', `${fmt(s.food / crew)} days`, Math.min(1, s.food / crew / 8), s.food <= 1e-9 ? 'bad' : 'food'),
        meter('Radiation', `${fmt(s.dose)} of ${res.doseBudget} mSv`, Math.min(1, s.dose / res.doseBudget), 'dose'),
        meter('Rocket', `${Math.round(s.fuel)}%`, s.fuel / 100, 'fuel'),
      );
      line.textContent = dayLine(s, moon);
      this.say(dayLine(s, moon));
      await wait(step);
    }
    this.skipTest = null;
    if (this.closed) return;
    this.scene?.setMood({ dust: 0, night: 0, cold: 0, storm: 0, shelter: 0, power: 1 });
    this.timeline.hidden = true;
    this.testing = false;
    this.el.classList.remove('testing');
    this.refresh();
    this.showResult(res);
  }

  private showResult(res: StressResult) {
    const moon = res.site === 'moon';
    sfx(res.pass ? (res.stars === 3 ? 'win' : 'good') : 'bad');
    const ev = res.event;
    const lines: Child[] = [];
    // Blueprint stars.
    let bp: HTMLElement | null = null;
    let next: Challenge | null = null;
    if (this.challenge) {
      const ch = this.challenge;
      const idx = CHALLENGES.indexOf(ch);
      const score = scoreChallenge(ch, { layout: this.layout, r: this.r });
      const before = this.stars[ch.id] ?? 0;
      const rec = recordStars(ch.id, score.stars);
      let xp = 0;
      if (rec.added > 0) {
        xp = rec.added * xpPerStar(idx);
        emitGame('xp', { amount: xp, reason: `Blueprint "${ch.title}": ${score.stars} ${score.stars === 1 ? 'star' : 'stars'}` });
        this.stars = starsNow();
        const was = this.unlocked;
        this.unlocked = unlockedParts(this.stars);
        const fresh = [...this.unlocked].filter((p) => !was.has(p));
        for (const p of fresh) toast(`New part: ${PARTS[p].name}`, 'Find it in the parts list.', { tone: 'gold', icon: partIcon(p, 24) as unknown as HTMLElement });
        if (fresh.length) this.renderPalette();
        if (score.stars >= 1 && before === 0) next = CHALLENGES[idx + 1] ?? null;
      }
      if (!next && score.stars >= 1 && (CHALLENGES[idx + 1] && isOpen(idx + 1, this.stars))) next = CHALLENGES[idx + 1];
      bp = h(
        'div',
        { class: 'evb-bp-result' },
        h('b', null, `Blueprint: ${ch.title}`),
        starRow(score.stars, 22),
        h('span', { class: 'sr-only' }, `${score.stars} of 3 stars.`),
        rec.added ? h('p', { class: 'evb-xp' }, h('b', null, `+${xp} XP`), ` for ${rec.added} new ${rec.added === 1 ? 'star' : 'stars'}!`) : score.stars ? h('p', null, `Your best: ${Math.max(before, score.stars)} stars.`) : h('p', null, 'No stars yet. Check the goal list and try again!'),
        ch.unlocks.length && score.stars >= 1 ? h('p', { class: 'evb-unlock' }, `Unlocked: ${ch.unlocks.map((p) => PARTS[p].name).join(', ')}.`) : null,
      );
      this.renderGoal();
    }
    const starsLabel = ['Pass', 'Steady', 'Storm-proof'];
    lines.push(
      h('div', { class: 'kicker' }, 'Stress test: a simplified test using the game\'s numbers'),
      h('h2', null, res.pass ? (res.stars === 3 ? 'Perfect run!' : 'Passed!') : 'Not yet'),
      h(
        'ul',
        { class: 'evb-test-stars' },
        ...[res.pass, res.steady, res.stormProof].map((ok, i) =>
          h('li', { class: ok ? 'ok' : '' }, starRow(ok ? 1 : 0, 16).firstElementChild as Element, h('b', null, starsLabel[i]), h('span', { class: 'sr-only' }, ok ? ' earned' : ' not yet'), h('small', null, STAR_TEXT[i])),
        ),
      ),
      h('ul', { class: 'evb-notes' }, ...res.notes.map((n) => h('li', null, n))),
      h(
        'p',
        { class: 'evb-stats' },
        `After ${res.sols.length} ${moon ? 'turns' : 'sols'}: ${fmt(res.airLeft / Math.max(1, res.crew))} days of air and ${fmt(res.foodLeft / Math.max(1, res.crew))} days of food left. Radiation: ${fmt(res.dose)} of the ${res.doseBudget} mSv game budget. Rocket: ${Math.round(res.fuel)}%.`,
      ),
      ev
        ? h(
            'p',
            { class: 'evb-event' },
            h('b', null, 'The solar storm was real: '),
            `a huge eruption on ${new Date(ev.time).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })} from the far side of the Sun (the side facing Mars)`,
            ev.speedKms ? `, racing out at ${ev.speedKms.toLocaleString('en-US')} km/s` : '',
            '. Data from NASA DONKI. ',
            ev.link ? h('a', { href: ev.link, target: '_blank', rel: 'noopener' }, 'See the record') : null,
          )
        : null,
      h('p', { class: 'evb-fine' }, moon ? `The game squeezes the Moon's ${LUNAR_NIGHT_DAYS}-day night into ${MOON_TUNING.cadet.nightLength} turns, and radiation numbers are scaled game values.` : 'Dust, cold and radiation sizes are the game\'s scaled values; the storm itself is a real NASA record.'),
      bp,
      h(
        'div',
        { class: 'actions' },
        h('button', { class: 'btn go', type: 'button', onclick: () => this.hidePanel() }, 'Keep building'),
        next ? h('button', { class: 'btn small cyan', type: 'button', onclick: () => this.startChallenge(next!) }, `Next: ${next.title}`) : null,
        h('button', { class: 'btn small', type: 'button', onclick: () => this.showStart() }, 'Blueprints'),
      ),
    );
    this.showPanel(h('div', { class: 'evb-result' }, ...lines), 'Stress test results');
  }

  // ---------------------------------------------------------------- keyboard
  private onKey = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement | null;
    const typing = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      if (this.testing) return this.skipTest?.();
      if (!this.overlay.hidden) {
        if (this.overlay.querySelector('.evb-start')) return this.close();
        return this.hidePanel();
      }
      if (this.mode.kind !== 'browse' || this.selected !== null) return this.cancel();
      return this.close();
    }
    if (typing || !this.overlay.hidden) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && (e.key === 'z' || e.key === 'Z')) {
      e.preventDefault();
      return e.shiftKey ? this.redo() : this.undo();
    }
    if (mod && (e.key === 'y' || e.key === 'Y')) {
      e.preventDefault();
      return this.redo();
    }
    if (mod || e.altKey) return;
    const onPad = t === this.stage || t === this.el;
    const k = e.key;
    if (onPad && (k === 'ArrowLeft' || k === 'ArrowRight' || k === 'ArrowUp' || k === 'ArrowDown')) {
      e.preventDefault();
      const dx = k === 'ArrowLeft' ? -1 : k === 'ArrowRight' ? 1 : 0;
      const dz = k === 'ArrowUp' ? -1 : k === 'ArrowDown' ? 1 : 0;
      this.hover = null;
      this.rest = null;
      this.cursor = { x: Math.max(0, Math.min(GRID - 1, this.cursor.x + dx)), z: Math.max(0, Math.min(GRID - 1, this.cursor.z + dz)) };
      this.paintGhost();
      const p = partAt(this.layout, this.cursor.x, this.cursor.z);
      const g = this.ghostAt(this.cursor);
      this.say(`Square ${this.cursor.x + 1}, ${this.cursor.z + 1}. ${g ? (g.fit.ok ? 'Fits here.' : g.fit.reason) : p ? PARTS[p.part].name + '.' : 'Empty.'}`);
      return;
    }
    if (onPad && (k === 'Enter' || k === ' ')) {
      e.preventDefault();
      this.hover = null;
      return this.act(this.cursor);
    }
    if (k === 'r' || k === 'R') return this.rotate();
    if (k === 'm' || k === 'M') return this.startMove();
    if (k === 'f' || k === 'F') return this.restyle();
    if ((k === 'Delete' || k === 'Backspace') && this.selected !== null) {
      e.preventDefault();
      return this.remove();
    }
    if (k === 'q' || k === 'Q') return this.scene?.orbitBy(0.4);
    if (k === 'e' || k === 'E') return this.scene?.orbitBy(-0.4);
    if (k === '+' || k === '=') return this.scene?.zoomBy(0.8);
    if (k === '-' || k === '_') return this.scene?.zoomBy(1.25);
  };

  // ---------------------------------------------------------------- close
  close() {
    if (this.closed) return;
    this.closed = true;
    this.skipTest?.();
    window.clearTimeout(this.saveTimer);
    if (!this.challenge) saveCurrent(this.layout);
    try {
      if (reader.owner === 'dialog') reader.stop();
    } catch {
      /* nothing reading */
    }
    try {
      this.scene?.dispose();
    } catch (e) {
      console.warn('[builder] dispose failed', e);
    }
    this.scene = null;
    this.el.removeEventListener('keydown', this.onKey);
    this.el.remove();
    for (const { el, had } of this.inertEls) if (!had) el.removeAttribute('inert');
    this.inertEls = [];
    if (this.gameStage) this.gameStage.el.style.display = this.gameStage.display;
    this.gameStage = null;
    if (open === this) open = null;
    sfx('click');
    // Back on the title screen: redraw it so the Outpost Architect tile shows the new status.
    try {
      metaContext()?.showTitle();
    } catch {
      /* the title will redraw next time */
    }
    const back = document.querySelector<HTMLElement>('[data-tile="builder"]') ?? (this.returnFocus?.isConnected ? this.returnFocus : null);
    back?.focus();
  }
}

const STAR_TEXT = ['Air and food never ran out, and everyone was in a powered shelter in the storm.', 'Heat, air and food were made every day.', 'Everyone 90% shielded, and the rocket got fuel every day.'];

function missingCells(p: { heatShort: number; airNeed: number; airMade: number; foodNeed: number; foodMade: number }): number {
  // Rough cells still missing for air and food (for the "crew needs" number). Heat is counted exactly.
  return p.heatShort + (p.airMade + 1e-9 < p.airNeed ? 1 : 0) + (p.foodMade + 1e-9 < p.foodNeed ? 1 : 0);
}

function dayIconFor(d: { weather: string; night: boolean; coldSnap: boolean; storm?: unknown }): SVGSVGElement {
  const kind: DayIcon = d.storm ? 'storm' : d.night ? 'night' : d.weather !== 'clear' ? 'dust' : d.coldSnap ? 'cold' : 'sun';
  return dayIcon(kind);
}

function dayLine(s: StressResult['sols'][number], moon: boolean): string {
  const p = s.plan;
  const unit = moon ? 'Turn' : 'Sol';
  const parts = [`${unit} ${s.day.sol}: ${s.day.label}.`, `Power ${p.cells} cells.`];
  if (s.day.storm) parts.push(p.warned ? (p.sheltered ? `Crew in the shelter: ${Math.round(p.block * 100)}% blocked.` : 'No room or power in a shelter!') : 'No warning in time!');
  if (p.heatShort) parts.push('Too cold!');
  if (p.airMade + 1e-9 < p.airNeed) parts.push('Using saved air.');
  if (p.foodMade + 1e-9 < p.foodNeed) parts.push('Using saved food.');
  if (p.fuelPct > 0) parts.push(`Rocket +${Math.round(p.fuelPct)}%.`);
  return parts.join(' ');
}

function meter(label: string, value: string, frac: number, cls: string): HTMLElement {
  return h(
    'div',
    { class: `evb-meter ${cls}` },
    h('span', { class: 'lbl' }, label),
    h('span', { class: 'bar' }, h('span', { class: 'fill', style: `width:${Math.round(Math.max(0, Math.min(1, frac)) * 100)}%` })),
    h('span', { class: 'val' }, value),
  );
}

function slotInfo(code: string): string {
  const l = decodeLayout(code);
  if (!l) return '';
  const crew = l.parts.filter((p) => p.part === 'habitat').length * BEDS_PER_HABITAT;
  return `${SITE_SHORT[l.site]}, ${l.parts.length} parts, ${crew} crew`;
}

/** For tests: the view on screen. */
export function currentBuilder(): BuilderView | null {
  return open;
}
