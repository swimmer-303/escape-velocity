// Written with AI assistance (Claude Code). See README "Use of AI tools".
import { describe, it, expect } from 'vitest';
import { buildEventPool, may2024Pool, MAY2024_SNAPSHOT, RECENT_SNAPSHOT } from '../../data/donki';
import {
  bigLabel,
  cardDate,
  classMeaning,
  factsFromEvent,
  isFarSideGiant,
  locationWords,
  parseFlareClass,
  rarityOf,
  timesStronger,
  type CardFacts,
} from './rarity';
import { burstSize, spotXY } from './art';

const flare = (classType: string): CardFacts => ({ id: `t-${classType}`, kind: 'flare', classType, time: '2026-11-07T12:43:00.000Z', severity: 'moderate', origin: 'archive' });

describe('Storm Card rarity comes from the real data', () => {
  it('reads the GOES flare class: each letter is 10 times the one before', () => {
    expect(parseFlareClass('X8.7')).toEqual({ letter: 'X', value: 8.7, flux: expect.closeTo(8.7e-4, 12) });
    expect(parseFlareClass('M1.0')!.flux).toBeCloseTo(1e-5, 12);
    expect(parseFlareClass('C5')!.value).toBe(5);
    expect(parseFlareClass('Z1.0')).toBeNull();
    expect(parseFlareClass(undefined)).toBeNull();
    expect(timesStronger(parseFlareClass('X1.0')!, 'M')).toBeCloseTo(10);
    expect(timesStronger(parseFlareClass('X1.0')!, 'C')).toBeCloseTo(100);
  });

  it('C is Common, M is Rare, X is Epic, X5 and up is Legendary', () => {
    expect(rarityOf(flare('C9.9'))).toBe('common');
    expect(rarityOf(flare('M1.0'))).toBe('rare');
    expect(rarityOf(flare('M9.9'))).toBe('rare');
    expect(rarityOf(flare('X1.0'))).toBe('epic');
    expect(rarityOf(flare('X4.9'))).toBe('epic');
    expect(rarityOf(flare('X5.0'))).toBe('legendary');
    expect(rarityOf(flare('X12.0'))).toBe('legendary');
  });

  it('particle storms are Rare, or Epic when an instrument at Mars recorded them', () => {
    const sep = (severity: CardFacts['severity']): CardFacts => ({ id: 's', kind: 'sep', time: '2024-05-10T00:00:00Z', severity, origin: 'archive' });
    expect(rarityOf(sep('moderate'))).toBe('rare');
    expect(rarityOf(sep('major'))).toBe('epic');
  });

  it('the May 2024 replay storms: X1.0 and X3.9 Epic, X5.8 and X8.7 Legendary, the far-side CME a special Legendary', () => {
    const set = may2024Pool().map(factsFromEvent);
    expect(set.length).toBe(5);
    const by = Object.fromEntries(set.map((c) => [bigLabel(c), c]));
    expect(rarityOf(by['X1.0'])).toBe('epic');
    expect(rarityOf(by['X3.9'])).toBe('epic');
    expect(rarityOf(by['X5.8'])).toBe('legendary');
    expect(rarityOf(by['X8.7'])).toBe('legendary');
    const far = by['CME'];
    expect(far.id).toBe('2024-05-20T05:36:00-CME-001');
    expect(far.speedKms).toBe(2678);
    expect(rarityOf(far)).toBe('legendary');
    expect(isFarSideGiant(far)).toBe(true);
    // Only that one is special.
    expect(set.filter(isFarSideGiant)).toHaveLength(1);
  });

  it('a slower CME is not special and is rated by its measured speed', () => {
    const cme = (speedKms: number, location: string | null = 'S20E35'): CardFacts => ({ id: 'c', kind: 'cme', time: '2024-05-20T20:12:00Z', severity: 'major', origin: 'archive', speedKms, location });
    expect(rarityOf(cme(836))).toBe('rare');
    expect(rarityOf(cme(1200))).toBe('epic');
    expect(isFarSideGiant(cme(836))).toBe(false);
    expect(isFarSideGiant(cme(2500))).toBe(false); // it has a source location seen from Earth
  });

  it('explains the class with numbers computed from it', () => {
    const x = classMeaning('X3.9').join(' ');
    expect(x).toContain('each letter is 10 times stronger than the one before');
    expect(x).toContain('X3.9 was 3.9 times as strong as an X1 flare');
    expect(x).toContain('39 times as strong as an M1 flare');
    expect(x).toContain('390 times as strong as a C1 flare');
    expect(classMeaning('M5.2').join(' ')).toContain('52 times as strong as a C1 flare');
    expect(classMeaning('X12.0').join(' ')).toContain('1,200 times as strong as a C1 flare');
    expect(classMeaning(undefined)).toEqual([]);
  });

  it('says where on the Sun from the DONKI location', () => {
    expect(locationWords('S16W15')).toBe("16 degrees south and 15 degrees west of the middle of the Sun's face, as seen from Earth (DONKI writes S16W15).");
    expect(locationWords(null)).toBeNull();
    expect(spotXY('N00W00')).toEqual({ x: 30, y: 25 });
    expect(spotXY('N10W120')).toBeNull(); // behind the limb
  });

  it('every card in the real pools shows only its own data', () => {
    const pool = [
      ...buildEventPool({ status: 'archive', snapshot: RECENT_SNAPSHOT, fetchedAt: null, via: 'snapshot' }),
      ...may2024Pool(),
    ];
    expect(pool.length).toBeGreaterThan(150);
    expect(MAY2024_SNAPSHOT).not.toBeNull();
    for (const e of pool) {
      const c = factsFromEvent(e);
      expect(c.id).toBe(e.id);
      expect(c.origin).toBe('archive');
      if (c.kind === 'flare') expect(bigLabel(c)).toBe(e.classType!.toUpperCase());
      expect(cardDate(c.time)).toMatch(/^[A-Z][a-z]{2} \d{1,2}, \d{4}$/);
      expect(c.region ?? null).toBe(e.activeRegionNum ?? null);
      expect(c.link).toBe(e.link);
    }
  });

  it('a bigger flare draws a bigger burst', () => {
    expect(burstSize('C1.0')).toBeLessThan(burstSize('M1.0'));
    expect(burstSize('M1.0')).toBeLessThan(burstSize('X1.0'));
    expect(burstSize('X1.0')).toBeLessThan(burstSize('X8.7'));
  });
});
