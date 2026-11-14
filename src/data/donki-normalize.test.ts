// Written with AI assistance (Claude Code). See README "Use of AI tools".
// The DONKI normalizer's optional CME fields (most accurate analysis + NASA's WSA-ENLIL predictions),
// tested on trimmed copies of real DONKI records (ccmc.gsfc.nasa.gov/DONKI/WS/get/CME, fetched 2026-11-14).

import { describe, it, expect } from 'vitest';
import { normalizeDonki, cmeAnalysisFields, type RawCme } from './donki-normalize';

// 2026-11-09T18:15:00-CME-001: one most-accurate analysis with two ENLIL runs; Mars glancing blow.
const nov9: RawCme = {
  activityID: '2026-11-09T18:15:00-CME-001',
  startTime: '2026-11-09T18:15Z',
  sourceLocation: '',
  link: 'https://ccmc.gsfc.nasa.gov/DONKI/view/CME/49447/-1',
  cmeAnalyses: [
    {
      isMostAccurate: true,
      time21_5: '2026-11-09T21:40Z',
      latitude: -2,
      longitude: 65,
      halfAngle: 10,
      speed: 726,
      enlilList: [
        {
          modelCompletionTime: '2026-11-10T02:00Z',
          estimatedShockArrivalTime: null,
          isEarthGB: false,
          isEarthMinorImpact: false,
          link: 'https://ccmc.gsfc.nasa.gov/DONKI/view/WSA-ENLIL/1/-1',
          impactList: [
            { location: 'Mars', arrivalTime: '2026-11-13T12:00Z', isGlancingBlow: true, isMinorImpact: false },
            { location: 'STEREO A', arrivalTime: '2026-11-12T01:00Z', isGlancingBlow: false, isMinorImpact: true },
          ],
        },
        {
          modelCompletionTime: '2026-11-10T05:00Z',
          estimatedShockArrivalTime: null,
          isEarthGB: false,
          isEarthMinorImpact: false,
          link: 'https://ccmc.gsfc.nasa.gov/DONKI/view/WSA-ENLIL/2/-1',
          impactList: [{ location: 'Mars', arrivalTime: '2026-11-13T12:00Z', isGlancingBlow: true, isMinorImpact: false }],
        },
      ],
    },
  ],
};

describe('CME analysis fields', () => {
  it('reads the most accurate analysis and the newest ENLIL run', () => {
    const f = cmeAnalysisFields(nov9);
    expect(f).toMatchObject({ time21_5: '2026-11-09T21:40Z', longitude: 65, latitude: -2, halfAngle: 10 });
    expect(f.enlil).toEqual({
      runs: 2,
      completedAt: '2026-11-10T05:00Z',
      link: 'https://ccmc.gsfc.nasa.gov/DONKI/view/WSA-ENLIL/2/-1',
      earth: null,
      mars: { time: '2026-11-13T12:00Z', glancing: true, minor: false },
    });
  });

  it('ignores analyses not flagged most accurate, and plane-of-sky analyses keep a null direction', () => {
    const raw: RawCme = {
      activityID: 'x',
      startTime: '2026-10-15T20:24Z',
      cmeAnalyses: [
        { isMostAccurate: false, longitude: 10, latitude: 0, halfAngle: 20, speed: 500, time21_5: '2026-10-16T01:00Z', enlilList: [{ modelCompletionTime: '2026-10-16T05:00Z', impactList: [{ location: 'Mars', arrivalTime: '2026-10-20T00:00Z' }] }] },
        { isMostAccurate: true, longitude: null, latitude: 0, halfAngle: 36, speed: 428, time21_5: '2026-10-16T08:40Z', enlilList: [] },
      ],
    };
    expect(cmeAnalysisFields(raw)).toEqual({ time21_5: '2026-10-16T08:40Z', longitude: null, latitude: 0, halfAngle: 36, enlil: null });
    expect(cmeAnalysisFields({ activityID: 'y', cmeAnalyses: null })).toEqual({ time21_5: null, longitude: null, latitude: null, halfAngle: null, enlil: null });
  });

  it("reads Earth predictions, and leaves out an arrival dated before the CME (a typo in DONKI's record)", () => {
    const raw: RawCme = {
      activityID: '2026-11-01T19:00:00-CME-001',
      startTime: '2026-11-01T19:00Z',
      cmeAnalyses: [
        {
          isMostAccurate: true,
          longitude: 31,
          latitude: 7,
          halfAngle: 27,
          speed: 357,
          time21_5: '2026-11-02T03:59Z',
          enlilList: [
            {
              modelCompletionTime: '2026-11-02T10:00Z',
              estimatedShockArrivalTime: '2026-11-05T05:00Z',
              isEarthGB: true,
              isEarthMinorImpact: false,
              impactList: [{ location: 'Mars', arrivalTime: '2016-11-07T06:00Z', isGlancingBlow: true }],
            },
          ],
        },
      ],
    };
    const f = cmeAnalysisFields(raw);
    expect(f.enlil?.earth).toEqual({ time: '2026-11-05T05:00Z', glancing: true, minor: false });
    expect(f.enlil?.mars).toBeNull();
  });

  it('keeps the old CME fields exactly as before and says which types were fetched', () => {
    const snap = normalizeDonki({ FLR: [], SEP: [], CME: [nov9] }, { startDate: '2026-10-15', endDate: '2026-11-14', sourceUrl: 'test', fetchedAt: 'now' });
    expect(snap.cmes[0]).toMatchObject({ id: nov9.activityID, startTime: '2026-11-09T18:15Z', speed: 726, sourceLocation: '', link: nov9.link });
    expect(snap.included).toEqual(['FLR', 'SEP', 'CME']);
    // The proxy without CMEs: an empty list that must not be read as "no CMEs".
    const noCme = normalizeDonki({ FLR: [], SEP: [] }, { startDate: 'a', endDate: 'b', sourceUrl: 'test' });
    expect(noCme.cmes).toEqual([]);
    expect(noCme.included).toEqual(['FLR', 'SEP']);
  });
});
