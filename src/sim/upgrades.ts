// Written with AI assistance (Claude Code). See README "Use of AI tools".
// Base upgrades. Each one is built by investing power cells in the Workshop over several sols:
// power spent building today is power NOT spent on air, food or fuel today.
// Upgrades stay with the base when a crew goes home, so every crew builds for the next one.

export type UpgradeId = 'panel' | 'monitor' | 'battery' | 'berm' | 'dome2' | 'moxie2' | 'reactor';
export const UPGRADE_IDS: readonly UpgradeId[] = ['panel', 'monitor', 'battery', 'berm', 'dome2', 'moxie2', 'reactor'];

export interface UpgradeDef {
  id: UpgradeId;
  name: string;
  /** Cost in power cells for each level (index = level being built). */
  costs: number[];
  effect: string;
  /** The catch: what it costs to own. */
  catch?: string;
  science: string;
}

export const UPGRADES: Record<UpgradeId, UpgradeDef> = {
  panel: {
    id: 'panel',
    name: 'Solar panel row',
    costs: [5, 7, 9, 11],
    effect: '+1 power cell every sol.',
    catch: 'Dust storms dim every panel, so more panels also means more power lost in a storm.',
    science: 'Mars gets about 43% as much sunlight as Earth, so a Mars base needs a lot of panels. NASA Mars Fact Sheet.',
  },
  monitor: {
    id: 'monitor',
    name: 'Radiation monitor',
    costs: [4],
    effect: 'Unlocks the monitor. Power it (1 cell) and it warns you about tomorrow\'s solar storm, even the fast ones.',
    catch: 'It only works on sols you give it a cell.',
    science: 'Solar particles can reach Mars in tens of minutes, faster than a warning from Earth. NASA/JPL, 2024.',
  },
  battery: {
    id: 'battery',
    name: 'Battery bank',
    costs: [6],
    effect: 'Unlocks the battery: store up to 2 cells today and get them back tomorrow. Great before a dust storm.',
    catch: 'A stored cell does nothing today.',
    science: 'Solar-powered rovers like Opportunity relied on batteries to survive the night and dust storms.',
  },
  berm: {
    id: 'berm',
    name: 'Regolith berm',
    costs: [6],
    effect: 'Piles Mars soil on the shelter: 1 cell now blocks 90% of a storm (instead of 50%).',
    science: 'Thick layers of soil (regolith) or water are some of the best radiation shields a Mars base could build.',
  },
  dome2: {
    id: 'dome2',
    name: 'Second greenhouse dome',
    costs: [8],
    effect: 'Each greenhouse cell grows 50% more food.',
    catch: 'One more building to heat: heaters need 1 extra cell every night.',
    science: 'Astronauts have grown lettuce, chile peppers and more on the ISS under LED lights.',
  },
  moxie2: {
    id: 'moxie2',
    name: 'Big O2 plant',
    costs: [12],
    effect: 'Your O2 plant makes 50% more oxygen per cell, for air AND rocket fuel.',
    science: 'A real Mars propellant plant would be MOXIE scaled up about 200 times, running on 25 to 30 kW. NASA PDS.',
  },
  reactor: {
    id: 'reactor',
    name: 'Fission reactor',
    costs: [18],
    effect: '+3 power cells every sol, day and night, even in dust storms.',
    science: 'NASA\'s Fission Surface Power project is designing small nuclear reactors for the Moon and Mars, because dust and long nights are hard on solar power.',
  },
};

export type Levels = Record<UpgradeId, number>;

export function emptyLevels(): Levels {
  return { panel: 0, monitor: 0, battery: 0, berm: 0, dome2: 0, moxie2: 0, reactor: 0 };
}

export function maxLevel(id: UpgradeId): number {
  return UPGRADES[id].costs.length;
}

/** Cost of the next level, or null if fully built. */
export function nextCost(id: UpgradeId, levels: Levels): number | null {
  const lvl = levels[id];
  return lvl < maxLevel(id) ? UPGRADES[id].costs[lvl] : null;
}

/** The base as it carries from crew to crew. */
export interface BaseState {
  levels: Levels;
  /** Cells already invested toward the next level of each upgrade. */
  progress: Levels;
  /** The project the Workshop is working on. */
  project: UpgradeId | null;
}

export function freshBase(): BaseState {
  return { levels: emptyLevels(), progress: emptyLevels(), project: 'panel' };
}

/** Suggested build order when a project finishes and the player hasn't picked another. */
export function defaultNextProject(levels: Levels): UpgradeId | null {
  const order: UpgradeId[] = ['panel', 'monitor', 'panel', 'battery', 'berm', 'moxie2', 'panel', 'reactor', 'dome2', 'panel'];
  for (const id of order) if (nextCost(id, levels) !== null) return id;
  return null;
}
