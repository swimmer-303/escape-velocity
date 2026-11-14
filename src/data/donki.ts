// Written with AI assistance (Claude Code). See README "Use of AI tools".
// NASA DONKI (Space Weather Database Of Notifications, Knowledge, Information).
// Real solar flares and particle storms become the radiation events in each mission.
// Order of preference: our cached proxy (/api/spaceweather) -> DONKI directly -> the stored snapshot.
// Live data is only ever labeled LIVE when it was actually fetched just now.

import type { SpaceWeatherEvent, Severity } from '../sim/types';

import { normalizeDonki, type DonkiSnapshot, type DonkiGst, type DonkiSep } from './donki-normalize';
export * from './donki-normalize';

export function flareSeverity(classType: string | null | undefined): Severity | null {
  if (!classType) return null;
  const letter = classType.trim().charAt(0).toUpperCase();
  if (letter === 'X') return 'major';
  if (letter === 'M') return 'moderate';
  if (letter === 'C') return 'minor';
  return null;
}

/** True if a DONKI SEP record lists an instrument at Mars (MAVEN or Curiosity's RAD). */
export function sepSeenAtMars(sep: DonkiSep): boolean {
  return sep.instruments.some((i) => /MAVEN|MSL|RAD|Mars/i.test(i));
}

/** Turn a DONKI snapshot into game events. Flares carry their real class; SEPs not tied to a flare become particle storms. */
export function snapshotToEvents(snap: DonkiSnapshot, origin: 'live' | 'archive'): SpaceWeatherEvent[] {
  const sepLinked = new Set<string>();
  for (const s of snap.seps) for (const id of s.linkedEvents) sepLinked.add(id);
  const flareIds = new Set(snap.flares.map((f) => f.id));
  const events: SpaceWeatherEvent[] = [];
  for (const f of snap.flares) {
    const severity = flareSeverity(f.classType);
    const time = f.peakTime ?? f.beginTime;
    if (!severity || !time) continue;
    events.push({
      id: f.id,
      kind: 'flare',
      classType: f.classType ?? undefined,
      severity,
      time: toIso(time),
      sourceLocation: f.sourceLocation,
      activeRegionNum: f.activeRegionNum,
      linkedSep: sepLinked.has(f.id),
      link: f.link ?? undefined,
      origin,
    });
  }
  for (const s of snap.seps) {
    if (!s.eventTime) continue;
    if (s.linkedEvents.some((id) => flareIds.has(id))) continue; // already represented by its flare
    events.push({
      id: s.id,
      kind: 'sep',
      severity: sepSeenAtMars(s) ? 'major' : 'moderate',
      time: toIso(s.eventTime),
      linkedSep: true,
      link: s.link ?? undefined,
      origin,
    });
  }
  return events;
}

function toIso(t: string): string {
  // DONKI times look like "2024-05-20T05:08Z".
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? t : d.toISOString();
}

export function countByClass(snap: DonkiSnapshot) {
  const c = { X: 0, M: 0, C: 0, sep: snap.seps.length, cme: snap.cmes.length, gst: snap.gsts.length };
  for (const f of snap.flares) {
    const l = (f.classType ?? '').charAt(0).toUpperCase();
    if (l === 'X' || l === 'M' || l === 'C') c[l]++;
  }
  return c;
}

// ---------------------------------------------------------------------------
// Loading

const snapshots = import.meta.glob<DonkiSnapshot>('./snapshots/donki-*.json', { eager: true, import: 'default' });
export const RECENT_SNAPSHOT: DonkiSnapshot | null = snapshots['./snapshots/donki-recent.json'] ?? null;
export const MAY2024_SNAPSHOT: DonkiSnapshot | null = snapshots['./snapshots/donki-may2024.json'] ?? null;

export interface SpaceWeatherFeed {
  status: 'live' | 'archive' | 'none';
  /** The window of real data in use. */
  snapshot: DonkiSnapshot | null;
  /** When we fetched it (live) or when the snapshot was taken (archive). */
  fetchedAt: string | null;
  via: 'proxy' | 'direct' | 'snapshot' | null;
  error?: string;
}

function ymd(d: Date) {
  return d.toISOString().slice(0, 10);
}

async function fetchJson(url: string, timeoutMs: number): Promise<unknown> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    return text.trim() ? JSON.parse(text) : [];
  } finally {
    clearTimeout(timer);
  }
}

const DIRECT_BASE = 'https://ccmc.gsfc.nasa.gov/DONKI/WS/get';

export async function loadSpaceWeather(days = 30): Promise<SpaceWeatherFeed> {
  const end = new Date();
  const start = new Date(end.getTime() - days * 86_400_000);
  const startDate = ymd(start);
  const endDate = ymd(end);
  const errors: string[] = [];

  // 1) Our Vercel proxy (keeps the API key server-side and caches for an hour).
  try {
    const snap = (await fetchJson(`/api/spaceweather?days=${days}`, 8000)) as DonkiSnapshot;
    if (snap && Array.isArray(snap.flares)) return { status: 'live', snapshot: snap, fetchedAt: snap.fetchedAt, via: 'proxy' };
    errors.push('proxy: bad shape');
  } catch (e) {
    errors.push(`proxy: ${(e as Error).message}`);
  }

  // 2) DONKI directly from the browser.
  try {
    const q = `startDate=${startDate}&endDate=${endDate}`;
    const [FLR, SEP] = await Promise.all([
      fetchJson(`${DIRECT_BASE}/FLR?${q}`, 9000),
      fetchJson(`${DIRECT_BASE}/SEP?${q}`, 9000),
    ]);
    const snap = normalizeDonki({ FLR, SEP }, { startDate, endDate, sourceUrl: DIRECT_BASE });
    return { status: 'live', snapshot: snap, fetchedAt: snap.fetchedAt, via: 'direct' };
  } catch (e) {
    errors.push(`direct: ${(e as Error).message}`);
  }

  // 3) The stored snapshot: real data, honestly labeled as ARCHIVE.
  if (RECENT_SNAPSHOT) {
    return { status: 'archive', snapshot: RECENT_SNAPSHOT, fetchedAt: RECENT_SNAPSHOT.fetchedAt, via: 'snapshot', error: errors.join('; ') };
  }
  return { status: 'none', snapshot: null, fetchedAt: null, via: null, error: errors.join('; ') };
}

/** Build the event pool: the current window first, May 2024 archive to fill any missing storm sizes. */
export function buildEventPool(feed: SpaceWeatherFeed): SpaceWeatherEvent[] {
  const pool: SpaceWeatherEvent[] = [];
  if (feed.snapshot) pool.push(...snapshotToEvents(feed.snapshot, feed.status === 'live' ? 'live' : 'archive'));
  if (MAY2024_SNAPSHOT) pool.push(...snapshotToEvents(MAY2024_SNAPSHOT, 'archive'));
  return pool;
}

/**
 * Replay History: the real May 2024 storm sequence (sol 1 = May 6, 2024).
 * - Sunspot region 13664 fired a run of X-class flares while facing Earth (May 8-15).
 *   Earth got its strongest geomagnetic storm in 20+ years on May 10.
 *   These flares were aimed at Earth, so in the game they reach Mars as moderate storms.
 * - On May 20 the region had turned toward Mars and erupted again: DONKI records a 2,678 km/s CME
 *   with no Earth-side source location (it came from the far side of the Sun, as seen from Earth).
 *   Curiosity measured 8,100 micrograys at Gale Crater: the finale of this scenario.
 */
export function may2024Pool(): SpaceWeatherEvent[] {
  const snap = MAY2024_SNAPSHOT;
  if (!snap) return [];
  const flareEvents = snapshotToEvents(snap, 'archive').filter((e) => e.kind === 'flare');
  const pick = (cls: string, day: string) => flareEvents.find((e) => e.classType === cls && e.time.startsWith(day));
  const earthFacing = [pick('X1.0', '2024-05-08'), pick('X3.9', '2024-05-10'), pick('X5.8', '2024-05-11'), pick('X8.7', '2024-05-14')]
    .filter((e): e is SpaceWeatherEvent => !!e)
    .map((e) => ({ ...e, severity: 'moderate' as const, note: 'This flare was aimed at Earth, so in the game it hits Mars as a smaller storm.' }));
  const farSide = snap.cmes
    .filter((c) => c.startTime?.startsWith('2024-05-20') && (c.speed ?? 0) >= 2000)
    .map<SpaceWeatherEvent>((c) => ({
      id: c.id,
      kind: 'cme',
      severity: 'major',
      time: toIso(c.startTime!),
      sourceLocation: c.sourceLocation,
      activeRegionNum: 13664,
      speedKms: c.speed,
      link: c.link ?? undefined,
      origin: 'archive',
      note: 'DONKI\'s analysts noted this eruption came from the far side of the Sun as seen from Earth: the side that was facing Mars. Earth could not see the flare itself.',
    }));
  return [...earthFacing, ...farSide].sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
}

/** Real DONKI geomagnetic storms at Earth on a given UTC day (news for the May 2024 scenario). */
export function earthStormsOn(dayIso: string): DonkiGst[] {
  return (MAY2024_SNAPSHOT?.gsts ?? []).filter((g) => g.startTime?.startsWith(dayIso));
}
