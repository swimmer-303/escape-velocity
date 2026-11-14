// Written with AI assistance (Claude Code). See README "Use of AI tools".
// Student names for Mission Control rooms: a first name or nickname, up to 12 letters, numbers
// and spaces, run through a small blocklist. This is a first filter only: the teacher sees every
// name and can remove a player with one tap. Names live in server memory and are never stored.

import { checkNameFormat, type NameProblem } from './protocol';

/** Blocked anywhere inside a name (no ordinary name contains these). */
const BLOCK_ANYWHERE = [
  'fuck', 'cunt', 'bitch', 'bastard', 'whore', 'slut', 'nigg', 'fagg', 'retard', 'penis', 'vagina', 'porn', 'boob',
  'dildo', 'pussy', 'twat', 'nazi', 'hitler', 'kkk', 'sexy', 'horny', 'poop', 'suicide',
];
/** Blocked only as a whole word (they hide inside real names, like "Cassie", "Shital", "Killian" or "Grape"). */
const BLOCK_WORD = [
  'ass', 'sex', 'fag', 'fuk', 'shit', 'shitty', 'tit', 'tits', 'cum', 'cock', 'dick', 'anus', 'butt', 'fart', 'pee', 'wank', 'rape',
  'kill', 'die', 'dead', 'hell', 'damn', 'crap', 'piss', 'gay', 'dumb', 'stupid', 'idiot', 'loser', 'hate',
];

/** Lowercase, drop accents, undo common number-for-letter swaps. */
function plain(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/0/g, 'o')
    .replace(/1/g, 'i')
    .replace(/3/g, 'e')
    .replace(/4/g, 'a')
    .replace(/5/g, 's')
    .replace(/7/g, 't')
    .replace(/8/g, 'b');
}

export function isBlockedName(name: string): boolean {
  const p = plain(name);
  const squashed = p.replace(/ /g, '');
  // "f u c k" and "fuuuck" tricks: also check with spaces removed and repeated letters squeezed.
  const squeezed = squashed.replace(/(.)\1+/g, '$1');
  if (BLOCK_ANYWHERE.some((w) => squashed.includes(w) || squeezed.includes(w))) return true;
  const words = p.split(' ');
  return [...words, squashed].some((w) => BLOCK_WORD.includes(w) || BLOCK_WORD.includes(w.replace(/(.)\1+/g, '$1')));
}

/** Full check for a new player's name (format + blocklist). */
export function checkName(raw: string): { ok: true; name: string } | { ok: false; problem: NameProblem } {
  const f = checkNameFormat(raw);
  if (!f.ok) return f;
  if (isBlockedName(f.name)) return { ok: false, problem: 'blocked' };
  return f;
}
