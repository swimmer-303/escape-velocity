// Written with AI assistance (Claude Code). See README "Use of AI tools".
// Friend challenge links, with no server: https://playescapevelocity.com/?race=<code>. The code carries the mission
// (seed, world, difficulty, light time, a fingerprint of the storm pool), the sender's callsign (words from fixed
// lists, never typed text) and their run: rocket fuel % after every sol, and how it ended. Opening the link races
// the sender's recorded run as a "ghost". Decoding is strict: anything unexpected is rejected, never guessed.
//
//   1.<seed>.<site><difficulty>.<callsign>.<fuel per sol, 2 base-36 digits each>.<end>.<pool>.<light>.<check>
//   e.g. 1.rk2x9a.mc.brave-comet-42.0m1g2a2s.w3c-5k.k3f9.6x.q1

import { hashSeed } from '../../sim/rng';
import type { Difficulty } from '../../sim/constants';
import type { LoseReason, MissionState, SpaceWeatherEvent } from '../../sim/types';
import { callsignSlug, parseCallsignSlug, type Callsign } from './callsign';

export const SITE_URL = 'https://playescapevelocity.com/';
export const MAX_SOLS = 60;

export interface GhostRun {
  seed: string;
  site: 'mars' | 'moon';
  difficulty: Difficulty;
  callsign: Callsign;
  /** Rocket fuel %, whole numbers, after each sol played. */
  fuel: number[];
  status: 'won' | 'lost';
  loseReason?: LoseReason;
  /** mSv, 0.1 precision. */
  dose: number;
  /** Days of air plus days of food left, 0.1 precision. */
  life: number;
  /** Fingerprint of the storm pool the run was dealt from ('' if unknown). */
  pool: string;
  lightTimeMin: number;
}

const END_CHAR: Record<'won' | LoseReason, string> = { won: 'w', air: 'a', food: 'f', dose: 'd', window: 't' };
const CHAR_END: Record<string, 'won' | LoseReason> = { w: 'won', a: 'air', f: 'food', d: 'dose', t: 'window' };

const b36 = (n: number, width = 1) => Math.max(0, Math.round(n)).toString(36).padStart(width, '0');

/** A short fingerprint of a storm pool: the same real events give the same 4 characters. */
export function poolFingerprint(pool: readonly Pick<SpaceWeatherEvent, 'id'>[]): string {
  return b36(hashSeed(pool.map((e) => e.id).join(',')) % 36 ** 4, 4);
}

function checksum(body: string): string {
  return b36(hashSeed(`ev-race|${body}`) % 36 ** 2, 2);
}

/** The run a finished (or unfinished) mission made, ready to share. */
export function ghostFromMission(m: MissionState, callsign: Callsign): GhostRun {
  const fuel = m.log.map((r) => Math.max(0, Math.min(100, Math.floor(r.after.fuel + 1e-9))));
  const won = m.status === 'won';
  if (won && fuel.length) fuel[fuel.length - 1] = 100;
  return {
    seed: m.config.seed,
    site: m.config.site === 'moon' ? 'moon' : 'mars',
    difficulty: m.config.difficulty,
    callsign,
    fuel: fuel.slice(0, MAX_SOLS),
    status: won ? 'won' : 'lost',
    ...(won ? {} : { loseReason: m.loseReason ?? 'window' }),
    dose: Math.round(m.dose * 10) / 10,
    life: Math.round(((Math.max(0, m.air) + Math.max(0, m.food)) / Math.max(1, m.crew)) * 10) / 10,
    pool: poolFingerprint(m.config.eventPool),
    lightTimeMin: Math.round(m.config.lightTimeMin * 10) / 10,
  };
}

export function encodeRun(g: GhostRun): string {
  const parts = [
    '1',
    g.seed,
    `${g.site === 'moon' ? 'n' : 'm'}${g.difficulty === 'commander' ? 'k' : 'c'}`,
    callsignSlug(g.callsign),
    g.fuel.map((f) => b36(Math.max(0, Math.min(100, Math.round(f))), 2)).join(''),
    `${END_CHAR[g.status === 'won' ? 'won' : (g.loseReason ?? 'window')]}${b36(g.dose * 10)}-${b36(g.life * 10)}`,
    g.pool || 'x',
    b36(g.lightTimeMin * 10),
  ];
  const body = parts.join('.');
  return `${body}.${checksum(body)}`;
}

export function challengeUrl(g: GhostRun, base = SITE_URL): string {
  return `${base}?race=${encodeRun(g)}`;
}

const num36 = (s: string, max: number): number | null => {
  if (!/^[0-9a-z]{1,4}$/.test(s)) return null;
  const n = parseInt(s, 36);
  return Number.isFinite(n) && n >= 0 && n <= max ? n : null;
};

/** Read a code. Returns null for anything that is not exactly a code this game made. */
export function decodeRun(code: unknown): GhostRun | null {
  if (typeof code !== 'string' || code.length > 400) return null;
  const parts = code.trim().split('.');
  if (parts.length !== 9 || parts[0] !== '1') return null;
  const [, seed, flags, sign, traj, end, pool, light, check] = parts;
  if (checksum(parts.slice(0, 8).join('.')) !== check) return null;
  if (!/^[A-Za-z0-9_-]{1,24}$/.test(seed)) return null;
  if (!/^[mn][ck]$/.test(flags)) return null;
  const callsign = parseCallsignSlug(sign);
  if (!callsign) return null;
  if (!/^([0-9a-z]{2})+$/.test(traj) || traj.length / 2 > MAX_SOLS) return null;
  const fuel: number[] = [];
  for (let i = 0; i < traj.length; i += 2) {
    const f = num36(traj.slice(i, i + 2), 100);
    if (f === null) return null;
    fuel.push(f);
  }
  const em = /^([wafdt])([0-9a-z]{1,3})-([0-9a-z]{1,3})$/.exec(end);
  if (!em) return null;
  const how = CHAR_END[em[1]];
  const dose10 = num36(em[2], 9999);
  const life10 = num36(em[3], 9999);
  if (!how || dose10 === null || life10 === null) return null;
  if (how === 'won' && fuel[fuel.length - 1] !== 100) return null;
  if (!/^([0-9a-z]{4}|x)$/.test(pool)) return null;
  const lt10 = num36(light, 600);
  if (lt10 === null) return null;
  return {
    seed,
    site: flags[0] === 'n' ? 'moon' : 'mars',
    difficulty: flags[1] === 'k' ? 'commander' : 'cadet',
    callsign,
    fuel,
    status: how === 'won' ? 'won' : 'lost',
    ...(how === 'won' ? {} : { loseReason: how }),
    dose: dose10 / 10,
    life: life10 / 10,
    pool: pool === 'x' ? '' : pool,
    lightTimeMin: lt10 / 10,
  };
}

/** The code from a page address (?race=...), or null. */
export function raceParam(search: string): string | null {
  try {
    return new URLSearchParams(search).get('race');
  } catch {
    return null;
  }
}
