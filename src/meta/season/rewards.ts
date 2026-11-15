// Written with AI assistance (Claude Code). See README "Use of AI tools".
// What the Season 1 tiers give, and the Player Card cosmetics (titles, banners, frames, mission patches).
// Every reward is earned by playing: no money, no loot boxes, no random drops. Every 5th tier is a big one.
// Four big tiers unlock Season 1 items in the Hangar (they also unlock at level 50, so nobody is locked out
// forever if they missed the season). Pure data, no DOM.

import { MAX_TIER, isBigTier } from './season';

export type RewardKind = 'title' | 'banner' | 'frame' | 'patch' | 'hangar';

export interface SeasonReward {
  kind: RewardKind;
  id: string;
  name: string;
}

export interface TierDef {
  tier: number;
  big: boolean;
  rewards: SeasonReward[];
}

// ------------------------------------------------------------------ Player Card cosmetics
export interface CardTitle {
  id: string;
  name: string;
}
export interface CardBanner {
  id: string;
  name: string;
  /** CSS background for the card. Dark enough for light text everywhere (contrast is checked by a test). */
  css: string;
  /** The darkest color in it, for the contrast test. */
  dark: string;
}
export interface CardFrame {
  id: string;
  name: string;
  /** Outer and inner border colors. */
  outer: string;
  inner: string;
}
export type PatchShape = 'hex' | 'shield' | 'octagon' | 'round' | 'diamond';
export type PatchMotif =
  | 'star'
  | 'first-light'
  | 'sunspot'
  | 'red-planet'
  | 'rocket'
  | 'two-moons'
  | 'corona'
  | 'moon-base'
  | 'comet'
  | 'ringed'
  | 'magnet'
  | 'sunburst'
  | 'lander'
  | 'solar-max'
  | 'escape'
  | 'aurora'
  | 'flare'
  | 'gannon';
export interface CardPatch {
  id: string;
  name: string;
  shape: PatchShape;
  motif: PatchMotif;
  bg: string;
  rim: string;
  /** Short text stitched on the patch (event patches: the flare class). */
  mark?: string;
  /** Event patches: "Nov 5, 2026". */
  date?: string;
}

/** What every player starts with. */
export const DEFAULT_CARD = { title: 't-junior', banner: 'b-night', frame: 'f-steel', patch: 'p-recruit' } as const;

export const TITLES: readonly CardTitle[] = [
  { id: 't-junior', name: 'Junior Astronaut' },
  { id: 't-sun-watcher', name: 'Sun Watcher' },
  { id: 't-storm-chaser', name: 'Storm Chaser' },
  { id: 't-oxygen-maker', name: 'Oxygen Maker' },
  { id: 't-shelter-chief', name: 'Shelter Chief' },
  { id: 't-flare-spotter', name: 'Flare Spotter' },
  { id: 't-fuel-boss', name: 'Fuel Boss' },
  { id: 't-aurora-hunter', name: 'Aurora Hunter' },
  { id: 't-habitat-builder', name: 'Habitat Builder' },
  { id: 't-radiation-ranger', name: 'Radiation Ranger' },
  { id: 't-crew-hero', name: 'Crew Hero' },
  { id: 't-space-weather-pro', name: 'Space Weather Pro' },
  { id: 't-solar-pioneer', name: 'Solar Pioneer' },
  { id: 't-deep-space', name: 'Deep Space Explorer' },
  { id: 't-solar-max-legend', name: 'Solar Maximum Legend' },
];

export const BANNERS: readonly CardBanner[] = [
  { id: 'b-night', name: 'Night Sky', css: 'linear-gradient(160deg, #1b1640 0%, #0d0b20 100%)', dark: '#0d0b20' },
  { id: 'b-sunrise', name: 'Sunrise', css: 'linear-gradient(180deg, #3a1c4a 0%, #6e2a3a 60%, #8a4a1c 100%)', dark: '#3a1c4a' },
  { id: 'b-red-dust', name: 'Red Dust', css: 'linear-gradient(170deg, #5a2414 0%, #3a160c 100%)', dark: '#3a160c' },
  { id: 'b-aurora', name: 'Aurora', css: 'linear-gradient(170deg, #0b2a2a 0%, #145a46 45%, #2a1650 100%)', dark: '#0b2a2a' },
  { id: 'b-solar-wind', name: 'Solar Wind', css: 'repeating-linear-gradient(115deg, #2a1a10 0 14px, #3a2414 14px 22px)', dark: '#2a1a10' },
  { id: 'b-deep-space', name: 'Deep Space', css: 'radial-gradient(circle at 80% 20%, #2e2654 0%, #0a0818 70%)', dark: '#0a0818' },
  { id: 'b-eclipse', name: 'Eclipse', css: 'radial-gradient(circle at 85% 50%, #000 0 18px, #ffd34d 19px 21px, #3a2a10 22px, #120c06 80%)', dark: '#120c06' },
  { id: 'b-golden-hour', name: 'Golden Hour', css: 'linear-gradient(180deg, #4a2a08 0%, #6a3a0a 100%)', dark: '#4a2a08' },
  { id: 'b-nebula', name: 'Nebula', css: 'radial-gradient(circle at 20% 30%, #5a1f5a 0%, transparent 55%), radial-gradient(circle at 80% 70%, #1f3a6a 0%, transparent 55%), #120c26', dark: '#120c26' },
  { id: 'b-starfield', name: 'Starfield', css: 'radial-gradient(#fff 1px, transparent 1.5px) 0 0 / 18px 18px, #0c0a1c', dark: '#0c0a1c' },
  { id: 'b-corona-gold', name: 'Corona Gold', css: 'radial-gradient(circle at 50% 120%, #8a5a10 0%, #3a2408 60%, #1a1004 100%)', dark: '#1a1004' },
];

export const FRAMES: readonly CardFrame[] = [
  { id: 'f-steel', name: 'Steel', outer: '#000', inner: '#8a8fa3' },
  { id: 'f-flare', name: 'Flare', outer: '#000', inner: '#ff7a1a' },
  { id: 'f-copper', name: 'Copper', outer: '#000', inner: '#c8743a' },
  { id: 'f-plasma', name: 'Plasma', outer: '#000', inner: '#ff6bd6' },
  { id: 'f-prominence', name: 'Prominence', outer: '#000', inner: '#ff5a4f' },
  { id: 'f-silver', name: 'Silver', outer: '#000', inner: '#dfe6f0' },
  { id: 'f-solar-gold', name: 'Solar Gold', outer: '#000', inner: '#ffd84a' },
];

export const PATCHES: readonly CardPatch[] = [
  { id: 'p-recruit', name: 'Recruit', shape: 'round', motif: 'star', bg: '#2e2654', rim: '#c2b59b' },
  { id: 'p-first-light', name: 'First Light', shape: 'hex', motif: 'first-light', bg: '#2a1650', rim: '#ffb627' },
  { id: 'p-sunspot', name: 'Sunspot', shape: 'octagon', motif: 'sunspot', bg: '#1d1450', rim: '#ff9a3c' },
  { id: 'p-red-planet', name: 'Red Planet', shape: 'shield', motif: 'red-planet', bg: '#15122b', rim: '#e0602f' },
  { id: 'p-rocket-home', name: 'Rocket Home', shape: 'shield', motif: 'rocket', bg: '#1f3a6a', rim: '#f4ead8' },
  { id: 'p-two-moons', name: 'Two Moons', shape: 'hex', motif: 'two-moons', bg: '#2a1a3a', rim: '#c9ccd6' },
  { id: 'p-corona', name: 'Corona', shape: 'round', motif: 'corona', bg: '#0a0818', rim: '#ffd84a' },
  { id: 'p-moon-base', name: 'Moon Base', shape: 'octagon', motif: 'moon-base', bg: '#14183a', rim: '#c9ccd6' },
  { id: 'p-comet', name: 'Comet', shape: 'diamond', motif: 'comet', bg: '#102a3a', rim: '#5ef2e6' },
  { id: 'p-ringed', name: 'Ringed Planet', shape: 'hex', motif: 'ringed', bg: '#2a1650', rim: '#c58bff' },
  { id: 'p-magnet', name: 'Magnetic Shield', shape: 'shield', motif: 'magnet', bg: '#0e1f3a', rim: '#5ec8f2' },
  { id: 'p-sunburst', name: 'Sunburst', shape: 'round', motif: 'sunburst', bg: '#3a1608', rim: '#ffd34d' },
  { id: 'p-lander', name: 'Lander', shape: 'octagon', motif: 'lander', bg: '#3a1a10', rim: '#f4ead8' },
  { id: 'p-solar-max', name: 'Solar Max', shape: 'shield', motif: 'solar-max', bg: '#2a0c08', rim: '#ffd84a', mark: 'S1' },
  { id: 'p-escape', name: 'Escape Velocity', shape: 'hex', motif: 'escape', bg: '#15122b', rim: '#ffb627' },
  { id: 'p-northern-lights', name: 'Northern Lights', shape: 'round', motif: 'aurora', bg: '#081a1e', rim: '#7dffb0' },
];

// ------------------------------------------------------------------ the 40 tiers
const r = (kind: RewardKind, id: string, name: string): SeasonReward => ({ kind, id, name });
const title = (id: string) => r('title', id, TITLES.find((t) => t.id === id)!.name);
const banner = (id: string) => r('banner', id, BANNERS.find((t) => t.id === id)!.name);
const frame = (id: string) => r('frame', id, FRAMES.find((t) => t.id === id)!.name);
const patch = (id: string) => r('patch', id, PATCHES.find((t) => t.id === id)!.name);

/** Hangar items the season unlocks (defined in ../hangar/items.ts, marked `season`). */
export const SEASON_HANGAR = {
  lights: { id: 'lights-aurora', name: 'Aurora base lights' },
  suit: { id: 'suit-solar-flare', name: 'Solar Flare suit' },
  pet: { id: 'pet-blaze', name: 'Blaze the rover pet' },
  rocket: { id: 'rocket-solar-max', name: 'Solar Max rocket paint' },
} as const;
const hangar = (k: keyof typeof SEASON_HANGAR) => r('hangar', SEASON_HANGAR[k].id, SEASON_HANGAR[k].name);

const LIST: SeasonReward[][] = [
  /* 1 */ [patch('p-first-light')],
  /* 2 */ [title('t-sun-watcher')],
  /* 3 */ [banner('b-sunrise')],
  /* 4 */ [patch('p-sunspot')],
  /* 5 */ [frame('f-flare'), title('t-storm-chaser')],
  /* 6 */ [patch('p-red-planet')],
  /* 7 */ [banner('b-red-dust')],
  /* 8 */ [title('t-oxygen-maker')],
  /* 9 */ [patch('p-rocket-home')],
  /* 10 */ [hangar('lights'), banner('b-aurora')],
  /* 11 */ [title('t-shelter-chief')],
  /* 12 */ [patch('p-two-moons')],
  /* 13 */ [banner('b-solar-wind')],
  /* 14 */ [frame('f-copper')],
  /* 15 */ [patch('p-corona'), title('t-flare-spotter')],
  /* 16 */ [banner('b-deep-space')],
  /* 17 */ [title('t-fuel-boss')],
  /* 18 */ [patch('p-moon-base')],
  /* 19 */ [frame('f-plasma')],
  /* 20 */ [hangar('suit'), title('t-aurora-hunter')],
  /* 21 */ [patch('p-comet')],
  /* 22 */ [banner('b-eclipse')],
  /* 23 */ [title('t-habitat-builder')],
  /* 24 */ [patch('p-ringed')],
  /* 25 */ [frame('f-prominence'), banner('b-golden-hour')],
  /* 26 */ [title('t-radiation-ranger')],
  /* 27 */ [patch('p-magnet')],
  /* 28 */ [banner('b-nebula')],
  /* 29 */ [title('t-crew-hero')],
  /* 30 */ [hangar('pet'), patch('p-sunburst')],
  /* 31 */ [banner('b-starfield')],
  /* 32 */ [patch('p-lander')],
  /* 33 */ [title('t-space-weather-pro')],
  /* 34 */ [frame('f-silver')],
  /* 35 */ [patch('p-solar-max'), title('t-solar-pioneer')],
  /* 36 */ [banner('b-corona-gold')],
  /* 37 */ [patch('p-escape')],
  /* 38 */ [title('t-deep-space')],
  /* 39 */ [patch('p-northern-lights')],
  /* 40 */ [hangar('rocket'), frame('f-solar-gold'), title('t-solar-max-legend')],
];

export const TIERS: readonly TierDef[] = LIST.map((rewards, i) => ({ tier: i + 1, big: isBigTier(i + 1), rewards }));

if (TIERS.length !== MAX_TIER) throw new Error('Season 1 needs exactly 40 tiers');

export function tierDef(tier: number): TierDef | undefined {
  return TIERS[tier - 1];
}

/** "Storm Chaser title", "Aurora base lights". */
export function rewardWords(x: SeasonReward): string {
  switch (x.kind) {
    case 'title':
      return `"${x.name}" title`;
    case 'banner':
      return `${x.name} card banner`;
    case 'frame':
      return `${x.name} card frame`;
    case 'patch':
      return `${x.name} mission patch`;
    case 'hangar':
      return x.name;
  }
}

/** The tier that unlocks a cosmetic (0 = everyone has it). */
export function tierOf(kind: RewardKind, id: string): number {
  if ((DEFAULT_CARD as Record<string, string>)[kind] === id) return 0;
  return TIERS.find((t) => t.rewards.some((x) => x.kind === kind && x.id === id))?.tier ?? -1;
}
