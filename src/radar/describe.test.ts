// Written with AI assistance (Claude Code). See README "Use of AI tools".
// The radar's plain-language text: estimates are always labeled, NASA's model is credited, calm months say so.

import { describe, it, expect } from 'vitest';
import type { DonkiCme, DonkiSnapshot } from '../data/donki-normalize';
import { buildRadar, countRadar, toRadarCme } from './model';
import { cmeSentence, directionText, durationText, enlilText, modelShort, modelText, summaryLines } from './describe';

const cme = (over: Partial<DonkiCme> = {}): DonkiCme => ({
  id: 'test-CME',
  startTime: '2026-11-09T18:15Z',
  speed: 1048,
  sourceLocation: null,
  link: null,
  time21_5: '2026-11-09T21:40Z',
  longitude: 57,
  latitude: 0,
  halfAngle: 15,
  enlil: { runs: 2, completedAt: '2026-11-10T01:00Z', link: null, earth: null, mars: { time: '2026-11-13T12:00Z', glancing: true, minor: false } },
  ...over,
});
const snap = (cmes: DonkiCme[]): DonkiSnapshot => ({
  fetchedAt: '2026-11-14T18:00:00.000Z',
  startDate: '2026-10-15',
  endDate: '2026-11-14',
  sourceUrl: 'test',
  flares: [],
  seps: [],
  cmes,
  gsts: [],
  included: ['CME'],
});
const END = Date.parse('2026-11-14T18:00:00Z');

describe('radar text', () => {
  it('describes directions the way DONKI measures them', () => {
    expect(directionText(40)).toBe('40° west of Earth');
    expect(directionText(-99)).toBe('99° east of Earth');
    expect(directionText(4)).toBe('almost straight at Earth');
    expect(directionText(172)).toBe('172° west of Earth, on the far side of the Sun');
  });

  it('rounds travel times kindly', () => {
    expect(durationText(20 * 3_600_000)).toBe('about 20 hours');
    expect(durationText(3.1 * 86_400_000)).toBe('about 3 days');
    expect(durationText(2.6 * 86_400_000)).toBe('about 2.5 days');
  });

  it('one line per CME: our estimate, then what NASA\'s ENLIL model predicted', () => {
    const c = toRadarCme(cme())!;
    const line = cmeSentence(c, END);
    expect(line).toMatch(/^CME on Nov 9, 1,048 km\/s, headed 57° west of Earth: it reached Mars' distance about \d(\.5)? days? later \(estimate\)\./);
    expect(line).toContain("NASA's ENLIL model predicted a glancing blow at Mars on Nov 13, 12:00 UTC.");
    expect(enlilText(c, 'earth')).toBe("NASA's ENLIL model predicted no hit at Earth");
    expect(modelText(c, 'earth', END)).toMatch(/^missed Earth, which was \d+° outside its cone \(estimate\)$/);
    expect(modelShort(c, 'earth', END)).toMatch(/^missed by \d+° \(estimate\)$/);
  });

  it('says nothing about ENLIL when DONKI lists no run, and labels misses and future arrivals as estimates', () => {
    const away = toRadarCme(cme({ longitude: -60, enlil: null }))!;
    expect(enlilText(away, 'mars')).toBeNull();
    expect(cmeSentence(away, END)).not.toMatch(/ENLIL/);
    expect(modelText(away, 'mars', END)).toContain('(estimate)');
    const above = toRadarCme(cme({ latitude: 60, halfAngle: 20 }))!;
    expect(modelText(above, 'mars', END)).toBe('passed above (north of) the planets and missed Mars (estimate)');
    const late = toRadarCme(cme({ startTime: '2026-11-14T10:00Z', time21_5: '2026-11-14T12:00Z', speed: 400 }))!;
    expect(modelText(late, 'mars', END)).toMatch(/^is on its way and should reach Mars' distance around Nov \d+ \(estimate\)$/);
  });

  it('summarizes honestly, including a calm month', () => {
    const calmData = buildRadar(snap([cme({ longitude: -60, enlil: null }), cme({ id: 'b', longitude: null })]));
    const calm = summaryLines(calmData, countRadar(calmData), 'live').join(' ');
    expect(calm).toContain("From Oct 15 to Nov 14, 2026, NASA's DONKI database lists 2 CMEs");
    expect(calm).toContain('1 has a measured direction and is on the radar. The other 1 was measured from only one viewpoint');
    expect(calm).toContain('The Sun was calm toward Mars this month: 2 CMEs, none headed for Mars.');

    const busyData = buildRadar(snap([cme()]));
    const busy = summaryLines(busyData, countRadar(busyData), 'archive').join(' ');
    expect(busy).toContain("Mars: our simple model says 1 CME reached Mars' distance");
    expect(busy).toContain("NASA's ENLIL model predicted 1 CME would reach Mars.");
    expect(busy).toContain('Fastest: 1,048 km/s on Nov 9');
    expect(busy).not.toMatch(/calm/);
  });
});
