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
/** One arrival predicted by NASA's WSA-ENLIL model run, as listed in DONKI. */
export interface DonkiEnlilArrival {
  /** Predicted arrival time (UTC, DONKI format). */
  time: string;
  /** DONKI's isGlancingBlow (Mars) or isEarthGB (Earth): only the edge of the CME is predicted to pass. */
  glancing: boolean;
  /** DONKI's isMinorImpact (Mars) or isEarthMinorImpact (Earth). */
  minor: boolean;
}
/** NASA's own model prediction for a CME: the newest WSA-ENLIL run DONKI lists under its most accurate analysis. */
export interface DonkiEnlil {
  /** How many WSA-ENLIL runs DONKI lists for this CME's most accurate analyses. */
  runs: number;
  /** modelCompletionTime of the run summarized here (the newest). */
  completedAt: string | null;
  link: string | null;
  /** estimatedShockArrivalTime (+ isEarthGB, isEarthMinorImpact), or null when the run predicted no arrival at Earth. */
  earth: DonkiEnlilArrival | null;
  /** The impactList entry with location "Mars", or null when the run predicted no arrival at Mars. */
  mars: DonkiEnlilArrival | null;
}
export interface DonkiCme {
  id: string;
  startTime: string | null;
  speed: number | null;
  sourceLocation: string | null;
  link: string | null;
  // The fields below are optional: snapshots and stored pools made before they existed don't have them.
  // They come from the first cmeAnalyses entry flagged isMostAccurate (null when there is none or it lacks the value).
  /** time21_5: when the CME's front passed 21.5 solar radii from the Sun's center (UTC). */
  time21_5?: string | null;
  /** Stonyhurst heliographic longitude of the CME's direction, degrees. 0 = toward Earth, + = west, - = east. Null for plane-of-sky measurements. */
  longitude?: number | null;
  /** Heliographic latitude of its direction, degrees (+ = north of the Sun's equator). */
  latitude?: number | null;
  /** Half the cone's opening angle, degrees. */
  halfAngle?: number | null;
  /** NASA's WSA-ENLIL prediction, or null when DONKI lists no ENLIL run for it. */
  enlil?: DonkiEnlil | null;
}
export interface DonkiGst {
  id: string;
  startTime: string | null;
  maxKp: number | null;
  link: string | null;
}
export type DonkiType = 'FLR' | 'SEP' | 'CME' | 'GST';
export interface DonkiSnapshot {
  fetchedAt: string;
  startDate: string;
  endDate: string;
  sourceUrl: string;
  flares: DonkiFlare[];
  seps: DonkiSep[];
  cmes: DonkiCme[];
  gsts: DonkiGst[];
  /**
   * Which DONKI record types were actually fetched (optional: older snapshots don't say).
   * An empty `cmes` list only means "no CMEs" when this includes 'CME'.
   */
  included?: DonkiType[];
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
interface RawImpact {
  location?: string;
  arrivalTime?: string | null;
  isGlancingBlow?: boolean;
  isMinorImpact?: boolean;
}
interface RawEnlil {
  modelCompletionTime?: string | null;
  estimatedShockArrivalTime?: string | null;
  isEarthGB?: boolean;
  isEarthMinorImpact?: boolean;
  link?: string | null;
  impactList?: RawImpact[] | null;
}
interface RawAnalysis {
  speed?: number | null;
  isMostAccurate?: boolean;
  time21_5?: string | null;
  longitude?: number | null;
  latitude?: number | null;
  halfAngle?: number | null;
  enlilList?: RawEnlil[] | null;
}
export interface RawCme {
  activityID?: string;
  startTime?: string;
  sourceLocation?: string;
  link?: string;
  cmeAnalyses?: RawAnalysis[] | null;
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
  const included = (['FLR', 'SEP', 'CME', 'GST'] as const).filter((t) => raw[t] !== undefined);
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
          ...cmeAnalysisFields(c),
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
    included,
  };
}

const num = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : null);
const str = (x: unknown): string | null => (typeof x === 'string' && x.trim() ? x : null);

/**
 * The optional direction and model fields of a normalized CME (see DonkiCme). Also mirrored in scripts/fetch-data.mjs.
 * Uses the first analysis DONKI flags isMostAccurate. ENLIL: the newest run (by modelCompletionTime) under any
 * most-accurate analysis. An arrival listed before the CME started is a typo in DONKI and is left out.
 */
export function cmeAnalysisFields(c: RawCme): Required<Pick<DonkiCme, 'time21_5' | 'longitude' | 'latitude' | 'halfAngle' | 'enlil'>> {
  const flagged = (c.cmeAnalyses ?? []).filter((a) => a?.isMostAccurate === true);
  const best = flagged[0];
  const runs = flagged.flatMap((a) => (Array.isArray(a.enlilList) ? a.enlilList : [])).filter(Boolean);
  let enlil: DonkiEnlil | null = null;
  if (runs.length) {
    const t = (r: RawEnlil) => Date.parse(r.modelCompletionTime ?? '') || 0;
    const newest = runs.reduce((a, b) => (t(b) > t(a) ? b : a));
    const start = Date.parse(c.startTime ?? '') || -Infinity;
    const valid = (time: string | null | undefined): time is string => !!str(time) && Date.parse(time!) >= start;
    const mars = (newest.impactList ?? []).find((i) => i?.location === 'Mars' && valid(i.arrivalTime));
    enlil = {
      runs: runs.length,
      completedAt: str(newest.modelCompletionTime),
      link: str(newest.link),
      earth: valid(newest.estimatedShockArrivalTime)
        ? { time: newest.estimatedShockArrivalTime!, glancing: newest.isEarthGB === true, minor: newest.isEarthMinorImpact === true }
        : null,
      mars: mars ? { time: mars.arrivalTime!, glancing: mars.isGlancingBlow === true, minor: mars.isMinorImpact === true } : null,
    };
  }
  return {
    time21_5: str(best?.time21_5),
    longitude: num(best?.longitude),
    latitude: num(best?.latitude),
    halfAngle: num(best?.halfAngle),
    enlil,
  };
}
