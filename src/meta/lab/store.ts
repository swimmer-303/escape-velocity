// Written with AI assistance (Claude Code). See README "Use of AI tools".
// Space Lab save data ('ev-lab-v1'): the dials as the player left them, the fair-test switch, the Lab Notebook (the
// last 12 experiments) and today's count of experiments that gave XP. Anything odd in storage (old shapes,
// hand edits, garbage) is cleaned up on the way in, and a blocked localStorage just means nothing is remembered.

import { sanitizeLab, defaultLab, type Hypothesis, type LabOutcome, type LabSettings, type RunSummary } from '../../sim/lab';

export const STORAGE_KEY = 'ev-lab-v1';
export const NOTEBOOK_MAX = 12;
/** XP for each finished experiment, and the most experiments a day that give it (so easy settings cannot farm XP). */
export const LAB_XP = 20;
export const LAB_XP_PER_DAY = 3;

export interface NotebookEntry {
  /** When the experiment finished (ISO). */
  at: string;
  settings: LabSettings;
  hypothesis: Hypothesis | null;
  won: boolean;
  /** Sols (or Moon days) played. */
  sols: number;
  /** Radiation dose at the end (it only ever goes up, so this is the peak), mSv, and the mission's limit. */
  dose: number;
  doseBudget: number;
  /** Rocket fuel at the end, %. */
  fuel: number;
  loseReason?: string;
  /** The fair test: the autopilot flew the same storms under real conditions, and under these lab conditions. */
  autoReal?: RunSummary;
  autoLab?: RunSummary;
  outcome?: LabOutcome;
  /** Did the hypothesis hold (null: no guess)? */
  held?: boolean | null;
  xp?: number;
}

export interface LabSave {
  v: 1;
  settings: LabSettings;
  /** Fair test: keep the same seed (same storms) every run. */
  sameStorms: boolean;
  hypothesis: Hypothesis | null;
  notebook: NotebookEntry[];
  xpDay: string;
  xpCount: number;
}

export function emptySave(): LabSave {
  return { v: 1, settings: defaultLab(), sameStorms: true, hypothesis: null, notebook: [], xpDay: '', xpCount: 0 };
}

const HYPOTHESES: readonly Hypothesis[] = ['sooner', 'later', 'not'];
const OUTCOMES: readonly LabOutcome[] = ['sooner', 'later', 'same', 'not'];
const num = (v: unknown, lo: number, hi: number, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d);
const hyp = (v: unknown): Hypothesis | null => (typeof v === 'string' && (HYPOTHESES as readonly string[]).includes(v) ? (v as Hypothesis) : null);
function run(v: unknown): RunSummary | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const o = v as Record<string, unknown>;
  if (typeof o.won !== 'boolean') return undefined;
  return { won: o.won, sols: Math.round(num(o.sols, 0, 99)) };
}

export function sanitizeEntry(v: unknown): NotebookEntry | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  if (typeof o.at !== 'string' || Number.isNaN(Date.parse(o.at)) || typeof o.won !== 'boolean') return null;
  const e: NotebookEntry = {
    at: o.at,
    settings: sanitizeLab(o.settings),
    hypothesis: hyp(o.hypothesis),
    won: o.won,
    sols: Math.round(num(o.sols, 0, 99)),
    dose: num(o.dose, 0, 999),
    doseBudget: num(o.doseBudget, 1, 999, 27),
    fuel: num(o.fuel, 0, 100),
  };
  if (typeof o.loseReason === 'string' && /^[a-z]{1,12}$/.test(o.loseReason)) e.loseReason = o.loseReason;
  const autoReal = run(o.autoReal);
  const autoLab = run(o.autoLab);
  if (autoReal) e.autoReal = autoReal;
  if (autoLab) e.autoLab = autoLab;
  if (typeof o.outcome === 'string' && (OUTCOMES as readonly string[]).includes(o.outcome)) e.outcome = o.outcome as LabOutcome;
  if (typeof o.held === 'boolean' || o.held === null) e.held = o.held as boolean | null;
  if (typeof o.xp === 'number') e.xp = Math.round(num(o.xp, 0, LAB_XP));
  return e;
}

export function sanitizeSave(v: unknown): LabSave {
  const d = emptySave();
  if (!v || typeof v !== 'object') return d;
  const o = v as Record<string, unknown>;
  const notebook = Array.isArray(o.notebook) ? o.notebook.map(sanitizeEntry).filter((e): e is NotebookEntry => !!e).slice(-NOTEBOOK_MAX) : [];
  return {
    v: 1,
    settings: sanitizeLab(o.settings),
    sameStorms: typeof o.sameStorms === 'boolean' ? o.sameStorms : true,
    hypothesis: hyp(o.hypothesis),
    notebook,
    xpDay: typeof o.xpDay === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(o.xpDay) ? o.xpDay : '',
    xpCount: Math.round(num(o.xpCount, 0, 99)),
  };
}

export function loadSave(): LabSave {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? sanitizeSave(JSON.parse(raw)) : emptySave();
  } catch {
    return emptySave();
  }
}

export function storeSave(s: LabSave): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    /* storage full or blocked: the lab still works, it just forgets */
  }
}

/** Today's date (local), for the daily XP cap. */
export function today(now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

/** XP for one more finished experiment today (0 once the day's cap is reached), and the save with it counted. */
export function claimXp(s: LabSave, day: string = today()): { xp: number; save: LabSave } {
  const count = s.xpDay === day ? s.xpCount : 0;
  if (count >= LAB_XP_PER_DAY) return { xp: 0, save: { ...s, xpDay: day, xpCount: count } };
  return { xp: LAB_XP, save: { ...s, xpDay: day, xpCount: count + 1 } };
}

/** Add an experiment to the notebook, keeping the newest NOTEBOOK_MAX. */
export function addEntry(s: LabSave, e: NotebookEntry): LabSave {
  return { ...s, notebook: [...s.notebook, e].slice(-NOTEBOOK_MAX) };
}

/** A fresh random seed for "New storms" (or when "Same storms each run" is off). */
export function newSeed(rand: () => number = Math.random): string {
  return `lab-${Math.floor(rand() * 36 ** 5)
    .toString(36)
    .padStart(5, '0')}`;
}
