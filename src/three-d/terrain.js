// Exploration Maps 3D: real terrain. The coordinate systems the page knows, the projection to longitude and
// latitude (proj4, loaded with the first projected system), and the DEM and satellite tile mosaics.
// Loaded by studio.js when a coordinate system is set or real terrain is wanted, and by the map inset
// (tags.js); the scene keeps what it draws synchronously (the surface, the drape, the credits).
//
// Tiles load as <img crossOrigin="anonymous">, not fetch(): the page's CSP allows https images but not
// these hosts in connect-src. A tile refused by CORS never loads at all, so the mosaic canvas is never
// tainted and exports keep working; missing tiles just leave gaps that fall back to the fitted surface.
const DEM_URL = (z, x, y) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;
export const IMG_URL = (z, x, y) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;
let P4 = null;           // proj4, loaded on first use
const UTM_FAMILIES = [   // [first EPSG code, last, first zone, south, datum, label]
  [32601, 32660, 1, false, '+datum=WGS84', 'WGS 84'], [32701, 32760, 1, true, '+datum=WGS84', 'WGS 84'],
  [26901, 26923, 1, false, '+ellps=GRS80 +towgs84=0,0,0,0,0,0,0', 'NAD83'], [26703, 26722, 3, false, '+ellps=clrk66 +towgs84=-8,160,176,0,0,0,0', 'NAD27'],
  [25828, 25838, 28, false, '+ellps=GRS80 +towgs84=0,0,0,0,0,0,0', 'ETRS89'], [28349, 28356, 49, true, '+ellps=GRS80 +towgs84=0,0,0,0,0,0,0', 'GDA94 MGA'],
  [7846, 7859, 46, true, '+ellps=GRS80 +towgs84=0,0,0,0,0,0,0', 'GDA2020 MGA'], [31965, 31976, 11, false, '+ellps=GRS80 +towgs84=0,0,0,0,0,0,0', 'SIRGAS 2000'],
  [31977, 31985, 17, true, '+ellps=GRS80 +towgs84=0,0,0,0,0,0,0', 'SIRGAS 2000'], [24817, 24821, 17, false, '+ellps=intl +towgs84=-288,175,-376,0,0,0,0', 'PSAD56'],
  [24877, 24881, 17, true, '+ellps=intl +towgs84=-288,175,-376,0,0,0,0', 'PSAD56'],
];
const DATUM_WORDS = [[/nad\s*83/i, 26901], [/nad\s*27/i, 26703], [/etrs/i, 25828], [/gda\s*2020/i, 7846], [/gda|mga/i, 28349], [/sirgas/i, 31965], [/psad/i, 24817]];
// "EPSG:26909", 26909, "UTM 9N", "NAD83 / UTM zone 9N", "WGS84 UTM 19S", "EPSG:4326" or a proj4 string.
// latlon: the page's description of WGS 84 latitude/longitude (studio.js LATLON), returned for EPSG:4326.
export function parseCRS(input, latlon) {
  const t = String(input).trim(), utm = (zone, south, fam) => ({ def: `+proj=utm +zone=${zone}${south ? ' +south' : ''} ${fam[4]} +units=m +no_defs`, label: `${fam[5]} / UTM ${zone}${south ? 'S' : 'N'}`, utm: true });
  if (/^\+proj=/.test(t)) return { code: t, label: 'Custom (proj4)', def: t, utm: /utm/.test(t) };
  const m = t.match(/^(?:epsg:\s*)?(\d{4,5})$/i);
  if (m) {
    const n = +m[1]; if (n === 4326) return { ...latlon };
    const fam = UTM_FAMILIES.find((f) => n >= f[0] && n <= f[1]);
    if (!fam) throw new Error(`EPSG:${n} is not supported here. Use a UTM code (e.g. EPSG:326xx, 327xx, 269xx, 258xx, 283xx), "UTM 9N", EPSG:4326 or a proj4 string.`);
    return { code: `EPSG:${n}`, ...utm(fam[2] + n - fam[0], fam[3], fam) };
  }
  const u = t.match(/utm\s*(?:zone\s*)?(\d{1,2})\s*([ns])?\b/i);
  if (u) {
    const zone = +u[1], south = /s/i.test(u[2] || '') || /south/i.test(t); if (zone < 1 || zone > 60) throw new Error('UTM zones run from 1 to 60.');
    const hit = DATUM_WORDS.find(([re]) => re.test(t)), name = hit ? UTM_FAMILIES.find((f) => f[0] === hit[1])[5] : 'WGS 84';
    const fam = UTM_FAMILIES.find((f) => f[5] === name && f[3] === south && zone >= f[2] && zone <= f[2] + f[1] - f[0]);
    return fam ? { code: `EPSG:${fam[0] + zone - fam[2]}`, ...utm(zone, south, fam) } : { code: `UTM ${zone}${south ? 'S' : 'N'} ${name}`, ...utm(zone, south, UTM_FAMILIES.find((f) => f[5] === name)) };
  }
  if (/^(wgs\s*84|lat.?lon|latitude|geographic)/i.test(t)) return { ...latlon };
  throw new Error(`"${t}" is not a coordinate system this page knows. Try "EPSG:26909", "UTM 9N NAD83" or "EPSG:4326".`);
}
// proj4 for a projected system, fetched once.
export async function ready(c) { if (!c.latlon && !P4) P4 = (await import('proj4')).default; }
// The forward transform of a projected system from project metres to [lon, lat]; checked against the collars
// (P: the project). studio.js geoFor handles latitude/longitude itself.
export function projFwd(c, P) {
  const f = P4(c.def, 'WGS84'), fwd = (x, y) => f.forward([x, y]);
  const h = P?.holes?.[0];
  if (h) {
    if (c.utm && (h.c.x < 100000 || h.c.x > 900000 || h.c.y < 0 || h.c.y > 10000000)) throw new Error(`Collar ${h.id} at ${Math.round(h.c.x)} E, ${Math.round(h.c.y)} N is not a UTM coordinate. Check the easting and northing columns.`);
    const [lon, lat] = fwd(h.c.x, h.c.y); if (!Number.isFinite(lon) || !Number.isFinite(lat) || Math.abs(lat) > 84) throw new Error(`${c.label} puts collar ${h.id} off the map. Check the zone and hemisphere.`);
  }
  return fwd;
}
// The inverse, [lon, lat] to the system's metres (map overlays in latitude/longitude, overlays.js).
export function projInv(c) { const f = P4(c.def, 'WGS84'); return (lon, lat) => f.inverse([lon, lat]); }
export const lon2t = (lon, z) => (lon + 180) / 360 * 2 ** z;
export const lat2t = (lat, z) => { const r = lat * Math.PI / 180; return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * 2 ** z; };
// (x, y) -> [a, b] for a smooth transform, interpolated from a (n+1)² lattice over the box:
// exact to well under a pixel over a few kilometres, and thousands of times cheaper than proj4 per texel.
function lattice(B, fn, n = 16) {
  const A = new Float64Array((n + 1) * (n + 1) * 2), w = B.x1 - B.x0, h = B.y1 - B.y0;
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) { const [a, b] = fn(B.x0 + w * i / n, B.y0 + h * j / n), k = (j * (n + 1) + i) * 2; A[k] = a; A[k + 1] = b; }
  const at = (x, y) => {
    const fi = Math.max(0, Math.min(n - 1e-9, (x - B.x0) / w * n)), fj = Math.max(0, Math.min(n - 1e-9, (y - B.y0) / h * n)), i = Math.floor(fi), j = Math.floor(fj), a = fi - i, b = fj - j, r = n + 1;
    const k00 = (j * r + i) * 2, k10 = k00 + 2, k01 = k00 + r * 2, k11 = k01 + 2, w00 = (1 - a) * (1 - b), w10 = a * (1 - b), w01 = (1 - a) * b, w11 = a * b;
    return [A[k00] * w00 + A[k10] * w10 + A[k01] * w01 + A[k11] * w11, A[k00 + 1] * w00 + A[k10 + 1] * w10 + A[k01 + 1] * w01 + A[k11 + 1] * w11];
  };
  let w0 = Infinity, e0 = -Infinity, s0 = Infinity, n0 = -Infinity; for (let k = 0; k < A.length; k += 2) { w0 = Math.min(w0, A[k]); e0 = Math.max(e0, A[k]); s0 = Math.min(s0, A[k + 1]); n0 = Math.max(n0, A[k + 1]); }
  at.bbox = { w: w0, e: e0, s: s0, n: n0 }; return at;
}
function loadImage(url, ms = 20000) {
  return new Promise((resolve) => {
    const im = new Image(); im.crossOrigin = 'anonymous'; im.decoding = 'async';
    const t = setTimeout(() => { im.onload = im.onerror = null; resolve(null); }, ms);
    im.onload = () => { clearTimeout(t); resolve(im); }; im.onerror = () => { clearTimeout(t); resolve(null); }; im.src = url;
  });
}
// Deepest zoom (<= maxZ) at which the box spans no more than px pixels.
export function zoomFor(bb, px, maxZ) { for (let z = maxZ; z > 1; z--) if (Math.max(lon2t(bb.e, z) - lon2t(bb.w, z), lat2t(bb.s, z) - lat2t(bb.n, z)) * 256 <= px) return z; return 2; }
export async function mosaic(urlFn, bb, z) {
  const x0 = Math.floor(lon2t(bb.w, z)), x1 = Math.floor(lon2t(bb.e, z)), y0 = Math.floor(lat2t(bb.n, z)), y1 = Math.floor(lat2t(bb.s, z)), jobs = [];
  for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) jobs.push([tx, ty]);
  const c = document.createElement('canvas'); c.width = (x1 - x0 + 1) * 256; c.height = (y1 - y0 + 1) * 256; const g = c.getContext('2d', { willReadFrequently: true });
  let next = 0, ok = 0;
  await Promise.all(Array.from({ length: 6 }, async () => { while (next < jobs.length) { const [tx, ty] = jobs[next++], im = await loadImage(urlFn(z, tx, ty)); if (im) { g.drawImage(im, (tx - x0) * 256, (ty - y0) * 256); ok++; } } }));
  if (!ok) throw new Error('no tiles loaded: offline, or the tile server is blocked');
  let data; try { data = g.getImageData(0, 0, c.width, c.height).data; } catch { throw new Error('the tiles were blocked by the browser'); }
  return { data, w: c.width, h: c.height, z, x0, y0, ok, total: jobs.length };
}
// fwd: project metres to [lon, lat] (the page's current coordinate system).
const pxOf = (M, fwd) => (x, y) => { const [lon, lat] = fwd(x, y); return [(lon2t(lon, M.z) - M.x0) * 256 - 0.5, (lat2t(lat, M.z) - M.y0) * 256 - 0.5]; };
export async function loadDem(key, B, fwd) {
  const bb = lattice(B, fwd, 4).bbox, M = await mosaic(DEM_URL, bb, zoomFor(bb, 512, 15)), E = new Float32Array(M.w * M.h);
  for (let i = 0; i < E.length; i++) E[i] = M.data[i * 4 + 3] < 255 ? NaN : M.data[i * 4] * 256 + M.data[i * 4 + 1] + M.data[i * 4 + 2] / 256 - 32768;
  const toPx = lattice(B, pxOf(M, fwd));
  const at = (x, y) => {
    const [px, py] = toPx(x, y), i = Math.floor(px), j = Math.floor(py), a = px - i, b = py - j;
    if (i < 0 || j < 0 || i + 1 >= M.w || j + 1 >= M.h) return NaN;
    const k = j * M.w + i; return E[k] * (1 - a) * (1 - b) + E[k + 1] * a * (1 - b) + E[k + M.w] * (1 - a) * b + E[k + M.w + 1] * a * b;
  };
  return { key, ok: true, at, z: M.z, tiles: `${M.ok}/${M.total}` };
}
export async function loadImagery(key, B, fwd) {
  const bb = lattice(B, fwd, 4).bbox, M = await mosaic(IMG_URL, bb, zoomFor(bb, 2048, 17)), toPx = lattice(B, pxOf(M, fwd));
  const bw = B.x1 - B.x0, bh = B.y1 - B.y0, across = (lon2t(bb.e, M.z) - lon2t(bb.w, M.z)) * 256;
  let w = Math.max(768, Math.min(2048, Math.round(across * 1.25))), h = Math.round(w * bh / bw); if (h > 2048) { w = Math.round(w * 2048 / h); h = 2048; }
  const out = new Uint8ClampedArray(w * h * 4), src = M.data;
  for (let py = 0; py < h; py++) for (let px = 0; px < w; px++) {
    const [sx, sy] = toPx(B.x0 + (px + 0.5) / w * bw, B.y1 - (py + 0.5) / h * bh), i = Math.max(0, Math.min(M.w - 2, Math.floor(sx))), j = Math.max(0, Math.min(M.h - 2, Math.floor(sy)));
    const a = Math.max(0, Math.min(1, sx - i)), b = Math.max(0, Math.min(1, sy - j)), k = (j * M.w + i) * 4, o = (py * w + px) * 4, r = M.w * 4;
    // Weighted by each sample's alpha: a tile that failed to load is transparent,
    // and stays a gap (alpha 0) for paintTerrain to fill, not a black patch.
    const wt = [(1 - a) * (1 - b) * src[k + 3], a * (1 - b) * src[k + 7], (1 - a) * b * src[k + r + 3], a * b * src[k + r + 7]], ws = wt[0] + wt[1] + wt[2] + wt[3];
    for (let c = 0; c < 3; c++) out[o + c] = ws ? (src[k + c] * wt[0] + src[k + 4 + c] * wt[1] + src[k + r + c] * wt[2] + src[k + r + 4 + c] * wt[3]) / ws : 0;
    out[o + 3] = ws / 255;
  }
  return { key, ok: true, w, h, data: out, z: M.z, tiles: `${M.ok}/${M.total}` };
}
