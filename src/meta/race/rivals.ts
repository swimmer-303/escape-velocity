// Written with AI assistance (Claude Code). See README "Use of AI tools".
// The AI rival commanders (fictional: made-up names, pixel portraits from ./portrait) and the leagues they race in.
// Each league lists who can show up and how they play there: higher leagues have smarter, faster rivals.

import { shuffle, makeRng } from '../../sim/rng';
import type { Difficulty } from '../../sim/constants';
import type { Brain } from './brain';

export interface RivalProfile {
  id: string;
  name: string;
  /** One friendly line about how they play. */
  about: string;
  /** Their play style in two or three words. */
  style: string;
}

export const RIVALS: Record<string, RivalProfile> = {
  pip: { id: 'pip', name: 'Commander Pip', about: 'Keeps two days of air and food, then fills the rocket.', style: 'Balanced' },
  kiko: { id: 'kiko', name: 'Dr. Kiko', about: 'Follows a careful plan with a big safety stock. Slow and steady!', style: 'Careful planner' },
  bolt: { id: 'bolt', name: 'Engineer Bolt', about: 'Loves building gadgets for the next crew, even if the trip home takes longer.', style: 'Builder' },
  rook: { id: 'rook', name: 'Pilot Rook', about: 'Sometimes skips the heaters to rush the rocket. Cold batteries make less power!', style: 'Daredevil' },
  vega: { id: 'vega', name: 'Captain Vega', about: 'Races for the launch pad, but always uses the storm shelter when warned.', style: 'Racer' },
  nova: { id: 'nova', name: 'Captain Nova', about: 'Never hides from solar storms. Very fast, and a little reckless.', style: 'Storm chaser' },
  zara: { id: 'zara', name: 'Pilot Zara', about: 'Counts every power cell. Fast and careful at the same time.', style: 'Racer' },
};

export interface LeagueSlot {
  rival: keyof typeof RIVALS;
  brain: Brain;
}

export interface League {
  id: 'bronze' | 'silver' | 'gold' | 'diamond' | 'legend';
  name: string;
  color: string;
  difficulty: Difficulty;
  /** Top-2 finishes needed to move up (0 in the top league). */
  promote: number;
  /** Who can race here, and how they play in this league. Three are picked for each race. */
  lineup: LeagueSlot[];
}

export const LEAGUES: League[] = [
  {
    id: 'bronze',
    name: 'Bronze',
    color: '#d08a4a',
    difficulty: 'cadet',
    promote: 2,
    lineup: [
      { rival: 'pip', brain: { style: 'steady', slip: 0.7 } },
      { rival: 'kiko', brain: { style: 'careful', slip: 0.3 } },
      { rival: 'bolt', brain: { style: 'builder', slip: 0 } },
      { rival: 'rook', brain: { style: 'daredevil', slip: 0, stock: 0.2, gamble: 0.25 } },
    ],
  },
  {
    id: 'silver',
    name: 'Silver',
    color: '#c9d1dc',
    difficulty: 'cadet',
    promote: 3,
    lineup: [
      { rival: 'pip', brain: { style: 'steady', slip: 0.4 } },
      { rival: 'kiko', brain: { style: 'careful', slip: 0 } },
      { rival: 'vega', brain: { style: 'racer', slip: 0.4 } },
      { rival: 'rook', brain: { style: 'daredevil', slip: 0, stock: 0.2, gamble: 0.2 } },
    ],
  },
  {
    id: 'gold',
    name: 'Gold',
    color: '#ffd84a',
    difficulty: 'cadet',
    promote: 3,
    lineup: [
      { rival: 'vega', brain: { style: 'racer', slip: 0.2 } },
      { rival: 'pip', brain: { style: 'steady', slip: 0 } },
      { rival: 'nova', brain: { style: 'daredevil', slip: 0.3 } },
      { rival: 'rook', brain: { style: 'daredevil', slip: 0, stock: 0.2, gamble: 0.15 } },
    ],
  },
  {
    id: 'diamond',
    name: 'Diamond',
    color: '#5ef2e6',
    difficulty: 'commander',
    promote: 4,
    lineup: [
      { rival: 'vega', brain: { style: 'racer', slip: 0 } },
      { rival: 'kiko', brain: { style: 'careful', slip: 0 } },
      { rival: 'nova', brain: { style: 'daredevil', slip: 0 } },
      { rival: 'zara', brain: { style: 'racer', slip: 0.2 } },
    ],
  },
  {
    id: 'legend',
    name: 'Legend',
    color: '#c58bff',
    difficulty: 'commander',
    promote: 0,
    lineup: [
      { rival: 'vega', brain: { style: 'racer', slip: 0 } },
      { rival: 'nova', brain: { style: 'daredevil', slip: 0, stock: 0.4 } },
      { rival: 'zara', brain: { style: 'racer', slip: 0 } },
      { rival: 'rook', brain: { style: 'daredevil', slip: 0, stock: 0.2, gamble: 0.1 } },
    ],
  },
];

export function leagueAt(i: number): League {
  return LEAGUES[Math.max(0, Math.min(LEAGUES.length - 1, Math.floor(Number.isFinite(i) ? i : 0)))];
}

/** The `n` rivals for a race in this league, picked from the seed (so the same seed always meets the same rivals). */
export function pickRivals(league: League, seed: string, n = 3): LeagueSlot[] {
  return shuffle(makeRng(`rivals|${league.id}|${seed}`), league.lineup).slice(0, Math.min(n, league.lineup.length));
}
