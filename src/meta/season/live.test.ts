// Written with AI assistance (Claude Code). See README "Use of AI tools".
// Live Sun Events: only a LIVE feed with a real M/X flare or fast CME from the last 3 days turns one on. The
// stored snapshot, offline play and a quiet Sun all give the ARCHIVE Gannon event, never a "live" claim.
import { describe, it, expect } from 'vitest';
import { FAST_CME_KMS, currentSunEvent, detectLiveEvent, eventChallenges, gannonFromSnapshot, patchForEvent, safeLink } from './live';
import { RECENT_SNAPSHOT, MAY2024_SNAPSHOT } from '../../data/donki';
import { NO_FEED, archiveFeed, liveFeed, snapshotWith } from './fixtures';

const NOW = new Date('2026-11-14T20:00:00Z');

describe('live event detection', () => {
  it('turns on for a real M-class flare in a LIVE feed from the last 3 days, with its DONKI link and end time', () => {
    const feed = liveFeed(snapshotWith(NOW, { flares: [{ cls: 'C3.1', hoursAgo: 2 }, { cls: 'M3.5', hoursAgo: 30 }] }));
    const e = detectLiveEvent(feed, NOW)!;
    expect(e).not.toBeNull();
    expect(e.type).toBe('live');
    expect(e.classType).toBe('M3.5');
    expect(e.headline).toBe('M3.5 flare');
    expect(e.link).toMatch(/^https:\/\/ccmc\.gsfc\.nasa\.gov\/DONKI\/view\/FLR\//);
    expect(Date.parse(e.endsAt) - Date.parse(e.time)).toBe(3 * 86_400_000);
    expect(currentSunEvent(feed, NOW).type).toBe('live');
  });

  it('picks the biggest: X beats M, and any big flare beats a CME', () => {
    const feed = liveFeed(snapshotWith(NOW, { flares: [{ cls: 'M9.9', hoursAgo: 5 }, { cls: 'X1.1', hoursAgo: 40 }], cmes: [{ speed: 2500, hoursAgo: 3 }] }));
    expect(detectLiveEvent(feed, NOW)!.classType).toBe('X1.1');
  });

  it('turns on for a fast CME when there is no big flare', () => {
    const feed = liveFeed(snapshotWith(NOW, { flares: [{ cls: 'C9.0', hoursAgo: 4 }], cmes: [{ speed: 900, hoursAgo: 4 }, { speed: 1450, hoursAgo: 10 }] }));
    const e = detectLiveEvent(feed, NOW)!;
    expect(e.kind).toBe('cme');
    expect(e.speedKms).toBe(1450);
    expect(e.headline).toBe('1,450 km/s CME');
    expect(FAST_CME_KMS).toBe(1000);
  });

  it('stays off for small flares, slow CMEs, or eruptions older than 3 days', () => {
    expect(detectLiveEvent(liveFeed(snapshotWith(NOW, { flares: [{ cls: 'C9.9', hoursAgo: 1 }], cmes: [{ speed: 999, hoursAgo: 1 }] })), NOW)).toBeNull();
    expect(detectLiveEvent(liveFeed(snapshotWith(NOW, { flares: [{ cls: 'X2.0', hoursAgo: 73 }] })), NOW)).toBeNull();
    // A record "from the future" (a wrong clock) is not counted either.
    expect(detectLiveEvent(liveFeed(snapshotWith(NOW, { flares: [{ cls: 'X2.0', hoursAgo: -5 }] })), NOW)).toBeNull();
  });

  it('never claims live from ARCHIVE data, even with a fresh-looking big flare in it', () => {
    const snap = snapshotWith(NOW, { flares: [{ cls: 'X5.0', hoursAgo: 1 }] });
    expect(detectLiveEvent(archiveFeed(snap), NOW)).toBeNull();
    expect(detectLiveEvent(NO_FEED, NOW)).toBeNull();
    expect(detectLiveEvent(null, NOW)).toBeNull();
    const e = currentSunEvent(archiveFeed(snap), NOW);
    expect(e.type).toBe('archive');
    expect(e.headline).toBe('The May 2024 Gannon storm');
  });

  it('never claims live from the stored recent snapshot (offline play)', () => {
    if (!RECENT_SNAPSHOT) return;
    const offline = { status: 'archive' as const, snapshot: RECENT_SNAPSHOT, fetchedAt: RECENT_SNAPSHOT.fetchedAt, via: 'snapshot' as const };
    // Even right after the snapshot was taken.
    expect(detectLiveEvent(offline, new Date(RECENT_SNAPSHOT.fetchedAt))).toBeNull();
    expect(currentSunEvent(offline, new Date(RECENT_SNAPSHOT.fetchedAt)).type).toBe('archive');
  });
});

describe('the archive event', () => {
  it('names the real Gannon storm from the stored DONKI data (May 10, 2024, Kp 9)', () => {
    const g = gannonFromSnapshot();
    expect(g.type).toBe('archive');
    expect(g.time.startsWith('2024-05-10')).toBe(true);
    if (MAY2024_SNAPSHOT) {
      expect(g.kp).toBe(9);
      expect(g.link).toMatch(/^https:\/\/ccmc\.gsfc\.nasa\.gov\/DONKI\/view\/GST\//);
    }
    // Without the stored data it still works, with no link and no made-up numbers.
    const bare = gannonFromSnapshot(null);
    expect(bare.link).toBeNull();
    expect(bare.kp).toBeNull();
  });

  it('has 3 challenges, and a patch, for both kinds of event', () => {
    const live = detectLiveEvent(liveFeed(snapshotWith(NOW, { flares: [{ cls: 'M1.2', hoursAgo: 2, id: '2026-11-14T17:48:00-FLR-001' }] })), NOW)!;
    expect(eventChallenges(live)).toHaveLength(3);
    expect(eventChallenges(gannonFromSnapshot())).toHaveLength(3);
    expect(patchForEvent(live)).toMatchObject({ id: 'live:2026-11-14T17:48:00-FLR-001', mark: 'M1.2', kind: 'flare', date: 'Nov 14, 2026' });
    expect(patchForEvent(gannonFromSnapshot())).toMatchObject({ id: 'archive:gannon-2024', mark: 'G5', kind: 'gannon', date: 'May 10, 2024' });
  });
});

describe('links', () => {
  it('only ever links to NASA DONKI pages over https', () => {
    expect(safeLink('https://ccmc.gsfc.nasa.gov/DONKI/view/FLR/49391/-1')).toBe('https://ccmc.gsfc.nasa.gov/DONKI/view/FLR/49391/-1');
    expect(safeLink('http://ccmc.gsfc.nasa.gov/DONKI/view/FLR/1/-1')).toBeNull();
    expect(safeLink('https://example.com/x')).toBeNull();
    expect(safeLink('javascript:alert(1)')).toBeNull();
    expect(safeLink(null)).toBeNull();
  });
});
