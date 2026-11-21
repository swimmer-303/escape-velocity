// Written with AI assistance (Claude Code). See README "Use of AI tools".
// GET /api/spaceweather?days=30 (run by src/server/api.ts, on Cloudflare)
// Fetches real solar flares (FLR), particle storms (SEP) and coronal mass ejections (CME, for the
// Space weather radar) from NASA DONKI, normalizes and trims them to the fields the game uses, and marks
// the answer cacheable; our server caches it for an hour so players never hit NASA rate limits.
// CMEs are optional: if that one request fails, the answer still has the flares and SEPs, and its
// `included` list leaves out 'CME' so nobody mistakes "not fetched" for "no CMEs".
// Uses the keyless CCMC DONKI host (ccmc.gsfc.nasa.gov); if NASA_API_KEY is set, api.nasa.gov is used as a backup.

import { normalizeDonki } from '../src/data/donki-normalize.js';

declare const process: { env: Record<string, string | undefined> };

const CCMC = 'https://ccmc.gsfc.nasa.gov/DONKI/WS/get';
const NASA = 'https://api.nasa.gov/DONKI';

async function getJson(url: string, timeoutMs = 8000): Promise<unknown> {
  const res = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`${res.status} from ${new URL(url).host}`);
  const text = await res.text();
  return text.trim() ? JSON.parse(text) : [];
}

async function fetchFrom(base: string, startDate: string, endDate: string, key?: string) {
  const q = `startDate=${startDate}&endDate=${endDate}${key ? `&api_key=${encodeURIComponent(key)}` : ''}`;
  // A month of CME records is ~160 KB raw (about 1 s from CCMC); the normalizer trims it to ~30 KB.
  const cme = getJson(`${base}/CME?${q}`, 7000).catch(() => undefined);
  const [FLR, SEP] = await Promise.all([getJson(`${base}/FLR?${q}`), getJson(`${base}/SEP?${q}`)]);
  // Never hold the flares (which game storms and Mission Control rooms need) more than 3 s for the CMEs.
  let grace: ReturnType<typeof setTimeout> | undefined;
  const CME = await Promise.race([cme, new Promise<undefined>((resolve) => (grace = setTimeout(resolve, 3000, undefined)))]);
  clearTimeout(grace);
  return normalizeDonki(Array.isArray(CME) ? { FLR, SEP, CME } : { FLR, SEP }, { startDate, endDate, sourceUrl: base });
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const days = Math.max(1, Math.min(60, Number(url.searchParams.get('days')) || 30));
  const end = new Date();
  const start = new Date(end.getTime() - days * 86_400_000);
  const startDate = start.toISOString().slice(0, 10);
  const endDate = end.toISOString().slice(0, 10);
  const errors: string[] = [];
  const sources: Array<[string, string | undefined]> = [[CCMC, undefined]];
  if (process.env.NASA_API_KEY) sources.push([NASA, process.env.NASA_API_KEY]);
  for (const [base, key] of sources) {
    try {
      const snap = await fetchFrom(base, startDate, endDate, key);
      return Response.json(snap, {
        headers: {
          'cache-control': 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400',
          'access-control-allow-origin': '*',
        },
      });
    } catch (e) {
      errors.push((e as Error).message);
    }
  }
  return Response.json({ error: 'DONKI unavailable', details: errors }, { status: 502, headers: { 'cache-control': 'no-store' } });
}
