export function circleToPolygon(center, radius, n = 24) {
  return Array.from({ length: n }, (_, i) => {
    const angle = (2 * Math.PI * i) / n - Math.PI / 2;
    const lat = center.lat + (radius / 111320) * Math.cos(angle);
    const lng =
      center.lng +
      (radius / (111320 * Math.cos((center.lat * Math.PI) / 180))) * Math.sin(angle);
    return { lat, lng };
  });
}

export function featureCollectionFeatures(geojson) {
  if (!geojson) return [];
  if (geojson.type === 'FeatureCollection') return geojson.features || [];
  if (geojson.type === 'Feature') return [geojson];
  if (Array.isArray(geojson)) {
    return geojson.flatMap((g) => featureCollectionFeatures(g));
  }
  return [];
}

export function isPointLayerGeoJSON(geojson) {
  const features = featureCollectionFeatures(geojson);
  if (!features.length) return false;
  const pointCount = features.filter((f) => {
    const type = f?.geometry?.type;
    return type === 'Point' || type === 'MultiPoint';
  }).length;
  return pointCount / features.length > 0.5;
}

export function getPropertyKeys(geojson) {
  const features = featureCollectionFeatures(geojson);
  const keys = new Set();
  features.slice(0, 20).forEach((f) => {
    Object.keys(f?.properties || {}).forEach((k) => keys.add(k));
  });
  return [...keys];
}

/**
 * Map scale as a 1:N denominator, rounded to a presentable step.
 *
 * Lives here rather than in the exporter because three places have to agree on
 * it: the NI 43-101 title block on screen, the canvas export and the SVG
 * export. When only the exporter knew how to compute it, the editing stage
 * printed "Auto" in the SCALE cell and the exported figure printed a number —
 * the same map, two different answers.
 */
export function scaleDenomFromMap(map) {
  if (!map) return null;
  try {
    const size = map.getSize();
    const pt1 = map.containerPointToLatLng([0, size.y / 2]);
    const pt2 = map.containerPointToLatLng([100, size.y / 2]);
    const R = 6371000;
    const toRad = (d) => (d * Math.PI) / 180;
    const dLat = toRad(pt2.lat - pt1.lat);
    const dLng = toRad(pt2.lng - pt1.lng);
    const a = Math.sin(dLat / 2) ** 2
      + Math.cos(toRad(pt1.lat)) * Math.cos(toRad(pt2.lat)) * Math.sin(dLng / 2) ** 2;
    const meters = 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
    const metersPerPixel = meters / 100;
    // A map scale is ground distance over the SAME distance on the sheet, so
    // the pixel has to be converted to a physical length. At the CSS reference
    // of 96 px per inch one pixel is 0.0254/96 m. Dividing by the pixel count
    // instead — which is what this used to do — reported metres per pixel and
    // printed it as the scale, so a regional figure came out of the NI 43-101
    // title block reading "1:25".
    const METERS_PER_PIXEL_ON_PAPER = 0.0254 / 96;
    const rawDenom = metersPerPixel / METERS_PER_PIXEL_ON_PAPER;
    if (!rawDenom || !Number.isFinite(rawDenom)) return null;
    const mag = Math.pow(10, Math.floor(Math.log10(rawDenom)));
    const candidates = [1, 2, 2.5, 5, 10].map((c) => c * mag);
    const rounded = candidates.reduce((best, c) => (Math.abs(c - rawDenom) < Math.abs(best - rawDenom) ? c : best));
    return Math.round(rounded);
  } catch {
    return null;
  }
}

/** "1:50,000" — or '' when the scale is unknown. */
export function formatScaleDenom(denom) {
  if (!denom) return '';
  return `1:${denom.toLocaleString('en-US')}`;
}

/** "WGS84 / UTM Zone 9N" for the map's current centre. */
export function autoProjectionName(map) {
  try {
    const c = map?.getCenter();
    if (!c) return 'WGS84';
    const zone = Math.floor((c.lng + 180) / 6) + 1;
    return `WGS84 / UTM Zone ${zone}${c.lat >= 0 ? 'N' : 'S'}`;
  } catch { return 'WGS84'; }
}
