// Written with AI assistance (Claude Code). See README "Use of AI tools".
// Class codes: the same code gives the whole class the same Mars.
import { describe, it, expect } from 'vitest';
import { CODE_ALPHABET, CODE_LENGTH, campaignWithCode, checkClassCode, classCodeFromSearch, isClassCode, makeClassCode, normalizeClassCode } from './classcode';
import { buildPlan } from './plan';
import { makeRng } from './rng';
import { createMission } from './sim';
import { builder, evenSplit, balanced, playCampaign, playOut } from './strategies';
import { deserialize, missionConfigFor, serialize } from './campaign';
import { TEST_POOL, testConfig } from './fixtures.test-util';
import { buildEventPool, RECENT_SNAPSHOT } from '../data/donki';
import { EXPEDITIONS, type Difficulty } from './constants';
import type { SolPlan, SpaceWeatherEvent } from './types';

const DIFFICULTIES: Difficulty[] = ['cadet', 'commander'];

/** The real stored DONKI window plus May 2024, like a device that can't reach NASA right now. */
const ARCHIVE_POOL: SpaceWeatherEvent[] = buildEventPool({ status: 'archive', snapshot: RECENT_SNAPSHOT, fetchedAt: null, via: 'snapshot' });

/** What a class would compare: dust, cold, storms (which real event, which sol), cargo day, blackout. */
function summary(plan: SolPlan[]) {
  return {
    dust: plan.filter((p) => p.weather !== 'clear').map((p) => `${p.sol}:${p.weather}`),
    cold: plan.filter((p) => p.coldSnap).map((p) => p.sol),
    storms: plan.filter((p) => p.storm).map((p) => `${p.sol}:${p.storm!.event.id}`),
    resupply: plan.filter((p) => p.resupply).map((p) => p.sol),
    blackout: plan.filter((p) => p.blackout).map((p) => p.sol),
  };
}

describe('class code format', () => {
  it('uses an alphabet with no look-alikes and no vowels', () => {
    for (const ch of '0O1IL' + 'AEU') expect(CODE_ALPHABET).not.toContain(ch);
    expect(new Set(CODE_ALPHABET).size).toBe(CODE_ALPHABET.length);
  });

  it('normalizes case, spaces and dashes', () => {
    expect(normalizeClassCode(' k7r-zq ')).toBe('K7RZQ');
    expect(normalizeClassCode('K 7 R Z Q')).toBe('K7RZQ');
    expect(normalizeClassCode('k7r_zq.')).toBe('K7RZQ');
    expect(normalizeClassCode('K7R–ZQ')).toBe('K7RZQ');
    for (const raw of ['K7RZQ', 'k7rzq', ' K7R ZQ ', 'k7-r-z-q']) expect(checkClassCode(raw)).toEqual({ ok: true, code: 'K7RZQ' });
  });

  it('rejects codes that are empty, the wrong length, or use letters codes never have', () => {
    expect(checkClassCode('  ')).toEqual({ ok: false, problem: 'empty' });
    expect(checkClassCode('K7RZ')).toEqual({ ok: false, problem: 'length' });
    expect(checkClassCode('K7RZQQ')).toEqual({ ok: false, problem: 'length' });
    expect(checkClassCode('K0RZQ')).toEqual({ ok: false, problem: 'letters' });
    expect(checkClassCode('HELLO')).toEqual({ ok: false, problem: 'letters' });
    expect(isClassCode('k7rzq')).toBe(false); // must be normalized first
  });

  it('reads ?code= from the page address', () => {
    expect(classCodeFromSearch('?code=k7r-zq')).toBe('K7RZQ');
    expect(classCodeFromSearch('?seed=abc&code=K7RZQ')).toBe('K7RZQ');
    expect(classCodeFromSearch('?code=nope')).toBeNull();
    expect(classCodeFromSearch('?seed=abc')).toBeNull();
    expect(classCodeFromSearch('')).toBeNull();
  });

  it('makes valid, varied codes', () => {
    const codes = Array.from({ length: 300 }, () => makeClassCode());
    for (const c of codes) {
      expect(c).toHaveLength(CODE_LENGTH);
      expect(isClassCode(c)).toBe(true);
    }
    expect(new Set(codes).size).toBeGreaterThan(290);
    // Edge of the random range still gives a valid code.
    expect(isClassCode(makeClassCode(() => 0.9999999999))).toBe(true);
    expect(makeClassCode(() => 0)).toBe(CODE_ALPHABET[0].repeat(CODE_LENGTH));
  });
});

describe('class code campaigns', () => {
  it('uses the code as the seed and saves it with the campaign', () => {
    const c = campaignWithCode('K7RZQ', 'random-seed', 'commander');
    expect(c.seed).toBe('K7RZQ');
    expect(c.classCode).toBe('K7RZQ');
    expect(c.difficulty).toBe('commander');
    expect(deserialize(serialize(c))?.classCode).toBe('K7RZQ');
    const plain = campaignWithCode(null, 'random-seed', 'cadet');
    expect(plain.seed).toBe('random-seed');
    expect(plain.classCode).toBeUndefined();
  });

  it('same code: identical mission plans (dust, cold, storms, resupply) on every device', () => {
    for (const pool of [TEST_POOL, ARCHIVE_POOL]) {
      for (const code of ['K7RZQ', makeClassCode(), makeClassCode()]) {
        for (const d of DIFFICULTIES) {
          for (let exp = 1; exp <= EXPEDITIONS.length; exp++) {
            // Two "devices": separate campaigns, separate copies of the pool (one in a different order).
            const a = missionConfigFor(campaignWithCode(code, 'x', d), 11.0, pool.map((e) => ({ ...e })));
            const b = missionConfigFor(campaignWithCode(code, 'y', d), 11.2, [...pool].reverse().map((e) => ({ ...e })));
            const planA = buildPlan({ ...a, expedition: exp });
            const planB = buildPlan({ ...b, expedition: exp });
            expect(planB).toEqual(planA);
            expect(summary(planA).storms.length).toBeGreaterThan(0);
            expect(summary(planA).resupply.length).toBe(1);
          }
        }
      }
    }
  });

  it('same code + same choices: identical outcomes', () => {
    for (const pool of [TEST_POOL, ARCHIVE_POOL]) {
      for (const d of DIFFICULTIES) {
        for (const strategy of [builder, balanced, evenSplit]) {
          const a = playCampaign('K7RZQ', d, pool, strategy);
          const b = playCampaign('K7RZQ', d, [...pool].reverse(), strategy);
          expect(b.results).toEqual(a.results);
          expect(b.base).toEqual(a.base);
          const m1 = playOut(createMission(testConfig('B4XN9', d)), strategy);
          const m2 = playOut(createMission(testConfig('B4XN9', d)), strategy);
          expect(m2.log).toEqual(m1.log);
          expect([m2.status, m2.fuel, m2.dose, m2.air, m2.food]).toEqual([m1.status, m1.fuel, m1.dose, m1.air, m1.food]);
        }
      }
    }
  });

  it('different codes: different plans', () => {
    const codes = ['K7RZQ', 'K7RZR', 'B4XN9', ...Array.from({ length: 27 }, (_, i) => makeClassCode(makeRng(`test-codes-${i}`)))];
    expect(new Set(codes).size).toBe(codes.length);
    for (const d of DIFFICULTIES) {
      const seen = new Set(codes.map((code) => JSON.stringify(buildPlan(testConfig(code, d)).map((p) => [p.weather, p.coldSnap, p.outlookActive, p.storm?.event.id ?? '', p.blackout]))));
      expect(seen.size).toBe(codes.length);
      // Even codes one letter apart give a different Mars that players would notice.
      const near = [summary(buildPlan(testConfig('K7RZQ', d))), summary(buildPlan(testConfig('K7RZR', d)))];
      expect(near[0]).not.toEqual(near[1]);
    }
  });
});

