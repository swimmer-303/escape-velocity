// Written with AI assistance (Claude Code). See README "Use of AI tools".
// @vitest-environment happy-dom
// Read aloud (with a fake speechSynthesis), the display settings, and that it all hides without a speech engine.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { App } from './app';
import { CssStage } from '../render/stage';
import { speakable, readingFor, pickVoice, voiceChoices, reader, speechSupported } from './voice';
import { speakButton, statusButton, statusText, ROOT_CLASS } from './access';
import { renderHud } from './hud';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function button(text: RegExp, root: ParentNode = document): HTMLButtonElement | null {
  return ([...root.querySelectorAll('button')] as HTMLButtonElement[]).find((b) => text.test(b.textContent ?? '') && !b.disabled) ?? null;
}

async function waitFor<T>(fn: () => T | null | undefined, ms = 8000): Promise<T> {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const v = fn();
    if (v) return v;
    await sleep(10);
  }
  throw new Error('timed out waiting');
}

// ------------------------------------------------------------------ a fake speech engine

interface FakeUtterance {
  text: string;
  voice: { name: string } | null;
  lang: string;
  rate: number;
  onend: (() => void) | null;
  onerror: (() => void) | null;
}

const voice = (name: string, lang: string, localService = true, isDefault = false) =>
  ({ name, lang, localService, default: isDefault, voiceURI: `uri:${name}` }) as unknown as SpeechSynthesisVoice;

const VOICES = [
  voice('Anna', 'de-DE', true, true),
  voice('Google US English', 'en-US', false),
  voice('Zarvox', 'en-US'),
  voice('Samantha', 'en-US'),
  voice('Daniel', 'en-GB'),
];

function installSpeech(voices = VOICES) {
  const spoken: FakeUtterance[] = [];
  class Utterance implements FakeUtterance {
    text: string;
    voice = null;
    lang = '';
    rate = 1;
    onend: (() => void) | null = null;
    onerror: (() => void) | null = null;
    constructor(text: string) {
      this.text = text;
    }
  }
  const synth = {
    speaking: false,
    pending: false,
    speak: vi.fn((u: FakeUtterance) => void spoken.push(u)),
    cancel: vi.fn(),
    getVoices: () => voices,
    addEventListener: vi.fn(),
  };
  vi.stubGlobal('speechSynthesis', synth);
  vi.stubGlobal('SpeechSynthesisUtterance', Utterance);
  /** Let the voice finish every sentence; returns everything it said. */
  const readAll = () => {
    for (let guard = 0; guard < 500 && reader.owner; guard++) spoken[spoken.length - 1].onend?.();
    return spoken.map((u) => u.text);
  };
  return { synth, spoken, readAll };
}

const PAGE = `<div id="app"><div id="stage"></div><header id="hud"></header><main id="dock"></main></div><div id="modal-root"></div>`;

beforeEach(() => {
  document.body.innerHTML = PAGE;
  document.documentElement.className = '';
  vi.stubGlobal('fetch', () => Promise.reject(new Error('offline in tests')));
  try {
    localStorage.clear();
  } catch {
    /* ignore */
  }
});

afterEach(() => {
  reader.stop();
  vi.unstubAllGlobals();
});

// ------------------------------------------------------------------ numbers and units

describe('read aloud: saying numbers and units naturally', () => {
  it.each([
    ['Life support: 2.5 d', 'Life support: 2.5 days'],
    ['Air 4.0 d left', 'Air 4 days left'],
    ['1.0 d of food', '1 day of food'],
    ['Already 2.5 days', 'Already 2.5 days'],
    ['Dose 3.2/27', 'Dose 3.2 of 27'],
    ['Tutorial 1/9', 'Tutorial 1 of 9'],
    ['Fuel tank 45%', 'Fuel tank 45 percent'],
    ['0.67 mSv per sol', '0.67 millisieverts per sol'],
    ['Radiation budget (mSv)', 'Radiation budget (millisieverts)'],
    ['The CME raced at 2,678 km/s.', 'The CME raced at 2,678 kilometers per second.'],
    ['8,100 µGy in one day', '8,100 micrograys in one day'],
    ['about 11 min', 'about 11 minutes'],
    ['1 sol is 24 h 39 min', '1 sol is 24 hours 39 minutes'],
    ['+3 days of food', 'plus 3 days of food'],
    ['Cold! −1 cell tomorrow', 'Cold! minus 1 cell tomorrow'],
    ['CREW 1 OF 3 · Sol 3 of 14', 'crew 1 of 3, Sol 3 of 14'],
    ['Tap PLAN THE DAY. NASA DONKI says so.', 'Tap plan the day. NASA DONKI says so.'],
    ['Solar panel row x2', 'Solar panel row times 2'],
    ['Image: NASA/SDO', 'Image: NASA and SDO'],
    ['a 45-55 minute lesson', 'a 45 to 55 minute lesson'],
    ['Storm on 2024-05-10', 'Storm on 2024-05-10'],
  ])('%s', (raw, said) => {
    expect(speakable(raw)).toBe(said);
  });
});

// ------------------------------------------------------------------ what gets read, in what order

function debriefLike(): HTMLElement {
  const root = document.getElementById('modal-root')!;
  root.innerHTML = `
    <div class="modal" role="dialog" aria-label="Sol 3 debrief">
      <button class="btn close-x" aria-label="Close">X</button>
      <div class="kicker">CREW 1 OF 3 · Sol 3 · Debrief</div>
      <p class="headline">Your crew made 2.5 d of air. Fuel is up to 45%.</p>
      <div class="art"><img src="/art/x.png" alt="Mars (AI-generated art)"></div>
      <div class="card event"><span class="tag archive">ARCHIVE</span><span class="tag real">REAL EVENT</span>
        <div>An X1.1 flare erupted on May 14, 2024.</div>
        <div class="title-foot">Source: NASA DONKI. <a href="#">See the record</a></div>
      </div>
      <ul class="clean"><li>Air: 4.0 d left.</li><li>Dose 3.2/27 mSv.</li></ul>
      <div class="stars" aria-label="2 of 3 stars"><span class="star on"><span class="icon"><svg aria-hidden="true"></svg></span><span>Launch</span></span><span class="star"><span>Builder</span></span></div>
      <figure class="card mchart">
        <figcaption class="kicker">How your mission went</figcaption>
        <p class="mchart-takeaway">The tank filled on sol 9.</p>
        <ul class="mchart-legend" aria-label="Chart key"><li>Air</li></ul>
        <div class="mchart-plot" role="group" aria-label="Mission chart"><svg><text>Fuel</text></svg></div>
        <p class="mchart-readout">Fuel 45%</p>
        <details class="mchart-table"><summary>See the numbers</summary><table><tr><td>1</td></tr></table></details>
      </figure>
      <details class="science"><summary class="kicker">Real Science: Plants in space</summary><p>Hidden until opened.</p></details>
      <div class="crew-says"><div class="crew-face" role="img" aria-label="Amara, Commander (AI-generated portrait)"></div><p><b>Amara says: </b>"Great work, team."</p></div>
      <table class="log"><thead><tr><th>Crew</th><th>Result</th></tr></thead><tbody><tr><td>1: First Footprints</td><td>Launched home</td></tr></tbody></table>
      <div class="actions"><button class="btn primary">Start sol 4</button></div>
    </div>`;
  return root.querySelector<HTMLElement>('.modal')!;
}

describe('read aloud: what a dialog says, in order', () => {
  it('reads the words in page order, one sentence at a time, and skips buttons, pictures and chart parts', () => {
    const said = readingFor([debriefLike()]).map((u) => u.speak);
    expect(said).toEqual([
      'crew 1 of 3, Sol 3, Debrief',
      'Your crew made 2.5 days of air.',
      'Fuel is up to 45 percent.',
      'archive.',
      'real event.',
      'An X1.1 flare erupted on May 14, 2024.',
      'Source: NASA DONKI.',
      'See the record',
      'Air: 4 days left.',
      'Dose 3.2 of 27 millisieverts.',
      '2 of 3 stars',
      'How your mission went',
      'The tank filled on sol 9.',
      'Real Science: Plants in space',
      'Amara says: "Great work, team."',
      '1: First Footprints, Launched home',
    ]);
    const all = said.join(' ');
    expect(all).not.toMatch(/Start sol 4|Close|AI-generated|Chart key|See the numbers|Hidden until opened|Fuel 45|Builder/);
  });

  it('reads what a picture-only element says (the certificate), and skips link buttons', () => {
    const box = document.createElement('div');
    box.innerHTML = `<h2>Your certificate</h2><div class="cert-preview"><canvas class="cert-canvas" role="img" aria-label="Junior Astronaut certificate for Ada. 7 of 9 stars."></canvas></div><a class="btn small" href="/teacher/">For teachers</a>`;
    expect(readingFor([box]).map((u) => u.speak)).toEqual(['Your certificate', 'Junior Astronaut certificate for Ada.', '7 of 9 stars.']);
  });

  it('reads with the chosen voice, highlights each sentence, and stops when the dialog changes', async () => {
    const { synth, spoken } = installSpeech();
    const box = debriefLike();
    reader.voiceURI = '';
    reader.rate = 0.95;
    reader.read([box], 'dialog');
    expect(reader.owner).toBe('dialog');
    expect(spoken.map((u) => u.text)).toEqual(['crew 1 of 3, Sol 3, Debrief']);
    expect(spoken[0].voice?.name).toBe('Samantha');
    expect(spoken[0].rate).toBe(0.95);
    expect(box.querySelector('.kicker')!.classList.contains('ev-reading-block')).toBe(true);

    spoken[0].onend!();
    expect(spoken[1].text).toBe('Your crew made 2.5 days of air.');
    expect(box.querySelector('.kicker')!.classList.contains('ev-reading-block')).toBe(false);
    expect(box.querySelector('.headline')!.classList.contains('ev-reading-block')).toBe(true);

    // A new dialog replaces this one: reading stops and the highlight goes away.
    const root = document.getElementById('modal-root')!;
    root.replaceChildren(Object.assign(document.createElement('div'), { className: 'modal', textContent: 'Next dialog' }));
    await sleep(0);
    expect(reader.owner).toBeNull();
    expect(synth.cancel).toHaveBeenCalled();
    expect(document.querySelector('.ev-reading-block')).toBeNull();
    // The old sentence finishing does not start the next one.
    spoken[1].onend?.();
    expect(spoken.length).toBe(2);
  });
});

// ------------------------------------------------------------------ voices

describe('read aloud: picking a voice', () => {
  it('prefers an on-device English voice, the browser language first, and skips joke voices', () => {
    expect(pickVoice(VOICES, '', 'en-US')?.name).toBe('Samantha');
    expect(pickVoice(VOICES, '', 'en-GB')?.name).toBe('Daniel');
    expect(pickVoice(VOICES, '', 'es-MX')?.name).toBe('Samantha');
    expect(pickVoice(VOICES, 'uri:Daniel', 'en-US')?.name).toBe('Daniel');
    expect(voiceChoices(VOICES).map((v) => v.name)).toEqual(['Daniel', 'Samantha']);
  });

  it('falls back gracefully: a missing saved voice, no English voice, or no voices at all', () => {
    expect(pickVoice(VOICES, 'uri:Gone', 'en-US')?.name).toBe('Samantha');
    expect(pickVoice([voice('Anna', 'de-DE', true, true)], '', 'en-US')).toBeNull();
    expect(pickVoice([], '', 'en-US')).toBeNull();
    expect(voiceChoices([voice('Anna', 'de-DE')]).map((v) => v.name)).toEqual(['Anna']);
  });
});

// ------------------------------------------------------------------ in the game

describe('read aloud in the game', () => {
  it('puts "Read to me" on dialogs and the tutorial, reads the briefing (not its buttons), and "My status" reads the HUD', async () => {
    const { spoken, readAll } = installSpeech();
    new App(new CssStage());
    const title = await waitFor(() => document.querySelector('[aria-label="Escape Velocity title screen"]'));
    expect(title.querySelector('.read-bar .speak-btn')?.textContent).toMatch(/Read to me/);
    (await waitFor(() => button(/Quick mission/))).click();
    (await waitFor(() => button(/Start quick mission/))).click();
    (await waitFor(() => button(/Land the crew/))).click();
    await waitFor(() => button(/Plan the day/));

    // The tutorial tip has its own button.
    const bubble = await waitFor(() => document.querySelector<HTMLElement>('.coach-bubble'));
    expect(bubble.querySelector('.speak-btn')).not.toBeNull();

    const briefing = document.querySelector<HTMLElement>('.modal')!;
    const speak = briefing.querySelector<HTMLButtonElement>('.read-bar .speak-btn')!;
    // Focus still goes to the main button, not "Read to me".
    expect(document.activeElement?.textContent).toMatch(/Plan the day/);
    speak.click();
    expect(speak.textContent).toMatch(/Stop/);
    expect(speak.getAttribute('aria-label')).toBe('Stop reading');
    expect(spoken[0].text).toMatch(/^quick mission, Sol 1 of \d+, Morning briefing$/);
    const said = readAll();
    expect(said.join(' ')).toMatch(/power cells/);
    expect(said.join(' ')).not.toMatch(/Plan the day|Read to me|Change\b/);
    expect(briefing.querySelector('.speak-btn')!.textContent).toMatch(/Read to me/);

    // Reading stops when the dialog closes.
    speak.click();
    expect(reader.owner).toBe('dialog');
    button(/Plan the day/)!.click();
    await sleep(0);
    expect(reader.owner).toBeNull();

    // "My status" reads the HUD meters: where you are first.
    const status = await waitFor(() => button(/My status/));
    expect(status.getAttribute('aria-label')).toBe('Read my status out loud');
    const before = spoken.length;
    status.click();
    const statusSaid = readAll().slice(before);
    expect(statusSaid[0]).toMatch(/^quick mission, 4 astronauts, sol 1 of \d+\.$/);
    expect(statusSaid.join(' ')).toMatch(/Power: \d+ of \d+ cells left to place\./);
    expect(statusSaid.join(' ')).toMatch(/Life support: [\d.]+ days?\./);
    expect(statusSaid.join(' ')).toMatch(/Radiation dose [\d.]+ of a \d+ millisieverts budget\./);
    expect(statusSaid.join(' ')).toMatch(/Fuel tank 0 percent full\./);
  }, 30000);

  it('auto read-aloud reads each new briefing, with the tutorial tip first', async () => {
    const { spoken } = installSpeech();
    localStorage.setItem('ev-settings', JSON.stringify({ autoRead: true }));
    new App(new CssStage());
    (await waitFor(() => button(/Quick mission/))).click();
    (await waitFor(() => button(/Start quick mission/))).click();
    (await waitFor(() => button(/Land the crew/))).click();
    await waitFor(() => button(/Plan the day/));
    await waitFor(() => spoken.length > 0);
    expect(spoken[0].text).toMatch(/^Good morning, Commander!/);
    expect(reader.owner).toBe('dialog');
    for (let i = 0; i < 400 && reader.owner && !/Morning briefing/.test(spoken[spoken.length - 1].text); i++) spoken[spoken.length - 1].onend!();
    expect(spoken[spoken.length - 1].text).toMatch(/Morning briefing$/);
  }, 30000);

  it('auto read-aloud is off by default', async () => {
    const { spoken } = installSpeech();
    new App(new CssStage());
    (await waitFor(() => button(/Quick mission/))).click();
    (await waitFor(() => button(/Start quick mission/))).click();
    (await waitFor(() => button(/Land the crew/))).click();
    await waitFor(() => button(/Plan the day/));
    await sleep(120);
    expect(spoken.length).toBe(0);
  }, 30000);
});

// ------------------------------------------------------------------ display settings

describe('display settings', () => {
  it('turn on root classes, save to ev-settings with the other settings, and come back after a reload', async () => {
    new App(new CssStage());
    (await waitFor(() => button(/^Settings$/))).click();
    const large = await waitFor(() => button(/Larger text: off/));
    large.click();
    const html = document.documentElement;
    expect(html.classList.contains(ROOT_CLASS.largeText)).toBe(true);
    const nowOn = button(/Larger text: on/)!;
    expect(nowOn.getAttribute('aria-pressed')).toBe('true');
    expect(document.activeElement).toBe(nowOn);
    button(/High contrast: off/)!.click();
    button(/Dyslexia-friendly spacing: off/)!.click();
    expect(html.classList.contains(ROOT_CLASS.highContrast)).toBe(true);
    expect(html.classList.contains(ROOT_CLASS.dyslexia)).toBe(true);

    const saved = JSON.parse(localStorage.getItem('ev-settings')!);
    expect(saved).toMatchObject({ largeText: true, highContrast: true, dyslexia: true, autoRead: false, muted: false, view3d: true, music: true, sfx: true });

    // Muting later keeps the display settings.
    button(/Done/)!.click();
    (await waitFor(() => document.querySelector<HTMLButtonElement>('button[aria-label^="Sound is on"]'))).click();
    expect(JSON.parse(localStorage.getItem('ev-settings')!)).toMatchObject({ muted: true, largeText: true, highContrast: true, dyslexia: true });

    // Reload: the classes are back before anything is clicked.
    html.className = '';
    document.body.innerHTML = PAGE;
    new App(new CssStage());
    expect(html.classList.contains(ROOT_CLASS.largeText)).toBe(true);
    expect(html.classList.contains(ROOT_CLASS.highContrast)).toBe(true);
    expect(html.classList.contains(ROOT_CLASS.dyslexia)).toBe(true);

    // Turning one off takes its class away.
    (await waitFor(() => button(/^Settings$/))).click();
    button(/High contrast: on/)!.click();
    expect(html.classList.contains(ROOT_CLASS.highContrast)).toBe(false);
    expect(JSON.parse(localStorage.getItem('ev-settings')!).highContrast).toBe(false);
  }, 30000);

  it('ignores damaged stored values', () => {
    localStorage.setItem('ev-settings', JSON.stringify({ largeText: 'yes', highContrast: 1, voice: 7 }));
    new App(new CssStage());
    expect(document.documentElement.classList.contains(ROOT_CLASS.largeText)).toBe(false);
    expect(document.documentElement.classList.contains(ROOT_CLASS.highContrast)).toBe(false);
  });

  it('are in Settings from the pause menu too, with every control labelled', async () => {
    installSpeech();
    localStorage.setItem('ev-tutorial-done', '1');
    new App(new CssStage());
    (await waitFor(() => button(/Quick mission/))).click();
    (await waitFor(() => button(/Start quick mission/))).click();
    (await waitFor(() => button(/Land the crew/))).click();
    await waitFor(() => button(/Plan the day/));
    button(/^Menu$/)!.click();
    (await waitFor(() => button(/^Settings$/, document.querySelector('.modal[aria-label="Menu"]')!))).click();
    const menu = await waitFor(() => document.querySelector<HTMLElement>('.modal[aria-label="Settings"]'));
    expect(menu.querySelector('.access-panel h3')?.textContent).toBe('Text and voice');
    expect(button(/Larger text: off/, menu)).not.toBeNull();
    expect(button(/Auto read-aloud: off/, menu)).not.toBeNull();
    const select = menu.querySelector<HTMLSelectElement>('select')!;
    expect(menu.querySelector(`label[for="${select.id}"]`)?.textContent).toBe('Voice');
    expect([...select.options].map((o) => o.textContent)).toEqual(['Automatic (Samantha)', 'Daniel (en-GB)', 'Samantha (en-US)']);
    // Every button and field has a name.
    for (const el of menu.querySelectorAll<HTMLElement>('button, select, input, a')) {
      const name = el.getAttribute('aria-label') || el.textContent?.trim() || (el.id && menu.querySelector(`label[for="${el.id}"]`)?.textContent);
      expect(name, el.outerHTML.slice(0, 80)).toBeTruthy();
    }
    // Picking a voice saves it and says hello in it.
    select.value = 'uri:Daniel';
    select.dispatchEvent(new Event('change'));
    expect(JSON.parse(localStorage.getItem('ev-settings')!).voice).toBe('uri:Daniel');
    expect(reader.voiceURI).toBe('uri:Daniel');
  }, 30000);
});

// ------------------------------------------------------------------ no speech engine

describe('without a speech engine', () => {
  it('hides every read-aloud control', async () => {
    expect(speechSupported()).toBe(false);
    expect(speakButton(() => ['hello'], 'x')).toBeNull();
    expect(statusButton(document.getElementById('hud')!)).toBeNull();
    new App(new CssStage());
    await waitFor(() => button(/Quick mission/));
    expect(document.querySelector('.speak-btn, .read-bar')).toBeNull();
    button(/^Settings$/)!.click();
    expect(document.querySelector('.access-panel h3')?.textContent).toBe('Text size and contrast');
    expect(button(/Larger text: off/)).not.toBeNull();
    expect(button(/Auto read-aloud/)).toBeNull();
    expect(document.querySelector('select')).toBeNull();
    button(/Done/)!.click();
    (await waitFor(() => button(/Quick mission/))).click();
    (await waitFor(() => button(/Start quick mission/))).click();
    (await waitFor(() => button(/Land the crew/))).click();
    await waitFor(() => button(/Plan the day/));
    await waitFor(() => document.querySelector('.coach-bubble'));
    expect(document.querySelector('.speak-btn, .read-bar')).toBeNull();
    expect(button(/My status/)).toBeNull();
  }, 30000);
});

// ------------------------------------------------------------------ the HUD status text

describe('"My status"', () => {
  it('says where you are first, then every meter', () => {
    const hud = document.getElementById('hud')!;
    renderHud(
      hud,
      { sol: 3, windowSol: 14, cellsTotal: 7, cellsLeft: 2, now: { air: 2.5, food: 4, dose: 3.2, fuel: 45.6 }, doseBudget: 27, crew: 4, label: 'CREW 1 OF 3' },
      [],
    );
    const text = statusText(hud);
    expect(text).toBe(
      'CREW 1 OF 3, 4 astronauts, sol 3 of 14. Power: 2 of 7 cells left to place. Life support: 2.5 days. Air 2.5 days, food 4.0 days. Radiation dose 3.2 of a 27 mSv budget. Fuel tank 45 percent full.',
    );
    expect(readingFor([text]).map((u) => u.speak)).toEqual([
      'crew 1 of 3, 4 astronauts, sol 3 of 14.',
      'Power: 2 of 7 cells left to place.',
      'Life support: 2.5 days.',
      'Air 2.5 days, food 4 days.',
      'Radiation dose 3.2 of a 27 millisieverts budget.',
      'Fuel tank 45 percent full.',
    ]);
  });
});
