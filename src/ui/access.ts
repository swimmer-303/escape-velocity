// Written with AI assistance (Claude Code). See README "Use of AI tools".
// Reading and display help: "Read to me" buttons on every dialog and the tutorial, "Auto read-aloud",
// a voice picker, "Read my status" for the HUD, and three display options (larger text, high contrast,
// dyslexia-friendly spacing). Settings live in the game's 'ev-settings' (the App owns that object and saves it).
// The display options are classes on <html>; the CSS is at the end of style.css under "Access".

import { h } from './dom';
import { icon } from './icons';
import { reader, speechSupported, allVoices, voiceChoices, pickVoice, type Source } from './voice';

export interface AccessSettings {
  /** Read each new briefing, debrief and tutorial tip out loud. */
  autoRead: boolean;
  /** voiceURI of the chosen voice; '' picks the best English voice on this device. */
  voice: string;
  /** Read a little slower. */
  slowVoice: boolean;
  largeText: boolean;
  highContrast: boolean;
  dyslexia: boolean;
}

export const ACCESS_DEFAULTS: AccessSettings = {
  autoRead: false,
  voice: '',
  slowVoice: false,
  largeText: false,
  highContrast: false,
  dyslexia: false,
};

/** The <html> class for each display option. */
export const ROOT_CLASS = {
  largeText: 'ev-large-text',
  highContrast: 'ev-contrast',
  dyslexia: 'ev-dyslexia',
} as const;

type Toggle = 'autoRead' | 'slowVoice' | 'largeText' | 'highContrast' | 'dyslexia';

let settings: AccessSettings = { ...ACCESS_DEFAULTS };
let persist: () => void = () => {};

export interface AccessHooks {
  /** Make the music quieter while the voice reads. */
  duck?(on: boolean): void;
  /** True when the player asked for reduced motion (no smooth scrolling while reading). */
  reducedMotion?(): boolean;
}

/**
 * Start-up: share the App's settings object (so one save writes everything), fix any bad stored values,
 * put the display classes on <html>, and set up the voice.
 */
export function initAccess(s: AccessSettings, save: () => void, hooks: AccessHooks = {}) {
  for (const k of Object.keys(ACCESS_DEFAULTS) as Array<keyof AccessSettings>) {
    if (typeof s[k] !== typeof ACCESS_DEFAULTS[k]) (s as unknown as Record<string, unknown>)[k] = ACCESS_DEFAULTS[k];
  }
  settings = s;
  persist = save;
  applyDisplay(s);
  syncVoice();
  unsubscribe?.();
  unsubscribe = reader.onChange(() => {
    paintSpeakButtons();
    hooks.duck?.(reader.speaking);
    reader.reducedMotion = hooks.reducedMotion?.() ?? false;
  });
  if (speechSupported() && !listening) {
    listening = true;
    window.addEventListener('pagehide', () => reader.stop());
    try {
      // Voices often arrive a moment after the page loads: refresh any open voice list.
      window.speechSynthesis.addEventListener?.('voiceschanged', () => {
        for (const p of panels) {
          if (p.isConnected) p.dispatchEvent(new Event('ev-refresh'));
          else panels.delete(p);
        }
      });
    } catch {
      /* older engines: the list fills in the next time the menu opens */
    }
  }
}

let unsubscribe: (() => void) | undefined;
let listening = false;

/** Put (or take off) the display classes on <html>. */
export function applyDisplay(s: Pick<AccessSettings, 'largeText' | 'highContrast' | 'dyslexia'>, root: HTMLElement = document.documentElement) {
  for (const k of Object.keys(ROOT_CLASS) as Array<keyof typeof ROOT_CLASS>) root.classList.toggle(ROOT_CLASS[k], !!s[k]);
}

function syncVoice() {
  reader.voiceURI = settings.voice;
  reader.rate = settings.slowVoice ? 0.8 : 0.95;
}

function flip(key: Toggle) {
  settings[key] = !settings[key];
  persist();
  applyDisplay(settings);
  syncVoice();
  if (key === 'autoRead' && !settings.autoRead) pending = null;
}

// ------------------------------------------------------------------ "Read to me" buttons

interface SpeakOptions {
  /** Visible words on the button (default "Read to me"). */
  text?: string;
  /** Spoken name, if different (it always contains the visible words). */
  label?: string;
}

/** A button that reads `sources()` out loud, and turns into "Stop" while it does. Null when the browser cannot speak. */
export function speakButton(sources: () => Source[], owner: string, opts: SpeakOptions = {}): HTMLButtonElement | null {
  if (!speechSupported()) return null;
  const btn = h('button', {
    class: 'btn small speak-btn',
    type: 'button',
    'data-speak-owner': owner,
    'data-text': opts.text ?? 'Read to me',
    'data-label': opts.label ?? '',
    onclick: () => (reader.owner === owner ? reader.stop() : reader.read(sources(), owner)),
  });
  paint(btn);
  return btn;
}

function paint(btn: HTMLButtonElement) {
  const on = reader.owner === btn.dataset.speakOwner;
  btn.classList.toggle('on', on);
  const label = on ? 'Stop reading' : btn.dataset.label || '';
  if (label) btn.setAttribute('aria-label', label);
  else btn.removeAttribute('aria-label');
  btn.replaceChildren(on ? h('span', { class: 'stop-sq', 'aria-hidden': 'true' }) : icon('sound', 18), h('span', null, on ? 'Stop' : (btn.dataset.text ?? 'Read to me')));
}

function paintSpeakButtons() {
  document.querySelectorAll<HTMLButtonElement>('.speak-btn').forEach(paint);
}

/** Add the "Read to me" button to a dialog, and read it out loud if it is a new briefing or debrief and auto read-aloud is on. */
export function decorateDialog(box: HTMLElement, opts: { autoRead?: boolean } = {}) {
  if (!speechSupported() || Array.from(box.children).some((c) => c.classList.contains('read-bar'))) return;
  const btn = speakButton(() => [box], 'dialog');
  if (!btn) return;
  const bar = h('div', { class: 'read-bar' }, btn);
  const close = Array.from(box.children).find((c) => c.classList.contains('close-x'));
  if (close) close.after(bar);
  else box.prepend(bar);
  if (opts.autoRead && settings.autoRead) queueAuto('dialog', box);
}

// ------------------------------------------------------------------ tutorial bubble

let coachKey: string | null = null;

/** The tutorial bubble shows a new tip (key) or hides (null): stop reading the old tip, and auto-read the new one. */
export function coachShown(bubble: HTMLElement, key: string | null) {
  if (key === coachKey) return;
  coachKey = key;
  if (reader.owner === 'coach') reader.stop();
  if (key && settings.autoRead && speechSupported()) queueAuto('coach', bubble);
}

// ------------------------------------------------------------------ auto read-aloud

let pending: { coach?: HTMLElement; dialog?: HTMLElement } | null = null;

/** Wait a moment so a dialog and the tutorial tip shown with it are read together: the tip first. */
function queueAuto(kind: 'coach' | 'dialog', el: HTMLElement) {
  if (!pending) {
    pending = {};
    setTimeout(flushAuto, 50);
  }
  pending[kind] = el;
}

function flushAuto() {
  const p = pending;
  pending = null;
  if (!p || !settings.autoRead) return;
  const dialog = p.dialog?.isConnected ? p.dialog : null;
  const coach = p.coach?.isConnected && p.coach.style.display !== 'none' ? p.coach : null;
  const sources = [coach, dialog].filter((x): x is HTMLElement => !!x);
  if (sources.length) reader.read(sources, dialog ? 'dialog' : 'coach');
}

// ------------------------------------------------------------------ HUD status

/** What the HUD meters say right now, in reading order: where you are, then power, life support, dose and fuel. */
export function statusText(hud: ParentNode): string {
  const chip = hud.querySelector('.sol-chip[aria-label]');
  const meters = Array.from(hud.querySelectorAll('.meter[aria-label]'));
  return [chip, ...meters]
    .filter((el): el is Element => !!el)
    .map((el) => (el.getAttribute('aria-label') ?? '').trim())
    .filter(Boolean)
    .map((t) => (/[.!?]$/.test(t) ? t : `${t}.`))
    .join(' ');
}

/** "My status": reads the HUD meters out loud. Null when the browser cannot speak. */
export function statusButton(hud: HTMLElement): HTMLButtonElement | null {
  return speakButton(() => [statusText(hud) || 'No mission yet.'], 'status', { text: 'My status', label: 'Read my status out loud' });
}

// ------------------------------------------------------------------ settings panel

const panels = new Set<HTMLElement>();

/** The "Text and voice" section of the Settings dialog (settings.ts). Redraws itself in place. */
export function accessPanel(): HTMLElement {
  const panel = h('section', { class: 'access-panel', 'aria-labelledby': 'access-h' });
  for (const p of panels) if (!p.isConnected) panels.delete(p);
  panels.add(panel);
  const speech = speechSupported();

  const toggle = (key: Toggle, name: string, hint?: string) =>
    h(
      'button',
      {
        class: 'btn small',
        type: 'button',
        'data-key': key,
        'aria-pressed': String(settings[key]),
        title: hint,
        onclick: () => {
          flip(key);
          render(key);
        },
      },
      `${name}: ${settings[key] ? 'on' : 'off'}`,
    );

  const voicePicker = () => {
    const voices = voiceChoices(allVoices());
    const chosen = pickVoice(allVoices(), settings.voice);
    const select = h(
      'select',
      {
        id: 'access-voice',
        class: 'voice-select',
        'data-key': 'voice',
        onchange: (e: Event) => {
          settings.voice = (e.target as HTMLSelectElement).value;
          persist();
          syncVoice();
          reader.read(['Hello! I will read to you.'], 'sample');
        },
      },
      h('option', { value: '', selected: settings.voice ? undefined : true }, chosen && !settings.voice ? `Automatic (${chosen.name})` : 'Automatic'),
      voices.map((v) => h('option', { value: v.voiceURI, selected: settings.voice === v.voiceURI ? true : undefined }, `${v.name} (${v.lang})`)),
    );
    return h('div', { class: 'voice-pick' }, h('label', { for: 'access-voice' }, 'Voice'), select);
  };

  const render = (focusKey?: string) => {
    panel.replaceChildren(
      h('h3', { id: 'access-h' }, accessButtonText()),
      h(
        'div',
        { class: 'toggle-row' },
        toggle('largeText', 'Larger text'),
        toggle('highContrast', 'High contrast'),
        toggle('dyslexia', 'Dyslexia-friendly spacing', 'More space between letters, words and lines'),
      ),
      ...(speech
        ? [
            h(
              'div',
              { class: 'toggle-row' },
              toggle('autoRead', 'Auto read-aloud', 'Reads each new briefing and debrief out loud'),
              toggle('slowVoice', 'Slower voice'),
            ),
            voicePicker(),
            h('p', { class: 'title-foot' }, 'Every dialog has a "Read to me" button. Reading uses your device\'s own voices: nothing is sent anywhere.'),
          ]
        : []),
    );
    if (focusKey) panel.querySelector<HTMLElement>(`[data-key="${focusKey}"]`)?.focus();
  };
  panel.addEventListener('ev-refresh', () => {
    const active = document.activeElement;
    // Don't redraw a voice list the player has open.
    if (active && panel.contains(active) && active.tagName === 'SELECT') return;
    render();
  });
  render();
  return panel;
}

/** The name of the text and voice settings ("Text size and contrast" when this browser cannot read aloud). */
export function accessButtonText(): string {
  return speechSupported() ? 'Text and voice' : 'Text size and contrast';
}
