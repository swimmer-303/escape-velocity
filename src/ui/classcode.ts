// Written with AI assistance (Claude Code). See README "Use of AI tools".
// The "Class code" area on the New campaign and Quick mission screens: students type the
// code from the board, and teachers make a new code (shown big, plus a link to share).
// Also the reminder line shown in the pause menu and on the end screens.

import { h, clear } from './dom';
import { checkClassCode, classCodeFromSearch, makeClassCode, type CodeProblem } from '../sim/classcode';

const PROBLEM: Record<CodeProblem, string> = {
  empty: 'Type the code from your teacher first.',
  length: 'A class code has 5 letters and numbers. Check the board and try again.',
  letters: 'That code has a letter or number that class codes never use (like O, I or 0). Check the board and try again.',
};

/** The link a teacher shares: this game, with the code in it. */
export function classCodeLink(code: string, origin: string = location.origin): string {
  return `${origin}/?code=${code}`;
}

/** "Class code K7RZQ: compare your stars and choices with classmates." */
export function classCodeLine(code: string | null | undefined): HTMLElement | null {
  if (!code) return null;
  return h('div', { class: 'card cc-compare' }, h('b', null, 'Class code '), h('span', { class: 'cc-chip' }, code), ': compare your stars and choices with classmates.');
}

export interface PanelOptions {
  /** Shown once a code is on, e.g. "Now pick the same difficulty as your class." */
  hint?: string;
  /** Runs when the code new games will use changes (null = a random Mars). */
  onChange?: (code: string | null) => void;
  sfx?: (name: 'click' | 'deny') => void;
}

/** Which class code new games use. Starts from `?code=` in the page address, if there is one. */
export class ClassCodes {
  /** The code the next new campaign or quick mission will use, or null for a random Mars. */
  active: string | null;
  /** What the player has typed (kept when the screen redraws). */
  private draft = '';
  private message = '';
  /** A code a teacher just made, shown big. */
  private teacherCode: string | null = null;

  constructor(search: string = typeof location === 'undefined' ? '' : location.search) {
    this.active = classCodeFromSearch(search);
    // A code in the link that doesn't check out: put it in the box so it can be fixed.
    if (!this.active) this.draft = new URLSearchParams(search).get('code') ?? '';
  }

  /** A short note for the title screen when a code is waiting to be used. */
  titleNote(): HTMLElement | null {
    if (!this.active) return null;
    return h(
      'p',
      { class: 'cc-note' },
      h('b', null, 'Class code '),
      h('span', { class: 'cc-chip' }, this.active),
      h('b', null, ' is ready. '),
      'Start a New campaign or a Quick mission to play the same Mars as your class.',
    );
  }

  /** The class code area. */
  panel(opts: PanelOptions = {}): HTMLElement {
    const box = h('section', { class: 'class-code', 'aria-label': 'Class code' });
    const draw = (focus?: string) => {
      clear(box);
      box.append(...(this.teacherCode ? this.teacherView(this.teacherCode, draw, opts) : this.studentView(draw, opts)));
      if (focus) box.querySelector<HTMLElement>(focus)?.focus();
    };
    draw();
    return box;
  }

  private setActive(code: string | null, opts: PanelOptions) {
    this.active = code;
    opts.onChange?.(code);
  }

  private studentView(draw: (focus?: string) => void, opts: PanelOptions): HTMLElement[] {
    const makeBtn = h(
      'button',
      {
        class: 'btn small cc-make',
        onclick: () => {
          opts.sfx?.('click');
          this.teacherCode = makeClassCode();
          draw('.cc-copy');
        },
      },
      'Make a code for my class',
    );
    const teacherRow = h('div', { class: 'cc-teacher-row' }, h('span', { class: 'title-foot' }, 'Teacher? '), makeBtn);

    if (this.active) {
      return [
        h('div', { class: 'kicker' }, 'Class code'),
        h(
          'p',
          { class: 'cc-on' },
          h('span', { class: 'cc-chip big' }, this.active),
          h('span', null, ' is on. Everyone with this code plays the same Mars. ', opts.hint ?? ''),
        ),
        h(
          'div',
          { class: 'cc-row' },
          h(
            'button',
            {
              class: 'btn small cc-remove',
              onclick: () => {
                opts.sfx?.('click');
                this.setActive(null, opts);
                draw('#class-code-input');
              },
            },
            'Remove code',
          ),
        ),
        teacherRow,
      ];
    }

    const apply = () => {
      const res = checkClassCode(this.draft);
      if (!res.ok) {
        this.message = PROBLEM[res.problem];
        opts.sfx?.('deny');
        draw('#class-code-input');
        return;
      }
      this.draft = '';
      this.message = '';
      opts.sfx?.('click');
      this.setActive(res.code, opts);
      draw('.cc-remove');
    };
    return [
      h('div', { class: 'kicker' }, 'Class code'),
      h('label', { for: 'class-code-input' }, 'Got a code from your teacher? Type it here.'),
      h(
        'div',
        { class: 'cc-row' },
        h('input', {
          id: 'class-code-input',
          class: 'cc-input',
          type: 'text',
          value: this.draft,
          maxlength: 12,
          autocomplete: 'off',
          autocapitalize: 'characters',
          spellcheck: 'false',
          placeholder: '5 letters and numbers',
          'aria-describedby': 'class-code-msg',
          oninput: (e: Event) => (this.draft = (e.target as HTMLInputElement).value),
          onkeydown: (e: KeyboardEvent) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              apply();
            }
          },
        }),
        h('button', { class: 'btn small go', onclick: apply }, 'Use code'),
      ),
      h('p', { id: 'class-code-msg', class: `cc-msg ${this.message ? 'bad' : ''}`, role: 'status' }, this.message),
      teacherRow,
    ];
  }

  private teacherView(code: string, draw: (focus?: string) => void, opts: PanelOptions): HTMLElement[] {
    const link = classCodeLink(code);
    const linkBox = h('input', { class: 'cc-link-text', type: 'text', readonly: true, value: link, 'aria-label': 'Link to share', onfocus: (e: Event) => (e.target as HTMLInputElement).select() });
    const status = h('p', { class: 'cc-msg', role: 'status' });
    const copy = async () => {
      opts.sfx?.('click');
      try {
        await navigator.clipboard.writeText(link);
        status.textContent = 'Link copied. Paste it where your class can click it.';
      } catch {
        linkBox.focus();
        linkBox.select();
        status.textContent = 'The link is selected: copy it with Ctrl+C (or Cmd+C on a Mac).';
      }
    };
    return [
      h('div', { class: 'kicker' }, 'For teachers: your class code'),
      h('div', { class: 'cc-big' }, code),
      h(
        'p',
        null,
        'Write it on the board. Everyone types it in here and picks the same difficulty (Cadet is best for most classes). Then the whole class gets the same dust storms, cold nights, cargo day and solar storms.',
      ),
      h('div', { class: 'cc-row' }, linkBox, h('button', { class: 'btn small cc-copy', onclick: () => void copy() }, 'Copy link')),
      status,
      h('p', { class: 'title-foot' }, "Use it during the same class period: the solar storms come from NASA's live data, which can change from day to day."),
      h(
        'div',
        { class: 'cc-row' },
        h(
          'button',
          {
            class: 'btn small go',
            onclick: () => {
              opts.sfx?.('click');
              this.teacherCode = null;
              this.setActive(code, opts);
              draw('.cc-remove');
            },
          },
          'Play with this code',
        ),
        h(
          'button',
          {
            class: 'btn small',
            onclick: () => {
              opts.sfx?.('click');
              this.teacherCode = makeClassCode();
              draw('.cc-copy');
            },
          },
          'Make a new code',
        ),
        h(
          'button',
          {
            class: 'btn small',
            onclick: () => {
              opts.sfx?.('click');
              this.teacherCode = null;
              draw('.cc-make');
            },
          },
          'Close',
        ),
      ),
    ];
  }
}
