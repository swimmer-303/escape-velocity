// Written with AI assistance (Claude Code). See README "Use of AI tools".
// Outpost Architect: a creative base-building mode with real engineering checks. Kids design a Mars or Moon base on a
// grid pad, watch a live readout (power, air, food, heat and storm safety, all from the game's own sim numbers),
// run a stress test with a real NASA solar storm, and collect stars on 12 Blueprint challenges that unlock new
// parts and decor. Talks to the game only through ../hooks:
// - a lobby tile on the title screen (order 36);
// - XP for new Blueprint stars (emitGame('xp'));
// - a shared link (?base=<code>) opens the builder with that base, once the game has started (?builder opens it).
import './builder.css';
import { addTitleExtra, whenMetaReady, metaContext } from '../hooks';
import { titleTile } from '../tile';
import { toast } from '../toast';
import { CHALLENGES, starTotals } from './challenges';
import { codeFromSearch, decodeLayout } from './share';
import { readSave, loadCurrent } from './store';
import { tileIcon } from './icons';
import { openBuilder } from './view';

export { openBuilder, builderOpen, currentBuilder, BUILDER_LABEL } from './view';

/** The status line under the tile's name. */
export function tileStatus(): string {
  const s = readSave();
  const t = starTotals(s.stars);
  if (t.done > 0) return `${t.done} of ${CHALLENGES.length} blueprints, ${t.got} stars`;
  return loadCurrent()?.parts.length ? 'Keep building your base' : 'Build your own base';
}

addTitleExtra({
  id: 'builder',
  order: 36,
  render: () => {
    const s = readSave();
    const fresh = !s.current && !Object.keys(s.stars).length;
    return titleTile({
      id: 'builder',
      name: 'Outpost Architect',
      sub: tileStatus(),
      icon: tileIcon(),
      accent: 'cyan',
      badge: fresh ? 'NEW' : undefined,
      onClick: () => {
        metaContext()?.audio.sfx('click');
        openBuilder({ start: true });
      },
    });
  },
});

/** Open a shared base from the page address (?base=<code>), then tidy the address so a reload doesn't reopen it. ?builder opens the start card. */
export function openFromLink(search: string = location.search): boolean {
  const code = codeFromSearch(search);
  if (!code) {
    // ?builder opens Outpost Architect's start card (a handy link for a class or a demo).
    let wanted = false;
    try {
      wanted = new URLSearchParams(search).has('builder');
    } catch {
      wanted = false;
    }
    if (wanted) openBuilder({ start: true });
    return wanted;
  }
  try {
    const url = new URL(location.href);
    url.searchParams.delete('base');
    history.replaceState(history.state, '', url.pathname + (url.search ? url.search : '') + url.hash);
  } catch {
    /* the address just keeps the code */
  }
  const layout = decodeLayout(code);
  if (!layout) {
    toast('That base link did not work.', 'Check the link, or build your own in Outpost Architect.', { tone: 'amber' });
    return false;
  }
  openBuilder({ layout, start: false });
  return true;
}

whenMetaReady(() => {
  // After the title screen has drawn.
  window.setTimeout(() => {
    try {
      openFromLink();
    } catch (e) {
      console.error('[builder] shared link failed', e);
    }
  }, 0);
});
