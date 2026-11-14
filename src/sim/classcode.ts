// Written with AI assistance (Claude Code). See README "Use of AI tools".
// Class codes: a teacher shares one short code and the whole class plays the same Mars.
// The code IS the mission seed, so the same code (and the same difficulty) gives everyone the
// same dust storms, cold nights, cargo day and the same pick of real solar storms from the
// same pool of NASA events. Players' choices still change how each crew copes.

import { newCampaign, type Campaign } from './campaign';
import type { Difficulty } from './constants';

/**
 * Easy to read aloud, write on a board and type: no 0/O or 1/I/L (they look alike),
 * and no vowels at all, so a random code can never spell a word.
 */
export const CODE_ALPHABET = '23456789BCDFGHJKMNPQRSTVWXYZ';
export const CODE_LENGTH = 5;

/** Uppercase, and drop spaces, dashes, dots and underscores: " k7r-zq " becomes "K7RZQ". */
export function normalizeClassCode(raw: string): string {
  return raw.toUpperCase().replace(/[\s\-‐-―_.]+/g, '');
}

/** Is this (already normalized) text a class code? */
export function isClassCode(code: string): boolean {
  return code.length === CODE_LENGTH && [...code].every((ch) => CODE_ALPHABET.includes(ch));
}

export type CodeProblem = 'empty' | 'length' | 'letters';
export type CodeCheck = { ok: true; code: string } | { ok: false; problem: CodeProblem };

/** Check what a player typed. Case, spaces and dashes don't matter. */
export function checkClassCode(raw: string): CodeCheck {
  const code = normalizeClassCode(raw);
  if (!code) return { ok: false, problem: 'empty' };
  if (code.length !== CODE_LENGTH) return { ok: false, problem: 'length' };
  if (!isClassCode(code)) return { ok: false, problem: 'letters' };
  return { ok: true, code };
}

/** The class code in a page address like `?code=K7RZQ`, or null if there isn't a valid one. */
export function classCodeFromSearch(search: string): string | null {
  const raw = new URLSearchParams(search).get('code');
  if (raw === null) return null;
  const res = checkClassCode(raw);
  return res.ok ? res.code : null;
}

function secureRandom(): number {
  const c = globalThis.crypto;
  if (c?.getRandomValues) return c.getRandomValues(new Uint32Array(1))[0] / 4294967296;
  return Math.random();
}

/** A fresh random class code for a teacher. */
export function makeClassCode(random: () => number = secureRandom): string {
  let out = '';
  for (let i = 0; i < CODE_LENGTH; i++) out += CODE_ALPHABET[Math.floor(random() * CODE_ALPHABET.length) % CODE_ALPHABET.length];
  return out;
}

/** A new campaign. With a class code, the code is the seed and is saved with the campaign. */
export function campaignWithCode(code: string | null, fallbackSeed: string, difficulty: Difficulty): Campaign {
  if (!code) return newCampaign(fallbackSeed, difficulty);
  return { ...newCampaign(code, difficulty), classCode: code };
}
