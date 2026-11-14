// Written with AI assistance (Claude Code). See README "Use of AI tools".
// Storm Cards: every real NASA solar storm your crew faces becomes a collectible card.
// - Earning: each played sol with a storm (never in the self-playing demo) adds that real event's card, or counts it again.
// - New cards give XP (more for rarer ones) and pop up a toast with a tiny picture of the card.
// - The title screen gets a compact row (order 20) that opens the Storm Cards screen.
// Rarity rules and wording: ./rarity.ts. The collection in localStorage: ./store.ts. What there is to find: ./pool.ts.

import './cards.css';
import { addTitleExtra, emitGame, metaContext, onGame, whenMetaReady, type GameEventMap } from '../hooks';
import { toast } from '../toast';
import { miniCard } from './art';
import { cardTitle, isFarSideGiant, rarityOf, RARITY_WORD, RARITY_XP, SET_BONUS_XP, SPECIAL_BONUS_XP } from './rarity';
import { addMeeting, loadCollection, saveCollection, type StoredCard } from './store';
import { may2024Ids, watchFeed } from './pool';
import { renderTitleRow } from './screen';

export { openStormCards } from './screen';

type StormReport = NonNullable<GameEventMap['sol']['report']['storm']>;

/** The crew sat it out in a powered shelter that blocked almost all of the dose (the game's "full" shelter). */
export function wasShielded(s: StormReport): boolean {
  if (s.shelterCells <= 0) return false;
  return s.doseUnsheltered <= 0 || s.doseTaken <= s.doseUnsheltered * 0.1 + 1e-9;
}

export function xpFor(card: StoredCard): number {
  return RARITY_XP[rarityOf(card)] + (isFarSideGiant(card) ? SPECIAL_BONUS_XP : 0);
}

/** Handle one played sol. Exported for tests. */
export function onSol(p: GameEventMap['sol']): void {
  if (p.demo || !p.report.storm) return;
  const s = p.report.storm;
  const col = loadCollection();
  const res = addMeeting(col, s.event, { shielded: wasShielded(s), site: p.after.config.site === 'moon' ? 'moon' : 'mars' });
  if (!res) return;
  let setDone = false;
  if (res.isNew && !col.setBonus) {
    const ids = may2024Ids();
    if (ids.has(res.card.id) && ids.size > 0 && [...ids].every((id) => col.cards[id])) {
      col.setBonus = true;
      setDone = true;
    }
  }
  saveCollection(col);

  const c = res.card;
  const title = cardTitle(c);
  const rarity = rarityOf(c);
  if (res.isNew) {
    emitGame('xp', { amount: xpFor(c), reason: `New Storm Card: ${title} (${RARITY_WORD[rarity]})` });
    // A collectible deserves a sound: the game's "good news" chime (respects the player's mute setting).
    metaContext()?.audio.sfx('good');
    toast('New Storm Card!', `${title}, ${RARITY_WORD[rarity]}${isFarSideGiant(c) ? ' (special)' : ''}. A real storm from ${dateWords(c.time)}.`, {
      tone: rarity === 'legendary' ? 'gold' : rarity === 'epic' || rarity === 'rare' ? 'cyan' : 'amber',
      icon: miniCard(c),
      ms: 5000,
    });
  } else {
    toast(`Storm Card x${c.count}`, `Your crews met the ${title} again.`, { tone: 'cyan', icon: miniCard(c), ms: 3000 });
  }
  if (setDone) {
    emitGame('xp', { amount: SET_BONUS_XP, reason: 'Completed the May 2024 Storm Card set' });
    toast('Set complete!', 'You collected every storm of May 2024.', { tone: 'gold', ms: 5000 });
  }
}

function dateWords(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? 'NASA\'s records' : d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

onGame('sol', onSol);

// The title-screen row, redrawn in place once the game's space-weather feed arrives (live or archive).
let row: HTMLElement | null = null;
function redrawRow() {
  if (row && row.isConnected) {
    const next = renderTitleRow();
    row.replaceWith(next);
    row = next;
  }
}
addTitleExtra({
  id: 'storm-cards',
  order: 20,
  render: () => {
    watchFeed(redrawRow);
    row = renderTitleRow();
    return row;
  },
});
whenMetaReady(() => watchFeed(redrawRow));
