// Written with AI assistance (Claude Code). See README "Use of AI tools".
// Vercel Function: GET /api/spaceweather?days=30
// Fetches real solar flares (FLR) and particle storms (SEP) from NASA DONKI, normalizes them,
// and lets Vercel's CDN cache the answer for an hour so players never hit NASA rate limits.
// Uses the keyless CCMC DONKI host (ccmc.gsfc.nasa.gov); if NASA_API_KEY is set, api.nasa.gov is used as a backup.

import { normalizeDonki } from '../src/data/donki-normalize.js';

const CCMC = 'https://ccmc.gsfc.nasa.gov/DONKI/WS/get';
const NASA = 'https://api.nasa.gov/DONKI';

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`${res.status} from ${new URL(url).host}`);
  const text = await res.text();
  return text.trim() ? JSON.parse(text) : [];
}

async function fetchFrom(base: string, startDate: string, endDate: string, key?: string) {
  const q = `startDate=${startDate}&endDate=${endDate}${key ? `&api_key=${encodeURIComponent(key)}` : ''}`;
  const [FLR, SEP] = await Promise.all([getJson(`${base}/FLR?${q}`), getJson(`${base}/SEP?${q}`)]);
  return normalizeDonki({ FLR, SEP }, { startDate, endDate, sourceUrl: base });
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
