// Written with AI assistance (Claude Code). See README "Use of AI tools".
// Astronaut rank, the rules: XP for what happened in the game, levels, daily mission progress and the streak.
// No DOM here: the screens in ./ui.ts listen with onRank().

import { emitGame, type GameEventMap } from '../hooks';
import { upgradeDef } from '../../sim/upgrades';
import type { SpaceWeatherEvent, SolReport } from '../../sim/types';
import { levelFor, rankFor, type Rank } from './curve';
import { ALL_DONE_BONUS, dayKey, missionById, missionsForDay, previousDay, type DailyMissionDef, type TrackEvent } from './daily';
import { freshState, loadState, saveState, type DailyState, type RankState } from './store';

/** XP for things that happen in the game. Other features add their own with emitGame('xp', ...). */
export const XP = {
  sol: 10,
  sheltered: 25,
  upgrade: 40,
  win: 100,
  star: 25,
  loss: 30,
  campaign: 300,
  /** Most XP a single 'xp' event from another feature can give (a guard against typos). */
  maxEvent: 1000,
} as const;

// ------------------------------------------------------------------ notes for the screens
export type RankNote =
  | { kind: 'xp'; amount: number; reason: string; quiet: boolean }
  | { kind: 'level'; level: number; rank: Rank; newRank: boolean }
  | { kind: 'mission'; def: DailyMissionDef }
  | { kind: 'all-done'; xp: number }
  | { kind: 'streak'; count: number };

const listeners: Array<(n: RankNote) => void> = [];
export function onRank(fn: (n: RankNote) => void): () => void {
  listeners.push(fn);
  return () => {
    const i = listeners.indexOf(fn);
    if (i >= 0) listeners.splice(i, 1);
  };
}
function note(n: RankNote) {
  for (const fn of [...listeners]) {
    try {
      fn(n);
    } catch (e) {
      console.error('[rank] screen update failed', e);
    }
  }
}

// ------------------------------------------------------------------ state
let state: RankState | null = null;
let clock: () => Date = () => new Date();

export function rankState(): RankState {
  return (state ??= loadState());
}
function save() {
  saveState(rankState());
}
export function today(): string {
  return dayKey(clock());
}
export function currentLevel(): number {
  return levelFor(rankState().xp);
}

/** Tests: start over (re-read storage) and/or use a fixed clock. */
export function resetRankEngine(opts: { clock?: () => Date; fresh?: boolean } = {}): void {
  state = opts.fresh ? freshState() : null;
  clock = opts.clock ?? (() => new Date());
}

// ------------------------------------------------------------------ XP and levels
/** Add XP. `quiet` XP is announced by its own pop-up (a daily mission), not the XP pop-up. */
export function award(amount: number, reason: string, quiet = false): void {
  const a = Math.round(amount);
  if (!Number.isFinite(a) || a <= 0) return;
  const s = rankState();
  const before = levelFor(s.xp);
  s.xp = Math.min(1e9, s.xp + a);
  const after = levelFor(s.xp);
  save();
  note({ kind: 'xp', amount: a, reason, quiet });
  for (let level = before + 1; level <= after; level++) {
    const rank = rankFor(level);
    note({ kind: 'level', level, rank, newRank: rank.from === level });
    emitGame('level-up', { level, rank: rank.name });
  }
  if (after > before) track({ type: 'level', level: after });
}

/** Levels reached that have not had their level-up card yet (oldest first). */
export function pendingLevels(): number[] {
  const s = rankState();
  const level = levelFor(s.xp);
  const out: number[] = [];
  for (let l = s.celebrated + 1; l <= level; l++) out.push(l);
  return out;
}
export function markCelebrated(): void {
  const s = rankState();
  s.celebrated = Math.max(s.celebrated, levelFor(s.xp));
  save();
}

// ------------------------------------------------------------------ daily missions
/** Today's missions, made fresh when the calendar day changes. */
export function dailyToday(): DailyState {
  const s = rankState();
  const key = today();
  if (!s.daily || s.daily.date !== key) {
    s.daily = { date: key, ids: missionsForDay(key).map((m) => m.id), progress: [0, 0, 0], bonus: false };
    save();
  }
  return s.daily;
}

export interface DailyView {
  def: DailyMissionDef;
  progress: number;
  done: boolean;
}
export function dailyView(): DailyView[] {
  const d = dailyToday();
  return d.ids.flatMap((id, i) => {
    const def = missionById(id);
    return def ? [{ def, progress: Math.min(def.goal, d.progress[i] ?? 0), done: (d.progress[i] ?? 0) >= def.goal }] : [];
  });
}

export function track(ev: TrackEvent): void {
  const s = rankState();
  const d = dailyToday();
  d.ids.forEach((id, i) => {
    const def = missionById(id);
    if (!def || d.progress[i] >= def.goal) return;
    let inc = 0;
    try {
      inc = def.count(ev);
    } catch {
      inc = 0;
    }
    if (!(inc > 0)) return;
    d.progress[i] = Math.min(def.goal, d.progress[i] + Math.floor(inc));
    save();
    if (d.progress[i] >= def.goal) {
      s.stats.dailyDone++;
      save();
      note({ kind: 'mission', def });
      award(def.xp, `Daily mission: ${def.title}`, true);
    }
  });
  if (!d.bonus && d.ids.every((id, i) => d.progress[i] >= (missionById(id)?.goal ?? Infinity))) {
    d.bonus = true;
    save();
    note({ kind: 'all-done', xp: ALL_DONE_BONUS });
    award(ALL_DONE_BONUS, 'All 3 daily missions done', true);
  }
}

// ------------------------------------------------------------------ streak
/** Count today as a day played. */
export function markPlayed(): void {
  const s = rankState();
  const key = today();
  if (s.streak.last === key) return;
  s.streak.count = s.streak.last === previousDay(key) ? s.streak.count + 1 : 1;
  s.streak.last = key;
  s.streak.best = Math.max(s.streak.best, s.streak.count);
  save();
  note({ kind: 'streak', count: s.streak.count });
}

/** Days in a row, counting today or yesterday (0 if the run has ended: a missed day is never held against anyone). */
export function liveStreak(): number {
  const { last, count } = rankState().streak;
  const key = today();
  return last === key || last === previousDay(key) ? count : 0;
}

// ------------------------------------------------------------------ game events
function stormName(e: SpaceWeatherEvent): string {
  const c = e.kind === 'flare' && e.classType ? e.classType[0].toUpperCase() : '';
  // Flare classes are A, B, C, M and X: "an M-class", "a C-class".
  if (c) return `${'AMX'.includes(c) ? 'an' : 'a'} ${c}-class storm`;
  return e.kind === 'cme' ? 'a CME storm' : 'a solar particle storm';
}

function builtIds(r: SolReport) {
  return r.builtAll ?? (r.built ? [r.built] : []);
}

export function onSol(p: GameEventMap['sol']): void {
  if (p.demo) return;
  const s = rankState();
  const r = p.report;
  const site = p.after.config.site;
  markPlayed();
  s.stats.sols++;
  save();
  award(XP.sol, `${site === 'moon' ? 'Day' : 'Sol'} ${r.sol} done`);
  if (r.storm) {
    const lostToDose = p.after.status === 'lost' && p.after.loseReason === 'dose';
    if (!lostToDose) s.stats.storms++;
    if (r.storm.shelterCells > 0) {
      s.stats.sheltered++;
      save();
      award(XP.sheltered, `Crew sheltered from ${stormName(r.storm.event)}`);
    }
    save();
  }
  for (const id of builtIds(r)) {
    s.stats.upgrades++;
    save();
    award(XP.upgrade, `Built: ${upgradeDef(id, site).name}`);
  }
  track({ type: 'sol', before: p.before, after: p.after, report: r, mode: p.mode });
}

export function onMissionEnd(p: GameEventMap['mission-end']): void {
  if (p.demo) return;
  const s = rankState();
  s.stats.missions++;
  if (p.won) s.stats.launches++;
  save();
  const n = p.stars.length;
  const stars = n ? ` (${n} star${n === 1 ? '' : 's'})` : '';
  if (p.won) award(XP.win + XP.star * n, `Rocket launched${stars}!`);
  else award(XP.loss + XP.star * n, `Crew home early${stars}. Every crew learns something.`);
  track({ type: 'end', mission: p.mission, won: p.won, mode: p.mode, stars: p.stars });
}

export function onCampaignComplete(): void {
  const s = rankState();
  s.stats.campaigns++;
  save();
  award(XP.campaign, 'Campaign complete: three crews!');
  track({ type: 'campaign' });
}

export function onXp(p: GameEventMap['xp']): void {
  const amount = typeof p?.amount === 'number' && Number.isFinite(p.amount) ? Math.min(XP.maxEvent, p.amount) : 0;
  const reason = typeof p?.reason === 'string' && p.reason.trim() ? p.reason.trim() : 'Bonus XP';
  award(amount, reason);
}
