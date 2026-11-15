// Written with AI assistance (Claude Code). See README "Use of AI tools".
// The Settings dialog, from the title screen and the mission Menu:
//   Sound: all sound (the HUD speaker button's master mute), Music and Sound effects, each on/off with a volume
//          slider you hear right away, and a true fact about sound on Mars (sources in docs/data-notes.md).
//   Display and motion: reduced motion, the 3D view, and 3D detail (Auto / Faster / Sharper).
//   Text and voice: the reading and display panel from access.ts.
//   Then any sections features add through src/meta/hooks.ts (addSettingsSection), such as the Space Lab.
// The App owns the settings object, saves it, and tells the sound and the 3D stage; this file only draws.

import { h } from './dom';
import { icon } from './icons';
import { accessPanel } from './access';
import { renderSettingsSections } from '../meta/hooks';
import { SOUND_DEFAULTS, cleanVolume, type GameAudio, type SoundMix } from './audio';
import type { Detail } from '../render/stage';

/** Everything Settings changes, apart from the text and voice options (access.ts). Saved in 'ev-settings'. */
export interface GameSettings extends SoundMix {
  /** The master mute (the HUD speaker button). */
  muted: boolean;
  reducedMotion: boolean;
  /** 3D outpost on (default) or the simple view for slow devices. */
  view3d: boolean;
  /** 3D detail: 'auto' (default), 'low' (Faster) or 'high' (Sharper). */
  detail: Detail;
}

export const DETAILS: Array<{ id: Detail; name: string; hint: string }> = [
  { id: 'auto', name: 'Auto', hint: 'The game picks what runs best on this device.' },
  { id: 'low', name: 'Faster', hint: 'Smoother on slow computers: soft shadows and less dust in the air.' },
  { id: 'high', name: 'Sharper', hint: 'Sharp shadows and more dust in the air. Needs a stronger computer.' },
];

/**
 * Settings saved by an older version (or damaged) made safe. A player from before there were Music and Effects
 * settings gets both on at the volume they always heard; their old master mute (`muted`) stays as it was.
 */
export function cleanGameSettings(s: Partial<GameSettings> & Record<string, unknown>): void {
  if (typeof s.muted !== 'boolean') s.muted = false;
  if (typeof s.music !== 'boolean') s.music = SOUND_DEFAULTS.music;
  if (typeof s.sfx !== 'boolean') s.sfx = SOUND_DEFAULTS.sfx;
  s.musicVolume = cleanVolume(s.musicVolume);
  s.sfxVolume = cleanVolume(s.sfxVolume);
  if (!DETAILS.some((d) => d.id === s.detail)) s.detail = 'auto';
}

/** `?quality=low` or `?quality=high` in the address: it wins over the 3D detail setting. */
export function urlQuality(search: string = location.search): 'low' | 'high' | null {
  try {
    const q = new URLSearchParams(search).get('quality');
    return q === 'low' || q === 'high' ? q : null;
  } catch {
    return null;
  }
}

/** What the dialog needs from the game. */
export interface SettingsHost {
  settings: GameSettings;
  audio: GameAudio;
  /** Save 'ev-settings'. */
  save(): void;
  /** The master mute changed: tell the sound and redraw the HUD's speaker button. */
  setMuted(m: boolean): void;
  setReducedMotion(on: boolean): void;
  /** Turn the 3D view on or off. The page reloads (a campaign is saved first). */
  toggleView3d(): void;
  /** Tell the 3D stage the new detail. */
  setDetail(d: Detail): void;
  /** True when the 3D view is showing and changes its detail right away. */
  detailLive(): boolean;
  /** Redraw the whole dialog (a feature section changed something it shows). */
  rerender(): void;
  /** Close (Done, the X, or Escape). */
  done(): void;
  /** Words on the Done button ("Done", or "Back to menu" from the mission Menu). */
  doneText?: string;
}

/** The dialog's contents (for App.modal), ending with the Done row that stays pinned to the bottom. */
export function settingsView(host: SettingsHost): HTMLElement[] {
  return [
    h('div', { class: 'kicker' }, 'Your game, your way'),
    h('h2', { id: 'settings-h' }, 'Settings'),
    h('p', { class: 'settings-intro' }, 'Changes save by themselves.'),
    h('div', { class: 'settings-grid' }, soundSection(host), displaySection(host)),
    accessPanel(),
    h('div', { class: 'settings-features' }, ...renderSettingsSections(() => host.rerender())),
    h('div', { class: 'actions end sticky' }, h('button', { class: 'btn primary', 'data-autofocus': true, onclick: () => host.done() }, host.doneText ?? 'Done')),
  ];
}

/** Which control has the keyboard focus, so a redraw can put it back (every control here has a data-set or an id). */
export function focusKeyOf(el: Element | null): string | null {
  if (!(el instanceof HTMLElement)) return null;
  if (el.dataset.set) return `[data-set="${el.dataset.set}"]`;
  if (el.dataset.key) return `[data-key="${el.dataset.key}"]`;
  return el.id ? `[id="${el.id}"]` : null;
}

// ------------------------------------------------------------------ sound

/** The Sound card. It redraws itself in place, keeping the focus on the control that was pressed. */
function soundSection(host: SettingsHost): HTMLElement {
  const sec = h('section', { class: 'settings-sec', 'aria-labelledby': 'set-sound-h' });
  const s = host.settings;
  const a = host.audio;
  let lastBlip = 0;

  const redraw = (focus?: string) => {
    sec.replaceChildren(...draw());
    if (focus) sec.querySelector<HTMLElement>(`[data-set="${focus}"]`)?.focus();
  };

  const toggle = (key: string, name: string, on: boolean, flip: () => void) =>
    h(
      'button',
      {
        class: `btn small switch ${on ? 'on' : ''}`,
        type: 'button',
        'data-set': key,
        'aria-pressed': String(on),
        onclick: () => {
          flip();
          host.save();
          redraw(key);
        },
      },
      h('span', { class: 'switch-dot', 'aria-hidden': 'true' }),
      `${name}: ${on ? 'on' : 'off'}`,
    );

  /** A volume slider, 0 to 100 in steps of 10. You hear each change right away. */
  const slider = (key: 'musicVolume' | 'sfxVolume', name: string, enabled: boolean, heard: (v: number) => void) => {
    const id = `set-${key}`;
    const out = h('output', { class: 'vol-value', for: id, 'aria-hidden': 'true' }, `${s[key]}%`);
    const input = h('input', {
      id,
      type: 'range',
      class: 'vol-range',
      min: 0,
      max: 100,
      step: 10,
      value: s[key],
      'data-set': key,
      'aria-valuetext': `${name} ${s[key]} percent`,
      disabled: !enabled,
      style: `--fill:${s[key]}%`,
      oninput: (e: Event) => {
        const v = cleanVolume(Number((e.target as HTMLInputElement).value));
        s[key] = v;
        input.setAttribute('aria-valuetext', `${name} ${v} percent`);
        input.style.setProperty('--fill', `${v}%`);
        out.textContent = `${v}%`;
        heard(v);
        host.save();
      },
    });
    return h('div', { class: `vol ${enabled ? '' : 'off'}` }, h('label', { for: id }, name), h('div', { class: 'vol-track' }, input, out));
  };

  const draw = (): HTMLElement[] => [
    h('h3', { id: 'set-sound-h' }, icon(s.muted ? 'mute' : 'sound', 18), 'Sound'),
    h(
      'div',
      { class: 'mix-row master' },
      toggle('muted', 'All sound', !s.muted, () => {
        s.muted = !s.muted;
        host.setMuted(s.muted);
      }),
      h('p', { class: 'set-hint' }, s.muted ? 'Everything is quiet. The speaker button at the top does this too.' : 'The speaker button at the top turns all sound off and on too.'),
    ),
    h(
      'div',
      { class: 'mix-row' },
      toggle('music', 'Music', s.music, () => {
        s.music = !s.music;
        a.setMusic(s.music);
      }),
      slider('musicVolume', 'Music volume', s.music, (v) => a.setMusicVolume(v)),
    ),
    h(
      'div',
      { class: 'mix-row' },
      toggle('sfx', 'Sound effects', s.sfx, () => {
        s.sfx = !s.sfx;
        a.setSfx(s.sfx);
        a.sfx('pop');
      }),
      slider('sfxVolume', 'Effects volume', s.sfx, (v) => {
        a.setSfxVolume(v);
        // A short sample so the new loudness is heard (not more than a few a second while dragging).
        const now = Date.now();
        if (now - lastBlip > 120) {
          lastBlip = now;
          a.sfx('pop', 0.8 + v / 250);
        }
      }),
    ),
    h(
      'p',
      { class: 'settings-fact' },
      h('b', null, 'Space science: '),
      "NASA's Perseverance rover has recorded real sounds on Mars with its microphones. Mars's air is thin, cold and mostly carbon dioxide, so sound travels slower there: about 240 meters per second, compared with about 340 on Earth. ",
      h('a', { href: 'https://science.nasa.gov/mission/mars-2020-perseverance/sounds-of-mars/', target: '_blank', rel: 'noopener' }, 'Hear them at NASA'),
    ),
  ];

  redraw();
  return sec;
}

// ------------------------------------------------------------------ display and motion

function displaySection(host: SettingsHost): HTMLElement {
  const sec = h('section', { class: 'settings-sec', 'aria-labelledby': 'set-display-h' });
  const s = host.settings;

  const redraw = (focus?: string) => {
    sec.replaceChildren(...draw());
    if (focus) sec.querySelector<HTMLElement>(`[data-set="${focus}"]`)?.focus();
  };

  const detailNote = (): string => {
    const forced = urlQuality();
    if (forced) return `The web address picks ${forced === 'low' ? 'Faster' : 'Sharper'} right now (quality=${forced}), so this choice waits until you open the game without it.`;
    if (!s.view3d) return 'Turn on the 3D view to see this.';
    const hint = DETAILS.find((d) => d.id === s.detail)!.hint;
    return host.detailLive() ? hint : `${hint} Applies next time you open the game.`;
  };

  const draw = (): HTMLElement[] => [
    h('h3', { id: 'set-display-h' }, 'Display and motion'),
    h(
      'div',
      { class: 'mix-row' },
      h(
        'button',
        {
          class: `btn small switch ${s.reducedMotion ? 'on' : ''}`,
          type: 'button',
          'data-set': 'reducedMotion',
          'aria-pressed': String(s.reducedMotion),
          onclick: () => {
            s.reducedMotion = !s.reducedMotion;
            host.save();
            host.setReducedMotion(s.reducedMotion);
            redraw('reducedMotion');
          },
        },
        h('span', { class: 'switch-dot', 'aria-hidden': 'true' }),
        `Reduced motion: ${s.reducedMotion ? 'on' : 'off'}`,
      ),
      h('p', { class: 'set-hint' }, 'On: the camera stays still and nothing shakes or flies around.'),
    ),
    h(
      'div',
      { class: 'mix-row' },
      h(
        'button',
        {
          class: `btn small switch ${s.view3d ? 'on' : ''}`,
          type: 'button',
          'data-set': 'view3d',
          'aria-pressed': String(s.view3d),
          onclick: () => host.toggleView3d(),
        },
        h('span', { class: 'switch-dot', 'aria-hidden': 'true' }),
        `3D view: ${s.view3d ? 'on' : 'off'}`,
      ),
      h('p', { class: 'set-hint' }, 'Off: a simple picture for very slow computers. The page reloads, and your campaign is saved.'),
    ),
    h(
      'div',
      { class: 'detail-pick' },
      h('span', { class: 'detail-label', id: 'set-detail-h' }, '3D detail'),
      h(
        'div',
        { class: 'segmented', role: 'group', 'aria-labelledby': 'set-detail-h', 'aria-describedby': 'set-detail-note' },
        DETAILS.map((d) =>
          h(
            'button',
            {
              class: `btn small ${s.detail === d.id ? 'on' : ''}`,
              type: 'button',
              'data-set': `detail-${d.id}`,
              'aria-pressed': String(s.detail === d.id),
              onclick: () => {
                if (s.detail === d.id) return;
                s.detail = d.id;
                host.save();
                host.setDetail(d.id);
                redraw(`detail-${d.id}`);
              },
            },
            d.name,
          ),
        ),
      ),
      h('p', { class: 'set-hint', id: 'set-detail-note' }, detailNote()),
    ),
  ];

  redraw();
  return sec;
}
