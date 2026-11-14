// Written with AI assistance (Claude Code). See README "Use of AI tools".
//
// Snapshot real NASA data for Escape Velocity.
//
//   node scripts/fetch-data.mjs                 # everything
//   node scripts/fetch-data.mjs --only=donki    # just DONKI (also: radlab, osdr; comma-separated)
//
// Node 22+, ESM, no dependencies (uses global fetch).
//
// Writes into src/data/snapshots/:
//   donki-recent.json     DONKI flares / SEPs / CMEs / storms, last 30 days (UTC)
//   donki-may2024.json    same, 2024-05-01 .. 2024-05-31 (the May 2024 storms)
//   radlab-iss.json       ISS absorbed dose rate (OSDR RadLab, DOSTEL1 in Columbus), daily series
//   radlab-iss-may2024.json  same instrument during the May 2024 storms
//   osdr-cards.json       "Real Science" cards: curated OSDR studies, titles re-read from the API
//
// Safety rule: a snapshot is only replaced when every request it depends on succeeded.
// If anything fails, the old file is kept and a warning is printed (exit code 1).
// An empty event list is written only when the API answered 200 with an empty list.
// See docs/data-notes.md for endpoints, field names, CORS and rate-limit notes.

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'src', 'data', 'snapshots');
const USER_AGENT = 'escape-velocity-data-fetch/1.0 (NASA Space Apps 2026 student game)';

// ---------------------------------------------------------------------------
// Small helpers

const warnings = [];
function warn(msg) {
  warnings.push(msg);
  console.warn(`WARN  ${msg}`);
}
function info(msg) {
  console.log(`      ${msg}`);
}

function isoDate(d) {
  return d.toISOString().slice(0, 10);
}
function addDays(dateStr, n) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return isoDate(d);
}

async function httpGet(url, { timeoutMs = 90_000, accept = 'application/json', method = 'GET' } = {}) {
  const res = await fetch(url, {
    method,
    headers: { 'User-Agent': USER_AGENT, Accept: accept },
    signal: AbortSignal.timeout(timeoutMs),
    redirect: 'follow',
  });
  return res;
}

async function getJson(url, opts) {
  const res = await httpGet(url, opts);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${redact(url)}`);
  const text = await res.text();
  return { text, json: text.trim() === '' ? undefined : JSON.parse(text), headers: res.headers };
}

function redact(url) {
  return url.replace(/api_key=[^&]+/, 'api_key=***');
}

async function writeSnapshot(name, data) {
  await mkdir(OUT_DIR, { recursive: true });
  const finalPath = join(OUT_DIR, name);
  const tmpPath = `${finalPath}.tmp`;
  await writeFile(tmpPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  await rename(tmpPath, finalPath); // atomic replace: never leaves a half-written snapshot
  info(`wrote src/data/snapshots/${name}`);
}

async function snapshotExists(name) {
  try {
    await readFile(join(OUT_DIR, name));
    return true;
  } catch {
    return false;
  }
}

async function keepOld(name, reason) {
  const had = await snapshotExists(name);
  warn(`${name}: ${reason} -> ${had ? 'kept the existing snapshot unchanged' : 'no snapshot written (none existed before)'}`);
}

// ---------------------------------------------------------------------------
// 1. DONKI (space weather)
//
// Host order. ccmc.gsfc.nasa.gov is keyless, returns Access-Control-Allow-Origin: * and is where
// every DONKI `link` field now points. kauai.ccmc.gsfc.nasa.gov is the older keyless host (it did
// not answer at all on 2026-11-14). api.nasa.gov needs a key; it is used only as a last resort
// (DEMO_KEY allowed only ~10 requests/hour when we checked), or first if NASA_API_KEY is set.

function donkiHosts() {
  const key = process.env.NASA_API_KEY;
  const ccmc = [
    { base: 'https://ccmc.gsfc.nasa.gov/DONKI/WS/get', path: (t) => t, key: null },
    { base: 'https://kauai.ccmc.gsfc.nasa.gov/DONKI/WS/get', path: (t) => t, key: null },
  ];
  const apiNasa = { base: 'https://api.nasa.gov/DONKI', path: (t) => t, key: key || 'DEMO_KEY' };
  return [...ccmc, apiNasa];
}

const DONKI_TYPES = {
  FLR: { idField: 'flrID', out: 'flares' },
  SEP: { idField: 'sepID', out: 'seps' },
  CME: { idField: 'activityID', out: 'cmes' },
  GST: { idField: 'gstID', out: 'gsts' },
};

function linkedIds(list) {
  return Array.isArray(list) ? list.map((l) => l?.activityID).filter(Boolean) : [];
}

function normFlare(r) {
  return {
    id: r.flrID,
    classType: r.classType ?? null,
    beginTime: r.beginTime ?? null,
    peakTime: r.peakTime ?? null,
    sourceLocation: r.sourceLocation || null,
    activeRegionNum: r.activeRegionNum ?? null,
    link: r.link ?? null,
  };
}

function normSep(r) {
  return {
    id: r.sepID,
    eventTime: r.eventTime ?? null,
    instruments: Array.isArray(r.instruments) ? r.instruments.map((i) => i?.displayName).filter(Boolean) : [],
    linkedEvents: linkedIds(r.linkedEvents),
    link: r.link ?? null,
  };
}

function normCme(r) {
  // DONKI marks the preferred analysis with isMostAccurate. Occasionally more than one analysis is
  // flagged (e.g. 2024-05-20T05:36 has a shock-front fit at 2678 km/s and a bulk fit at 1927 km/s,
  // both flagged); we take the first flagged entry in DONKI's own order. No flag -> null.
  const analyses = Array.isArray(r.cmeAnalyses) ? r.cmeAnalyses : [];
  const best = analyses.find((a) => a?.isMostAccurate === true);
  const speed = typeof best?.speed === 'number' ? best.speed : null;
  return {
    id: r.activityID,
    startTime: r.startTime ?? null,
    speed,
    sourceLocation: r.sourceLocation || null,
    link: r.link ?? null,
  };
}

function normGst(r) {
  const kps = Array.isArray(r.allKpIndex) ? r.allKpIndex.map((k) => k?.kpIndex).filter((k) => typeof k === 'number') : [];
  return {
    id: r.gstID,
    startTime: r.startTime ?? null,
    maxKp: kps.length ? Math.max(...kps) : null,
    link: r.link ?? null,
  };
}

const NORMALIZERS = { FLR: normFlare, SEP: normSep, CME: normCme, GST: normGst };

async function fetchDonkiType(host, type, startDate, endDate) {
  const params = new URLSearchParams({ startDate, endDate });
  if (host.key) params.set('api_key', host.key);
  const url = `${host.base}/${host.path(type)}?${params}`;
  const { json, text } = await getJson(url, { timeoutMs: 120_000 });
  // DONKI answers "no events" with either [] or an empty body; both mean a genuine empty list.
  if (json === undefined) return [];
  if (!Array.isArray(json)) throw new Error(`${type}: expected a JSON array, got ${text.slice(0, 80)}`);
  const idField = DONKI_TYPES[type].idField;
  for (const rec of json) {
    if (!rec || typeof rec[idField] !== 'string') throw new Error(`${type}: record without ${idField}`);
  }
  return json;
}

async function fetchDonkiWindow(startDate, endDate) {
  const errors = [];
  for (const host of donkiHosts()) {
    try {
      const raw = {};
      for (const type of Object.keys(DONKI_TYPES)) {
        raw[type] = await fetchDonkiType(host, type, startDate, endDate);
      }
      const snap = {
        fetchedAt: new Date().toISOString(),
        startDate,
        endDate,
        sourceUrl: host.base,
      };
      for (const [type, { out }] of Object.entries(DONKI_TYPES)) {
        snap[out] = raw[type].map(NORMALIZERS[type]);
      }
      return snap;
    } catch (err) {
      errors.push(`${host.base}: ${err.message}`);
      info(`DONKI host failed, trying next: ${host.base} (${err.message})`);
    }
  }
  throw new Error(`all DONKI hosts failed: ${errors.join(' | ')}`);
}

function summarizeDonki(s) {
  const byClass = {};
  for (const f of s.flares) {
    const c = (f.classType || '?')[0];
    byClass[c] = (byClass[c] || 0) + 1;
  }
  const maxKp = s.gsts.reduce((m, g) => (g.maxKp != null && g.maxKp > m ? g.maxKp : m), -Infinity);
  return `flares ${s.flares.length} ${JSON.stringify(byClass)}, SEPs ${s.seps.length}, CMEs ${s.cmes.length}, storms ${s.gsts.length}${s.gsts.length ? ` (max Kp ${maxKp})` : ''}`;
}

async function runDonki() {
  console.log('== DONKI');
  const today = isoDate(new Date());
  const windows = [
    { file: 'donki-recent.json', startDate: addDays(today, -30), endDate: today },
    { file: 'donki-may2024.json', startDate: '2024-05-01', endDate: '2024-05-31' },
  ];
  for (const w of windows) {
    try {
      const snap = await fetchDonkiWindow(w.startDate, w.endDate);
      info(`${w.file} ${w.startDate}..${w.endDate} via ${snap.sourceUrl}: ${summarizeDonki(snap)}`);
      await writeSnapshot(w.file, snap);
    } catch (err) {
      await keepOld(w.file, err.message);
    }
  }
}

// ---------------------------------------------------------------------------
// 2. RadLab (OSDR radiation dosimetry): ISS absorbed dose rate
//
// API docs: https://visualization.osdr.nasa.gov/radlab/gui/data-api/
// absorbed_dose_rate is in µGy/hour. DOSTEL1/DOSTEL2 (DLR silicon telescopes in the Columbus module)
// were the only ISS detectors returning 2024 data when we checked; the ISS series in RadLab ended in
// late Oct/early Nov 2024 (nothing for 2025-2026). The windows below are therefore fixed, not "live".
//
// Readings are NOT evenly spaced: the cadence is ~20 s in the South Atlantic Anomaly (high dose) and
// ~100 s elsewhere, so a plain average of readings over-weights the SAA (it came out ~2.5x too high).
// We time-weight instead: each reading counts for the time until the next reading (gaps > 10 min are
// treated as "no data"), giving a daily mean rate in µGy/h, times 24 -> µGy/day.

const RADLAB_BASE = 'https://visualization.osdr.nasa.gov/radlab/api/';
const RADLAB_MAX_GAP_S = 600;
const RADLAB_MIN_COVERAGE_H = 20;

const RADLAB_WINDOWS = [
  // Last 30 complete days of DOSTEL1 data available in RadLab (checked 2026-11-14).
  { file: 'radlab-iss.json', instrumentId: 'DosTel1', startDate: '2024-09-29', endDate: '2024-10-28', maxDays: 30 },
  // Same detector during the May 2024 storms (pairs with donki-may2024.json).
  { file: 'radlab-iss-may2024.json', instrumentId: 'DosTel1', startDate: '2024-05-01', endDate: '2024-05-31', maxDays: 31 },
];

function radlabUrl(instrumentId, startDate, endDateInclusive) {
  const endExclusive = addDays(endDateInclusive, 1);
  // Key-value syntax from the docs; <, >, : are URL-encoded as the docs recommend.
  return (
    `${RADLAB_BASE}?instrument_id=${encodeURIComponent(instrumentId)}` +
    `&timestamp%3E=${startDate}T00%3A00&timestamp%3C${endExclusive}T00%3A00` +
    `&absorbed_dose_rate&module&format=json`
  );
}

function dailyTimeWeighted(rows) {
  // rows: [{ t: Date, v: number }] sorted by t
  const days = new Map();
  for (let i = 0; i < rows.length - 1; i++) {
    const dt = (rows[i + 1].t - rows[i].t) / 1000;
    if (!(dt > 0) || dt > RADLAB_MAX_GAP_S) continue;
    const day = rows[i].t.toISOString().slice(0, 10);
    const d = days.get(day) || { dose: 0, secs: 0, n: 0 };
    d.dose += rows[i].v * dt; // µGy/h * s
    d.secs += dt;
    d.n += 1;
    days.set(day, d);
  }
  return [...days.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([date, d]) => ({
      date,
      meanRate: d.dose / d.secs, // µGy/h
      coverageHours: d.secs / 3600,
      readings: d.n,
    }));
}

async function fetchRadlabWindow(w) {
  const queryUrl = radlabUrl(w.instrumentId, w.startDate, w.endDate);
  const { json } = await getJson(queryUrl, { timeoutMs: 300_000 });
  if (!json || !Array.isArray(json.columns) || !Array.isArray(json.data)) throw new Error('unexpected RadLab JSON shape');
  const ti = json.columns.indexOf('timestamp');
  const vi = json.columns.indexOf('absorbed_dose_rate');
  const mi = json.columns.indexOf('module');
  if (ti < 0 || vi < 0) throw new Error(`RadLab columns missing: ${json.columns.join(',')}`);
  const modules = new Set();
  const rows = [];
  for (const r of json.data) {
    const v = r[vi];
    if (typeof v !== 'number' || !Number.isFinite(v)) continue;
    // RadLab timestamps carry no zone suffix; we treat them as UTC.
    const t = new Date(`${r[ti]}Z`);
    if (Number.isNaN(t.getTime())) continue;
    rows.push({ t, v });
    if (mi >= 0 && r[mi]) modules.add(r[mi]);
  }
  if (rows.length < 100) throw new Error(`only ${rows.length} usable readings returned`);
  rows.sort((a, b) => a.t - b.t);

  const days = dailyTimeWeighted(rows).filter((d) => d.coverageHours >= RADLAB_MIN_COVERAGE_H);
  if (days.length === 0) throw new Error('no day had enough coverage');
  const series = days.slice(-(w.maxDays ?? 30)).map((d) => ({
    date: d.date,
    value: Math.round(d.meanRate * 24 * 10) / 10, // µGy/day
    coverageHours: Math.round(d.coverageHours * 10) / 10,
  }));
  const mean = series.reduce((s, d) => s + d.value, 0) / series.length;
  const naive = rows.reduce((s, r) => s + r.v, 0) / rows.length;

  return {
    fetchedAt: new Date().toISOString(),
    queryUrl,
    spacecraft: 'ISS',
    instrument: `${w.instrumentId} (DOSTEL silicon detector telescope, DLR)${modules.size ? `, module: ${[...modules].join('/')}` : ''}`,
    startDate: series[0].date,
    endDate: series[series.length - 1].date,
    units: 'µGy/day (absorbed dose; DOSTEL measures in silicon, not in tissue, and this is not a dose equivalent in µSv)',
    meanDoseRatePerDay: Math.round(mean * 10) / 10,
    dailySeries: series,
    notes:
      `RadLab reports absorbed_dose_rate in µGy/hour. Readings are unevenly spaced (about every 20 s inside the ` +
      `South Atlantic Anomaly, about every 100 s elsewhere), so each reading was weighted by the time until the next ` +
      `reading (gaps over ${RADLAB_MAX_GAP_S / 60} min skipped) to get a time-averaged µGy/hour for each UTC day, then ` +
      `multiplied by 24 to get µGy/day. Days with under ${RADLAB_MIN_COVERAGE_H} h of coverage are left out. ` +
      `${rows.length} readings used. For comparison, a plain unweighted average of all readings would be ` +
      `${(naive * 24).toFixed(0)} µGy/day, which over-counts the SAA. This is archived data (RadLab's ISS ` +
      `series ended in late 2024), not a live reading. Gray (Gy) is absorbed energy; sievert (Sv) is the ` +
      `biological dose equivalent, so do not compare these numbers directly with mSv figures.`,
  };
}

async function runRadlab() {
  console.log('== RadLab');
  for (const w of RADLAB_WINDOWS) {
    try {
      const snap = await fetchRadlabWindow(w);
      info(`${w.file}: ${snap.dailySeries.length} days ${snap.startDate}..${snap.endDate}, mean ${snap.meanDoseRatePerDay} µGy/day`);
      await writeSnapshot(w.file, snap);
    } catch (err) {
      await keepOld(w.file, err.message);
    }
  }
}

// ---------------------------------------------------------------------------
// 3. OSDR "Real Science" cards
//
// The choice of studies and the kid-friendly takeaways are hand-written (curated on 2026-11-14 from
// what the OSDR search API returned for each searchTerm). This step re-checks every card against the
// live API: the study must still exist (metadata API) and its exact title is copied from the API.
// A card whose study is no longer returned by its search term only produces a warning.

const OSDR_SEARCH = 'https://osdr.nasa.gov/osdr/data/search';
const OSDR_META = 'https://osdr.nasa.gov/osdr/data/osd/meta/';
const OSDR_STUDY_PAGE = 'https://osdr.nasa.gov/bio/repo/data/studies/';

const OSDR_CARDS = [
  // greenhouse
  {
    osdId: 'OSD-772',
    searchTerm: 'plant growth',
    tieIn: 'greenhouse',
    takeaway:
      'Chile pepper plants grew in a plant chamber on the International Space Station for 137 days, one of the longest plant-growing tests there, and made 26 peppers.',
  },
  {
    osdId: 'OSD-267',
    searchTerm: 'lettuce',
    tieIn: 'greenhouse',
    takeaway:
      'Scientists grew red romaine lettuce in the Veggie plant chamber on the space station and compared it with lettuce grown on Earth to check that space-grown food is safe and healthy to eat.',
  },
  {
    osdId: 'OSD-314',
    searchTerm: 'partial gravity',
    tieIn: 'greenhouse',
    takeaway:
      'Scientists grew tiny seedlings on the space station in weightlessness and in Mars-strength gravity, and found that the Mars-gravity seedlings only got their growing cells back on track when they were given red light.',
  },
  {
    osdId: 'OSD-581',
    searchTerm: 'oxygen',
    tieIn: 'greenhouse',
    takeaway:
      'Scientists on Earth grew ryegrass in pretend Mars soil: the plants grew for two weeks, but their leaves turned yellowish and bent downward.',
  },
  // shelter (radiation)
  {
    osdId: 'OSD-210',
    searchTerm: 'cosmic radiation',
    tieIn: 'shelter',
    takeaway:
      'Scientists sent about 580,000 tiny plant seeds high above Antarctica on a balloon to study cosmic radiation, and those seeds sprouted less often and had more mutations than seeds that stayed safe in the lab.',
  },
  {
    osdId: 'OSD-431',
    searchTerm: 'space radiation',
    tieIn: 'shelter',
    takeaway:
      'Scientists flew human blood-vessel cells to the space station and found that space radiation and weightlessness change the cells in different ways, with radiation switching on the cells’ DNA-repair systems.',
  },
  {
    osdId: 'OSD-479',
    searchTerm: 'cosmic radiation',
    tieIn: 'shelter',
    takeaway:
      'Scientists on Earth used a particle accelerator to give mice radiation like the kind found in deep space; afterward the male mice had more trouble learning their way through a maze, but the female mice did not.',
  },
  // crew (bone / muscle / microgravity)
  {
    osdId: 'OSD-714',
    searchTerm: 'muscle',
    tieIn: 'crew',
    takeaway:
      'On the space station, mice that rode in a spinning habitat with Moon-strength gravity kept their leg muscle size, while mice in weightlessness lost some.',
  },
  {
    osdId: 'OSD-342',
    searchTerm: 'bone',
    tieIn: 'crew',
    takeaway:
      'Mice that spent 33 days on the space station lost muscle and bone, so scientists tested a treatment that helped mice build muscle and bone, both in space and on the ground.',
  },
  {
    osdId: 'OSD-324',
    searchTerm: 'bone',
    tieIn: 'crew',
    takeaway:
      'Scientists flew bone cells to the space station for 2 to 6 days to learn how bones sense weightlessness, because astronauts lose bone on long trips.',
  },
];

async function osdrSearchAccessions(term) {
  const params = new URLSearchParams({ term, type: 'cgene', from: '0', size: '200' });
  const { json } = await getJson(`${OSDR_SEARCH}?${params}`, { timeoutMs: 90_000 });
  const hits = json?.hits?.hits;
  if (!Array.isArray(hits)) throw new Error(`OSDR search "${term}": unexpected response shape`);
  return new Set(hits.map((h) => h?._source?.Accession).filter(Boolean));
}

async function osdrTitle(osdId) {
  const num = osdId.replace(/^OSD-/, '');
  const { json } = await getJson(`${OSDR_META}${num}`, { timeoutMs: 90_000 });
  const study = json?.study?.[osdId]?.studies?.[0];
  if (!study || typeof study.title !== 'string' || !study.title.trim()) throw new Error(`${osdId}: not found in OSDR metadata API`);
  return study.title.trim();
}

async function runOsdr() {
  console.log('== OSDR cards');
  const file = 'osdr-cards.json';
  try {
    const searchCache = new Map();
    const cards = [];
    for (const c of OSDR_CARDS) {
      if (!searchCache.has(c.searchTerm)) searchCache.set(c.searchTerm, await osdrSearchAccessions(c.searchTerm));
      if (!searchCache.get(c.searchTerm).has(c.osdId)) {
        warn(`${c.osdId} is no longer in the top results for "${c.searchTerm}" (card kept: study still checked below)`);
      }
      const title = await osdrTitle(c.osdId);
      const url = `${OSDR_STUDY_PAGE}${c.osdId}`;
      const page = await httpGet(url, { method: 'HEAD', accept: 'text/html', timeoutMs: 60_000 });
      if (!page.ok) throw new Error(`${url} returned HTTP ${page.status}`);
      cards.push({ osdId: c.osdId, title, takeaway: c.takeaway, url, searchTerm: c.searchTerm, tieIn: c.tieIn });
    }
    const byTie = cards.reduce((m, c) => ((m[c.tieIn] = (m[c.tieIn] || 0) + 1), m), {});
    info(`${cards.length} cards verified ${JSON.stringify(byTie)}`);
    await writeSnapshot(file, cards);
  } catch (err) {
    await keepOld(file, err.message);
  }
}

// ---------------------------------------------------------------------------

const STEPS = { donki: runDonki, radlab: runRadlab, osdr: runOsdr };

async function main() {
  const onlyArg = process.argv.find((a) => a.startsWith('--only='));
  const selected = onlyArg ? onlyArg.slice('--only='.length).split(',').map((s) => s.trim()) : Object.keys(STEPS);
  for (const name of selected) {
    if (!STEPS[name]) {
      console.error(`unknown step "${name}" (use: ${Object.keys(STEPS).join(', ')})`);
      process.exit(2);
    }
  }
  for (const name of selected) await STEPS[name]();
  if (warnings.length) {
    console.warn(`\nFinished with ${warnings.length} warning(s); failed snapshots were left as they were.`);
    process.exitCode = 1;
  } else {
    console.log('\nAll snapshots updated.');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
