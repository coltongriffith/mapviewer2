// Map overlays for Exploration Maps 3D: claims, targets, faults and soil points from GeoJSON, KML, a zipped
// shapefile (unzip.js turns it into GeoJSON) or a CSV of points, draped on the terrain. Loaded by studio.js the
// first time a figure has an overlay or an overlay file. Areas are painted into the terrain image (so the relief
// hides them where it should); outlines, lines, points and their labels are drawn on the figure, sampled along
// the surface and broken where a ridge hides them, so they stay crisp at any export size.
// S.overlays: [{ id, name, file | data, crs, kind, color, dash, width, opacity, label, labelField, show, inset, role, group, credit }].
// inset: outlined in the inset too; unset, an area (fill) overlay is on a figure of design version 5. An
// overlay from a file (role "overlay") keeps the file's name, the file being saved with the figure; one added
// as data keeps its features. crs: null (the figure's own metres), "EPSG:4326" or another system's name.
import { clipLine, clipRing, densify, sightTest, drapeRuns } from './drape.js';
import { hits } from './layout.js';
import { uses } from './design-version.js';

let H, S;
export function init(host) { H = host; S = host.S; }

// ---- Reading ----
export const LL = 'EPSG:4326';
const KIND_OF = { A: 'fill', L: 'line', P: 'points' }, WORD = { fill: 'areas', line: 'lines', points: 'points' };
const rd = (v) => (Math.abs(v) > 1000 ? Math.round(v * 100) / 100 : Math.round(v * 1e7) / 1e7); // 1 cm in metres or degrees
const ok2 = (p) => Array.isArray(p) && p.length >= 2 && Number.isFinite(+p[0]) && Number.isFinite(+p[1]);
const pt = (p) => [rd(+p[0]), rd(+p[1])], path = (c) => (Array.isArray(c) ? c.filter(ok2).map(pt) : []);
const props = (p) => Object.fromEntries(Object.entries(p || {}).filter(([, v]) => v !== null && v !== undefined && typeof v !== 'object').slice(0, 24)
  .map(([k, v]) => [String(k).slice(0, 40), typeof v === 'number' ? v : String(v).slice(0, 80)]));
// "urn:ogc:def:crs:EPSG::26909" -> "EPSG:26909"; CRS84 and EPSG:4326 -> latitude/longitude.
export const crsName = (n) => { const t = String(n || '').trim(); if (!t) return null; if (/crs84$|epsg:+4326$|^wgs ?84$/i.test(t)) return LL; const m = t.match(/epsg:+(\d{4,5})$/i); return m ? `EPSG:${m[1]}` : t; };
// Features as { g: "A" (area: rings) | "L" (line) | "P" (point), c: coordinates, p: properties }, multi-part
// geometries split into their parts.
function fromGeoJSON(j) {
  const out = [];
  const add = (g, p) => {
    if (!g || typeof g !== 'object') return;
    if (g.type === 'GeometryCollection') { (g.geometries || []).forEach((x) => add(x, p)); return; }
    const t = String(g.type || '').replace(/^Multi/, ''); if (!Array.isArray(g.coordinates)) return;
    (/^Multi/.test(g.type) ? g.coordinates : [g.coordinates]).forEach((q) => {
      if (t === 'Point' && ok2(q)) out.push({ g: 'P', c: pt(q), p });
      else if (t === 'LineString') { const l = path(q); if (l.length > 1) out.push({ g: 'L', c: l, p }); }
      else if (t === 'Polygon' && Array.isArray(q)) { const rs = q.map(path).filter((r) => r.length > 2); if (rs.length) out.push({ g: 'A', c: rs, p }); }
    });
  };
  const list = j?.type === 'FeatureCollection' ? j.features || [] : j?.type === 'Feature' ? [j] : [{ geometry: j }];
  list.forEach((f) => add(f?.geometry, props(f?.properties)));
  return out;
}
const unxml = (s) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, '&').trim();
const tagRe = (t, g) => new RegExp(`<(?:\\w+:)?${t}\\b[^>]*>([\\s\\S]*?)</(?:\\w+:)?${t}>`, g ? 'gi' : 'i');
const inner = (s, t) => (s.match(tagRe(t)) || [])[1], each = (s, t) => [...s.matchAll(tagRe(t, true))].map((m) => m[1]);
const kmlPts = (s) => path((s || '').trim().split(/\s+/).map((t) => t.split(',')));
function fromKML(text) {
  const out = [];
  for (const pm of each(text, 'Placemark')) {
    const p = {}, nm = inner(pm, 'name'); if (nm) p.name = unxml(nm);
    for (const m of pm.matchAll(/<(?:\w+:)?(?:Data|SimpleData)\b[^>]*\bname="([^"]+)"[^>]*>([\s\S]*?)<\/(?:\w+:)?(?:Data|SimpleData)>/gi)) p[m[1]] = unxml(inner(m[2], 'value') ?? m[2]);
    const q = props(p);
    each(pm, 'Point').forEach((g) => { const c = kmlPts(inner(g, 'coordinates')); if (c.length) out.push({ g: 'P', c: c[0], p: q }); });
    each(pm, 'LineString').forEach((g) => { const c = kmlPts(inner(g, 'coordinates')); if (c.length > 1) out.push({ g: 'L', c, p: q }); });
    each(pm, 'Polygon').forEach((g) => {
      const rs = [inner(g, 'outerBoundaryIs'), ...each(g, 'innerBoundaryIs')].map((b) => kmlPts(inner(b || '', 'coordinates'))).filter((r) => r.length > 2);
      if (rs.length) out.push({ g: 'A', c: rs, p: q });
    });
  }
  return out;
}
const limit = (feats) => {
  let n = 0; feats.forEach((f) => { n += f.g === 'P' ? 1 : f.g === 'L' ? f.c.length : f.c.reduce((s, r) => s + r.length, 0); });
  if (feats.length > 20000 || n > 250000) throw new Error('That overlay is too detailed for a figure (over 250,000 points). Simplify it first.');
  return feats;
};
// GeoJSON (an object or its text) or KML text: { feats, crs } (crs from the file, undefined when it says none).
export function parseOverlay(src, name = '') {
  if (src && typeof src === 'object') return { feats: limit(fromGeoJSON(src)), crs: crsName(src.crs?.properties?.name) || undefined };
  const t = String(src ?? '').trim();
  if (/^</.test(t) || /\.kml$/i.test(name)) return { feats: limit(fromKML(t)), crs: LL };
  let j; try { j = JSON.parse(t); } catch { throw new Error(`${name || 'That overlay'} is not GeoJSON or KML.`); }
  return parseOverlay(j, name);
}
// A CSV given the overlay type by hand: one point per row at its easting/northing (or longitude/latitude).
export function fromCSV(f) {
  const c = f.cols || {}, ll = c.east === undefined && c.lat !== undefined, xi = ll ? c.lon : c.east, yi = ll ? c.lat : c.north;
  if (xi === undefined || yi === undefined) throw new Error(`Pick the easting and northing (or latitude and longitude) columns of ${f.name} in step 1.`);
  const feats = f.rows.map((r) => [parseFloat(r[xi]), parseFloat(r[yi]), r]).filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y))
    .map(([x, y, r]) => ({ g: 'P', c: pt([x, y]), p: props(Object.fromEntries(f.header.map((h, i) => [h, r[i]]))) }));
  return { feats: limit(feats), crs: ll ? LL : null };
}
const eachPt = (f, fn) => (f.g === 'P' ? fn(f.c) : f.g === 'L' ? f.c.forEach(fn) : f.c.forEach((r) => r.forEach(fn)));
// Latitude/longitude when every coordinate could be one and the drilling (in metres, B) is elsewhere; a figure
// whose collars are in latitude/longitude takes such an overlay as latitude/longitude too.
export function guessCrs(feats, B, latlonFigure) {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  feats.forEach((f) => eachPt(f, ([x, y]) => { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }));
  if (!(x0 >= -180 && x1 <= 180 && y0 >= -90 && y1 <= 90)) return null;
  if (latlonFigure || !B) return LL;
  return x1 > B.x0 - 1e4 && x0 < B.x1 + 1e4 && y1 > B.y0 - 1e4 && y0 < B.y1 + 1e4 ? null : LL;
}
// Latitude/longitude to the metres of collars given in latitude/longitude (studio.js geoFor, inverted).
export const fromLatLon = (ll) => (lon, lat) => [(lon - ll.lon0) * Math.cos(ll.lat0 * Math.PI / 180) * 111320, (lat - ll.lat0) * 110540];
// What an overlay of each kind draws: areas (fill), points, or lines (line; the areas' outlines in a file with
// no lines).
export const pick = (kind, feats) => { const g = kind === 'fill' ? 'A' : kind === 'points' ? 'P' : feats.some((f) => f.g === 'L') ? 'L' : 'A'; return feats.filter((f) => f.g === g); };

// ---- Placing: the overlay's coordinates to the figure's metres ----
const TF = new Map(), ID = (x, y) => [x, y];
const tfKey = (o) => { const g = H.geo(), ll = H.project?.latlon; return `${o.crs || ''}|${g?.code || ''}|${ll ? `${ll.lat0},${ll.lon0}` : ''}`; };
async function transform(src) {
  if (!src) return ID;
  const geo = H.geo(); if (!geo) throw new Error('Set the coordinate system in step 1 to place it.');
  const T = await H.terrain(); let toLL = null;
  if (src !== LL) {
    const c = T.parseCRS(src, { code: LL, latlon: true }); if (c.code === geo.code) return ID;
    if (!c.latlon) { await T.ready(c); toLL = T.projFwd(c); }
  }
  let inv;
  if (geo.latlon) { if (!H.project?.latlon) throw new Error('The collars are not in latitude/longitude.'); inv = fromLatLon(H.project.latlon); } else { await T.ready(geo); inv = T.projInv(geo); }
  return toLL ? (x, y) => inv(...toLL(x, y)) : inv;
}
export async function ready() {
  const keys = [...new Set(S.overlays.map(tfKey))].filter((k) => !TF.has(k));
  if (!keys.length) return;
  await Promise.all(keys.map(async (k) => { try { TF.set(k, await transform(S.overlays.find((o) => tfKey(o) === k).crs)); } catch (e) { TF.set(k, e); } }));
  H.restyle(); H.schedulePublish();
}
const PARSED = new WeakMap(), PLACED = new WeakMap();
function source(o) {
  if (o.data) return { feats: o.data.features || [], rev: 'd' };
  const f = H.files().find((x) => x.name === o.file); if (!f) return null;
  const rev = `${H.digest(f)}|${JSON.stringify(f.cols || {})}`, c = PARSED.get(f);
  if (c?.rev === rev) return c;
  let r; try { r = { ...(f.header?.length ? fromCSV(f) : parseOverlay(f.text, f.name)), rev }; } catch (e) { r = { feats: [], err: e.message, rev }; }
  PARSED.set(f, r); return r;
}
// The overlay's features in the figure's metres (cached), or null while it cannot be placed.
function placed(o) {
  const fn = TF.get(tfKey(o)), src = source(o); if (!fn || fn instanceof Error || !src) return null;
  const k = `${tfKey(o)}|${src.rev}|${o.kind}`, c = PLACED.get(o); if (c?.k === k) return c.feats;
  const mp = (p) => fn(p[0], p[1]);
  const feats = pick(o.kind, src.feats).map((f) => ({ ...f, c: f.g === 'P' ? mp(f.c) : f.g === 'L' ? f.c.map(mp) : f.c.map((r) => r.map(mp)) }));
  PLACED.set(o, { k, feats }); return feats;
}
export function info(o) {
  const src = source(o), fn = TF.get(tfKey(o)), problem = !src ? 'Its file is missing.' : src.err || (fn instanceof Error ? fn.message : null);
  return { features: src ? pick(o.kind, src.feats).length : 0, placed: !!placed(o), ...(problem ? { problem } : {}) };
}

// ---- Adding and changing ----
const KINDS = ['fill', 'line', 'points'], DASHES = ['solid', 'dashed', 'dotted'], WIDTH = { fill: 2, line: 2.5, points: 8 }, OPAC = { fill: 0.3, line: 1, points: 1 };
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
function patch(o, x, feats) {
  if (x.name !== undefined) { const t = String(x.name ?? '').trim(); if (!t) throw new Error('An overlay needs a name.'); o.name = t.slice(0, 80); }
  if (x.kind !== undefined) {
    if (!KINDS.includes(x.kind)) throw new Error('kind must be "fill" (areas), "line" or "points".');
    if (feats && !pick(x.kind, feats).length) throw new Error(`"${o.name}" has no ${{ fill: 'polygons', line: 'lines or polygons', points: 'points' }[x.kind]} to draw as ${x.kind}.`);
    o.kind = x.kind;
  }
  if (x.color !== undefined) { if (!/^#[0-9a-f]{6}$/i.test(String(x.color))) throw new Error('color must be a hex colour like #c65322.'); o.color = String(x.color).toLowerCase(); }
  if (x.dash !== undefined) { const d = x.dash === true ? 'dashed' : x.dash === false || x.dash === null ? 'solid' : x.dash; if (!DASHES.includes(d)) throw new Error('dash must be "solid", "dashed" or "dotted" (or true / false).'); o.dash = d; }
  [['width', 0.5, 16], ['opacity', 0, 1]].forEach(([k, lo, hi]) => { if (x[k] === undefined) return; let v = +x[k]; if (!Number.isFinite(v)) throw new Error(`${k} must be a number.`); if (k === 'opacity' && v > 1) v /= 100; o[k] = clamp(v, lo, hi); });
  if (x.label !== undefined) o.label = x.label === false ? '' : x.label === null ? null : String(x.label).slice(0, 80); // null: the name; "": no legend row
  if (x.labelField !== undefined) {
    const v = x.labelField || null, keys = fieldsOf(feats || []);
    if (v && feats && !keys.includes(v)) throw new Error(`No field "${v}" in "${o.name}". Fields: ${keys.join(', ') || 'none'}.`);
    o.labelField = v;
  }
  if (x.show !== undefined) o.show = !!x.show;
  if (x.inset !== undefined) o.inset = !!x.inset;
  // Claims found in a registry (claims.js): role "claims", group "project" or "neighbours", and the source credit.
  ['role', 'group', 'credit'].forEach((k) => { if (x[k] === null || x[k] === '') delete o[k]; else if (x[k] !== undefined) o[k] = String(x[k]).slice(0, 120); });
}
const fieldsOf = (feats) => [...new Set(feats.slice(0, 200).flatMap((f) => Object.keys(f.p || {})))];
const mix = (h, t) => `#${[1, 3, 5].map((i) => Math.round(parseInt(h.slice(i, i + 2), 16) * (1 - t) + 255 * t).toString(16).padStart(2, '0')).join('')}`;
// Brand colours, in turn: the accent, the primary, then lighter tones of each, skipping any already in use.
function nextColour() {
  const cyc = [S.accent, S.primary, mix(S.accent, 0.45), mix(S.primary, 0.5)], used = new Set(S.overlays.map((o) => o.color));
  return cyc.find((c) => !used.has(c)) || cyc[S.overlays.length % 4];
}
const baseName = (n) => String(n || '').replace(/\.(geo)?json$|\.kml$|\.csv$|\.txt$/i, '').replace(/[_-]+/g, ' ').trim();
// One overlay per kind of geometry asked for (or found); returns their ids.
function create(x, feats, crs, file) {
  const kinds = x.kind ? [x.kind] : KINDS.filter((k) => feats.some((f) => KIND_OF[f.g] === k));
  if (!kinds.length) throw new Error('No points, lines or polygons found in that overlay.');
  return kinds.map((kind) => {
    const mine = pick(kind, feats), one = mine.length === 1 && (mine[0].p?.name || mine[0].p?.Name);
    const n = S.overlays.reduce((mx, o) => Math.max(mx, +String(o.id).replace(/\D/g, '') || 0), 0) + 1;
    const name = x.name ? `${x.name}${kinds.length > 1 ? ` (${WORD[kind]})` : ''}` : one || `${baseName(file) || 'Overlay'}${kinds.length > 1 ? ` (${WORD[kind]})` : ''}`;
    const o = { id: `O${n}`, name: String(name).slice(0, 80), ...(file ? { file } : { data: { features: mine } }), crs: crs ?? null, kind, color: nextColour(), dash: 'solid', width: WIDTH[kind], opacity: OPAC[kind], label: null, labelField: null, show: true };
    const rest = { ...x }; ['name', 'kind', 'data', 'file', 'crs'].forEach((k) => delete rest[k]);
    patch(o, rest, mine);
    S.overlays = [...S.overlays, o]; return o.id;
  });
}
const done = () => { H.restyle(); H.schedulePublish(); renderUI(document.getElementById('ov-ui')); };
export async function add(x = {}) {
  if (!x || typeof x !== 'object') throw new Error('addOverlay takes { name, data | file, kind, color, dash, width, opacity, label, labelField }.');
  let r, file = null, d = x.data;
  if (x.file !== undefined) {
    const f = H.files().find((y) => y.name === x.file);
    if (!f) throw new Error(`No file "${x.file}". Files: ${H.files().map((y) => y.name).join(', ') || 'none'}.`);
    f.role = 'overlay'; r = f.header?.length ? fromCSV(f) : parseOverlay(f.text, f.name); file = f.name; H.renderFiles();
  } else if (d !== undefined && d !== null) {
    if (d instanceof ArrayBuffer || ArrayBuffer.isView(d) || (typeof d === 'string' && /^(data:[^,]*;base64,)?UEsD/.test(d))) { // a zipped shapefile, KML or GeoJSON
      const g = (await import('./unzip.js')).zipFiles(d).find((f) => /\.(geojson|json|kml)$/i.test(f.name));
      if (!g) throw new Error('No shapefile, GeoJSON or KML in that ZIP.');
      r = parseOverlay(g.text, g.name); file = null; if (x.name === undefined) x = { ...x, name: baseName(g.name) };
    } else r = parseOverlay(d, x.name);
  } else throw new Error('addOverlay needs data (GeoJSON, KML text, or a zipped shapefile as base64 or an ArrayBuffer) or file (the name of a file added in step 1).');
  if (!r.feats.length) throw new Error('No points, lines or polygons found in that overlay.');
  const crs = x.crs !== undefined ? crsName(x.crs) : r.crs !== undefined ? r.crs : guessCrs(r.feats, H.G?.B, !!H.project?.latlon);
  const prev = S.overlays; let ids;
  try { ids = create(x, r.feats, crs, file); } catch (e) { S.overlays = prev; throw e; }
  await ready(); done();
  H.status(`Overlay added: ${ids.map((id) => S.overlays.find((o) => o.id === id).name).join(', ')}.`);
  return ids.length === 1 ? ids[0] : ids;
}
const find = (id) => { const o = S.overlays.find((x) => x.id === id); if (!o) throw new Error(`No overlay "${id}". Overlays: ${S.overlays.map((x) => x.id).join(', ') || 'none'}.`); return o; };
export function update(id, x = {}) {
  const o = find(id), next = structuredClone(o), src = source(o);
  patch(next, x, src ? src.feats : null);
  S.overlays = S.overlays.map((y) => (y === o ? next : y)); done();
}
export function remove(id) {
  const o = find(id); S.overlays = S.overlays.filter((y) => y !== o);
  // The last overlay drawn from a file takes the file with it, so it does not come back.
  if (o.file && !S.overlays.some((y) => y.file === o.file)) { const fs = H.files(), i = fs.findIndex((f) => f.name === o.file); if (i >= 0) fs.splice(i, 1); H.renderFiles(); }
  done();
}
// After the scene is built or the files change: overlays for overlay files new to the figure, none for files
// that have gone; the terrain repainted when its areas are out of date.
export function sync() {
  const fs = H.files().filter((f) => f.role === 'overlay'), names = new Set(fs.map((f) => f.name)), was = S.overlays;
  if (was.some((o) => o.file && !names.has(o.file))) S.overlays = was.filter((o) => !o.file || names.has(o.file));
  const added = [];
  fs.forEach((f) => {
    if (S.overlays.some((o) => o.file === f.name)) return;
    try { const r = f.header?.length ? fromCSV(f) : parseOverlay(f.text, f.name); if (r.feats.length) added.push(...create({}, r.feats, r.crs !== undefined ? r.crs : guessCrs(r.feats, H.G?.B, !!H.project?.latlon), f.name)); } catch (e) { H.status(`${f.name}: ${e.message}`); }
  });
  if (added.length) H.status(`Drawn on the terrain: ${added.map((id) => S.overlays.find((o) => o.id === id).name).join(', ')}. Restyle them in Layout, Map overlays.`);
  if (S.overlays.some((o) => !TF.has(tfKey(o)))) ready().catch((e) => H.status(e.message));
  if (H.G && H.G.ovPainted !== S.overlays) H.restyle();
  if (S.overlays !== was) { H.schedulePublish(); renderUI(document.getElementById('ov-ui')); }
}

// ---- Drawing ----
// Areas, painted into the terrain image (P: plan metres to its pixels) under the section line.
export function paint(ctx, P) {
  const G = H.G; G.ovPainted = S.overlays;
  S.overlays.forEach((o) => {
    if (o.show === false || o.kind !== 'fill' || !(o.opacity > 0)) return;
    const F = placed(o); if (!F?.length) return;
    ctx.save(); ctx.globalAlpha = o.opacity; ctx.fillStyle = o.color; ctx.beginPath();
    F.forEach((f) => f.c.forEach((r) => { r.forEach((p, i) => { const [x, y] = P({ x: p[0], y: p[1] }); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); }); ctx.closePath(); }));
    ctx.fill('evenodd'); ctx.restore();
  });
}
const dashOf = (ctx, dash, w, u) => { ctx.lineCap = dash === 'dashed' ? 'butt' : 'round'; ctx.setLineDash(dash === 'dashed' ? [Math.max(6 * u, 3.5 * w), Math.max(4 * u, 2.2 * w)] : dash === 'dotted' ? [0.01, Math.max(3 * u, 2.2 * w)] : []); };
const inB = (B, p) => p[0] >= B.x0 && p[0] <= B.x1 && p[1] >= B.y0 && p[1] <= B.y1;
let SC = null;
// Screen geometry of the shown overlays: runs of each outline or line, points and label anchors (cached per view).
function screen() {
  const G = H.G, cam = H.camera, fr = H.frame(), key = `${cam.matrixWorld.elements.join()}|${cam.projectionMatrix.elements.join()}|${fr}`;
  if (SC && SC.key === key && SC.G === G && SC.list === S.overlays && SC.n === TF.size) return SC.out;
  const vex = S.vex, p = cam.position, d = cam.getWorldDirection(p.clone());
  const seen = sightTest(G.B, G.surf, G.zmax, S.projection === 'orthographic' ? { dir: [-d.x, d.z, -d.y / vex] } : { eye: [p.x + G.cx, G.cy - p.z, p.y / vex + G.zref] }, Math.max(0.5, (G.terr.hi - G.terr.lo) * 0.01));
  const toScreen = (x, y, z) => H.proj(G.V(x, y, z)), step = Math.max(G.bw, G.bh) / 250, opt = { surf: G.surf, toScreen, seen };
  const spot = (x, y) => { const z = G.surf(x, y), s = toScreen(x, y, z); return s[2] <= 1 && seen(x, y, z) ? s : null; };
  const out = S.overlays.filter((o) => o.show !== false).map((o) => {
    const r = { o, runs: [], pts: [], labels: [] };
    (placed(o) || []).forEach((f) => {
      const t = o.labelField && f.p?.[o.labelField] !== undefined ? String(f.p[o.labelField]) : '';
      if (f.g === 'P') { const s = inB(G.B, f.c) && spot(...f.c); if (s) { r.pts.push(s); if (t) r.labels.push({ t, at: s, side: true }); } return; }
      const runs = (f.g === 'A' ? f.c.map((ring) => [...ring, ring[0]]) : [f.c]).flatMap((l) => clipLine(l, G.B)).flatMap((l) => drapeRuns(densify(l, step), opt));
      r.runs.push(...runs);
      if (!t || !runs.length) return;
      if (f.g === 'A') { const c = clipRing(f.c[0], G.B), s = c.length && spot(c.reduce((a, q) => a + q[0], 0) / c.length, c.reduce((a, q) => a + q[1], 0) / c.length); if (s) r.labels.push({ t, at: s }); }
      else { const run = runs.reduce((a, b) => (b.length > a.length ? b : a)); r.labels.push({ t, at: run[run.length >> 1] }); }
    });
    return r;
  });
  SC = { key, G, list: S.overlays, n: TF.size, out }; return out;
}
// On the figure, under the collars: outlines and lines (on a pale halo), points, then their labels, each kept
// off what is already placed (occ) or left out.
export function draw(ctx, K, occ) {
  if (!H.G || !S.overlays.length) return;
  const { u, font } = K, L = screen(), order = { fill: 0, line: 1, points: 2 };
  ctx.save(); ctx.lineJoin = 'round';
  L.slice().sort((a, b) => order[a.o.kind] - order[b.o.kind]).forEach(({ o, runs, pts }) => {
    const w = o.width * u; ctx.globalAlpha = o.kind === 'fill' ? 1 : o.opacity; // an area's opacity is its fill's (paint)
    if (o.kind === 'points') {
      pts.forEach(([x, y]) => { ctx.beginPath(); ctx.arc(x, y, w / 2, 0, 2 * Math.PI); ctx.fillStyle = o.color; ctx.fill(); ctx.lineWidth = Math.max(0.8 * u, w / 9); ctx.strokeStyle = 'rgba(20,33,38,0.7)'; ctx.stroke(); });
      return;
    }
    if (!runs.length) return;
    ctx.beginPath(); runs.forEach((r) => r.forEach((q, i) => (i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]))));
    ctx.setLineDash([]); ctx.lineCap = 'round'; ctx.strokeStyle = H.paper(0.55); ctx.lineWidth = w + 2.4 * u; ctx.stroke();
    dashOf(ctx, o.dash, w, u); ctx.strokeStyle = o.color; ctx.lineWidth = w; ctx.stroke(); ctx.setLineDash([]);
  });
  ctx.globalAlpha = 1; font(600, 11.5); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineCap = 'round';
  L.forEach(({ o, labels }) => labels.forEach(({ t, at, side }) => {
    const tw = ctx.measureText(t).width, x = side ? at[0] + o.width * u / 2 + 5 * u + tw / 2 : at[0], y = at[1], box = [x - tw / 2 - 3 * u, y - 8 * u, x + tw / 2 + 3 * u, y + 8 * u];
    if (occ.some((b) => hits(box, b))) return; occ.push(box);
    ctx.lineWidth = 3 * u; ctx.strokeStyle = H.paper(0.9); ctx.strokeText(t, x, y); ctx.fillStyle = H.INK; ctx.fillText(t, x, y);
  }));
  ctx.restore();
}
// In the inset (studio.js's plan of drilling, tags.js's location map): the outlines of the overlays set to show
// there, clipped to its picture (rect [x, y, w, h]); P maps the figure's metres to the inset.
export const inInset = (o) => o.show !== false && (o.inset ?? (o.kind === 'fill' && uses(S, 'insetOutline')));
export function inset(ctx, P, u, [x, y, w, h]) {
  const list = S.overlays.filter(inInset); if (!list.length) return;
  ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip(); ctx.lineJoin = 'round';
  list.forEach((o) => {
    const F = placed(o); if (!F?.length || o.kind === 'points') return;
    ctx.beginPath(); F.forEach((f) => (f.g === 'A' ? f.c : [f.c]).forEach((r) => { r.forEach((p, i) => { const q = P(p[0], p[1]); if (i) ctx.lineTo(q[0], q[1]); else ctx.moveTo(q[0], q[1]); }); if (f.g === 'A') ctx.closePath(); }));
    if (o.kind === 'fill') { ctx.globalAlpha = Math.min(0.2, o.opacity); ctx.fillStyle = o.color; ctx.fill('evenodd'); ctx.globalAlpha = 1; }
    ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = 2.6 * u; ctx.stroke(); ctx.strokeStyle = o.color; ctx.lineWidth = 1.2 * u; ctx.stroke();
  });
  ctx.restore();
}
// The claim map inset's areas (tags.js): of the area overlays shown in the inset (inInset: not set inset: false),
// the registry claims (role "claims"), else all of them; each { o, feats } in the figure's metres.
export function claimShapes() {
  const fills = S.overlays.filter((o) => o.kind === 'fill' && inInset(o)), claims = fills.filter((o) => o.role === 'claims');
  return (claims.length ? claims : fills).map((o) => ({ o, feats: placed(o) || [] })).filter((x) => x.feats.length);
}
// The sources of the overlays shown ("Claims: BC Mineral Titles Online, retrieved 2026-10-21"), for the footer.
export const credits = () => [...new Set(S.overlays.filter((o) => o.show !== false && o.credit).map((o) => o.credit))];
// Legend rows, each with a swatch the shape of its mark (a filled box, a line, a dot).
const swatch = (o) => (ctx, x, cy, u) => {
  const w = Math.min(o.width, o.kind === 'points' ? 10 : 4) * u; ctx.save(); ctx.lineJoin = 'round'; if (o.kind !== 'fill') ctx.globalAlpha = Math.max(0.3, o.opacity);
  if (o.kind === 'points') { ctx.beginPath(); ctx.arc(x + 11 * u, cy, w / 2, 0, 2 * Math.PI); ctx.fillStyle = o.color; ctx.fill(); ctx.lineWidth = 0.8 * u; ctx.strokeStyle = 'rgba(20,33,38,0.7)'; ctx.stroke(); }
  else {
    if (o.kind === 'fill') { ctx.globalAlpha = Math.max(0.3, o.opacity); ctx.fillStyle = o.color; ctx.fillRect(x, cy - 6 * u, 22 * u, 12 * u); ctx.globalAlpha = 1; }
    dashOf(ctx, o.dash, w, u); ctx.strokeStyle = o.color; ctx.lineWidth = w; ctx.beginPath();
    if (o.kind === 'fill') ctx.rect(x, cy - 6 * u, 22 * u, 12 * u); else { ctx.moveTo(x, cy); ctx.lineTo(x + 22 * u, cy); }
    ctx.stroke();
  }
  ctx.restore();
};
export function legendSecs() {
  const B = H.G?.B, rows = S.overlays.filter((o) => o.show !== false && (o.label ?? o.name) && placed(o)?.some((f) => { let any = false; eachPt(f, (q) => { any = any || (B && inB(B, q)); }); return any; }))
    .map((o) => ({ label: o.label ?? o.name, draw: swatch(o) }));
  return rows.length ? [{ key: 'overlays', title: 'Surface', rows }] : [];
}

// ---- The Layout panel: list, restyle, hide and remove ----
export function renderUI(el) {
  if (!el) return;
  const esc = H.esc, open = new Set([...el.querySelectorAll('details[open]')].map((d) => d.dataset.id));
  el.innerHTML = S.overlays.length ? S.overlays.map((o) => {
    const i = esc(o.id), n = info(o), src = source(o), fields = fieldsOf(src?.feats || []), sel = (k, opts) => opts.map(([v, t]) => `<option value="${esc(v)}" ${o[k] === v ? 'selected' : ''}>${esc(t)}</option>`).join('');
    const kinds = KINDS.filter((k) => pick(k, src?.feats || []).length).map((k) => [k, { fill: 'Filled areas', line: 'Lines or outlines', points: 'Points' }[k]]);
    return `<div class="file"><div class="file-head"><label class="check"><input type="checkbox" data-ov="${i}" data-k="show" ${o.show !== false ? 'checked' : ''}><span class="name" title="${esc(o.name)}">${esc(o.name)}</span></label>
      <span class="row"><input type="color" data-ov="${i}" data-k="color" value="${esc(o.color)}" aria-label="Colour of ${esc(o.name)}"><button class="btn" type="button" data-ovx="${i}" aria-label="Remove ${esc(o.name)}">Remove</button></span></div>
      <div class="grid2"><label class="field"><span>Draw as</span><select data-ov="${i}" data-k="kind">${sel('kind', kinds)}</select></label>
      ${o.kind === 'points' ? '' : `<label class="field"><span>${o.kind === 'fill' ? 'Outline' : 'Line'}</span><select data-ov="${i}" data-k="dash">${sel('dash', DASHES.map((d) => [d, d[0].toUpperCase() + d.slice(1)]))}</select></label>`}</div>
      <details data-id="${i}" ${open.has(o.id) ? 'open' : ''}><summary>More</summary><div class="grid2">
        <label class="field" style="grid-column:1/-1"><span>Name</span><input type="text" data-ov="${i}" data-k="name" value="${esc(o.name)}" maxlength="80"></label>
        <label class="field" style="grid-column:1/-1"><span>Legend text (empty: not in the legend)</span><input type="text" data-ov="${i}" data-k="label" value="${esc(o.label ?? o.name)}" maxlength="80"></label>
        <label class="field"><span>${o.kind === 'points' ? 'Dot size' : 'Width'}</span><input type="number" data-ov="${i}" data-k="width" min="0.5" max="16" step="0.5" value="${o.width}"></label>
        <label class="field"><span>${o.kind === 'fill' ? 'Fill opacity' : 'Opacity'} %</span><input type="number" data-ov="${i}" data-k="opacity" min="0" max="100" step="5" value="${Math.round(o.opacity * 100)}"></label>
        ${o.kind === 'points' ? '' : `<label class="check" style="grid-column:1/-1"><input type="checkbox" data-ov="${i}" data-k="inset" ${inInset({ ...o, show: true }) ? 'checked' : ''}>Outline in the inset</label>`}
        <label class="field" style="grid-column:1/-1"><span>Label each with</span><select data-ov="${i}" data-k="labelField"><option value="">No labels</option>${fields.map((f) => `<option ${f === o.labelField ? 'selected' : ''}>${esc(f)}</option>`).join('')}</select></label>
      </div></details>
      <span class="${n.problem ? 'warn' : 'muted'}">${n.features.toLocaleString()} ${n.features === 1 ? 'feature' : 'features'}${o.file ? ` from ${esc(o.file)}` : ''}${n.problem ? `. ${esc(n.problem)}` : ''}</span></div>`;
  }).join('') : '<p class="muted">None yet.</p>';
  el.querySelectorAll('[data-ov]').forEach((c) => c.addEventListener('change', () => {
    const k = c.dataset.k, v = c.type === 'checkbox' ? c.checked : k === 'opacity' ? +c.value / 100 : k === 'width' ? +c.value : c.value;
    Promise.resolve().then(() => H.api.updateOverlay(c.dataset.ov, { [k]: v })).catch((e) => { H.status(e.message); renderUI(el); });
  }));
  el.querySelectorAll('[data-ovx]').forEach((b) => b.addEventListener('click', () => H.api.removeOverlay(b.dataset.ovx).catch((e) => H.status(e.message))));
}
