// Written with AI assistance (Claude Code). See README "Use of AI tools".
//
// Snapshot REAL Mars elevations from NASA Mars Trek for the 3D diorama's skyline.
//
//   node scripts/fetch-terrain.mjs                  Gale Crater (Curiosity's landing site) -> gale-terrain.json
//   node scripts/fetch-terrain.mjs --site=arcadia   Arcadia Planitia (the ice landing site) -> arcadia-terrain.json
//
// Node 22+, ESM, no dependencies (uses global fetch and a tiny built-in TIFF reader).
//
// Where the numbers come from
// ---------------------------
// Mars Trek's catalog lists the product "MGS MOLA and Mars Express HRSC, DEM"
// (layer Mars_MOLA_blend200ppx_HRSC_DEM_clon0dd_200mpp_lzw, 200 m/pixel, category Topography / DEM).
// Trek's WMTS map tiles are for display only: e.g. the MOLA DEM layer's tiles are 8-bit grayscale
// PNGs with an unknown contrast stretch, so they cannot give heights. But Mars Trek also serves the
// layer from its ArcGIS image services (https://trek.nasa.gov/mars/trekarcgis/rest/services), and
// there the pixels are the DEM itself: signed 16-bit elevations in meters (the service reports
// min -8528, max 21230). We ask that server's exportImage for a small Float32 GeoTIFF around
// Curiosity's landing site, read the raw floats, and store them as whole meters.
// Nothing is drawn, shaded or guessed.
//
// Writes src/data/snapshots/<site>-terrain.json:
//   heights: rows x cols numbers in meters, row-major, row 0 = northern edge, column 0 = western edge,
//            each value at a pixel center; the center pixel is the base site.
//
// Safety rule (same as fetch-data.mjs): the snapshot is only replaced when every check passes.

import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const USER_AGENT = 'escape-velocity-data-fetch/1.0 (NASA Space Apps 2026 student game)';

const LAYER = 'Mars_MOLA_blend200ppx_HRSC_DEM_clon0dd_200mpp_lzw';
const SERVICES = 'https://trek.nasa.gov/mars/trekarcgis/rest/services';
const SERVICE = `${SERVICES}/${LAYER}/ImageServer`;
// Mars Trek's product catalog entry for the same layer (title "MGS MOLA and Mars Express HRSC, DEM").
const CATALOG = `https://trek.nasa.gov/mars/TrekServices/ws/index/eq/searchItems?start=0&rows=5&facetKeys=itemType%7CproductLabel&facetValues=product%7C${LAYER}`;

// The sites (planetocentric, east-positive longitudes, 0-360).
const SITES = {
  // Bradbury Landing, where Curiosity touched down on Aug 6, 2012.
  gale: {
    file: 'gale-terrain.json',
    name: 'Bradbury Landing (Curiosity landing site)',
    lat: -4.5895,
    lon: 137.4417,
    sourceUrl: 'https://en.wikipedia.org/wiki/Bradbury_Landing',
    label: 'landing site',
  },
  // The center of Arcadia Planitia, from the IAU/USGS Gazetteer of Planetary Nomenclature (feature 348):
  // center latitude 46.66, center longitude 192.00 (planetocentric, +East, 0-360). NASA's SWIM project maps
  // likely shallow ice here (see scripts/fetch-swim.mjs).
  arcadia: {
    file: 'arcadia-terrain.json',
    name: 'Arcadia Planitia (center of the plain, IAU/USGS Gazetteer)',
    lat: 46.66,
    lon: 192.0,
    sourceUrl: 'https://planetarynames.wr.usgs.gov/Feature/348',
    label: 'base site',
  },
};
const siteArg = (process.argv.find((a) => a.startsWith('--site=')) ?? '--site=gale').slice('--site='.length);
const SITE = SITES[siteArg];
if (!SITE) throw new Error(`unknown --site=${siteArg} (choose ${Object.keys(SITES).join(' or ')})`);
const OUT = join(ROOT, 'src', 'data', 'snapshots', SITE.file);

// Grid: ROWS samples north-south, SPACING_KM apart (+-120 km), centered on the site.
// The image server only returns square pixels in degrees, so east-west spacing is SPACING_KM x cos(latitude):
// 2.99 km at Gale Crater, but only 2.06 km at Arcadia Planitia (46.66 N). So there are more columns than rows
// far from the equator, enough to reach about as far east and west as north and south. The spacing is recorded
// in the snapshot. (At Gale this gives 81 x 81, exactly as before.)
const SIZE = 81;
const ROWS = SIZE;
const COLS = 2 * Math.round((SIZE / Math.cos((SITE.lat * Math.PI) / 180) - 1) / 2) + 1; // odd, so the middle column is the site
const SPACING_KM = 3;
// Mars 2000 sphere radius used by the service's coordinate system (GCS_Mars_2000, 3,396,190 m).
const MARS_RADIUS_KM = 3396.19;
const SR = 104905; // ESRI wkid for GCS_Mars_2000 (the service's native coordinate system)

// ---------------------------------------------------------------------------

async function get(url, accept) {
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: accept }, signal: AbortSignal.timeout(90_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res;
}

/** Minimal baseline-TIFF reader: one band, uncompressed, 32-bit float, strips or tiles. */
function readFloatTiff(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const order = String.fromCharCode(bytes[0], bytes[1]);
  if (order !== 'II' && order !== 'MM') throw new Error('not a TIFF');
  const le = order === 'II';
  const u16 = (o) => dv.getUint16(o, le);
  const u32 = (o) => dv.getUint32(o, le);
  if (u16(2) !== 42) throw new Error('not a classic TIFF (BigTIFF is not supported)');
  const SIZES = { 1: 1, 2: 1, 3: 2, 4: 4, 11: 4, 12: 8 };
  const ifd = u32(4);
  const tags = {};
  for (let i = 0; i < u16(ifd); i++) {
    const e = ifd + 2 + i * 12;
    const tag = u16(e);
    const type = u16(e + 2);
    const count = u32(e + 4);
    const size = (SIZES[type] ?? 1) * count;
    const off = size <= 4 ? e + 8 : u32(e + 8);
    const vals = [];
    for (let k = 0; k < count; k++) {
      if (type === 3) vals.push(u16(off + k * 2));
      else if (type === 4) vals.push(u32(off + k * 4));
      else if (type === 12) vals.push(dv.getFloat64(off + k * 8, le));
      else if (type === 11) vals.push(dv.getFloat32(off + k * 4, le));
      else vals.push(bytes[off + k]);
    }
    tags[tag] = type === 2 ? String.fromCharCode(...vals).replace(/\0+$/, '') : vals;
  }
  const width = tags[256]?.[0];
  const height = tags[257]?.[0];
  if (tags[258]?.[0] !== 32) throw new Error(`expected 32-bit samples, got ${tags[258]}`);
  if (tags[339]?.[0] !== 3) throw new Error(`expected floating-point samples (SampleFormat 3), got ${tags[339]}`);
  if ((tags[259]?.[0] ?? 1) !== 1) throw new Error(`expected an uncompressed TIFF, got compression ${tags[259]}`);
  if ((tags[277]?.[0] ?? 1) !== 1) throw new Error('expected a single band');
  const px = new Float32Array(width * height);
  if (tags[322]) {
    const tw = tags[322][0];
    const th = tags[323][0];
    const offsets = tags[324];
    const across = Math.ceil(width / tw);
    for (let r = 0; r < height; r++)
      for (let c = 0; c < width; c++) {
        const t = Math.floor(r / th) * across + Math.floor(c / tw);
        px[r * width + c] = dv.getFloat32(offsets[t] + ((r % th) * tw + (c % tw)) * 4, le);
      }
  } else {
    const offsets = tags[273];
    const rps = tags[278]?.[0] ?? height;
    for (let r = 0; r < height; r++) {
      const s = Math.floor(r / rps);
      const base = offsets[s] + (r - s * rps) * width * 4;
      for (let c = 0; c < width; c++) px[r * width + c] = dv.getFloat32(base + c * 4, le);
    }
  }
  return {
    width,
    height,
    px,
    pixelScale: tags[33550] ?? null, // GeoTIFF ModelPixelScale (deg/pixel)
    tiepoint: tags[33922] ?? null, // GeoTIFF ModelTiepoint (pixel corner -> lon, lat)
    noData: tags[42113] != null ? Number(tags[42113]) : null, // GDAL_NODATA
    citation: typeof tags[34737] === 'string' ? tags[34737] : null,
  };
}

async function main() {
  // 1. Confirm Mars Trek still lists the product as a DEM, and still serves it as an image service.
  const cat = await (await get(CATALOG, 'application/json')).json();
  const item = (cat?.response?.docs ?? []).find((d) => d.productLabel === LAYER);
  if (!item || item.productCat2 !== 'DEM') throw new Error(`Mars Trek's catalog no longer lists ${LAYER} as a DEM`);
  const dir = await (await get(`${SERVICES}?f=json`, 'application/json')).json();
  if (!(dir?.services ?? []).some((s) => s.name === LAYER && s.type === 'ImageServer')) throw new Error(`Mars Trek no longer serves ${LAYER} as an ImageServer`);
  console.log(`      catalog: "${item.title}" (${item.productCat1} / ${item.productCat2})`);

  // 2. Confirm the service holds a single band of elevations.
  const meta = await (await get(`${SERVICE}?f=json`, 'application/json')).json();
  if (meta.bandCount !== 1 || !/^[SUF]\d+$/.test(meta.pixelType ?? '')) throw new Error(`unexpected service: ${meta.bandCount} bands, ${meta.pixelType}`);
  console.log(`      service ${meta.name}: ${meta.pixelType}, ${meta.pixelSizeX} deg/px, values ${meta.minValues} .. ${meta.maxValues}`);

  // 3. Ask for the grid. Pixel-is-area: the bbox spans COLS x ROWS whole pixels, so pixel centers are
  //    a whole number of pixels apart and the middle pixel sits on the site.
  //    The image server's longitudes run from -180 to 180, so 192 E is asked for as -168.
  const kmPerDegLat = (Math.PI / 180) * MARS_RADIUS_KM;
  const kmPerDegLon = kmPerDegLat * Math.cos((SITE.lat * Math.PI) / 180);
  const degPerPx = SPACING_KM / kmPerDegLat;
  const halfLat = (ROWS * degPerPx) / 2;
  const halfLon = (COLS * degPerPx) / 2;
  const lon = SITE.lon > 180 ? SITE.lon - 360 : SITE.lon;
  const bounds = { west: lon - halfLon, east: lon + halfLon, south: SITE.lat - halfLat, north: SITE.lat + halfLat };
  const spacingKm = { northSouth: SPACING_KM, eastWest: Number(((2 * halfLon * kmPerDegLon) / COLS).toFixed(4)) };
  const round = (v) => Number(v.toFixed(6));
  const bbox = [bounds.west, bounds.south, bounds.east, bounds.north].map(round).join(',');
  const exportUrl =
    `${SERVICE}/exportImage?bbox=${bbox}&bboxSR=${SR}&imageSR=${SR}&size=${COLS},${ROWS}` +
    `&format=tiff&pixelType=F32&interpolation=RSP_BilinearInterpolation&f=image`;
  const res = await get(exportUrl, 'image/tiff');
  const type = res.headers.get('content-type') ?? '';
  if (!type.includes('tiff')) throw new Error(`expected a TIFF, got ${type}`);
  const tif = readFloatTiff(new Uint8Array(await res.arrayBuffer()));
  if (tif.width !== COLS || tif.height !== ROWS) throw new Error(`asked for ${COLS}x${ROWS}, got ${tif.width}x${tif.height}`);

  // 4. Check the georeferencing matches what we asked for.
  const degLon = (bounds.east - bounds.west) / COLS;
  const degLat = (bounds.north - bounds.south) / ROWS;
  if (tif.pixelScale && (Math.abs(tif.pixelScale[0] - degLon) > 1e-4 || Math.abs(tif.pixelScale[1] - degLat) > 1e-4))
    throw new Error(`pixel scale ${tif.pixelScale} does not match the request (${degLon}, ${degLat})`);
  if (tif.tiepoint && (Math.abs(tif.tiepoint[3] - bounds.west) > 1e-3 || Math.abs(tif.tiepoint[4] - bounds.north) > 1e-3))
    throw new Error(`tie point ${tif.tiepoint} does not match the requested north-west corner`);

  // 5. Sanity-check every value: real Mars elevations, no holes.
  const heights = [];
  let min = Infinity;
  let max = -Infinity;
  for (const v of tif.px) {
    if (!Number.isFinite(v) || (tif.noData !== null && v === tif.noData) || v < -9000 || v > 22000) throw new Error(`bad elevation value ${v}`);
    const m = Math.round(v);
    heights.push(m);
    min = Math.min(min, m);
    max = Math.max(max, m);
  }
  const center = heights[((ROWS - 1) / 2) * COLS + (COLS - 1) / 2];

  // 6. Cross-check the site at full resolution (the grid above is resampled).
  let siteFullRes = null;
  try {
    const idUrl = `${SERVICE}/identify?geometry=${encodeURIComponent(JSON.stringify({ x: lon, y: SITE.lat, spatialReference: { wkid: SR } }))}&geometryType=esriGeometryPoint&returnGeometry=false&returnCatalogItems=false&f=json`;
    const id = await (await get(idUrl, 'application/json')).json();
    const v = Number(id?.value);
    if (Number.isFinite(v)) siteFullRes = v;
  } catch (e) {
    console.warn(`WARN  full-resolution check at the ${SITE.label} failed: ${e.message}`);
  }
  const siteInfo = { name: SITE.name, lat: SITE.lat, lon: SITE.lon, sourceUrl: SITE.sourceUrl };

  const data = {
    source: 'NASA Mars Trek (NASA/JPL Solar System Treks), ArcGIS image service for the Mars Trek DEM layer',
    sourceUrls: [exportUrl, `${SERVICE}?f=json`, CATALOG, 'https://trek.nasa.gov/mars/'],
    catalogTitle: item.title,
    product: 'MGS MOLA and Mars Express HRSC, DEM (blended, 200 m/pixel)',
    productLayer: LAYER,
    productInfoUrl: 'https://astrogeology.usgs.gov/search/map/mars_mgs_mola_mex_hrsc_blended_dem_global_200m',
    encodes: 'Elevation in meters (the service stores signed 16-bit meters; we asked for 32-bit floats and rounded to whole meters). These are real heights, not shaded-relief colors.',
    fetchedAt: new Date().toISOString(),
    center: { ...siteInfo, elevationM: center, elevationFullResM: siteFullRes },
    bounds: Object.fromEntries(Object.entries(bounds).map(([k, v]) => [k, round(v)])),
    size: { cols: COLS, rows: ROWS },
    spacingKm,
    order: `row-major; row 0 = northern edge, column 0 = western edge; values at pixel centers; the middle sample is the ${SITE.label}`,
    units: 'm',
    range: { min, max },
    heights,
    notes:
      `A ${COLS} x ${ROWS} grid, ${spacingKm.northSouth} km apart north-south and ${spacingKm.eastWest} km east-west (about ${(ROWS - 1) * SPACING_KM} km across), resampled from the 200 m DEM by the Mars Trek image server (bilinear). ` +
      `Degrees were converted to km on the Mars 2000 sphere (radius 3,396.19 km) with a flat (equirectangular) approximation around the ${SITE.label}. ` +
      (lon !== SITE.lon ? `Bounds use the image server's -180..180 east longitudes (${SITE.lon} E = ${lon}). ` : '') +
      `The game uses only height differences from the ${SITE.label}. In the diorama the landscape is shrunk to 1 scene unit per km (the base itself is not to scale), ` +
      `heights are exaggerated (see src/render/${siteArg}.ts), and the ground right around the base is flattened for the buildings.`,
  };

  await mkdir(dirname(OUT), { recursive: true });
  const tmp = `${OUT}.tmp`;
  await writeFile(tmp, `${JSON.stringify(data, null, 1).replace(/\n\s+(-?\d+)(?=,|\n)/g, ' $1')}\n`, 'utf8');
  await rename(tmp, OUT);
  console.log(`      wrote src/data/snapshots/${SITE.file}: ${COLS}x${ROWS}, ${min} .. ${max} m, ${SITE.label} ${center} m (full res ${siteFullRes ?? 'n/a'} m)`);
}

main().catch((e) => {
  console.warn(`WARN  ${SITE.file}: ${e.message} -> kept the existing snapshot unchanged`);
  process.exitCode = 1;
});
