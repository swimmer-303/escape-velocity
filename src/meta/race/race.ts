// Written with AI assistance (Claude Code). See README "Use of AI tools".
// One Rival Race, the rules (no DOM). You and three rivals run the SAME mission: the same seed, the same real
// storms, the same world. After each of your sols every AI rival plays that sol too (deterministically, so the
// same seed always gives the same race), and a friend's ghost replays their recorded run sol by sol.

import { buildEventPool, RECENT_SNAPSHOT } from '../../data/donki';
import { earthMarsLightTime } from '../../data/lighttime';
import { createMission } from '../../sim/sim';
import type { Difficulty } from '../../sim/constants';
import type { LoseReason, MissionState, SpaceWeatherEvent } from '../../sim/types';
import { finishRival, stepRival, type Brain } from './brain';
import { callsignText, type Callsign } from './callsign';
import { poolFingerprint, type GhostRun } from './code';
import { leagueAt, pickRivals, RIVALS } from './rivals';
import { rankFinishes, rankLive, type Finish, type LiveEntry, type Placed } from './score';

export interface Racer {
  /** 'you', 'ghost', or a rival id. */
  id: string;
  kind: 'you' | 'ai' | 'ghost';
  name: string;
  /** Seed for the pixel portrait. */
  face: string;
  about?: string;
  style?: string;
  brain?: Brain;
  /** AI rivals: their mission so far. */
  state?: MissionState;
}

export interface Race {
  seed: string;
  site: 'mars' | 'moon';
  difficulty: Difficulty;
  league: number;
  lightTimeMin: number;
  eventPool: SpaceWeatherEvent[];
  racers: Racer[];
  ghost: GhostRun | null;
  /** The friend's run was dealt from the same storm pool as this race (so the storms match exactly). */
  sameStorms: boolean;
  status: 'ready' | 'done';
}

/**
 * Races deal storms from the stored copy of real NASA DONKI data that ships with the game (the recent month plus
 * May 2024), not today's live feed: so a friend who opens a challenge link next week still meets the same storms.
 */
export function racePool(): SpaceWeatherEvent[] {
  return buildEventPool({ status: 'archive', snapshot: RECENT_SNAPSHOT, fetchedAt: RECENT_SNAPSHOT?.fetchedAt ?? null, via: 'snapshot' });
}

export function newSeed(random: () => number = Math.random): string {
  let s = 'r';
  for (let i = 0; i < 6; i++) s += Math.floor(random() * 36).toString(36);
  return s;
}

export interface RaceOpts {
  league: number;
  you: Callsign;
  seed?: string;
  site?: 'mars' | 'moon';
  ghost?: GhostRun | null;
  /** Tests: a fixed light time and pool. */
  lightTimeMin?: number;
  eventPool?: SpaceWeatherEvent[];
}

export function createRace(o: RaceOpts): Race {
  const g = o.ghost ?? null;
  const lg = leagueAt(o.league);
  const seed = g?.seed ?? o.seed ?? newSeed();
  const eventPool = o.eventPool ?? racePool();
  const lightTimeMin = g?.lightTimeMin ?? o.lightTimeMin ?? Math.round(earthMarsLightTime().oneWayMinutes * 10) / 10;
  const you: Racer = { id: 'you', kind: 'you', name: 'You', face: `you|${callsignText(o.you)}` };
  const racers: Racer[] = [you];
  if (g) racers.push({ id: 'ghost', kind: 'ghost', name: callsignText(g.callsign), face: `friend|${callsignText(g.callsign)}`, about: 'Your friend\'s recorded run.', style: 'Friend' });
  for (const slot of pickRivals(lg, seed, g ? 2 : 3)) {
    const p = RIVALS[slot.rival];
    racers.push({ id: p.id, kind: 'ai', name: p.name, face: `rival|${p.id}`, about: p.about, style: p.style, brain: slot.brain });
  }
  return {
    seed,
    site: g?.site ?? o.site ?? 'mars',
    difficulty: g?.difficulty ?? lg.difficulty,
    league: o.league,
    lightTimeMin,
    eventPool,
    racers,
    ghost: g,
    sameStorms: !g || !g.pool || g.pool === poolFingerprint(eventPool),
    status: 'ready',
  };
}

/** Is this the race's mission? (Same seed, world and difficulty.) */
export function isRaceMission(race: Race | null, m: MissionState | null | undefined): boolean {
  if (!race || !m) return false;
  const site = m.config.site === 'moon' ? 'moon' : 'mars';
  return m.config.seed === race.seed && site === race.site && m.config.difficulty === race.difficulty && m.config.expedition === 1;
}

const rivalKey = (race: Race, r: Racer) => `${race.seed}|${r.id}`;

/**
 * Bring every AI rival to the same sol as the player. Rivals start from the player's own mission config, so they
 * meet exactly the same storms. Safe to call any number of times.
 */
export function syncRivals(race: Race, player: MissionState): void {
  for (const r of race.racers) {
    if (r.kind !== 'ai' || !r.brain) continue;
    r.state ??= createMission(player.config);
    let guard = 0;
    while (r.state.status === 'playing' && r.state.log.length < player.log.length && guard++ < 100) r.state = stepRival(r.state, r.brain, rivalKey(race, r));
  }
}

const lifeOf = (s: Pick<MissionState, 'air' | 'food' | 'crew'>) => (Math.max(0, s.air) + Math.max(0, s.food)) / Math.max(1, s.crew);

export interface Row extends LiveEntry {
  racer: Racer;
  loseReason?: LoseReason;
}

function stateRow(r: Racer, s: MissionState): Row {
  return { id: r.id, racer: r, status: s.status, fuel: s.status === 'won' ? 100 : s.fuel, sols: s.log.length, dose: s.dose, life: lifeOf(s), loseReason: s.loseReason };
}

/** Where everyone is after the player has played `player.log.length` sols. */
export function liveRows(race: Race, player: MissionState): Array<Placed<Row>> {
  const n = player.log.length;
  const rows = race.racers.map<Row>((r) => {
    if (r.kind === 'you') return stateRow(r, player);
    if (r.kind === 'ai') return r.state ? stateRow(r, r.state) : { id: r.id, racer: r, status: 'playing', fuel: player.config.prefillPct, sols: 0, dose: 0, life: lifeOf(player) };
    const g = race.ghost!;
    const k = Math.min(n, g.fuel.length);
    const done = n >= g.fuel.length;
    return {
      id: r.id,
      racer: r,
      status: done ? g.status : 'playing',
      fuel: k ? g.fuel[k - 1] : 0,
      sols: k,
      dose: done ? g.dose : 0,
      life: done ? g.life : 0,
      loseReason: done ? g.loseReason : undefined,
    };
  });
  return rankLive(rows);
}

export type Result = Placed<Finish & { racer: Racer; loseReason?: LoseReason }>;

/** The player's mission is over: play every rival to the end and work out the final places. */
export function finishRace(race: Race, player: MissionState): Result[] {
  syncRivals(race, player);
  const list: Array<Finish & { racer: Racer; loseReason?: LoseReason }> = race.racers.map((r) => {
    if (r.kind === 'ai' && r.state && r.brain) {
      r.state = finishRival(r.state, r.brain, rivalKey(race, r));
      const s = r.state;
      return { id: r.id, racer: r, launched: s.status === 'won', sols: s.log.length, dose: s.dose, life: lifeOf(s), fuel: s.status === 'won' ? 100 : s.fuel, loseReason: s.loseReason };
    }
    if (r.kind === 'ghost' && race.ghost) {
      const g = race.ghost;
      return { id: r.id, racer: r, launched: g.status === 'won', sols: g.fuel.length, dose: g.dose, life: g.life, fuel: g.fuel[g.fuel.length - 1] ?? 0, loseReason: g.loseReason };
    }
    const s = player;
    return { id: r.id, racer: r, launched: s.status === 'won', sols: s.log.length, dose: s.dose, life: lifeOf(s), fuel: s.status === 'won' ? 100 : s.fuel, loseReason: s.loseReason };
  });
  race.status = 'done';
  return rankFinishes(list);
}

// ------------------------------------------------------------------ what changed this sol
export type RaceNews =
  | { kind: 'overtake'; racer: Racer }
  | { kind: 'passed'; racer: Racer }
  | { kind: 'launch'; racer: Racer; sols: number }
  | { kind: 'home'; racer: Racer; reason: LoseReason; storm: 'solar' | 'dust' | null };

/** Compare the standings before and after a sol. */
export function newsBetween(before: Array<Placed<Row>>, after: Array<Placed<Row>>): RaceNews[] {
  const news: RaceNews[] = [];
  const at = (rows: Array<Placed<Row>>, id: string) => rows.find((r) => r.id === id)!;
  const meB = at(before, 'you');
  const meA = at(after, 'you');
  for (const a of after) {
    if (a.id === 'you') continue;
    const b = at(before, a.id);
    if (b.status === 'playing' && a.status === 'won') {
      news.push({ kind: 'launch', racer: a.racer, sols: a.sols });
      continue;
    }
    if (b.status === 'playing' && a.status === 'lost') {
      const last = a.racer.state?.log[a.racer.state.log.length - 1];
      const storm = last?.storm ? 'solar' : last && last.weather !== 'clear' ? 'dust' : null;
      news.push({ kind: 'home', racer: a.racer, reason: a.loseReason ?? 'window', storm });
      continue;
    }
    // Passing only counts while you are both still racing (your own launch ends the race for you: the podium says the rest).
    if (meA.status !== 'playing' || a.status !== 'playing') continue;
    // A tie on fuel is not a pass: someone has to be strictly ahead.
    const gap = Math.floor(meA.fuel) - Math.floor(a.fuel);
    if (b.place < meB.place && a.place > meA.place && gap > 0) news.push({ kind: 'overtake', racer: a.racer });
    else if (b.place > meB.place && a.place < meA.place && gap < 0) news.push({ kind: 'passed', racer: a.racer });
  }
  return news;
}
