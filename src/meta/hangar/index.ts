// Written with AI assistance (Claude Code). See README "Use of AI tools".
// The Hangar: suit colors, rocket paint jobs, a rover pet and base light colors, unlocked by Astronaut level
// (earned by playing, never bought). It talks to the game only through ../hooks:
// - the level-up screen lists what each level unlocks (addLevelRewards, with a pixel preview);
// - a level-up pops a toast for each newly unlocked item;
// - the title screen gets a Hangar button (order 30);
// - the player's choices are painted on the stage at start, and live while they equip things.
import './hangar.css';
import { addLevelRewards, addTitleExtra, metaContext, onGame, whenMetaReady } from '../hooks';
import { toast } from '../toast';
import { ITEMS, SLOT_WORDS, fullName } from './items';
import { applyLooks, unlocksToAnnounce } from './store';
import { itemPreview } from './preview';
import { openHangar, titleStrip } from './view';

export { openHangar, titleStrip } from './view';
export { ITEMS } from './items';
export { applyLooks, resetLooksMemo } from './store';

addLevelRewards(() =>
  ITEMS.filter((i) => i.level > 1).map((i) => ({
    id: `hangar-${i.id}`,
    name: fullName(i),
    kind: SLOT_WORDS[i.slot].kind,
    level: i.level,
    preview: () => itemPreview(i, 'small'),
  })),
);

whenMetaReady((ctx) => applyLooks(ctx));

addTitleExtra({
  id: 'hangar',
  order: 30,
  render: () => {
    // Back on the title screen: make sure the base wears the saved looks (the level may have just arrived).
    applyLooks();
    return titleStrip(() => {
      const ctx = metaContext();
      if (ctx) openHangar(ctx);
    });
  },
});

onGame('level-up', ({ level }) => {
  for (const item of unlocksToAnnounce(level)) {
    toast(`${SLOT_WORDS[item.slot].unlocked}: ${item.name}.`, 'Equip it in the Hangar.', { tone: 'gold', icon: itemPreview(item, 'small') });
  }
  applyLooks();
});
