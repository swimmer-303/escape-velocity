// Written with AI assistance (Claude Code). See README "Use of AI tools".
// Read aloud with the browser's own speech engine (Web Speech API, speechSynthesis).
// Nothing is sent anywhere by this game: no network, no AI. The voice picker only offers voices that run on the
// device (localService), and everything is hidden when the browser has no speech engine.
//
// A dialog is read in page order, one sentence at a time: buttons, form fields, pictures and chart axes are
// skipped, numbers and units are said the way people say them ("2.5 d" -> "2.5 days", "45%" -> "45 percent"),
// and the sentence being read is highlighted (CSS Custom Highlight API where the browser has it, otherwise the
// whole card or paragraph gets an outline). Reading stops as soon as the dialog it was reading goes away.

// ------------------------------------------------------------------ support

export function speechSupported(): boolean {
  try {
    return typeof window !== 'undefined' && !!window.speechSynthesis && typeof window.SpeechSynthesisUtterance === 'function';
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------ what to read

/** Never read these (or anything inside them). */
const SKIP = [
  'button',
  'a.btn',
  'input',
  'select',
  'textarea',
  'option',
  'svg',
  'img',
  'canvas',
  'audio',
  'video',
  'script',
  'style',
  'template',
  'noscript',
  'thead',
  '[aria-hidden="true"]',
  '[hidden]',
  '[data-noread]',
  '[role="img"]',
  '.coach-head',
  '.read-bar',
  // Charts: read the caption and the takeaway, not the key, the axes, the live readout or the number table.
  '.mchart-legend',
  '.mchart-plot',
  '.mchart-readout',
  '.mchart-table',
].join(',');

/** Read the aria-label instead of the contents (a row of star icons says "2 of 3 stars"; the certificate says what is on it). */
const READ_LABEL = '.stars[aria-label], .cert-canvas[aria-label]';

const BLOCK = new Set([
  'P', 'DIV', 'LI', 'UL', 'OL', 'DL', 'DT', 'DD', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'SECTION', 'ARTICLE', 'HEADER', 'FOOTER',
  'MAIN', 'ASIDE', 'NAV', 'FORM', 'FIGURE', 'FIGCAPTION', 'TABLE', 'TBODY', 'TFOOT', 'TR', 'DETAILS', 'SUMMARY', 'BLOCKQUOTE',
  'LABEL', 'FIELDSET', 'LEGEND',
]);

interface Piece {
  node: Text;
  /** Where this text node starts in the block's text. */
  start: number;
}

/** One paragraph, card line, list item or table row, with the text nodes it came from (for highlighting). */
export interface Block {
  el: Element;
  text: string;
  pieces: Piece[];
}

function skipped(el: Element): boolean {
  if (el.matches(SKIP)) return true;
  const style = (el as HTMLElement).style;
  return !!style && style.display === 'none';
}

/** The readable blocks of a dialog, in page order. */
export function readableBlocks(root: Element): Block[] {
  const blocks: Block[] = [];
  let cur: Block | null = null;
  const flush = () => {
    if (cur && /[A-Za-z0-9]/.test(cur.text)) blocks.push(cur);
    cur = null;
  };
  const add = (owner: Element, text: string, node?: Text) => {
    cur ??= { el: owner, text: '', pieces: [] };
    if (node) cur.pieces.push({ node, start: cur.text.length });
    cur.text += text;
  };
  const walk = (el: Element, owner: Element) => {
    for (const child of Array.from(el.childNodes)) {
      if (child.nodeType === 3) {
        const t = child as Text;
        if (t.data) add(owner, t.data, t);
        continue;
      }
      if (child.nodeType !== 1) continue;
      const c = child as Element;
      if (c.matches(READ_LABEL)) {
        flush();
        cur = { el: c, text: c.getAttribute('aria-label') ?? '', pieces: [] };
        flush();
        continue;
      }
      if (skipped(c)) continue;
      if (c.tagName === 'DETAILS' && !(c as HTMLDetailsElement).open) {
        // A closed "Real Science" card: just its title.
        const summary = Array.from(c.children).find((x) => x.tagName === 'SUMMARY');
        if (summary) {
          flush();
          walk(summary, summary);
          flush();
        }
        continue;
      }
      if (c.tagName === 'BR') {
        add(owner, ' ');
        continue;
      }
      if (c.tagName === 'TD' || c.tagName === 'TH') {
        if (cur && /\S/.test(cur.text)) add(owner, ', ');
        walk(c, owner);
        continue;
      }
      if (c.classList.contains('tag')) {
        // "ARCHIVE" "REAL EVENT" labels: each one a short phrase of its own.
        walk(c, owner);
        add(owner, '. ');
        continue;
      }
      if (BLOCK.has(c.tagName)) {
        flush();
        walk(c, c);
        flush();
        continue;
      }
      walk(c, owner);
    }
  };
  walk(root, root);
  flush();
  return blocks;
}

const ABBREV = /\b(?:e\.g|i\.e|vs|etc|al|approx|Dr|Mr|Mrs|Ms|St)\.$/i;

/** [start, end) of each sentence in `text`. Decimals ("2.5") and abbreviations ("e.g.") never end a sentence. */
export function splitSentences(text: string): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const re = /[.!?]+["'”’)]*(?=\s|$)/g;
  let start = 0;
  let m: RegExpExecArray | null;
  const push = (a: number, b: number) => {
    while (a < b && /\s/.test(text[a])) a++;
    while (b > a && /\s/.test(text[b - 1])) b--;
    if (b > a && /[A-Za-z0-9]/.test(text.slice(a, b))) out.push([a, b]);
  };
  while ((m = re.exec(text))) {
    const end = m.index + m[0].length;
    if (ABBREV.test(text.slice(start, end))) continue;
    push(start, end);
    start = end;
  }
  push(start, text.length);
  return out;
}

// ------------------------------------------------------------------ how to say it

/** Short capitalised words that should still be spelled out (everything else in CAPS is read as a word). */
const ACRONYMS = new Set([
  'NASA', 'DONKI', 'ISS', 'CME', 'CMES', 'SDO', 'JPL', 'RAD', 'OSDR', 'AIA', 'SEP', 'FLR', 'GST', 'BVAD', 'DOSTEL', 'LND', 'NGSS',
  'AR', 'OSD', 'UTC', 'AI', 'CCMC', 'DLR', 'ESA', 'JAXA', 'CSA', 'USA', 'UK', 'HUD', 'SOS', 'ID', 'OK', 'TV',
]);

/** Units after a number: [singular, plural]. */
const UNITS: Record<string, [string, string]> = {
  'km/s': ['kilometer per second', 'kilometers per second'],
  mSv: ['millisievert', 'millisieverts'],
  'µGy': ['microgray', 'micrograys'],
  'μGy': ['microgray', 'micrograys'],
  km: ['kilometer', 'kilometers'],
  kg: ['kilogram', 'kilograms'],
  kW: ['kilowatt', 'kilowatts'],
  '°C': ['degree Celsius', 'degrees Celsius'],
  min: ['minute', 'minutes'],
  h: ['hour', 'hours'],
  d: ['day', 'days'],
  '%': ['percent', 'percent'],
};
const UNIT_AFTER_NUMBER = /(\d[\d,]*(?:\.\d+)?)\s*(km\/s|mSv|µGy|μGy|km|kg|kW|°C|min|h|d|%)(?![A-Za-z])/g;

/** Turn screen text into words a speech engine says naturally. */
export function speakable(raw: string): string {
  let s = ` ${raw} `.replace(/\s+/g, ' ');
  s = s
    .replace(/\s*[·•|]\s*/g, ', ')
    .replace(/\s+[—–]\s+/g, ', ')
    .replace(/−\s?(?=\d)/g, 'minus ')
    .replace(/±\s?0(?:\.0+)?(?!\d)/g, 'no change')
    .replace(/±\s?(?=\d)/g, 'plus or minus ')
    .replace(/(^|[\s(])\+(?=\d)/g, '$1plus ')
    .replace(/(^|[\s(])~\s?(?=\d)/g, '$1about ')
    .replace(/≈\s?/g, 'about ')
    .replace(/&/g, ' and ')
    .replace(/\be\.g\./gi, 'for example')
    .replace(/\bi\.e\./gi, 'that is')
    .replace(/\bvs\.?(?=\s)/gi, 'versus')
    // "4.0" is "4"; "2.50" stays.
    .replace(/(\d)\.0(?!\d)/g, '$1')
    // "3.2/27" is "3.2 of 27" (never dates: there are none like that in the game).
    .replace(/(\d)\s*\/\s*(?=\d)/g, '$1 of ')
    // "45-55" is "45 to 55" (not ISO dates like 2024-05-10).
    .replace(/(?<![\d-])(\d+)\s*[-–](\d+)(?![\d-])/g, '$1 to $2')
    // "Solar Panels x2" is "Solar Panels times 2".
    .replace(/\bx(\d+)\b/g, 'times $1');
  // Units after numbers, with singular for exactly 1.
  s = s.replace(UNIT_AFTER_NUMBER, (all, num: string, unit: string) => {
    const words = UNITS[unit];
    return words ? `${num} ${num === '1' ? words[0] : words[1]}` : all;
  });
  // Units written alone, e.g. "Radiation budget (mSv)".
  s = s.replace(/\bmSv\b/g, 'millisieverts').replace(/[µμ]Gy\b/g, 'micrograys').replace(/\bkm\/s\b/g, 'kilometers per second');
  // Letters/letters: "NASA/SDO" is "NASA and SDO".
  s = s.replace(/([A-Za-z])\/([A-Za-z])/g, '$1 and $2');
  // Words in CAPITALS are read as words ("PLAN THE DAY", "CREW 1 OF 3"), except real acronyms.
  s = s.replace(/\b[A-Z]{2,}\b/g, (w) => (ACRONYMS.has(w) ? w : w.toLowerCase()));
  return s.replace(/\s+/g, ' ').replace(/\s+([,.!?;:])/g, '$1').trim();
}

// ------------------------------------------------------------------ the reading list

export type Source = Element | string;

export interface Utterance {
  /** What is shown on screen. */
  text: string;
  /** What the voice says. */
  speak: string;
  block?: Block;
  start?: number;
  end?: number;
  root?: Element;
}

/** Everything to say for these dialogs (or plain strings), one sentence per utterance. */
export function readingFor(sources: Source[]): Utterance[] {
  const out: Utterance[] = [];
  const push = (u: Utterance) => {
    if (/[A-Za-z0-9]/.test(u.speak)) out.push(u);
  };
  for (const src of sources) {
    if (typeof src === 'string') {
      for (const [a, b] of splitSentences(src)) push({ text: src.slice(a, b), speak: speakable(src.slice(a, b)) });
      continue;
    }
    for (const block of readableBlocks(src)) {
      for (const [a, b] of splitSentences(block.text)) {
        const text = block.text.slice(a, b);
        push({ text, speak: speakable(text), block, start: a, end: b, root: src });
      }
    }
  }
  return out;
}

// ------------------------------------------------------------------ voices

/** Joke and sound-effect voices that some systems ship: fun, but hard to understand. */
const NOVELTY = /\b(Albert|Bad News|Bahh|Bells|Boing|Bubbles|Cellos|Deranged|Good News|Hysterical|Jester|Junior|Organ|Pipe Organ|Superstar|Trinoids|Whisper|Wobble|Zarvox|Ralph|Fred|Kathy)\b/i;

const normLang = (l: string) => (l || '').replace('_', '-').toLowerCase();
const isEnglish = (v: SpeechSynthesisVoice) => /^en(-|$)/.test(normLang(v.lang));

/** On-device voices for the picker: English first, joke voices left out. Falls back to every voice if none are on the device. */
export function voiceChoices(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice[] {
  const local = voices.filter((v) => v.localService !== false);
  const pool = (local.length ? local : voices).filter((v) => !NOVELTY.test(v.name));
  const en = pool.filter(isEnglish);
  const list = en.length ? en : pool;
  return list.slice().sort((a, b) => normLang(a.lang).localeCompare(normLang(b.lang)) || a.name.localeCompare(b.name));
}

/**
 * The voice to read with: the one the player picked, if this device has it; otherwise the best English voice
 * (the browser's own language first, then US, then any English); otherwise null, which lets the browser use
 * its default voice.
 */
export function pickVoice(voices: SpeechSynthesisVoice[], wanted?: string, lang?: string): SpeechSynthesisVoice | null {
  if (wanted) {
    const v = voices.find((x) => x.voiceURI === wanted);
    if (v) return v;
  }
  const choices = voiceChoices(voices).filter(isEnglish);
  if (!choices.length) return null;
  const want = normLang(lang ?? (typeof navigator !== 'undefined' ? navigator.language : '') ?? '');
  const pref = want.startsWith('en') ? want : 'en-us';
  const score = (v: SpeechSynthesisVoice) => {
    const l = normLang(v.lang);
    return (l === pref ? 8 : 0) + (l === 'en-us' ? 4 : 0) + (v.default ? 2 : 0) + (v.localService !== false ? 1 : 0);
  };
  return choices.slice().sort((a, b) => score(b) - score(a))[0] ?? null;
}

export function allVoices(): SpeechSynthesisVoice[] {
  if (!speechSupported()) return [];
  try {
    return window.speechSynthesis.getVoices() ?? [];
  } catch {
    return [];
  }
}

// ------------------------------------------------------------------ highlighting

const HIGHLIGHT = 'ev-reading';
const BLOCK_CLASS = 'ev-reading-block';

function position(block: Block, offset: number): [Text, number] | null {
  let best: Piece | null = null;
  for (const p of block.pieces) {
    if (offset < p.start) break;
    best = p;
  }
  const piece = best ?? block.pieces[0];
  if (!piece) return null;
  return [piece.node, Math.max(0, Math.min(offset - piece.start, piece.node.data.length))];
}

type HighlightRegistry = { set(name: string, h: unknown): void; delete(name: string): void };

function highlightRegistry(): { reg: HighlightRegistry; Highlight: new (...r: Range[]) => unknown } | null {
  const css = (globalThis as unknown as { CSS?: { highlights?: HighlightRegistry } }).CSS;
  const H = (globalThis as unknown as { Highlight?: new (...r: Range[]) => unknown }).Highlight;
  return css?.highlights && typeof H === 'function' ? { reg: css.highlights, Highlight: H } : null;
}

function clearHighlight() {
  if (typeof document === 'undefined') return;
  document.querySelectorAll(`.${BLOCK_CLASS}`).forEach((el) => el.classList.remove(BLOCK_CLASS));
  try {
    highlightRegistry()?.reg.delete(HIGHLIGHT);
  } catch {
    /* ignore */
  }
}

function showHighlight(u: Utterance, reducedMotion: boolean) {
  clearHighlight();
  const b = u.block;
  if (!b || !b.el.isConnected) return;
  if (b.el !== u.root) b.el.classList.add(BLOCK_CLASS);
  const hl = highlightRegistry();
  if (hl && u.start !== undefined && u.end !== undefined) {
    const a = position(b, u.start);
    const z = position(b, u.end);
    if (a && z) {
      try {
        const range = document.createRange();
        range.setStart(a[0], a[1]);
        range.setEnd(z[0], z[1]);
        hl.reg.set(HIGHLIGHT, new hl.Highlight(range));
      } catch {
        /* the text changed under us: the outline is enough */
      }
    }
  }
  // Keep the sentence in view in a long dialog.
  const el = b.el as HTMLElement;
  if (el.closest('.modal') && typeof el.scrollIntoView === 'function') {
    try {
      el.scrollIntoView({ block: 'nearest', behavior: reducedMotion ? 'auto' : 'smooth' });
    } catch {
      /* ignore */
    }
  }
}

// ------------------------------------------------------------------ the reader

/**
 * Speaks one sentence at a time (long utterances get cut off in some browsers), so each one can be
 * highlighted. `owner` says who started it ("dialog", "coach", "status"), so the right button shows "Stop".
 */
export class Reader {
  owner: string | null = null;
  voiceURI = '';
  rate = 0.95;
  reducedMotion = false;
  private queue: Utterance[] = [];
  private roots: Element[] = [];
  private observer: MutationObserver | null = null;
  private current: SpeechSynthesisUtterance | null = null;
  private token = 0;
  private listeners = new Set<() => void>();

  get speaking(): boolean {
    return this.owner !== null;
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit() {
    for (const fn of this.listeners) {
      try {
        fn();
      } catch {
        /* one bad listener must not stop the others */
      }
    }
  }

  /** Read these dialogs (or strings) out loud, replacing anything being read now. */
  read(sources: Source[], owner: string) {
    if (!speechSupported()) return;
    const synth = window.speechSynthesis;
    const busy = synth.speaking || synth.pending;
    this.halt();
    const utterances = readingFor(sources);
    if (!utterances.length) {
      this.emit();
      return;
    }
    this.queue = utterances;
    this.owner = owner;
    this.roots = sources.filter((s): s is Element => typeof s !== 'string');
    this.watch();
    this.emit();
    const token = this.token;
    // Some browsers drop a sentence spoken right after cancel(); the very first one must stay inside the tap (iOS).
    if (busy) setTimeout(() => this.next(token), 60);
    else this.next(token);
  }

  /** Stop reading (and clear the highlight). */
  stop() {
    const was = this.owner;
    this.halt();
    if (was !== null) this.emit();
  }

  private halt() {
    this.token++;
    this.queue = [];
    this.owner = null;
    this.roots = [];
    if (this.current) this.current.onend = this.current.onerror = null;
    this.current = null;
    this.observer?.disconnect();
    this.observer = null;
    clearHighlight();
    if (speechSupported()) {
      try {
        window.speechSynthesis.cancel();
      } catch {
        /* ignore */
      }
    }
  }

  private next(token: number) {
    if (token !== this.token) return;
    if (this.roots.some((r) => !r.isConnected)) return this.stop();
    const u = this.queue.shift();
    if (!u) return this.stop();
    const utt = new window.SpeechSynthesisUtterance(u.speak);
    const voice = pickVoice(allVoices(), this.voiceURI);
    if (voice) {
      utt.voice = voice;
      utt.lang = voice.lang;
    } else utt.lang = 'en-US';
    utt.rate = this.rate;
    utt.onend = () => this.next(token);
    utt.onerror = () => this.next(token);
    this.current = utt; // keep a reference: some browsers drop the end event of an utterance nobody holds
    showHighlight(u, this.reducedMotion);
    try {
      window.speechSynthesis.speak(utt);
    } catch {
      this.stop();
    }
  }

  /** Stop when the dialog being read goes away (a new dialog, or the dialog closed). */
  private watch() {
    if (!this.roots.length || typeof MutationObserver === 'undefined') return;
    this.observer = new MutationObserver(() => {
      if (this.roots.some((r) => !r.isConnected)) this.stop();
    });
    this.observer.observe(document.body, { childList: true, subtree: true });
  }
}

export const reader = new Reader();
