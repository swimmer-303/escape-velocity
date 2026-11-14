// Written with AI assistance (Claude Code). See README "Use of AI tools".
//
// Snapshot REAL subsurface-ice map values from NASA's Subsurface Water Ice Mapping (SWIM) project for the
// game's ice landing site (Arcadia Planitia), with Gale Crater for comparison.
//
//   node scripts/fetch-swim.mjs
//
// Node 22+, ESM, no dependencies (global fetch, HTTP range requests, a tiny built-in TIFF reader).
//
// Where the numbers come from
// ---------------------------
// SWIM (https://swim.psi.edu/) is run by the Planetary Science Institute for NASA's Mars Exploration Program
// (funded through JPL). Its maps combine orbital data from Mars Odyssey (neutrons), Mars Global Surveyor and
// Mars Odyssey (thermal), and Mars Reconnaissance Orbiter (SHARAD radar, CTX/HiRISE landforms) into an
// "ice consistency" C_I from -1 to +1:
//   "-1 indicates that a given measurement is inconsistent with the presence of ice ... a +1 indicates that the
//    measurement is consistent with the presence of ice. A value of 0 means these data are inconclusive or are
//    absent altogether." (https://swim.psi.edu/about.php?section=overview)
// The SWIM 2.0 global products are public GeoTIFFs (https://swim.psi.edu/SWIM2Products.php), 32-bit floats on
// the Mars 2000 sphere (equirectangular, 0.05 degrees per pixel, 60 S to 60 N), stored in 128 x 128 tiles.
// Each file is about 70 MB, so we read only the header and the few tiles we need, with HTTP range requests.
// Nothing is drawn, smoothed or guessed: the snapshot stores the map's own values.
//
// Writes src/data/snapshots/swim-ice.json. Safety rule (same as the other fetch scripts): the snapshot is only
// replaced when every request and check succeeds.

import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'src', 'data', 'snapshots', 'swim-ice.json');
const USER_AGENT = 'escape-velocity-data-fetch/1.0 (NASA Space Apps 2026 student game)';

const PAGE = 'https://swim.psi.edu/SWIM2Products.php';
const ABOUT = 'https://swim.psi.edu/about.php?section=overview';
const BASE = 'https://swim.psi.edu/output/SWIM2/Global/Composite/';
// Product titles and depth zones as the SWIM 2.0 products page names them.
const PRODUCTS = [
  { id: 'c0_1', file: 'SWIM2_c0_1.tif', title: 'Combined Ice Consistency (0-1 meters)', depth: '0 to 1 m' },
  { id: 'c1_5', file: 'SWIM2_c1_5.tif', title: 'Combined Ice Consistency (1-5 meters)', depth: '1 to 5 m' },
  { id: 'c5', file: 'SWIM2_c_5.tif', title: 'Combined Ice Consistency (>5 meters)', depth: 'deeper than 5 m' },
];

// Planetocentric, east-positive longitudes (0-360).
const SITES = {
  arcadia: {
    name: 'Arcadia Planitia (center of the plain)',
    lat: 46.66,
    lon: 192.0,
    sourceUrl: 'https://planetarynames.wr.usgs.gov/Feature/348',
    sourceNote: 'IAU/USGS Gazetteer of Planetary Nomenclature, feature 348: center latitude 46.66, center longitude 192.00 (planetocentric, +East, 0-360)',
  },
  gale: {
    name: 'Gale Crater (Bradbury Landing, Curiosity landing site)',
    lat: -4.5895,
    lon: 137.4417,
    sourceUrl: 'https://en.wikipedia.org/wiki/Bradbury_Landing',
    sourceNote: 'Same coordinates as src/data/snapshots/gale-terrain.json',
  },
};
// Average over a box of +-WINDOW pixels around each site (0.05 degrees per pixel: +-0.5 degrees, about +-30 km north-south).
const WINDOW = 10;
// A north-south profile along the Arcadia site's longitude: the ice-versus-sunlight trade-off, in real data.
const PROFILE_LATS = [36, 38, 40, 42, 44, 46, 48, 50, 52, 54, 56];

// ---------------------------------------------------------------------------

async function get(url, headers = {}, tries = 3) {
  for (let i = 1; ; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, ...headers }, signal: AbortSignal.timeout(90_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return res;
    } catch (e) {
      if (i >= tries) throw e;
      await new Promise((r) => setTimeout(r, 1500 * i));
    }
  }
}

/** Bytes [start, start + length) of a remote file. */
async function range(url, start, length) {
  const res = await get(url, { Range: `bytes=${start}-${start + length - 1}` });
  if (res.status !== 206) throw new Error(`expected a partial response (206) for ${url}, got ${res.status}`);
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.length !== length) throw new Error(`asked for ${length} bytes of ${url}, got ${buf.length}`);
  return { buf, lastModified: res.headers.get('last-modified') };
}

/** Open a remote tiled float GeoTIFF: read its tags, then fetch tiles on demand. */
async function openTiff(url) {
  const head = await range(url, 0, 8);
  const order = String.fromCharCode(head.buf[0], head.buf[1]);
  if (order !== 'II' && order !== 'MM') throw new Error('not a TIFF');
  const le = order === 'II';
  const hdv = new DataView(head.buf.buffer);
  if (hdv.getUint16(2, le) !== 42) throw new Error('not a classic TIFF');
  const ifd = hdv.getUint32(4, le);
  const nTags = new DataView((await range(url, ifd, 2)).buf.buffer).getUint16(0, le);
  const dir = new DataView((await range(url, ifd + 2, nTags * 12)).buf.buffer);
  const SIZES = { 1: 1, 2: 1, 3: 2, 4: 4, 11: 4, 12: 8 };
  const tags = {};
  for (let i = 0; i < nTags; i++) {
    const e = i * 12;
    const tag = dir.getUint16(e, le);
    const type = dir.getUint16(e + 2, le);
    const count = dir.getUint32(e + 4, le);
    const size = (SIZES[type] ?? 1) * count;
    let dv;
    let base = 0;
    if (size <= 4) {
      dv = dir;
      base = e + 8;
    } else {
      dv = new DataView((await range(url, dir.getUint32(e + 8, le), size)).buf.buffer);
    }
    const vals = [];
    for (let k = 0; k < count; k++) {
      if (type === 3) vals.push(dv.getUint16(base + k * 2, le));
      else if (type === 4) vals.push(dv.getUint32(base + k * 4, le));
      else if (type === 12) vals.push(dv.getFloat64(base + k * 8, le));
      else if (type === 11) vals.push(dv.getFloat32(base + k * 4, le));
      else vals.push(dv.getUint8(base + k));
    }
    tags[tag] = type === 2 ? String.fromCharCode(...vals).replace(/\0+$/, '') : vals;
  }
  const width = tags[256]?.[0];
  const height = tags[257]?.[0];
  if (tags[258]?.[0] !== 32 || tags[339]?.[0] !== 3) throw new Error('expected 32-bit floating-point samples');
  if ((tags[259]?.[0] ?? 1) !== 1) throw new Error(`expected an uncompressed TIFF, got compression ${tags[259]}`);
  if ((tags[277]?.[0] ?? 1) !== 1) throw new Error('expected a single band');
  if (!tags[322] || !tags[324]) throw new Error('expected a tiled TIFF');
  const citation = typeof tags[34737] === 'string' ? tags[34737] : '';
  if (!/Mars_?2000/i.test(citation) || !/Plate_Carree|equicylindrical/i.test(citation)) throw new Error(`unexpected projection: ${citation.slice(0, 120)}`);
  const radius = Number(/SPHEROID\["[^"]*",([\d.]+)/.exec(citation)?.[1]);
  if (!(radius > 3.3e6 && radius < 3.5e6)) throw new Error(`unexpected Mars radius ${radius}`);
  const [sx, sy] = tags[33550];
  if (Math.abs(sx - sy) > 1e-6) throw new Error('expected square pixels');
  const [, , , x0, y0] = tags[33922];
  const noData = tags[42113] != null ? Number(tags[42113]) : null;
  const tw = tags[322][0];
  const th = tags[323][0];
  const offsets = tags[324];
  const across = Math.ceil(width / tw);
  const tiles = new Map();
  const deg = Math.PI / 180;
  let lastModified = head.lastModified;
  async function tile(t) {
    if (!tiles.has(t)) {
      const r = await range(url, offsets[t], tw * th * 4);
      lastModified = r.lastModified ?? lastModified;
      tiles.set(t, new DataView(r.buf.buffer));
    }
    return tiles.get(t);
  }
  /** Pixel (row, col) holding a planetocentric lat/lon (east-positive). */
  function rowCol(lat, lon) {
    const L = lon > 180 ? lon - 360 : lon;
    return [Math.floor((y0 - lat * deg * radius) / sy), Math.floor((L * deg * radius - x0) / sx)];
  }
  async function value(r, c) {
    if (r < 0 || c < 0 || r >= height || c >= width) return null;
    const dv = await tile(Math.floor(r / th) * across + Math.floor(c / tw));
    const v = dv.getFloat32(((r % th) * tw + (c % tw)) * 4, le);
    return !Number.isFinite(v) || (noData !== null && v === noData) ? null : v;
  }
  return {
    width,
    height,
    degPerPixel: sx / radius / deg,
    northEdge: y0 / radius / deg,
    westEdge: x0 / radius / deg,
    radius,
    noData,
    rowCol,
    value,
    get lastModified() {
      return lastModified;
    },
  };
}

const r3 = (v) => (v === null ? null : Math.round(v * 1000) / 1000);

async function sampleSite(map, site) {
  const [r0, c0] = map.rowCol(site.lat, site.lon);
  const center = await map.value(r0, c0);
  const vals = [];
  for (let r = r0 - WINDOW; r <= r0 + WINDOW; r++) for (let c = c0 - WINDOW; c <= c0 + WINDOW; c++) {
    const v = await map.value(r, c);
    if (v !== null) vals.push(v);
  }
  for (const v of [center, ...vals]) if (v !== null && (v < -1.0001 || v > 1.0001)) throw new Error(`ice consistency ${v} is outside -1..1`);
  if (!vals.length) return { center: r3(center), mean: null, min: null, max: null, pixels: 0 };
  return {
    center: r3(center),
    mean: r3(vals.reduce((a, b) => a + b, 0) / vals.length),
    min: r3(Math.min(...vals)),
    max: r3(Math.max(...vals)),
    pixels: vals.length,
  };
}

async function main() {
  // 1. The products page must still offer these files under these titles.
  const page = await (await get(PAGE)).text();
  for (const p of PRODUCTS) {
    if (!page.includes(p.title)) throw new Error(`the SWIM 2.0 products page no longer lists "${p.title}"`);
  }
  const about = await (await get(ABOUT)).text();
  if (!/ice consistency/i.test(about) || !/-1 to \+1/.test(about)) throw new Error('the SWIM overview no longer defines ice consistency from -1 to +1');

  const products = [];
  const sites = Object.fromEntries(Object.entries(SITES).map(([id, s]) => [id, { ...s, values: {} }]));
  let profile = null;
  for (const p of PRODUCTS) {
    const url = BASE + p.file;
    const map = await openTiff(url);
    if (map.width !== 7200 || map.height !== 2400) throw new Error(`${p.file}: unexpected size ${map.width} x ${map.height}`);
    console.log(`      ${p.file}: ${map.width} x ${map.height}, ${map.degPerPixel.toFixed(5)} deg/px, north edge ${map.northEdge.toFixed(3)}, west edge ${map.westEdge.toFixed(3)}`);
    for (const [id, s] of Object.entries(SITES)) {
      sites[id].values[p.id] = await sampleSite(map, s);
      console.log(`      ${id.padEnd(8)} ${p.id.padEnd(5)} ${JSON.stringify(sites[id].values[p.id])}`);
    }
    if (p.id === 'c0_1') {
      profile = { product: p.id, lonE: SITES.arcadia.lon, windowDeg: WINDOW * 0.05, points: [] };
      for (const lat of PROFILE_LATS) profile.points.push({ lat, ...(await sampleSite(map, { lat, lon: SITES.arcadia.lon })) });
    }
    products.push({ ...p, url, lastModified: map.lastModified, degPerPixel: Number(map.degPerPixel.toFixed(6)), noData: map.noData });
  }
  if (sites.arcadia.values.c0_1.center === null) throw new Error('no SWIM value at the Arcadia site');

  const data = {
    source: 'Subsurface Water Ice Mapping (SWIM) on Mars, SWIM 2.0 global products. Planetary Science Institute, for NASA\'s Mars Exploration Program (funded through JPL).',
    sourceUrls: [PAGE, ABOUT, ...products.map((p) => p.url)],
    paper: {
      citation: 'Morgan, G.A., Putzig, N.E., Perry, M.R., et al., 2021, Availability of subsurface water-ice resources in the northern mid-latitudes of Mars: Nature Astronomy, v. 5, p. 230-236',
      doi: 'https://doi.org/10.1038/s41550-020-01290-z',
      abstractUrl: 'https://pubs.usgs.gov/publication/70226786',
    },
    scale:
      'Ice consistency C_I, from -1 to +1. -1: the orbital data are inconsistent with ice. +1: consistent with ice. 0: inconclusive, or no data. It is a measure of agreement between independent datasets, not a probability and not an amount of ice.',
    fetchedAt: new Date().toISOString(),
    products,
    windowDeg: WINDOW * 0.05,
    sites,
    profile,
    notes:
      'Each site value is the map pixel holding the coordinates (center) plus the mean, min and max over a box of +-' +
      `${WINDOW * 0.05} degrees around it (no-data pixels skipped). The profile runs north-south along the Arcadia site's longitude, each point the mean of the same-size box. ` +
      'SWIM does not choose landing sites; the Arcadia point is the center of the named plain, picked by the game. Read with HTTP range requests from the full-resolution GeoTIFFs; values rounded to 3 decimals.',
  };

  await mkdir(dirname(OUT), { recursive: true });
  const tmp = `${OUT}.tmp`;
  await writeFile(tmp, `${JSON.stringify(data, null, 1)}\n`, 'utf8');
  await rename(tmp, OUT);
  console.log(`      wrote src/data/snapshots/swim-ice.json: Arcadia 0-1 m ${sites.arcadia.values.c0_1.center}, Gale 0-1 m ${sites.gale.values.c0_1.center}`);
}

main().catch((e) => {
  console.warn(`WARN  swim-ice.json: ${e.message} -> kept the existing snapshot unchanged`);
  process.exitCode = 1;
});
