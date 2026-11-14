// Written with AI assistance (Claude Code). See README "Use of AI tools".
// "The Sun right now": the newest picture from NASA's Solar Dynamics Observatory (SDO), AIA 171 camera,
// plus the latest real flare in the DONKI data the game is using.
// Picture order of preference:
//   1) our cached server (/api/sun), which also says when SDO took the picture;
//   2) NASA's own "latest" file, loaded straight into an <img> (works anywhere, including the Vite dev
//      server, but its headers can't be read cross-origin, so we make no "taken at" claim);
//   3) no picture: the panel hides it.
// No Vite-only features or top-level browser globals here: api/sun.ts imports the URLs from this file.

import type { DonkiFlare, DonkiSnapshot } from './donki-normalize';

export const SUN_PROXY_URL = '/api/sun';
/** NASA SDO's newest 512 px AIA 171 picture. It answers Cache-Control: no-cache and no CORS headers. */
export const SDO_LATEST_URL = 'https://sdo.gsfc.nasa.gov/assets/img/latest/latest_512_0171.jpg';
export const SDO_HOME_URL = 'https://sdo.gsfc.nasa.gov/';

export interface SunPicture {
  /** What the <img> should load: a blob: URL of our server's copy, or NASA's own URL. */
  src: string;
  via: 'proxy' | 'direct';
  /** When SDO took the picture (ISO, UTC), from our server. Null when we can't know it reliably. */
  takenAt: string | null;
}

const DIRECT: SunPicture = { src: SDO_LATEST_URL, via: 'direct', takenAt: null };

export async function loadSunPicture(timeoutMs = 8000): Promise<SunPicture> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(SUN_PROXY_URL, { signal: ctl.signal });
    const type = res.headers.get('content-type') ?? '';
    // The Vite dev server answers unknown paths with index.html, so insist on an image.
    if (!res.ok || !type.startsWith('image/') || typeof URL.createObjectURL !== 'function') return DIRECT;
    const blob = await res.blob();
    return { src: URL.createObjectURL(blob), via: 'proxy', takenAt: trustedTime(res.headers.get('x-sun-taken-at'), res.headers.get('date')) };
  } catch {
    return DIRECT;
  } finally {
    clearTimeout(timer);
  }
}

/** The picture's time, or null if it is unreadable, in the future, or this device's clock disagrees with our server's. */
function trustedTime(taken: string | null, serverDate: string | null, now = Date.now()): string | null {
  const t = Date.parse(taken ?? '');
  if (Number.isNaN(t) || t > now + 60_000) return null;
  const server = Date.parse(serverDate ?? '');
  // A browser-cached answer can carry a Date up to 5 minutes old, so allow 10.
  if (!Number.isNaN(server) && Math.abs(now - server) > 10 * 60_000) return null;
  return new Date(t).toISOString();
}

const REFRESH_MS = 10 * 60 * 1000;
let cached: { at: number; picture: Promise<SunPicture> } | null = null;

/** One picture per 10 minutes, shared by every screen (the briefing redraws each sol). */
export function getSunPicture(now = Date.now()): Promise<SunPicture> {
  if (!cached || now - cached.at > REFRESH_MS) {
    const old = cached?.picture;
    cached = { at: now, picture: loadSunPicture() };
    if (old) {
      void Promise.all([old, cached.picture]).then(([o, n]) => {
        if (o.src !== n.src && o.src.startsWith('blob:')) URL.revokeObjectURL(o.src);
      });
    }
  }
  return cached.picture;
}

/** The newest flare (by peak time) that has a class, or null. */
export function latestFlare(snap: DonkiSnapshot | null | undefined): DonkiFlare | null {
  let best: DonkiFlare | null = null;
  let bestT = -Infinity;
  for (const f of snap?.flares ?? []) {
    const t = Date.parse(f.peakTime ?? f.beginTime ?? '');
    if (!f.classType || Number.isNaN(t)) continue;
    if (t > bestT) {
      best = f;
      bestT = t;
    }
  }
  return best;
}

/** "about 12 minutes ago", "about 3 hours ago", or null when the age is unknown or too old to say that way. */
export function agoText(takenAt: string | null, now = Date.now()): string | null {
  if (!takenAt) return null;
  const mins = Math.round((now - Date.parse(takenAt)) / 60_000);
  if (!Number.isFinite(mins) || mins < 0) return null;
  if (mins <= 1) return 'about 1 minute ago';
  if (mins < 90) return `about ${mins} minutes ago`;
  const hours = Math.round(mins / 60);
  return hours < 48 ? `about ${hours} hours ago` : null;
}

/** "Nov 11" (UTC, like DONKI), with the year added when it isn't this year. */
export function flareDay(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const sameYear = d.getUTCFullYear() === now.getUTCFullYear();
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: sameYear ? undefined : 'numeric', timeZone: 'UTC' });
}

/** Test hook: forget the shared picture. */
export function resetSunPicture() {
  cached = null;
}
