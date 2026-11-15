// Written with AI assistance (Claude Code). See README "Use of AI tools".
// Seeded random numbers for Rover Expeditions, with no imports (so the lobby tile never pulls three.js into the
// first download). The generator is the same mulberry32 as rand() in src/render/retro.ts.

/** Seeded random numbers in 0..1: the same seed always gives the same sequence. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A 32-bit FNV-1a hash of a string, to turn "2026-11-14|gale" into a seed. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
