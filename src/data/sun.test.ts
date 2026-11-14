// Written with AI assistance (Claude Code). See README "Use of AI tools".
// The /api/sun handler (api/sun.ts) and the Sun helpers: picking SDO's newest picture and its real time.

import { describe, it, expect } from 'vitest';
import { newestBrowseFile, fetchSunImage } from '../../api/sun';
import { SDO_LATEST_URL, agoText, latestFlare } from './sun';

// Shape of a real SDO browse listing (filtered with ?P=*_512_0171.jpg), trimmed.
const LISTING = `<a href="20261114_153610_512_0171.jpg">20261114_153610_512_0171.jpg</a> 2026-11-14 15:40  56K
<a href="20261114_154746_512_0171.jpg">20261114_154746_512_0171.jpg</a> 2026-11-14 15:52  57K
<a href="20261114_152710_512_0171.jpg">20261114_152710_512_0171.jpg</a> 2026-11-14 15:31  56K`;

const jpeg = (lastModified = 'Sat, 14 Nov 2026 15:52:07 GMT') =>
  new Response(new Uint8Array(5000), { status: 200, headers: { 'content-type': 'image/jpeg', 'last-modified': lastModified } });

describe('SDO picture (server side)', () => {
  it('finds the newest picture and its time in a browse listing', () => {
    expect(newestBrowseFile(LISTING)).toEqual({ file: '20261114_154746_512_0171.jpg', takenAt: '2026-11-14T15:47:46.000Z' });
    expect(newestBrowseFile('<html>Index of /</html>')).toBeNull();
  });

  it('serves the newest archive picture with the time SDO took it', async () => {
    const asked: string[] = [];
    const img = await fetchSunImage(new Date('2026-11-14T16:00:00Z'), async (url) => {
      asked.push(url);
      return url.includes('?') ? new Response(LISTING, { status: 200, headers: { 'content-type': 'text/html' } }) : jpeg();
    });
    expect(asked[0]).toBe('https://sdo.gsfc.nasa.gov/assets/img/browse/2026/11/14/?C=M;O=D;P=*_512_0171.jpg');
    expect(img.sourceUrl).toBe('https://sdo.gsfc.nasa.gov/assets/img/browse/2026/11/14/20261114_154746_512_0171.jpg');
    expect(img.takenAt).toBe('2026-11-14T15:47:46.000Z');
    expect(img.lastModified).toBe('Sat, 14 Nov 2026 15:52:07 GMT');
    expect(img.contentType).toBe('image/jpeg');
  });

  it("looks in yesterday's folder just after midnight UTC", async () => {
    const img = await fetchSunImage(new Date('2026-11-15T00:03:00Z'), async (url) => {
      if (url.includes('/2026/11/15/')) return new Response('Not Found', { status: 404 });
      return url.includes('?') ? new Response(LISTING, { status: 200 }) : jpeg();
    });
    expect(img.sourceUrl).toContain('/2026/11/14/20261114_154746_512_0171.jpg');
  });

  it("falls back to NASA's latest file, with no made-up time, if the archive fails", async () => {
    const img = await fetchSunImage(new Date('2026-11-14T16:00:00Z'), async (url) => {
      if (url === SDO_LATEST_URL) return jpeg();
      return new Response('oops', { status: 500 });
    });
    expect(img.sourceUrl).toBe(SDO_LATEST_URL);
    expect(img.takenAt).toBeNull();
    expect(img.lastModified).toBe('Sat, 14 Nov 2026 15:52:07 GMT');
  });

  it('refuses things that are not pictures', async () => {
    await expect(fetchSunImage(new Date('2026-11-14T16:00:00Z'), async () => new Response('<html>', { status: 200, headers: { 'content-type': 'text/html' } }))).rejects.toThrow(/SDO unavailable/);
  });
});

describe('Sun helpers', () => {
  it('picks the latest classed flare by peak time', () => {
    const f = (id: string, classType: string | null, peakTime: string | null) => ({ id, classType, beginTime: null, peakTime, sourceLocation: null, activeRegionNum: null, link: null });
    const snap = { fetchedAt: '', startDate: '', endDate: '', sourceUrl: '', seps: [], cmes: [], gsts: [], flares: [f('a', 'M1.0', '2026-11-01T00:00Z'), f('b', 'C2.0', '2026-11-09T12:30Z'), f('c', null, '2026-11-10T00:00Z'), f('d', 'X1.0', null)] };
    expect(latestFlare(snap)?.id).toBe('b');
    expect(latestFlare(null)).toBeNull();
  });

  it('only says how long ago when the time makes sense', () => {
    const now = Date.parse('2026-11-14T16:00:00Z');
    expect(agoText('2026-11-14T15:47:46Z', now)).toBe('about 12 minutes ago');
    expect(agoText('2026-11-14T15:59:50Z', now)).toBe('about 1 minute ago');
    expect(agoText('2026-11-14T13:00:00Z', now)).toBe('about 3 hours ago');
    expect(agoText('2026-11-14T16:30:00Z', now)).toBeNull();
    expect(agoText('2026-11-10T16:00:00Z', now)).toBeNull();
    expect(agoText(null, now)).toBeNull();
  });
});
