// Written with AI assistance (Claude Code). See README "Use of AI tools".
// The teacher dashboard page: /?dashboard=CODE&key=KEY.
// A page of its own on top of the game's HTML (the game stays hidden and idle). It asks the
// server for the class board every ~10 seconds (only "anything new?" when nothing changed),
// and keeps the secret key out of the address bar once loaded, so it is not on the projector.

import { h, clear, append } from '../dom';
import { CLASS_LIMITS, type DashboardLink, type DashboardResponse, type DashboardView, type PlayerView } from '../../class/protocol';
import { teacherKeyFor } from '../classboard';
import { dashboardBody, type SortKey, type ViewState } from './views';

type Status = 'loading' | 'ok' | 'offline' | 'gone' | 'denied' | 'nokey';

export interface DashboardOptions {
  /** Where to draw (default: a new <main> on the page, with the game hidden). */
  root?: HTMLElement;
  refreshMs?: number;
}

const sessionKeyName = (code: string) => `ev-dash-key-${code}`;

function sessionKey(code: string): string | null {
  try {
    return sessionStorage.getItem(sessionKeyName(code));
  } catch {
    return null;
  }
}

const timeOf = (ms: number) => new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
const dateOf = (ms: number) => new Date(ms).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

export class DashboardPage {
  readonly code: string;
  private key: string | null;
  private view: DashboardView | null = null;
  private status: Status = 'loading';
  private changedAt: number | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private confirmClear = false;
  private resetTimer: ReturnType<typeof setTimeout> | null = null;
  private st: ViewState = { hideNames: false, manage: false, sort: 'name', dir: 1, confirm: null };
  private refreshMs: number;
  private onVisible = () => {
    if (!document.hidden) void this.refresh();
  };

  constructor(
    link: DashboardLink,
    private root: HTMLElement,
    opts: DashboardOptions = {},
  ) {
    this.code = link.code;
    this.refreshMs = opts.refreshMs ?? CLASS_LIMITS.refreshMs;
    this.key = link.key ?? sessionKey(link.code) ?? teacherKeyFor(link.code);
    if (link.key) {
      // Remember it for this tab only, and take it out of the address bar (it would show on the projector).
      try {
        sessionStorage.setItem(sessionKeyName(link.code), link.key);
        history.replaceState(null, '', `/?dashboard=${link.code}`);
      } catch {
        /* keep the key in the address bar then */
      }
    }
    document.title = `Class board ${this.code}: Escape Velocity`;
  }

  /** First load, then a check every ~10 seconds. */
  async start(): Promise<void> {
    document.addEventListener('visibilitychange', this.onVisible);
    if (!this.key) {
      this.status = 'nokey';
      this.render();
      return;
    }
    this.render();
    await this.refresh();
  }

  stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    if (this.resetTimer) clearTimeout(this.resetTimer);
    document.removeEventListener('visibilitychange', this.onVisible);
  }

  private schedule() {
    if (this.timer) clearTimeout(this.timer);
    if (this.stopped || this.status === 'gone' || this.status === 'denied' || this.status === 'nokey') return;
    this.timer = setTimeout(() => void this.refresh(), this.refreshMs);
  }

  /** Ask the server for anything new. `full`: ignore the version we have. */
  async refresh(full = false): Promise<void> {
    if (this.stopped || !this.key) return;
    if (typeof document !== 'undefined' && document.hidden && this.view) return this.schedule();
    const since = this.view && !full ? `&since=${this.view.v}` : '';
    const before = `${this.status}:${this.view?.v ?? ''}`;
    try {
      const res = await fetch(`/api/class/${this.code}?key=${this.key}${since}`, { cache: 'no-store' });
      if (res.status === 404) this.status = 'gone';
      else if (res.status === 403) this.status = 'denied';
      else if (!res.ok) this.status = 'offline';
      else {
        const json = (await res.json()) as DashboardResponse;
        if (!('unchanged' in json)) {
          if (!this.view || json.v !== this.view.v) this.changedAt = Date.now();
          this.view = json;
        }
        this.status = 'ok';
      }
    } catch {
      this.status = 'offline';
    }
    // Redraw only when something changed (keeps scroll, focus and screen readers calm on a quiet board).
    if (full || `${this.status}:${this.view?.v ?? ''}` !== before) this.render();
    this.schedule();
  }

  private async teacher(body: Record<string, unknown>): Promise<boolean> {
    try {
      const res = await fetch(`/api/class/${this.code}/teacher`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...body, key: this.key }) });
      return res.ok;
    } catch {
      return false;
    }
  }

  // ------------------------------------------------------------ drawing

  private setState(patch: Partial<ViewState>, focus?: string) {
    this.st = { ...this.st, ...patch };
    this.render(focus);
  }

  private sortBy(key: SortKey) {
    // Numbers read best biggest-first; words A to Z.
    const firstDir: 1 | -1 = key === 'name' || key === 'site' || key === 'last' || key === 'best' ? 1 : -1;
    this.setState({ sort: key, dir: this.st.sort === key ? ((-this.st.dir) as 1 | -1) : firstDir }, `sort-${key}`);
  }

  private async remove(p: PlayerView) {
    if (this.st.confirm !== p.num) {
      this.setState({ confirm: p.num }, `remove-${p.num}`);
      if (this.resetTimer) clearTimeout(this.resetTimer);
      this.resetTimer = setTimeout(() => this.setState({ confirm: null }), 5000);
      return;
    }
    this.st.confirm = null;
    if (await this.teacher({ action: 'remove', num: p.num })) await this.refresh(true);
    else this.render();
  }

  private async clearAll() {
    if (!this.confirmClear) {
      this.confirmClear = true;
      this.render('clear');
      if (this.resetTimer) clearTimeout(this.resetTimer);
      this.resetTimer = setTimeout(() => {
        this.confirmClear = false;
        this.render();
      }, 5000);
      return;
    }
    this.confirmClear = false;
    if (await this.teacher({ action: 'clear' })) await this.refresh(true);
    else this.render();
  }

  private toggleFullscreen() {
    if (document.fullscreenElement) void document.exitFullscreen?.();
    else void document.documentElement.requestFullscreen?.().catch(() => undefined);
  }

  private statusText(): string {
    switch (this.status) {
      case 'loading':
        return 'Loading the class board...';
      case 'offline':
        return this.view ? 'Cannot reach the game server right now. Showing the last results; trying again.' : 'Cannot reach the game server. Trying again every 10 seconds.';
      default:
        return `Live: checks for new results every 10 seconds.${this.changedAt ? ` Last change at ${timeOf(this.changedAt)}.` : ''}`;
    }
  }

  private problem(): HTMLElement | null {
    const p = (title: string, text: string) => h('section', { class: 'db-card db-problem', role: 'alert' }, h('h2', null, title), h('p', null, text), h('p', null, h('a', { href: '/teacher/' }, 'Teacher guide'), ' · ', h('a', { href: '/' }, 'Open the game')));
    switch (this.status) {
      case 'nokey':
        return p('This link is missing its key', 'Open the full dashboard link you copied when you made the class code. It ends with "&key=" and a long string of letters and numbers.');
      case 'denied':
        return p('This dashboard link is not right', 'Check that you copied the whole link. If you lost it, make a new class code in the game: it comes with a new dashboard link.');
      case 'gone':
        return p(
          `There is no class board for ${this.code}`,
          'Class boards and their results are deleted 7 days after the last result. Make a new class code in the game to start a new board.',
        );
      default:
        return null;
    }
  }

  render(focus?: string) {
    // Keep keyboard focus on the same control across redraws (every 10 seconds).
    const had = focus ?? (document.activeElement as HTMLElement | null)?.dataset?.fk;
    clear(this.root);
    const v = this.view;
    const fs = typeof document.fullscreenEnabled === 'boolean' && document.fullscreenEnabled;
    const tool = (fk: string, label: string, pressed: boolean | null, onclick: () => void) =>
      h('button', { class: 'btn small', 'data-fk': fk, ...(pressed === null ? {} : { 'aria-pressed': String(pressed) }), onclick }, label);
    const tools =
      this.status === 'ok' || (this.status === 'offline' && v)
        ? h(
            'div',
            { class: 'db-tools' },
            tool('hide', 'Hide names', this.st.hideNames, () => this.setState({ hideNames: !this.st.hideNames }, 'hide')),
            tool('manage', 'Manage', this.st.manage, () => this.setState({ manage: !this.st.manage, confirm: null }, 'manage')),
            fs ? tool('fs', 'Full screen', null, () => this.toggleFullscreen()) : null,
          )
        : null;
    const problem = this.problem();

    append(this.root, [
      h(
        'header',
        { class: 'db-head' },
        h(
          'div',
          { class: 'db-title' },
          h('div', { class: 'kicker' }, 'Escape Velocity · Teacher dashboard'),
          h('h1', null, 'Class board ', h('span', { class: 'cc-chip big' }, this.code)),
          problem ? null : h('p', { class: 'db-join' }, 'Students: open ', h('b', null, location.host || 'the game'), ' and type the class code ', h('b', null, this.code), '.'),
        ),
        tools,
      ),
      problem ? null : h('p', { class: `db-status ${this.status}`, role: 'status' }, this.statusText()),
      problem ?? (v ? h('div', { class: 'db-body' }, dashboardBody(v, this.st, { onSort: (k) => this.sortBy(k), onRemove: (p) => void this.remove(p) })) : null),
      v && !problem
        ? h(
            'footer',
            { class: 'db-foot' },
            h(
              'p',
              null,
              'Privacy: the board shows only nicknames (or "Player 3") and game results. No accounts, no other student information. ',
              `This board and every result are deleted on ${dateOf(v.expiresAt)}, 7 days after the last result.`,
            ),
            this.st.manage
              ? h(
                  'div',
                  { class: 'db-manage' },
                  h('p', null, 'Manage: press Remove next to a student to take them off the board (they cannot come back on this board). '),
                  h('button', { class: `btn small ${this.confirmClear ? 'primary' : ''}`, 'data-fk': 'clear', onclick: () => void this.clearAll() }, this.confirmClear ? 'Sure? Delete every result' : 'Delete every result now'),
                )
              : null,
            h('p', null, h('a', { href: '/teacher/' }, 'Teacher guide'), ' · ', h('a', { href: '/' }, 'Open the game')),
          )
        : null,
    ]);
    if (had) this.root.querySelector<HTMLElement>(`[data-fk="${had}"]`)?.focus();
  }
}

/** Open the dashboard as its own page (the game's screens are hidden). */
export function openDashboard(link: DashboardLink, opts: DashboardOptions = {}): DashboardPage {
  let root = opts.root;
  if (!root) {
    document.documentElement.classList.add('dash-mode');
    root = h('main', { id: 'dashboard', class: 'db' });
    document.body.append(root);
  }
  const page = new DashboardPage(link, root, opts);
  void page.start();
  return page;
}
