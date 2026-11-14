// Written with AI assistance (Claude Code). See README "Use of AI tools".
// Base upgrades. Each one is built by investing power cells in the Workshop over several sols:
// power spent building today is power NOT spent on air, food or fuel today.
// Upgrades stay with the base when a crew goes home, so every crew builds for the next one.

import type { Site } from './constants';

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

/**
 * Moon wording. Costs and effects are the same game values; only what is different on the Moon changes.
 * Sources: NASA Moon Fact Sheet (sunlight 1361 W/m², 29.53-day synodic month),
 * https://nssdc.gsfc.nasa.gov/planetary/factsheet/moonfact.html ; NASA Carbothermal Reduction Demonstration (Apr 25, 2023),
 * https://www.nasa.gov/centers-and-facilities/johnson/nasa-successfully-extracts-oxygen-from-lunar-soil-simulant/
 */
const MOON_TEXT: Partial<Record<UpgradeId, Partial<Pick<UpgradeDef, 'effect' | 'catch' | 'science'>>>> = {
  panel: {
    effect: '+1 power cell every day while the Sun is up.',
    catch: 'Solar panels make nothing during the lunar night.',
    science: 'The Moon gets as much sunlight as Earth (1361 watts per square meter), but none at all during its night, which lasts about two weeks. NASA Moon Fact Sheet.',
  },
  battery: {
    effect: 'Unlocks the battery: put in up to 2 cells a day and it saves them for the lunar night, then gives back up to 2 cells each night.',
    catch: 'A stored cell does nothing today.',
    science: 'Every lunar night lasts about two weeks, so a solar-powered Moon base needs to store energy or make it another way.',
  },
  berm: {
    effect: 'Piles Moon soil on the shelter: 1 cell now blocks 90% of a storm (instead of 50%).',
    science: 'Thick layers of soil (regolith) or water are some of the best radiation shields a Moon base could build.',
  },
  moxie2: {
    effect: 'Your O2 plant makes 50% more oxygen per cell, for air AND rocket fuel.',
    science: 'In 2023, NASA heated simulated Moon soil in a vacuum chamber and pulled oxygen out of it. Bigger machines could make oxygen to breathe and to burn as rocket propellant.',
  },
  reactor: {
    effect: '+3 power cells every day, all through the lunar night.',
  },
};

/** The upgrade as described at this site. */
export function upgradeDef(id: UpgradeId, site?: Site): UpgradeDef {
  const def = UPGRADES[id];
  return site === 'moon' ? { ...def, ...MOON_TEXT[id] } : def;
}

/**
 * Upgrades that can be built at this site. On the Moon, Earth's storm warnings take only 1.3 seconds, so they are
 * never late and the base does not need its own radiation monitor.
 */
export function upgradesFor(site?: Site): readonly UpgradeId[] {
  return site === 'moon' ? UPGRADE_IDS.filter((id) => id !== 'monitor') : UPGRADE_IDS;
}

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
/**
 * Every cell still needed to finish everything buildable at this site (the current project first).
 * The Workshop takes as many cells as you like, up to this: extra cells roll into the next project.
 */
export function remainingBuildCost(base: BaseState, site?: Site): number {
  let total = 0;
  for (const id of upgradesFor(site)) {
    const def = UPGRADES[id];
    for (let l = base.levels[id]; l < def.costs.length; l++) total += def.costs[l];
    if (base.levels[id] < def.costs.length) total -= base.progress[id];
  }
  return Math.max(0, total);
}

export function defaultNextProject(levels: Levels, site?: Site): UpgradeId | null {
  const order: UpgradeId[] =
    site === 'moon'
      ? ['panel', 'battery', 'panel', 'berm', 'moxie2', 'panel', 'reactor', 'dome2', 'panel']
      : ['panel', 'monitor', 'panel', 'battery', 'berm', 'moxie2', 'panel', 'reactor', 'dome2', 'panel'];
  for (const id of order) if (nextCost(id, levels) !== null) return id;
  return null;
}
