// A small, explicit source-CRS catalog, not an EPSG registry or a datum-shift
// service. Preview unprojects on the source ellipsoid; import values never move.
const geographic = (code, datum, ellipsoid) => ({ code: `EPSG:${code}`, datum, ellipsoid, label: `${datum} longitude / latitude`, geographic: true });
const utm = (code, zone, datum, ellipsoid, south = false) => ({ code: `EPSG:${code}`, zone, datum, ellipsoid, south, label: `${datum} / UTM zone ${zone}${south ? 'S' : 'N'}` });
export const DRILL_SOURCE_CRS = [
  geographic(4326, 'WGS84', 'WGS84'), geographic(4269, 'NAD83', 'GRS80'), geographic(4267, 'NAD27', 'clrk66'),
  ...Array.from({ length: 23 }, (_, i) => utm(26901 + i, i + 1, 'NAD83', 'GRS80')),
  ...Array.from({ length: 20 }, (_, i) => utm(26703 + i, i + 3, 'NAD27', 'clrk66')),
  ...Array.from({ length: 60 }, (_, i) => utm(32601 + i, i + 1, 'WGS84', 'WGS84')),
  ...Array.from({ length: 60 }, (_, i) => utm(32701 + i, i + 1, 'WGS84', 'WGS84', true)),
];
export const sourceCrs = (code) => DRILL_SOURCE_CRS.find(c => c.code === String(code || '').trim().toUpperCase()) || null;
export function sourceCoordinateMapping(mapping, code) {
  const crs = String(code || '').trim().toUpperCase();
  return { ...mapping, crs: crs || undefined, coordinateSource: { version: 1, crs: crs || null, operation: 'preserve-source', axisOrder: 'xy' } };
}
// A column template is not evidence of the new file's datum. Keep its current
// source choice (including an explicit blank), not the previous file's CRS.
export function keepFileSource(templateMapping, fileMapping) {
  const { crs: _crs, coordinateSource: _coordinateSource, ...columns } = templateMapping;
  return { ...columns, ...(fileMapping.crs !== undefined ? { crs: fileMapping.crs } : {}), ...(fileMapping.coordinateSource ? { coordinateSource: fileMapping.coordinateSource } : {}) };
}
export function coordinateDefinitions(code) {
  const c = sourceCrs(code);
  if (!c) throw new Error('Preview is unavailable for this CRS. The source values can still be imported unchanged.');
  // Both definitions deliberately share the same ellipsoid and NO datum
  // transformation. In particular NAD27 output must never be called WGS84.
  const geographic = `+proj=longlat +ellps=${c.ellipsoid} +datum=none +no_defs`;
  const projected = c.geographic ? geographic : `+proj=utm +zone=${c.zone}${c.south ? ' +south' : ''} +ellps=${c.ellipsoid} +datum=none +units=m +no_defs`;
  return { source: projected, geographic, descriptor: c };
}
export async function previewSourceCoordinates(rows, code) {
  const { source, geographic, descriptor: c } = coordinateDefinitions(code);
  const { default: proj4 } = await import('proj4');
  return rows.slice(0, 5).map(row => {
    let issue = null, longitude = null, latitude = null;
    if (!Number.isFinite(row.x) || !Number.isFinite(row.y)) issue = 'X and Y must be finite numbers.';
    else if (c.geographic && (Math.abs(row.x) > 180 || Math.abs(row.y) > 90)) issue = 'Expected X = longitude (−180 to 180), Y = latitude (−90 to 90). Check the columns and CRS.';
    else if (!c.geographic && (row.x < 100000 || row.x > 900000 || row.y < 0 || row.y > 10000000)) issue = 'Outside the usual UTM metre range. Check the columns, units and zone.';
    else {
      try {
        [longitude, latitude] = c.geographic ? [row.x, row.y] : proj4(source, geographic, [row.x, row.y]);
        if (!Number.isFinite(longitude) || !Number.isFinite(latitude) || Math.abs(longitude) > 180 || Math.abs(latitude) > 90) throw new Error();
        if (!c.geographic && (c.south ? latitude < -80 || latitude > 0 : latitude < 0 || latitude > 84)) issue = 'Outside this UTM hemisphere or latitude range. Check the source CRS.';
      } catch { issue = 'These values could not be previewed in the selected CRS.'; }
    }
    return { hole_id: row.hole_id, x: row.x, y: row.y, longitude, latitude, issue };
  });
}
