// Collar conversion between the catalog's NAD27, NAD83 and WGS84 CRSs, loaded
// only when an import chooses to convert. NAD27↔NAD83 uses the national grid
// shift (public/grids, built by scripts/build-datum-grids.mjs) for the
// property's country; without one it falls back to a regional 3-parameter
// shift that the user must acknowledge. Every row records how it was moved.
import proj4 from 'proj4';
import { version } from 'proj4/package.json';
import { CA_PROVINCES } from './jurisdictions';
import { sourceCrs } from './drillCoordinates';

const NRCAN = 'NRCan NTV2_0, Open Government Licence – Canada', NOAA = 'NOAA NADCON, public domain';
// Node extents (NAD27 degrees, [west, south, east, north]) and sha256 of each file.
export const DATUM_GRIDS = {
  ca_nrc_ntv2_0_west: { bbox: [-142, 47, -88, 60], source: NRCAN, sha256: 'f064198f4120dfa024bd0c8061c81a0326f3d5e2a26d7251c7974016fc6648f3' },
  ca_nrc_ntv2_0_east: { bbox: [-88, 40, -44, 60], source: NRCAN, sha256: 'f8305543a3643241dc966b8b5802215562b6e14dcb90b76ad6764e7bf5958887' },
  ca_nrc_ntv2_0_north: { bbox: [-142, 60, -44, 75], source: NRCAN, sha256: '1fc947ea6817b87234784cb94a9ed3eac43aeba0b4e1655e540fce53172f6025' },
  ca_nrc_ntv2_0_arctic: { bbox: [-142, 75, -44, 84], source: NRCAN, sha256: 'e0b0056c447c6665a70f87a63a7f4a2dc5b85229fc401ebb597fba5788645a79' },
  us_noaa_conus: { bbox: [-131, 20, -63, 50], source: NOAA, sha256: '68b1b15c1a997e64c65f722e61caff27ae29cad11182b6d0cd6751eff36a1364' },
  us_noaa_alaska: { bbox: [-194, 46, -128, 77], source: NOAA, sha256: '967552a1a4eb969fd9ecb940d1083e391c3cc3c9506df72e09ef48f555f5a8e4' },
};
// NIMA TR8350.2 regional mean NAD27→WGS84 shifts (metres). Compared with the
// grids on a 0.3° lattice over their coverage they differ by up to 47 m.
const HELMERT = { ca: '-10,158,187', ak: '-5,135,172', us: '-8,160,176' };
export const HELMERT_ERROR_M = 50, NULL_ERROR_M = 2;
const LIBRARY = `proj4js ${version}`;
const CANADA = new Set(CA_PROVINCES.map(p => p.value));
const region = (j) => (CANADA.has(j) ? 'ca' : j === 'us-ak' ? 'ak' : /^us-/.test(j || '') ? 'us' : null);
const regionGrids = { ca: ['ca_nrc_ntv2_0_west', 'ca_nrc_ntv2_0_east', 'ca_nrc_ntv2_0_north', 'ca_nrc_ntv2_0_arctic'], ak: ['us_noaa_alaska'], us: ['us_noaa_conus'] };
const inside = ([w, s, e, n], [lon, lat]) => lat >= s && lat <= n && [lon, lon - 360].some(x => x >= w && x <= e);

const loaded = new Map();
export function loadGrid(key, get = (url) => fetch(url)) {
  if (!loaded.has(key)) loaded.set(key, (async () => {
    const res = await get(`/grids/${key}.gsb`);
    if (!res.ok) throw new Error(`The ${key} grid could not be loaded.`);
    const buf = await res.arrayBuffer();
    const hex = [...new Uint8Array(await crypto.subtle.digest('SHA-256', buf))].map(b => b.toString(16).padStart(2, '0')).join('');
    if (hex !== DATUM_GRIDS[key].sha256) throw new Error(`The ${key} grid did not match its checksum.`);
    // proj4js uses the first subgrid that holds a point; NTv2 lists parents first.
    proj4.nadgrid(key, buf).subgrids.reverse();
    return key;
  })().catch(e => { loaded.delete(key); throw e; }));
  return loaded.get(key);
}

const def = (c, datum) => `${c.geographic ? '+proj=longlat' : `+proj=utm +zone=${c.zone}${c.south ? ' +south' : ''} +units=m`} +ellps=${c.ellipsoid} ${datum} +no_defs`;
const round = (c, v) => (c.geographic ? Math.round(v * 1e9) / 1e9 : Math.round(v * 1000) / 1000);

/** Converts collar rows from one catalog CRS to another; originals go to x_src/y_src/crs_src. */
export async function convertCollars(rows, from, to, { jurisdiction = null, get } = {}) {
  const a = sourceCrs(from), b = sourceCrs(to);
  if (!a || !b || a.code === b.code) throw new Error('Conversion needs two different coordinate systems from the preset catalog.');
  const nad27 = a.datum === 'NAD27' ? a : b.datum === 'NAD27' ? b : null;
  const viaNull = a.datum !== b.datum && (a.datum === 'WGS84' || b.datum === 'WGS84');
  const reg = region(jurisdiction);
  const geo = (r) => proj4(def(a, '+datum=none'), `+proj=longlat +ellps=${a.ellipsoid} +datum=none +no_defs`, [r.x, r.y]);
  const points = rows.map(r => { try { return geo(r); } catch { return [NaN, NaN]; } });
  const grids = [], unavailable = [];
  if (nad27 && a.datum !== b.datum && reg) {
    for (const key of regionGrids[reg].filter(k => points.some(p => inside(DATUM_GRIDS[k].bbox, p)))) {
      try { grids.push(await loadGrid(key, get)); } catch (e) { unavailable.push(e.message); }
    }
  }
  const other = a.datum === b.datum ? '+datum=none' : '+towgs84=0,0,0';
  const helmert = `+towgs84=${HELMERT[reg || 'us']}`;
  const run = (datum27, r) => proj4(def(a, a.datum === 'NAD27' ? datum27 : other), def(b, b.datum === 'NAD27' ? datum27 : other), [r.x, r.y]);
  const counts = { projection: 0, grid: 0, helmert: 0, null: 0 }, failed = [], outside = [];
  const out = rows.map((r, i) => {
    let xy = null, transform;
    const ok = (p) => p && Number.isFinite(p[0]) && Number.isFinite(p[1]);
    const usable = grids.filter(k => inside(DATUM_GRIDS[k].bbox, points[i]));
    if (a.datum === b.datum) { xy = run('+datum=none', r); transform = { method: 'projection' }; }
    else if (!nad27) { xy = run(null, r); transform = { method: 'null', note: 'NAD83 taken as WGS84 (proj4 default)', expected_error_m: NULL_ERROR_M }; }
    else {
      if (usable.length) {
        try { xy = run(`+nadgrids=${usable.map(k => `@${k}`).join(',')}`, r); } catch { xy = null; }
        if (ok(xy)) transform = { method: viaNull ? 'grid+null' : 'grid', grid: usable.map(k => `${k}.gsb`).join(','), source: DATUM_GRIDS[usable[0]].source,
          sha256: usable.map(k => DATUM_GRIDS[k].sha256).join(','), ...(viaNull ? { note: 'grid to NAD83, then NAD83 taken as WGS84', expected_error_m: NULL_ERROR_M } : {}) };
      }
      if (!transform) {
        if (grids.length || reg) outside.push(r.hole_id);
        xy = run(helmert, r);
        transform = { method: 'helmert', params: helmert.slice(9), note: 'NIMA TR8350.2 regional mean; no grid shift', expected_error_m: HELMERT_ERROR_M };
      }
    }
    if (!ok(xy)) { failed.push(r.hole_id); return null; }
    counts[transform.method.split('+')[0]]++;
    return { ...r, x: round(b, xy[0]), y: round(b, xy[1]), crs: b.code, x_src: r.x, y_src: r.y, crs_src: a.code, transform: { ...transform, from: a.code, to: b.code, library: LIBRARY } };
  });
  const expected = Math.max(0, ...out.filter(Boolean).map(r => r.transform.expected_error_m || 0));
  return { rows: failed.length ? null : out, failed, outside, unavailable, counts, grids: grids.filter(k => out.some(r => r?.transform.grid?.split(',').includes(`${k}.gsb`))),
    expectedErrorM: expected, needsAck: expected > 0, region: reg };
}
