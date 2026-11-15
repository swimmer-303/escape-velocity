// Written with AI assistance (Claude Code). See README "Use of AI tools".
// The Season Pass rules: Season XP, tiers and claiming, weekly challenges, Sun event challenges, the
// welcome-back gifts, the Player Card choices and stats. No DOM here: the screens listen with onSeason().
// Nothing is ever taken away: a missed day or week only means new challenges, never lost progress.

import type { GameEventMap } from '../hooks';
import { MAX_TIER, seasonOver, tierFor } from './season';
import { rollCallsign } from './callsign';
import { BANNERS, DEFAULT_CARD, FRAMES, PATCHES, TIERS, TITLES, tierDef, type CardPatch, type RewardKind, type SeasonReward } from './rewards';
import { challengeById, challengesForWeek, isoWeekKey, type ChallengeDef, type SeasonEvent } from './weekly';
import { currentSunEvent, eventChallenges, knownFeed, patchForEvent, type EventChallengeDef, type EventPatch, type SunEvent } from './live';
import { MAX_EVENTS, freshState, loadState, saveState, type EventState, type SeasonState } from './store';

/**
 * Season XP for play, the same amounts the Astronaut rank gives (see ../rank/engine.ts), so a sol fills the pass
 * as it fills the rank bar. XP from other modes arrives as 'xp' events and counts in full (capped like the rank).
 */
export const SEASON_XP = { sol: 10, sheltered: 25, upgrade: 40, win: 100, star: 25, loss: 30, campaign: 300, maxEvent: 1000 } as const;

/** Welcome-back gifts, one per day the game is opened, in a 7-step strip that loops. Day 7 is the big one. */
export const GIFTS: readonly number[] = [50, 60, 75, 90, 100, 125, 200];

// ------------------------------------------------------------------ notes for the screens
export type SeasonNote =
  | { kind: 'tier'; tier: number }
  | { kind: 'claim'; tier: number; rewards: SeasonReward[] }
  | { kind: 'weekly'; def: ChallengeDef }
  | { kind: 'event-step'; def: EventChallengeDef }
  | { kind: 'event-done'; patch: EventPatch }
  | { kind: 'gift'; xp: number; day: number };

const listeners: Array<(n: SeasonNote) => void> = [];
export function onSeason(fn: (n: SeasonNote) => void): () => void {
  listeners.push(fn);
  return () => {
    const i = listeners.indexOf(fn);
    if (i >= 0) listeners.splice(i, 1);
  };
}
function note(n: SeasonNote) {
  for (const fn of [...listeners]) {
    try {
      fn(n);
    } catch (e) {
      console.error('[season] screen update failed', e);
    }
  }
}

// ------------------------------------------------------------------ state and clock
let state: SeasonState | null = null;
let clock: () => Date = () => new Date();

export function seasonState(): SeasonState {
  return (state ??= loadState());
}
function save() {
  saveState(seasonState());
}
export function now(): Date {
  return clock();
}

/** Tests: start over (re-read storage, or a fresh state) and/or use a fixed clock. */
export function resetSeasonEngine(opts: { clock?: () => Date; fresh?: boolean } = {}): void {
  state = opts.fresh ? freshState() : null;
  clock = opts.clock ?? (() => new Date());
}

const pad = (n: number) => String(n).padStart(2, '0');
export function dayKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function isOver(): boolean {
  return seasonOver(clock());
}

// ------------------------------------------------------------------ Season XP and tiers
export function currentTier(): number {
  return tierFor(seasonState().xp);
}

/**
 * Add Season XP. `source`: 'game' (a sol, a launch), 'bonus' (an 'xp' event from another mode) or 'reward' (a
 * challenge or gift: it does not count toward XP challenges, so rewards never feed themselves).
 */
export function addSeasonXp(amount: number, source: 'game' | 'bonus' | 'reward', reason = ''): void {
  const a = Math.round(amount);
  if (!Number.isFinite(a) || a <= 0 || isOver()) return;
  const s = seasonState();
  const before = tierFor(s.xp);
  s.xp = Math.min(1e9, s.xp + a);
  const after = tierFor(s.xp);
  save();
  for (let t = Math.max(before, s.announced) + 1; t <= after; t++) note({ kind: 'tier', tier: t });
  if (after > s.announced) {
    s.announced = after;
    save();
  }
  if (source !== 'reward') track({ type: 'xp', amount: a, reason, bonus: source === 'bonus' });
}

/** Tiers reached whose rewards are waiting. */
export function claimableTiers(): number[] {
  const s = seasonState();
  const reached = tierFor(s.xp);
  const out: number[] = [];
  for (let t = 1; t <= reached; t++) if (!s.claimed.includes(t)) out.push(t);
  return out;
}

export function isClaimed(tier: number): boolean {
  return seasonState().claimed.includes(tier);
}

/** Claim one reached tier. Returns its rewards, or null if it is not reached or already claimed. */
export function claimTier(tier: number): SeasonReward[] | null {
  const s = seasonState();
  const def = tierDef(tier);
  if (!def || tier > tierFor(s.xp) || s.claimed.includes(tier)) return null;
  s.claimed.push(tier);
  s.claimed.sort((a, b) => a - b);
  save();
  note({ kind: 'claim', tier, rewards: def.rewards });
  return def.rewards;
}

/** Claim everything waiting. Returns the tiers claimed. */
export function claimAll(): number[] {
  return claimableTiers().filter((t) => claimTier(t) !== null);
}

// ------------------------------------------------------------------ what the player owns
function claimedRewards(kind: RewardKind): string[] {
  const s = seasonState();
  return TIERS.filter((t) => s.claimed.includes(t.tier)).flatMap((t) => t.rewards.filter((x) => x.kind === kind).map((x) => x.id));
}

/** Ids the player can use, defaults included. */
export function ownedIds(kind: Exclude<RewardKind, 'hangar'>): Set<string> {
  const out = new Set<string>([(DEFAULT_CARD as Record<string, string>)[kind], ...claimedRewards(kind)]);
  if (kind === 'patch') for (const p of seasonState().eventPatches) out.add(p.id);
  return out;
}

/** Hangar items the season has unlocked (claimed tiers). Read by the Hangar's unlock source. */
export function hangarUnlocks(): string[] {
  return claimedRewards('hangar');
}

/** An event patch as a drawable patch. */
export function eventPatchArt(p: EventPatch): CardPatch {
  const kind = p.kind;
  return {
    id: p.id,
    name: kind === 'gannon' ? 'Gannon Storm 2024' : `${p.mark} ${kind === 'cme' ? 'eruption' : 'flare'}, ${p.date}`,
    shape: kind === 'gannon' ? 'shield' : 'octagon',
    motif: kind === 'gannon' ? 'gannon' : 'flare',
    bg: kind === 'gannon' ? '#0b1a3a' : '#2a0c08',
    rim: kind === 'gannon' ? '#7dffb0' : '#ff7a1a',
    mark: p.mark,
    date: p.date,
  };
}

/** Every patch there is (season patches and the player's event patches). */
export function allPatches(): CardPatch[] {
  return [...PATCHES, ...seasonState().eventPatches.map(eventPatchArt)];
}

export function patchById(id: string): CardPatch {
  return allPatches().find((p) => p.id === id) ?? PATCHES[0];
}

// ------------------------------------------------------------------ the Player Card
export type CardSlot = 'title' | 'banner' | 'frame' | 'patch';

/** Choose a title, banner, frame or patch the player owns. Returns whether it changed. */
export function setCard(slot: CardSlot, id: string): boolean {
  if (!ownedIds(slot).has(id)) return false;
  const s = seasonState();
  if (s.card[slot] === id) return false;
  s.card[slot] = id;
  save();
  return true;
}

/** A new callsign from the word lists (never the same one twice in a row). */
export function rerollCallsign(rand: () => number = Math.random): string {
  const s = seasonState();
  s.card.callsign = rollCallsign(rand, s.card.callsign);
  save();
  return `${s.card.callsign.adj} ${s.card.callsign.noun} ${s.card.callsign.num}`;
}

export function cardView() {
  const s = seasonState();
  const c = s.card;
  return {
    callsign: `${c.callsign.adj} ${c.callsign.noun} ${c.callsign.num}`,
    title: TITLES.find((t) => t.id === c.title) ?? TITLES[0],
    banner: BANNERS.find((t) => t.id === c.banner) ?? BANNERS[0],
    frame: FRAMES.find((t) => t.id === c.frame) ?? FRAMES[0],
    patch: patchById(c.patch),
  };
}

// ------------------------------------------------------------------ weekly challenges
export function weekKey(): string {
  return isoWeekKey(clock());
}

/** This week's challenges, made fresh when a new week starts (last week's progress simply ends). */
export function weeklyToday(): NonNullable<SeasonState['weekly']> {
  const s = seasonState();
  const key = weekKey();
  if (!s.weekly || s.weekly.week !== key) {
    const defs = challengesForWeek(key);
    s.weekly = { week: key, ids: defs.map((d) => d.id), progress: defs.map(() => 0) };
    save();
  }
  return s.weekly;
}

export interface ChallengeView<D> {
  def: D;
  progress: number;
  done: boolean;
}

export function weeklyView(): ChallengeView<ChallengeDef>[] {
  const w = weeklyToday();
  return w.ids.flatMap((id, i) => {
    const def = challengeById(id);
    return def ? [{ def, progress: Math.min(def.goal, w.progress[i] ?? 0), done: (w.progress[i] ?? 0) >= def.goal }] : [];
  });
}

// ------------------------------------------------------------------ Sun events
/** The event on now: LIVE from the real Sun, or the ARCHIVE event. */
export function sunEvent(): SunEvent {
  return currentSunEvent(knownFeed(), clock());
}

function eventStateFor(id: string): EventState {
  const s = seasonState();
  let e = s.events.find((x) => x.id === id);
  if (!e) {
    e = { id, progress: [0, 0, 0], rewarded: s.eventPatches.some((p) => p.id === id) };
    s.events.push(e);
    while (s.events.length > MAX_EVENTS) s.events.shift();
    save();
  }
  return e;
}

export interface EventView {
  event: SunEvent;
  patch: EventPatch;
  steps: ChallengeView<EventChallengeDef>[];
  rewarded: boolean;
}

export function eventView(): EventView {
  const event = sunEvent();
  const patch = patchForEvent(event);
  const st = eventStateFor(patch.id);
  const steps = eventChallenges(event).map((def, i) => ({ def, progress: Math.min(def.goal, st.progress[i] ?? 0), done: (st.progress[i] ?? 0) >= def.goal }));
  return { event, patch, steps, rewarded: st.rewarded };
}

// ------------------------------------------------------------------ tracking
export function track(ev: SeasonEvent): void {
  if (isOver()) return;
  const s = seasonState();
  // Weekly challenges.
  const w = weeklyToday();
  const finished: ChallengeDef[] = [];
  w.ids.forEach((id, i) => {
    const def = challengeById(id);
    if (!def || w.progress[i] >= def.goal) return;
    let inc = 0;
    try {
      inc = def.count(ev);
    } catch {
      inc = 0;
    }
    if (!(inc > 0)) return;
    w.progress[i] = Math.min(def.goal, w.progress[i] + Math.floor(inc));
    if (w.progress[i] >= def.goal) finished.push(def);
  });
  save();
  // The Sun event.
  const event = sunEvent();
  const patch = patchForEvent(event);
  const st = eventStateFor(patch.id);
  const steps: EventChallengeDef[] = [];
  eventChallenges(event).forEach((def, i) => {
    if (st.progress[i] >= def.goal) return;
    let inc = 0;
    try {
      inc = def.count(ev);
    } catch {
      inc = 0;
    }
    if (!(inc > 0)) return;
    st.progress[i] = Math.min(def.goal, st.progress[i] + Math.floor(inc));
    if (st.progress[i] >= def.goal) steps.push(def);
  });
  const allDone = eventChallenges(event).every((def, i) => st.progress[i] >= def.goal);
  let patchEarned = false;
  if (allDone && !st.rewarded) {
    st.rewarded = true;
    if (!s.eventPatches.some((p) => p.id === patch.id)) s.eventPatches.push(patch);
    patchEarned = true;
  }
  save();
  // Rewards last, so the XP they give is counted after this event's own progress.
  for (const def of finished) {
    note({ kind: 'weekly', def });
    addSeasonXp(def.xp, 'reward');
  }
  for (const def of steps) {
    note({ kind: 'event-step', def });
    addSeasonXp(def.xp, 'reward');
  }
  if (patchEarned) note({ kind: 'event-done', patch });
}

// ------------------------------------------------------------------ welcome-back gifts
/** The gift waiting today (the 1-based day in the 7-step strip), or null if today's was opened. */
export function giftReady(): { day: number; xp: number } | null {
  if (isOver()) return null;
  const s = seasonState();
  if (s.login.last === dayKey(clock())) return null;
  const step = s.login.count % GIFTS.length;
  return { day: step + 1, xp: GIFTS[step] };
}

/** Open today's gift. Missing days never reset the strip: it just picks up where it left off. */
export function openGift(): number {
  const g = giftReady();
  if (!g) return 0;
  const s = seasonState();
  s.login.last = dayKey(clock());
  s.login.count++;
  save();
  note({ kind: 'gift', xp: g.xp, day: g.day });
  addSeasonXp(g.xp, 'reward');
  return g.xp;
}

/** Where the strip is: how many of the current 7 are opened, and which step opens next. */
export function giftStrip(): { opened: number; next: number; today: boolean } {
  const s = seasonState();
  const today = s.login.last === dayKey(clock());
  const inRound = s.login.count % GIFTS.length;
  // Just finished a full strip today: show it complete until tomorrow.
  const opened = today && inRound === 0 && s.login.count > 0 ? GIFTS.length : inRound;
  return { opened, next: inRound, today };
}

// ------------------------------------------------------------------ game events
function builtCount(r: GameEventMap['sol']['report']) {
  return r.builtAll?.length ?? (r.built ? 1 : 0);
}

export function onSol(p: GameEventMap['sol']): void {
  if (p.demo) return;
  const s = seasonState();
  const r = p.report;
  s.stats.sols++;
  if (r.storm && !(p.after.status === 'lost' && p.after.loseReason === 'dose')) s.stats.storms++;
  save();
  let xp = SEASON_XP.sol;
  if ((r.storm?.shelterCells ?? 0) > 0) xp += SEASON_XP.sheltered;
  xp += SEASON_XP.upgrade * builtCount(r);
  track({ type: 'sol', before: p.before, after: p.after, report: r, mode: p.mode });
  addSeasonXp(xp, 'game', 'Sol played');
}

export function onMissionEnd(p: GameEventMap['mission-end']): void {
  if (p.demo) return;
  const s = seasonState();
  s.stats.missions++;
  if (p.won) s.stats.launches++;
  save();
  const xp = (p.won ? SEASON_XP.win : SEASON_XP.loss) + SEASON_XP.star * p.stars.length;
  track({ type: 'end', mission: p.mission, won: p.won, mode: p.mode, stars: p.stars });
  addSeasonXp(xp, 'game', p.won ? 'Rocket launched' : 'Mission finished');
}

export function onCampaignComplete(): void {
  track({ type: 'campaign' });
  addSeasonXp(SEASON_XP.campaign, 'game', 'Campaign complete');
}

/** XP from any other mode (Storm Cards, flight medals, and every new mode) fills the pass too. */
export function onXp(p: GameEventMap['xp']): void {
  const amount = typeof p?.amount === 'number' && Number.isFinite(p.amount) ? Math.min(SEASON_XP.maxEvent, p.amount) : 0;
  const reason = typeof p?.reason === 'string' ? p.reason : '';
  addSeasonXp(amount, 'bonus', reason);
}

export function onLevelUp(p: GameEventMap['level-up']): void {
  const s = seasonState();
  if (typeof p?.level !== 'number' || p.level < s.stats.bestLevel) return;
  s.stats.bestLevel = Math.min(50, Math.max(1, Math.floor(p.level)));
  if (typeof p.rank === 'string' && /^[A-Za-z ]{1,24}$/.test(p.rank)) s.stats.bestRank = p.rank;
  save();
}

/** Keep the best level in step with the rank module (it may be ahead of what we have seen). */
export function syncBestLevel(level: number): void {
  const s = seasonState();
  if (Number.isFinite(level) && level > s.stats.bestLevel) {
    s.stats.bestLevel = Math.min(50, Math.floor(level));
    // We did not see this level's rank title arrive: show the level alone rather than an old title.
    s.stats.bestRank = null;
    save();
  }
}

export { MAX_TIER };
