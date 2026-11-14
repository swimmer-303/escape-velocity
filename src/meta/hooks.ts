// Written with AI assistance (Claude Code). See README "Use of AI tools".
// Extension points for the meta-game: Astronaut rank (XP, levels, daily missions), Storm Cards, the launch and
// landing mini-games, and the Hangar. Each feature lives in its own module under src/meta/ and talks to the
// game only through this file: the game controller (src/ui/app.ts) announces what happened (events), lets a
// feature take over the screen at two moments (interstitials), and shows what features add to the title screen.
// Features talk to each other through this file too (XP, level rewards), so none imports another.

import type { MissionState, SolReport } from '../sim/types';
import type { Campaign, StarId } from '../sim/campaign';
import type { Stage } from '../render/stage';
import type { GameAudio } from '../ui/audio';
import type { Child } from '../ui/dom';

export type PlayMode = 'campaign' | 'quick' | 'history' | 'daily';

// ------------------------------------------------------------------ events
export interface GameEventMap {
  /** One sol (or Moon day) has been played. `demo` is true in the self-playing demo: give no rewards then. */
  sol: { before: MissionState; after: MissionState; report: SolReport; mode: PlayMode; demo: boolean };
  /** A mission's end screen is about to show for the first time (won or lost). */
  'mission-end': { mission: MissionState; won: boolean; mode: PlayMode; stars: StarId[]; demo: boolean };
  /** The last crew of a campaign is done. */
  'campaign-complete': { campaign: Campaign };
  /** Award XP (the rank module listens). `reason` is shown to the player, e.g. "Survived an X-class storm". */
  xp: { amount: number; reason: string };
  /** The rank module announces a new level. */
  'level-up': { level: number; rank: string };
}

type Handler<K extends keyof GameEventMap> = (payload: GameEventMap[K]) => void;
const handlers: { [K in keyof GameEventMap]?: Array<Handler<K>> } = {};

/** Listen for a game event; returns a function that stops listening. */
export function onGame<K extends keyof GameEventMap>(kind: K, fn: Handler<K>): () => void {
  const list = (handlers[kind] ??= []) as Array<Handler<K>>;
  list.push(fn);
  return () => {
    const i = list.indexOf(fn);
    if (i >= 0) list.splice(i, 1);
  };
}

/** Announce a game event. A feature that throws never breaks the game. */
export function emitGame<K extends keyof GameEventMap>(kind: K, payload: GameEventMap[K]): void {
  for (const fn of [...((handlers[kind] ?? []) as Array<Handler<K>>)]) {
    try {
      fn(payload);
    } catch (e) {
      console.error(`[meta] ${kind} handler failed`, e);
    }
  }
}

// ------------------------------------------------------------------ shared context
/** What features may use: the 3D stage, sound, the dialog layer, and a way back to the title screen. */
export interface MetaContext {
  stage: Stage;
  audio: GameAudio;
  /** Show a dialog (replaces whatever dialog is open). */
  modal(content: Child, opts: { label: string; wide?: boolean; onClose?: () => void }): HTMLElement;
  closeModal(): void;
  showTitle(): void;
  reducedMotion(): boolean;
}

let ctx: MetaContext | null = null;
export function setMetaContext(c: MetaContext): void {
  ctx = c;
  for (const fn of readyFns.splice(0)) fn(c);
}
export function metaContext(): MetaContext | null {
  return ctx;
}
const readyFns: Array<(c: MetaContext) => void> = [];
/** Run once the game has started (right away if it already has). */
export function whenMetaReady(fn: (c: MetaContext) => void): void {
  if (ctx) fn(ctx);
  else readyFns.push(fn);
}

// ------------------------------------------------------------------ interstitials
export interface InterstitialContext {
  mission: MissionState;
  mode: PlayMode;
  site: 'mars' | 'moon';
  /** The full-screen layer to draw in (the dialog root); clear it when done. */
  root: HTMLElement;
  stage: Stage;
  audio: GameAudio;
  reducedMotion: boolean;
}

/**
 * Moments a feature may take over the screen, awaited by the game:
 * - 'landing': a new crew is about to land (before the first briefing). Not in the May 2024 replay.
 * - 'launch': the crew has filled the rocket and is about to launch (before the launch cinematic and end screen).
 * Interstitials never run in the self-playing demo. They must always resolve (offer a Skip button).
 */
export type InterstitialName = 'landing' | 'launch';
const interstitials: Partial<Record<InterstitialName, (c: InterstitialContext) => Promise<void>>> = {};

export function setInterstitial(name: InterstitialName, fn: ((c: InterstitialContext) => Promise<void>) | null): void {
  if (fn) interstitials[name] = fn;
  else delete interstitials[name];
}

export function hasInterstitial(name: InterstitialName): boolean {
  return !!interstitials[name];
}

export async function runInterstitial(name: InterstitialName, c: InterstitialContext): Promise<void> {
  const fn = interstitials[name];
  if (!fn) return;
  try {
    await fn(c);
  } catch (e) {
    console.error(`[meta] ${name} interstitial failed`, e);
  }
}

// ------------------------------------------------------------------ title screen
/** Something a feature adds to the title screen, drawn right under the tagline, in `order` (lowest first). */
export interface TitleExtra {
  id: string;
  order: number;
  render(): HTMLElement | null;
}
const titleExtras: TitleExtra[] = [];
export function addTitleExtra(extra: TitleExtra): void {
  const i = titleExtras.findIndex((e) => e.id === extra.id);
  if (i >= 0) titleExtras.splice(i, 1);
  titleExtras.push(extra);
  titleExtras.sort((a, b) => a.order - b.order);
}
export function renderTitleExtras(): HTMLElement[] {
  const out: HTMLElement[] = [];
  for (const e of titleExtras) {
    try {
      const el = e.render();
      if (el) out.push(el);
    } catch (err) {
      console.error(`[meta] title extra ${e.id} failed`, err);
    }
  }
  return out;
}

// ------------------------------------------------------------------ levels and rewards
/** Something a level unlocks (a Hangar item, a card pack...), shown on the level-up screen. */
export interface LevelReward {
  id: string;
  name: string;
  /** e.g. 'Suit color', 'Rocket paint', 'Rover pet', 'Title'. */
  kind: string;
  level: number;
  /** A small preview swatch or icon for the level-up screen. */
  preview?: () => HTMLElement;
}
const rewardSources: Array<() => LevelReward[]> = [];
export function addLevelRewards(source: () => LevelReward[]): void {
  rewardSources.push(source);
}
export function allLevelRewards(): LevelReward[] {
  return rewardSources.flatMap((s) => {
    try {
      return s();
    } catch {
      return [];
    }
  });
}
export function rewardsAtLevel(level: number): LevelReward[] {
  return allLevelRewards().filter((r) => r.level === level);
}

let levelProvider: () => number = () => 1;
/** The rank module tells everyone the player's level. */
export function setLevelProvider(fn: () => number): void {
  levelProvider = fn;
}
export function playerLevel(): number {
  try {
    return levelProvider();
  } catch {
    return 1;
  }
}
