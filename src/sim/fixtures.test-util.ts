// Written with AI assistance (Claude Code). See README "Use of AI tools".
// TEST FIXTURES ONLY. These shapes mimic DONKI records so tests do not depend on the network.
// They are never shown in the game; the game only uses real DONKI records.
import type { MissionConfig, SpaceWeatherEvent } from './types';
import type { Difficulty } from './constants';

const ev = (i: number, severity: SpaceWeatherEvent['severity'], cls: string): SpaceWeatherEvent => ({
  id: `TEST-FLR-${i}`,
  kind: 'flare',
  classType: cls,
  severity,
  time: new Date(Date.UTC(2026, 9, 15 + i)).toISOString(),
  origin: 'archive',
});

export const TEST_POOL: SpaceWeatherEvent[] = [
  ev(1, 'major', 'X1.1'),
  ev(2, 'major', 'X2.0'),
  ev(3, 'major', 'X3.3'),
  ev(4, 'moderate', 'M1.2'),
  ev(5, 'moderate', 'M2.5'),
  ev(6, 'moderate', 'M5.0'),
  ev(7, 'moderate', 'M1.0'),
  ev(8, 'minor', 'C3.0'),
  ev(9, 'minor', 'C5.1'),
];

export function testConfig(seed: string, difficulty: Difficulty = 'cadet'): MissionConfig {
  return { seed, difficulty, lightTimeMin: 12, eventPool: TEST_POOL };
}
