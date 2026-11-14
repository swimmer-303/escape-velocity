// Written with AI assistance (Claude Code). See README "Use of AI tools".
// Small hand-made game states for the rank tests (only the fields the rank module reads).

import type { MissionConfig, MissionState, Severity, SolReport } from '../../sim/types';

export function fakeMission(over: Partial<MissionState> = {}, cfg: Partial<MissionConfig> = {}): MissionState {
  return {
    config: { seed: 'test', difficulty: 'cadet', lightTimeMin: 10, eventPool: [], expedition: 1, prefillPct: 0, ...cfg },
    sol: 1,
    crew: 4,
    air: 40,
    food: 40,
    dose: 10,
    doseBudget: 100,
    fuel: 0,
    builtThisExpedition: [],
    plan: [],
    log: [],
    status: 'playing',
    ...over,
  } as unknown as MissionState;
}

const snap = { air: 10, food: 10, dose: 10, fuel: 0 };

export function fakeReport(over: Partial<SolReport> = {}): SolReport {
  return {
    sol: 1,
    alloc: { air: 2, fuel: 2, greenhouse: 1, heaters: 1, shelter: 0, monitor: 0, build: 1, battery: 0 },
    cells: 7,
    weather: 'clear',
    coldSnap: false,
    baseDose: 1,
    airMade: 8,
    foodMade: 2,
    fuelMade: 5,
    heaterShortfall: 0,
    newDamage: false,
    blackout: false,
    cleaning: false,
    stored: 0,
    before: snap,
    after: snap,
    ...over,
  };
}

export function fakeStorm(opts: { severity?: Severity; shelterCells?: number; classType?: string; warnedBy?: 'monitor' | 'earth' | null } = {}): NonNullable<SolReport['storm']> {
  return {
    event: { id: 'test-FLR', kind: 'flare', classType: opts.classType ?? 'M2.0', severity: opts.severity ?? 'moderate', time: '2024-05-10T00:00:00Z', origin: 'archive' },
    fast: false,
    warnedBy: opts.warnedBy === undefined ? 'earth' : opts.warnedBy,
    shelterCells: opts.shelterCells ?? 1,
    doseUnsheltered: 12,
    doseTaken: 6,
  };
}
