// Written with AI assistance (Claude Code). See README "Use of AI tools".
// Outpost Architect: share codes. A base becomes a short code of letters and digits (no personal data in it), and a
// link https://playescapevelocity.com/?base=<code> that opens the builder with that base to remix.
// Format: '1' (version), the site (g, a or m), 4 characters per part (part, x, z, turn and flag design), and a
// check character, so a mistyped or made-up code is rejected instead of loading something odd.

import { PART_IDS, FLAG_DESIGNS } from './parts';
import { GRID, sanitize, type Layout, type SiteId } from './layout';

const ALPHA = '0123456789abcdefghijklmnopqrstuvwxyz';
const SITE_CHAR: Record<SiteId, string> = { gale: 'g', arcadia: 'a', moon: 'm' };
const CHAR_SITE: Record<string, SiteId> = { g: 'gale', a: 'arcadia', m: 'moon' };
export const SHARE_ORIGIN = 'https://playescapevelocity.com';
/** Longest code we read: a full pad of one-square parts. */
export const MAX_CODE = 3 + 4 * GRID * GRID;

function check(body: string): string {
  let sum = 7;
  for (let i = 0; i < body.length; i++) sum = (sum * 31 + ALPHA.indexOf(body[i]) + 1) % 1_000_003;
  return ALPHA[sum % 36];
}

export function encodeLayout(layout: Layout): string {
  let body = `1${SITE_CHAR[layout.site] ?? 'g'}`;
  for (const p of layout.parts) {
    const pi = PART_IDS.indexOf(p.part);
    if (pi < 0 || pi >= 36) continue;
    const style = p.part === 'flag' ? Math.max(0, Math.min(FLAG_DESIGNS.length - 1, p.style ?? 0)) : 0;
    body += ALPHA[pi] + ALPHA[p.x] + ALPHA[p.z] + ALPHA[(p.rot & 3) + 4 * style];
  }
  return body + check(body);
}

/** Read a code. Anything wrong (bad characters, wrong length, bad check) gives null. Parts that don't fit are dropped. */
export function decodeLayout(code: unknown): Layout | null {
  if (typeof code !== 'string') return null;
  const s = code.trim().toLowerCase();
  if (s.length < 3 || s.length > MAX_CODE || !/^[0-9a-z]+$/.test(s)) return null;
  if (s[0] !== '1') return null;
  const site = CHAR_SITE[s[1]];
  if (!site) return null;
  const body = s.slice(0, -1);
  if (check(body) !== s.at(-1)) return null;
  const partsStr = body.slice(2);
  if (partsStr.length % 4 !== 0) return null;
  const parts: Array<{ part: string; x: number; z: number; rot: number; style?: number }> = [];
  for (let i = 0; i < partsStr.length; i += 4) {
    const pi = ALPHA.indexOf(partsStr[i]);
    const x = ALPHA.indexOf(partsStr[i + 1]);
    const z = ALPHA.indexOf(partsStr[i + 2]);
    const rs = ALPHA.indexOf(partsStr[i + 3]);
    const part = PART_IDS[pi];
    if (!part || x >= GRID || z >= GRID) return null;
    parts.push({ part, x, z, rot: rs & 3, style: rs >> 2 });
  }
  return sanitize({ site, parts });
}

export function shareLink(layout: Layout, origin = SHARE_ORIGIN): string {
  return `${origin}/?base=${encodeLayout(layout)}`;
}

/** The ?base= code in a page address (search string), or null. */
export function codeFromSearch(search: string): string | null {
  try {
    const v = new URLSearchParams(search).get('base');
    return v && v.length <= MAX_CODE + 8 ? v : null;
  } catch {
    return null;
  }
}
