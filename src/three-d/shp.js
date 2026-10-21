// Exploration Maps 3D: a zipped ESRI shapefile (.shp, .dbf, .prj) read as GeoJSON, so it joins the figure as a
// map overlay file like any GeoJSON. Points, multipoints, polylines and polygons (with their Z and M forms);
// polygon rings that run clockwise start a polygon and the anticlockwise ones after them are its holes.
// Used by unzip.js; the coordinate system is the .prj's name (overlays.js places it).

const area2 = (r) => r.reduce((s, p, i) => { const q = r[(i + 1) % r.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0);
function readShp(buf) {
  const v = new DataView(buf), out = []; let o = 100;
  while (o + 12 <= v.byteLength) {
    const len = v.getInt32(o + 4) * 2, c = o + 8, type = v.getInt32(c, true) % 10; o = c + len;
    const pt = (at) => [v.getFloat64(at, true), v.getFloat64(at + 8, true)];
    if (type === 0) { out.push(null); continue; }
    if (type === 1) { out.push({ type: 'Point', coordinates: pt(c + 4) }); continue; }
    if (type === 8) { const n = v.getInt32(c + 36, true); out.push({ type: 'MultiPoint', coordinates: Array.from({ length: n }, (_, i) => pt(c + 40 + i * 16)) }); continue; }
    const np = v.getInt32(c + 36, true), n = v.getInt32(c + 40, true), p0 = c + 44 + np * 4;
    const parts = Array.from({ length: np }, (_, i) => v.getInt32(c + 44 + i * 4, true)).concat(n);
    const rings = parts.slice(0, -1).map((s, i) => Array.from({ length: parts[i + 1] - s }, (_, k) => pt(p0 + (s + k) * 16)));
    if (type === 3) { out.push(rings.length === 1 ? { type: 'LineString', coordinates: rings[0] } : { type: 'MultiLineString', coordinates: rings }); continue; }
    const polys = [];
    rings.forEach((r) => { if (area2(r) < 0 || !polys.length) polys.push([r]); else polys[polys.length - 1].push(r); });
    out.push(polys.length === 1 ? { type: 'Polygon', coordinates: polys[0] } : { type: 'MultiPolygon', coordinates: polys });
  }
  return out;
}
// The attribute table: one object per record, values trimmed (numbers as numbers).
function readDbf(buf) {
  const v = new DataView(buf), n = v.getUint32(4, true), hl = v.getUint16(8, true), rl = v.getUint16(10, true), dec = new TextDecoder(), fields = [];
  for (let o = 32, at = 1; o + 32 <= hl && v.getUint8(o) !== 0x0d; o += 32) {
    const name = dec.decode(new Uint8Array(buf, o, 11)).replace(/\0[\s\S]*$/, '').trim(), type = String.fromCharCode(v.getUint8(o + 11)), len = v.getUint8(o + 16);
    fields.push({ name, type, at, len }); at += len;
  }
  return Array.from({ length: n }, (_, i) => Object.fromEntries(fields.map((f) => {
    const t = dec.decode(new Uint8Array(buf, hl + i * rl + f.at, f.len)).trim();
    return [f.name, 'NFO'.includes(f.type) && t !== '' && Number.isFinite(+t) ? +t : t];
  })));
}
// The .prj's coordinate system as a name overlays.js can place: EPSG:4326 for geographic coordinates, else
// the projected system's name ("NAD 83 UTM zone 9N").
export function prjName(prj) {
  const m = String(prj || '').match(/^\s*PROJCS\["([^"]+)"/);
  if (!m) return /^\s*GEOGCS/.test(prj || '') ? 'EPSG:4326' : null;
  return m[1].replace(/_/g, ' ').replace(/\b19(27|83|84)\b/g, '$1');
}
export function shpToGeoJSON(shp, dbf, prj) {
  const geoms = readShp(shp), props = dbf ? readDbf(dbf) : [], name = prjName(prj);
  return { type: 'FeatureCollection', ...(name ? { crs: { type: 'name', properties: { name } } } : {}),
    features: geoms.map((g, i) => (g ? { type: 'Feature', properties: props[i] || {}, geometry: g } : null)).filter(Boolean) };
}
