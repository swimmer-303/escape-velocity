// Written with AI assistance (Claude Code). See README "Use of AI tools".
// The newest picture of the Sun from NASA's Solar Dynamics Observatory (SDO), AIA 171 camera,
// for GET /api/sun (src/server/api.ts serves it and caches it for 10 minutes).
// NASA's "latest" file carries no observation time we can read (only Last-Modified, when it was posted).
// SDO's browse archive names each picture with the time it was taken, in UTC
// (e.g. browse/2026/11/14/20261114_154746_512_0171.jpg), and the newest one is the same file as "latest".
// So we serve the newest archive picture with its real time, and fall back to the latest file
// (with no observation time) if that fails.

import { SDO_LATEST_URL } from '../src/data/sun.js';

export const SDO_BROWSE_BASE = 'https://sdo.gsfc.nasa.gov/assets/img/browse';
const SUFFIX = '_512_0171.jpg';

export interface SunImage {
  body: Uint8Array;
  contentType: string;
  /** NASA's Last-Modified header (when the file was posted), if sent. */
  lastModified: string | null;
  /** When SDO took the picture (ISO, UTC), read from the archive file name. Null if unknown. */
  takenAt: string | null;
  /** When our server fetched it (ISO). */
  fetchedAt: string;
  sourceUrl: string;
}

type Fetch = (url: string, init?: { signal?: AbortSignal }) => Promise<Response>;

/** The newest "YYYYMMDD_HHMMSS_512_0171.jpg" in an SDO browse directory listing, with its time. */
export function newestBrowseFile(listing: string): { file: string; takenAt: string } | null {
  let best: string | null = null;
  for (const m of listing.matchAll(/(\d{8}_\d{6})_512_0171\.jpg/g)) if (!best || m[1] > best) best = m[1];
  if (!best) return null;
  const [d, t] = best.split('_');
  const ms = Date.parse(`${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}T${t.slice(0, 2)}:${t.slice(2, 4)}:${t.slice(4, 6)}Z`);
  return Number.isNaN(ms) ? null : { file: `${best}${SUFFIX}`, takenAt: new Date(ms).toISOString() };
}

const pad = (n: number) => String(n).padStart(2, '0');
const browseDir = (d: Date) => `${SDO_BROWSE_BASE}/${d.getUTCFullYear()}/${pad(d.getUTCMonth() + 1)}/${pad(d.getUTCDate())}/`;

async function getImage(url: string, fetchImpl: Fetch) {
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`${res.status} from ${url}`);
  const contentType = res.headers.get('content-type') ?? '';
  if (!contentType.startsWith('image/')) throw new Error(`not an image (${contentType || 'no type'}) from ${url}`);
  const body = new Uint8Array(await res.arrayBuffer());
  if (body.byteLength < 1000) throw new Error(`image too small from ${url}`);
  return { body, contentType, lastModified: res.headers.get('last-modified') };
}

export async function fetchSunImage(now = new Date(), fetchImpl: Fetch = fetch): Promise<SunImage> {
  const fetchedAt = now.toISOString();
  const errors: string[] = [];
  // 1) The newest archive picture: today (UTC), or yesterday just after midnight. The listing is
  //    filtered to our one camera and size, so it is about 15 KB instead of 1 MB.
  for (const day of [now, new Date(now.getTime() - 86_400_000)]) {
    const dir = browseDir(day);
    try {
      const res = await fetchImpl(`${dir}?C=M;O=D;P=*${SUFFIX}`, { signal: AbortSignal.timeout(10_000) });
      const newest = res.ok ? newestBrowseFile(await res.text()) : null;
      if (!newest) {
        errors.push(`no pictures listed in ${dir} (${res.status})`);
        // An empty or missing folder just means a new UTC day has started; anything else, go to step 2.
        if (res.ok || res.status === 404) continue;
        break;
      }
      if (Date.parse(newest.takenAt) > now.getTime() + 60_000) throw new Error(`time in the future: ${newest.file}`);
      const img = await getImage(dir + newest.file, fetchImpl);
      return { ...img, takenAt: newest.takenAt, fetchedAt, sourceUrl: dir + newest.file };
    } catch (e) {
      errors.push((e as Error).message);
      break;
    }
  }
  // 2) NASA's "latest" file: the newest picture, but we don't know exactly when it was taken.
  try {
    const img = await getImage(SDO_LATEST_URL, fetchImpl);
    return { ...img, takenAt: null, fetchedAt, sourceUrl: SDO_LATEST_URL };
  } catch (e) {
    errors.push((e as Error).message);
  }
  throw new Error(`SDO unavailable: ${errors.join('; ')}`);
}
