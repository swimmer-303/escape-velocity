// Written with AI assistance (Claude Code). See README "Use of AI tools".
import { describe, it, expect } from 'vitest';
import { arcadiaLatitude, dailyTargets, iceKeepChance, spotAt, swimIceAt, targetCount, todayKey } from './targets';
import { MOUNT_SHARP_BEARING, SAMPLE_KINDS, sampleKind, kindsAt } from './samples';
import { DRIVE_RADIUS, SITES } from './sites';
import { siteHeight } from './world';

const days = (n: number, from = '2026-11-01') => {
  const out: string[] = [];
  const t0 = Date.parse(`${from}T12:00:00Z`);
  for (let i = 0; i < n; i++) out.push(new Date(t0 + i * 86_400_000).toISOString().slice(0, 10));
  return out;
};

describe('daily targets', () => {
  it('are the same for the same date and site (everyone gets the same set)', () => {
    for (const site of SITES) expect(dailyTargets(site, '2026-11-14')).toEqual(dailyTargets(site, '2026-11-14'));
  });

  it('change from day to day and from site to site', () => {
    const a = JSON.stringify(dailyTargets('gale', '2026-11-14').map((t) => [t.kind, t.x, t.z]));
    const b = JSON.stringify(dailyTargets('gale', '2026-11-15').map((t) => [t.kind, t.x, t.z]));
    const c = JSON.stringify(dailyTargets('arcadia', '2026-11-14').map((t) => [t.kind, t.x, t.z]));
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
  });

  it('number 5 to 8 a day, match targetCount, and have unique ids', () => {
    const counts = new Set<number>();
    for (const date of days(60)) {
      for (const site of SITES) {
        const list = dailyTargets(site, date);
        expect(list.length).toBe(targetCount(site, date));
        expect(list.length).toBeGreaterThanOrEqual(5);
        expect(list.length).toBeLessThanOrEqual(8);
        counts.add(list.length);
        expect(new Set(list.map((t) => t.id)).size).toBe(list.length);
        list.forEach((t, i) => expect(t.id).toBe(`${date}:${site}:${i}`));
      }
    }
    expect(counts.size).toBeGreaterThan(2);
  });

  it('only use samples from their own site, inside the map, with at most one legendary a day', () => {
    for (const date of days(40)) {
      for (const site of SITES) {
        const list = dailyTargets(site, date);
        for (const t of list) {
          expect(sampleKind(t.kind)?.site).toBe(site);
          const r = Math.hypot(t.x, t.z);
          expect(r).toBeGreaterThan(80);
          expect(r).toBeLessThan(DRIVE_RADIUS);
        }
        expect(list.filter((t) => sampleKind(t.kind)?.rarity === 'legendary').length).toBeLessThanOrEqual(1);
      }
    }
  });

  it('sometimes hold rare and legendary finds', () => {
    const all = days(120).flatMap((d) => SITES.flatMap((s) => dailyTargets(s, d)));
    const rarities = new Set(all.map((t) => sampleKind(t.kind)!.rarity));
    expect([...rarities].sort()).toEqual(['common', 'legendary', 'rare', 'uncommon']);
    // Every kind turns up at least once in four months.
    expect(new Set(all.map((t) => t.kind)).size).toBe(SAMPLE_KINDS.length);
  });

  it('todayKey gives a YYYY-MM-DD date', () => {
    expect(todayKey(new Date('2026-11-15T03:00:00Z'))).toBe('2026-11-14'); // still the 14th in Eastern time
    expect(todayKey()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('placement follows the real data', () => {
  it('Mount Sharp samples sit toward higher real ground at Gale Crater', () => {
    const h = siteHeight('gale');
    const toward = [150, 250, 350].map((d) => spotAt(MOUNT_SHARP_BEARING, d));
    const away = [150, 250, 350].map((d) => spotAt(MOUNT_SHARP_BEARING + Math.PI, d));
    const avg = (pts: Array<{ x: number; z: number }>) => pts.reduce((s, p) => s + h(p.x, p.z), 0) / pts.length;
    expect(avg(toward)).toBeGreaterThan(avg(away) + 10);
    // ...and the layered-rock targets really are on that side.
    const layered = days(90).flatMap((d) => dailyTargets('gale', d)).filter((t) => t.kind === 'gale-layers');
    expect(layered.length).toBeGreaterThan(3);
    const meanH = layered.reduce((s, t) => s + h(t.x, t.z), 0) / layered.length;
    expect(meanH).toBeGreaterThan(20);
  });

  it('SWIM ice consistency rises toward the north at Arcadia, and ice targets lean north', () => {
    expect(arcadiaLatitude(0)).toBeCloseTo(46.66, 2);
    expect(arcadiaLatitude(600)).toBeGreaterThan(arcadiaLatitude(0));
    expect(swimIceAt(48)).toBeGreaterThan(swimIceAt(46));
    expect(swimIceAt(46)).toBeGreaterThan(swimIceAt(44));
    expect(swimIceAt(44)).toBeCloseTo(0.313, 3); // the profile's own value at 44 N (swim-ice.json)
    expect(iceKeepChance(600)).toBeGreaterThan(iceKeepChance(-600));
    const ice = new Set(kindsAt('arcadia').filter((k) => k.place.kind === 'ice').map((k) => k.id));
    const all = days(150).flatMap((d) => dailyTargets('arcadia', d));
    const iceZ = all.filter((t) => ice.has(t.kind)).map((t) => t.z);
    const rockZ = all.filter((t) => !ice.has(t.kind)).map((t) => t.z);
    const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;
    expect(iceZ.length).toBeGreaterThan(20);
    expect(mean(iceZ)).toBeGreaterThan(mean(rockZ) + 40);
  });
});

describe('sample facts', () => {
  it('every kind has a short fact, a site and its own id', () => {
    expect(new Set(SAMPLE_KINDS.map((k) => k.id)).size).toBe(SAMPLE_KINDS.length);
    for (const k of SAMPLE_KINDS) {
      expect(k.fact.length).toBeGreaterThan(30);
      expect(k.fact.length).toBeLessThan(170);
      expect(k.dist[0]).toBeLessThan(k.dist[1]);
      // No emoji anywhere (they look different on every device).
      expect(/\p{Extended_Pictographic}/u.test(k.name + k.fact)).toBe(false);
    }
    for (const site of SITES) expect(kindsAt(site).length).toBeGreaterThanOrEqual(6);
  });
});
