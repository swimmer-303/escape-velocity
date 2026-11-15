// @vitest-environment happy-dom
// Written with AI assistance (Claude Code). See README "Use of AI tools".
import { describe, it, expect, beforeEach } from 'vitest';
import { LAB_XP, LAB_XP_PER_DAY, NOTEBOOK_MAX, STORAGE_KEY, addEntry, claimXp, emptySave, loadSave, newSeed, sanitizeSave, storeSave, type NotebookEntry } from './store';
import { defaultLab, sanitizeLab } from '../../sim/lab';
import { changesList, labMissionConfig, labPool, oneAtATimeNote, scienceLine, summaryLine, fairTest } from './experiment';

const entry = (i: number): NotebookEntry => ({
  at: new Date(Date.UTC(2026, 10, 15, 12, i)).toISOString(),
  settings: defaultLab(),
  hypothesis: 'later',
  won: i % 2 === 0,
  sols: 10 + i,
  dose: 3.5,
  doseBudget: 27,
  fuel: 100,
});

describe('Lab Notebook store', () => {
  beforeEach(() => localStorage.clear());

  it('survives bad data', () => {
    expect(sanitizeSave(null)).toEqual(emptySave());
    expect(sanitizeSave(42)).toEqual(emptySave());
    localStorage.setItem(STORAGE_KEY, '{not json');
    expect(loadSave()).toEqual(emptySave());
    const s = sanitizeSave({
      settings: { dust: 'global', crew: 50 },
      sameStorms: 'yes',
      hypothesis: 'maybe',
      notebook: [entry(1), null, 'x', { at: 'never', won: true }, { ...entry(2), sols: -5, fuel: 900, held: 'sure', loseReason: '<b>' }],
      xpDay: 'today',
      xpCount: -3,
    });
    expect(s.settings).toEqual(sanitizeLab({ dust: 'global', crew: 6 }));
    expect(s.sameStorms).toBe(true);
    expect(s.hypothesis).toBeNull();
    expect(s.notebook.length).toBe(2);
    expect(s.notebook[1]).toMatchObject({ sols: 0, fuel: 100 });
    expect(s.notebook[1].held).toBeUndefined();
    expect(s.notebook[1].loseReason).toBeUndefined();
    expect(s.xpDay).toBe('');
    expect(s.xpCount).toBe(0);
  });

  it('keeps the last 12 experiments', () => {
    let s = emptySave();
    for (let i = 0; i < 20; i++) s = addEntry(s, entry(i));
    expect(s.notebook.length).toBe(NOTEBOOK_MAX);
    expect(s.notebook[NOTEBOOK_MAX - 1].sols).toBe(29);
    storeSave(s);
    expect(loadSave().notebook.length).toBe(NOTEBOOK_MAX);
  });

  it('gives XP for at most 3 experiments a day, and starts again the next day', () => {
    let s = emptySave();
    const got: number[] = [];
    for (let i = 0; i < 5; i++) {
      const c = claimXp(s, '2026-11-15');
      got.push(c.xp);
      s = c.save;
    }
    expect(got).toEqual([LAB_XP, LAB_XP, LAB_XP, 0, 0]);
    expect(LAB_XP_PER_DAY).toBe(3);
    expect(claimXp(s, '2026-11-16').xp).toBe(LAB_XP);
  });

  it('makes safe seeds', () => {
    const seed = newSeed(() => 0.5);
    expect(seed).toMatch(/^lab-[a-z0-9]{5}$/);
    expect(sanitizeLab({ seed }).seed).toBe(seed);
  });
});

describe('Space Lab words and the fair test', () => {
  it('lists only what changed, and nudges toward one change at a time', () => {
    expect(changesList(defaultLab())).toEqual([]);
    expect(summaryLine(defaultLab())).toBe('Real conditions at Gale Crater.');
    const two = { ...defaultLab(), dust: 'storm' as const, crew: 6 };
    expect(changesList(two)).toEqual(['Dust in the air: Dust storm (tau 3) (real: Hazy (normal) (tau 0.6))', 'Crew size: 6 astronauts (real: 4 astronauts)']);
    expect(oneAtATimeNote(two)).toMatch(/changed 2 things/);
    expect(oneAtATimeNote({ ...defaultLab(), crew: 6 })).toBeNull();
    expect(scienceLine({ ...defaultLab(), dust: 'global' })).toMatch(/tau 10.8/);
    expect(scienceLine({ ...defaultLab(), orbit: 'perihelion' })).toMatch(/45% more sunlight/);
  });

  it('deals lab missions from stored (ARCHIVE) DONKI records only', () => {
    const pool = labPool();
    expect(pool.length).toBeGreaterThan(0);
    expect(pool.every((e) => e.origin === 'archive')).toBe(true);
  });

  it('the autopilot shows a planet-wide dust storm is worse than real conditions', () => {
    const f = fairTest(labMissionConfig({ ...defaultLab('lab-test1'), dust: 'global' }, 12));
    expect(f.real.won).toBe(true);
    expect(f.lab.won).toBe(false);
    expect(f.outcome).toBe('not');
    const same = fairTest(labMissionConfig(defaultLab('lab-test1'), 12));
    expect(same.outcome).toBe('same');
  });
});
