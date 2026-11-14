// @vitest-environment happy-dom
// Written with AI assistance (Claude Code). See README "Use of AI tools".
// "The Sun right now" panel: latest real flare text, honest LIVE/ARCHIVE tags and times, and a picture that hides itself when it can't load.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { sunPanel } from './sunpanel';
import { SDO_LATEST_URL, loadSunPicture, resetSunPicture } from '../data/sun';
import type { SpaceWeatherFeed } from '../data/donki';
import type { DonkiFlare, DonkiSnapshot } from '../data/donki-normalize';

const flare = (id: string, classType: string | null, peakTime: string | null, region: number | null): DonkiFlare => ({
  id,
  classType,
  beginTime: peakTime,
  peakTime,
  sourceLocation: null,
  activeRegionNum: region,
  link: `https://ccmc.gsfc.nasa.gov/DONKI/view/FLR/${id}/-1`,
});

const snap: DonkiSnapshot = {
  fetchedAt: '2026-11-14T14:05:47.472Z',
  startDate: '2026-10-15',
  endDate: '2026-11-14',
  sourceUrl: 'https://ccmc.gsfc.nasa.gov/DONKI/WS/get',
  // Out of order on purpose: the panel must pick the latest by peak time.
  flares: [
    flare('a', 'M1.7', '2026-11-11T21:21Z', 14566),
    flare('b', 'X1.2', '2026-10-20T03:00Z', 14500),
    flare('c', 'M3.5', '2026-11-05T10:00Z', 14560),
    flare('d', null, '2026-11-13T00:00Z', null),
  ],
  seps: [],
  cmes: [],
  gsts: [],
};

const live: SpaceWeatherFeed = { status: 'live', snapshot: snap, fetchedAt: snap.fetchedAt, via: 'proxy' };
const archive: SpaceWeatherFeed = { status: 'archive', snapshot: snap, fetchedAt: snap.fetchedAt, via: 'snapshot' };
const NOW = Date.parse('2026-11-14T16:00:00Z');
const text = (el: Element) => (el.textContent ?? '').replace(/\s+/g, ' ');

beforeEach(() => {
  document.body.innerHTML = '';
  resetSunPicture();
});

describe('Sun panel', () => {
  it('shows the latest real flare by peak time, tagged LIVE', () => {
    const el = sunPanel(live, { now: NOW, picture: { src: 'blob:sun', via: 'proxy', takenAt: '2026-11-14T15:47:46.000Z' } });
    const line = el.querySelector('.sun-flare')!;
    expect(text(line)).toContain('Latest real flare: M1.7 on Nov 11, from sunspot region 14566.');
    expect(line.querySelector('.tag')!.textContent).toBe('LIVE');
    expect(line.querySelector('a')!.getAttribute('href')).toContain('/FLR/a/');
    expect(text(el)).toContain('Picture taken about 12 minutes ago.');
    expect(text(el)).toContain('Image: NASA/SDO');
    expect(text(el)).not.toMatch(/AI-generated/);
  });

  it('never calls stored data live', () => {
    const el = sunPanel(archive, { now: NOW, compact: true, picture: { src: SDO_LATEST_URL, via: 'direct', takenAt: null } });
    const line = el.querySelector('.sun-flare')!;
    expect(line.querySelector('.tag')!.textContent).toBe('ARCHIVE');
    expect(text(line)).toContain('Latest flare in our stored NASA data: M1.7 on Nov 11');
    expect(text(el)).not.toMatch(/LIVE/);
    // NASA's own file gives us no readable time, so the panel makes no "taken" claim.
    expect(text(el)).toContain('NASA adds a new picture about every 10 minutes.');
    expect(text(el)).not.toMatch(/taken/i);
  });

  it('falls back to NASA directly, then hides the picture if that fails too', () => {
    const el = sunPanel(live, { now: NOW, picture: { src: 'blob:sun', via: 'proxy', takenAt: '2026-11-14T15:47:46.000Z' } });
    document.body.append(el);
    const img = el.querySelector('img')!;
    expect(img.getAttribute('src')).toBe('blob:sun');
    img.dispatchEvent(new Event('error'));
    expect(img.getAttribute('src')).toBe(SDO_LATEST_URL);
    expect(text(el)).toContain('NASA adds a new picture about every 10 minutes.');
    expect(el.querySelector<HTMLElement>('.sun-img')!.hidden).toBe(false);
    img.dispatchEvent(new Event('error'));
    expect(el.querySelector<HTMLElement>('.sun-img')!.hidden).toBe(true);
    expect(el.querySelector<HTMLElement>('.sun-about')!.hidden).toBe(true);
    // The flare news still shows.
    expect(el.hidden).toBe(false);
    expect(text(el.querySelector('.sun-flare')!)).toContain('M1.7');
  });

  it('hides the whole panel when there is no picture and no flare data', () => {
    const offline: SpaceWeatherFeed = { status: 'none', snapshot: null, fetchedAt: null, via: null, error: 'offline' };
    const el = sunPanel(offline, { now: NOW, picture: { src: SDO_LATEST_URL, via: 'direct', takenAt: null } });
    el.querySelector('img')!.dispatchEvent(new Event('error'));
    expect(el.hidden).toBe(true);
  });

  it('says "a recent picture" instead of "right now" when the picture is hours old', () => {
    const el = sunPanel(live, { now: NOW, picture: { src: 'blob:sun', via: 'proxy', takenAt: '2026-11-14T10:00:00.000Z' } });
    expect(text(el)).toContain('A recent picture of the Sun');
    expect(text(el)).toContain('Picture taken about 6 hours ago.');
  });

  it('uses NASA directly when /api/sun is missing (the Vite dev server answers with index.html)', async () => {
    vi.stubGlobal('fetch', async () => new Response('<!doctype html>', { status: 200, headers: { 'content-type': 'text/html' } }));
    expect(await loadSunPicture()).toEqual({ src: SDO_LATEST_URL, via: 'direct', takenAt: null });
    vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')));
    expect(await loadSunPicture()).toEqual({ src: SDO_LATEST_URL, via: 'direct', takenAt: null });
    vi.unstubAllGlobals();
  });

  it('reads the picture time from our server only when this device clock agrees with the server', async () => {
    const serve = (date: string) => async () =>
      new Response(new Uint8Array(2000), {
        status: 200,
        headers: { 'content-type': 'image/jpeg', 'x-sun-taken-at': '2026-11-14T15:47:46.000Z', date },
      });
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    vi.stubGlobal('fetch', serve(new Date(NOW - 30_000).toUTCString()));
    const ok = await loadSunPicture();
    expect(ok.via).toBe('proxy');
    expect(ok.takenAt).toBe('2026-11-14T15:47:46.000Z');
    vi.stubGlobal('fetch', serve(new Date(NOW - 3 * 3_600_000).toUTCString()));
    expect((await loadSunPicture()).takenAt).toBeNull();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
});
