// Written with AI assistance (Claude Code). See README "Use of AI tools".
// Pure DONKI normalizing code, shared by the browser, our server's proxy (api/spaceweather.ts)
// and tests. No Vite-only features here.

export interface DonkiFlare {
  id: string;
  classType: string | null;
  beginTime: string | null;
  peakTime: string | null;
  sourceLocation: string | null;
  activeRegionNum: number | null;
  link: string | null;
}
export interface DonkiSep {
  id: string;
  eventTime: string | null;
  instruments: string[];
  linkedEvents: string[];
  link: string | null;
}
export interface DonkiCme {
  id: string;
  startTime: string | null;
  speed: number | null;
  sourceLocation: string | null;
  link: string | null;
}
export interface DonkiGst {
  id: string;
  startTime: string | null;
  maxKp: number | null;
  link: string | null;
}
export interface DonkiSnapshot {
  fetchedAt: string;
  startDate: string;
  endDate: string;
  sourceUrl: string;
  flares: DonkiFlare[];
  seps: DonkiSep[];
  cmes: DonkiCme[];
  gsts: DonkiGst[];
}

// ---------------------------------------------------------------------------
// Raw DONKI API records (only the fields we read).
interface RawLinked {
  activityID?: string;
}
interface RawFlr {
  flrID?: string;
  beginTime?: string;
  peakTime?: string;
  classType?: string;
  sourceLocation?: string;
  activeRegionNum?: number | null;
  link?: string;
}
interface RawSep {
  sepID?: string;
  eventTime?: string;
  instruments?: { displayName?: string }[];
  linkedEvents?: RawLinked[] | null;
  link?: string;
}
interface RawCme {
  activityID?: string;
  startTime?: string;
  sourceLocation?: string;
  link?: string;
  cmeAnalyses?: { speed?: number; isMostAccurate?: boolean }[] | null;
}
interface RawGst {
  gstID?: string;
  startTime?: string;
  allKpIndex?: { kpIndex?: number }[];
  link?: string;
}

export function normalizeDonki(
  raw: { FLR?: unknown; SEP?: unknown; CME?: unknown; GST?: unknown },
  meta: { startDate: string; endDate: string; sourceUrl: string; fetchedAt?: string },
): DonkiSnapshot {
  const arr = <T>(x: unknown): T[] => (Array.isArray(x) ? (x as T[]) : []);
  return {
    fetchedAt: meta.fetchedAt ?? new Date().toISOString(),
    startDate: meta.startDate,
    endDate: meta.endDate,
    sourceUrl: meta.sourceUrl,
    flares: arr<RawFlr>(raw.FLR)
      .filter((f) => f.flrID)
      .map((f) => ({
        id: f.flrID!,
        classType: f.classType ?? null,
        beginTime: f.beginTime ?? null,
        peakTime: f.peakTime ?? null,
        sourceLocation: f.sourceLocation ?? null,
        activeRegionNum: f.activeRegionNum ?? null,
        link: f.link ?? null,
      })),
    seps: arr<RawSep>(raw.SEP)
      .filter((s) => s.sepID)
      .map((s) => ({
        id: s.sepID!,
        eventTime: s.eventTime ?? null,
        instruments: (s.instruments ?? []).map((i) => i.displayName ?? '').filter(Boolean),
        linkedEvents: (s.linkedEvents ?? []).map((l) => l.activityID ?? '').filter(Boolean),
        link: s.link ?? null,
      })),
    cmes: arr<RawCme>(raw.CME)
      .filter((c) => c.activityID)
      .map((c) => {
        const analyses = c.cmeAnalyses ?? [];
        const best = analyses.find((a) => a.isMostAccurate) ?? analyses[0];
        return {
          id: c.activityID!,
          startTime: c.startTime ?? null,
          speed: best?.speed ?? null,
          sourceLocation: c.sourceLocation ?? null,
          link: c.link ?? null,
        };
      }),
    gsts: arr<RawGst>(raw.GST)
      .filter((g) => g.gstID)
      .map((g) => ({
        id: g.gstID!,
        startTime: g.startTime ?? null,
        maxKp: (g.allKpIndex ?? []).reduce<number | null>((m, k) => (k.kpIndex == null ? m : Math.max(m ?? 0, k.kpIndex)), null),
        link: g.link ?? null,
      })),
  };
}
