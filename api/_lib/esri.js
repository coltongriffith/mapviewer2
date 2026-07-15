// ArcGIS esri-JSON → GeoJSON geometry conversion with correct ring handling.
//
// Esri packs polygons as a flat `rings` array where orientation distinguishes
// exterior rings (clockwise) from holes (counter-clockwise), and one geometry
// can contain SEVERAL separate polygons. The old conversion copied all rings
// into a single GeoJSON Polygon, so a multi-part claim rendered its 2nd+
// exterior rings as holes. This classifies rings by orientation, assigns each
// hole to the exterior ring that contains it, and emits Polygon or
// MultiPolygon accordingly. Source coordinates are never mutated.

/** Signed ring area via the shoelace formula. Negative = clockwise (esri exterior). */
function signedArea(ring) {
  let sum = 0;
  for (let i = 0, n = ring.length - 1; i < n; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[i + 1];
    sum += (x2 - x1) * (y2 + y1);
  }
  return sum / 2; // positive = clockwise in x-east/y-north coordinates
}

/** Ray-casting point-in-ring test. */
function pointInRing([px, py], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (((yi > py) !== (yj > py)) && (px < ((xj - xi) * (py - yi)) / (yj - yi) + xi)) {
      inside = !inside;
    }
  }
  return inside;
}

function validRing(ring) {
  return Array.isArray(ring)
    && ring.length >= 4
    && ring.every((c) => Array.isArray(c) && Number.isFinite(c[0]) && Number.isFinite(c[1]));
}

/**
 * Classify esri rings into GeoJSON Polygon/MultiPolygon coordinates.
 * Returns null for empty/entirely-invalid input.
 */
export function ringsToGeoJSON(rings) {
  const usable = (rings || []).filter(validRing);
  if (!usable.length) return null;

  const exteriors = [];
  const holes = [];
  for (const ring of usable) {
    // Esri convention: clockwise = exterior, counter-clockwise = hole.
    if (signedArea(ring) > 0) exteriors.push(ring);
    else holes.push(ring);
  }
  // Degenerate but real-world case: no clockwise ring at all (some servers
  // emit everything counter-clockwise). Treat all rings as exteriors rather
  // than dropping the geometry.
  if (!exteriors.length) {
    return holes.length === 1
      ? { type: 'Polygon', coordinates: [holes[0]] }
      : { type: 'MultiPolygon', coordinates: holes.map((h) => [h]) };
  }

  const polygons = exteriors.map((ext) => [ext]);
  for (const hole of holes) {
    // A hole belongs to the exterior ring containing it. Test an interior
    // point (first vertex is on the boundary of its own ring but strictly
    // inside its parent), falling back to the first exterior when nothing
    // contains it — a lone hole is better rendered than silently dropped.
    const idx = exteriors.findIndex((ext) => pointInRing(hole[0], ext));
    polygons[idx >= 0 ? idx : 0].push(hole);
  }

  return polygons.length === 1
    ? { type: 'Polygon', coordinates: polygons[0] }
    : { type: 'MultiPolygon', coordinates: polygons };
}

/** Full esri geometry (rings/paths/points) → GeoJSON geometry (or null). */
export function esriGeometryToGeoJSON(g) {
  if (!g || typeof g !== 'object') return null;
  try {
    if (g.rings) return ringsToGeoJSON(g.rings);
    if (g.paths) {
      const paths = g.paths.filter((p) => Array.isArray(p) && p.length >= 2);
      if (!paths.length) return null;
      return paths.length === 1
        ? { type: 'LineString', coordinates: paths[0] }
        : { type: 'MultiLineString', coordinates: paths };
    }
    if (g.points) {
      const pts = g.points.filter((p) => Array.isArray(p) && Number.isFinite(p[0]));
      return pts.length ? { type: 'MultiPoint', coordinates: pts } : null;
    }
    if (g.x != null && Number.isFinite(g.x) && Number.isFinite(g.y)) {
      return { type: 'Point', coordinates: [g.x, g.y] };
    }
  } catch {
    return null; // malformed geometry must never crash the whole response
  }
  return null;
}
