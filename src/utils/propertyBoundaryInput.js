import { layerFeatures, isFeatureHidden } from './featureIdentity.js';

// Conservative prototype limits for a presentation overlay, not an import cap.
// These include hidden input so identity filtering never scans unbounded data.
export const BOUNDARY_INPUT_LIMITS = Object.freeze({ features: 256, polygons: 128, rings: 256, points: 2048, comparisons: 200000 });
const fail = (reason) => ({ ok: false, reason, polygons: [] });
const same = (a, b) => a[0] === b[0] && a[1] === b[1];
const orient = (a, b, c) => (b[0]-a[0])*(c[1]-a[1]) - (b[1]-a[1])*(c[0]-a[0]);
const between = (a, b, c) => c[0] >= Math.min(a[0],b[0]) && c[0] <= Math.max(a[0],b[0])
  && c[1] >= Math.min(a[1],b[1]) && c[1] <= Math.max(a[1],b[1]);
function intersects(a, b, c, d) {
  const abC = orient(a,b,c), abD = orient(a,b,d), cdA = orient(c,d,a), cdB = orient(c,d,b);
  return (abC === 0 && between(a,b,c)) || (abD === 0 && between(a,b,d))
    || (cdA === 0 && between(c,d,a)) || (cdB === 0 && between(c,d,b))
    || ((abC > 0) !== (abD > 0) && (cdA > 0) !== (cdB > 0) && abC !== 0 && abD !== 0 && cdA !== 0 && cdB !== 0);
}
function inside(point, ring) {
  let value = false;
  for (let i = 0, j = ring.length-2; i < ring.length-1; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a[1] > point[1]) !== (b[1] > point[1])
      && point[0] < (b[0]-a[0])*(point[1]-a[1])/(b[1]-a[1])+a[0]) value = !value;
  }
  return value;
}

function validatePolygon(rings, work) {
  if (!Array.isArray(rings) || !rings.length) return 'invalid-rings';
  work.rings += rings.length;
  if (work.rings > BOUNDARY_INPUT_LIMITS.rings) return 'complexity-limit';
  for (const ring of rings) {
    if (!Array.isArray(ring) || ring.length < 4) return 'invalid-ring';
    work.points += ring.length;
    if (work.points > BOUNDARY_INPUT_LIMITS.points) return 'complexity-limit';
    if (ring.some((p) => !Array.isArray(p) || p.length < 2 || p.length > 3 || !p.every(Number.isFinite)
      || Math.abs(p[0]) > 180 || Math.abs(p[1]) > 90)) return 'invalid-coordinate';
    if (!same(ring[0],ring[ring.length-1])) return 'open-ring';
    const seen = new Set();
    for (let i = 0; i < ring.length-1; i++) {
      const a = ring[i], b = ring[i+1], c = ring[(i+2) % (ring.length-1)];
      const key = `${a[0]},${a[1]}`;
      if (seen.has(key)) return 'invalid-topology';
      seen.add(key);
      if (Math.abs(a[0]-b[0]) > 180) return 'antimeridian-unsupported';
      if (orient(a,b,c) === 0 && (b[0]-a[0])*(c[0]-b[0])+(b[1]-a[1])*(c[1]-b[1]) <= 0) return 'invalid-topology';
    }
    // Translation before the area sum avoids cancellation at large longitudes.
    const origin = ring[0];
    const area = ring.slice(1).reduce((sum, p, i) => sum + orient(origin,ring[i],p), 0);
    if (area === 0) return 'invalid-topology';
  }
  // Rings may not cross or touch; each ring must also be simple. Overlap
  // BETWEEN source polygons is allowed and is handled by the later union.
  for (let r = 0; r < rings.length; r++) {
    for (let s = r; s < rings.length; s++) {
      const a = rings[r], b = rings[s];
      for (let i = 0; i < a.length-1; i++) for (let j = 0; j < b.length-1; j++) {
        if (r === s && (j <= i+1 || (i === 0 && j === a.length-2))) continue;
        if (++work.comparisons > BOUNDARY_INPUT_LIMITS.comparisons) return 'complexity-limit';
        if (intersects(a[i],a[i+1],b[j],b[j+1])) return 'invalid-topology';
      }
    }
  }
  for (let h = 1; h < rings.length; h++) {
    if (!inside(rings[h][0],rings[0])) return 'invalid-hole';
    for (let k = 1; k < h; k++) if (inside(rings[h][0],rings[k]) || inside(rings[k][0],rings[h])) return 'invalid-hole';
  }
  return null;
}

/** Unbound foundation: explicit opt-in and subject selection only. The returned
 * coordinate-only COPIES are for a future overlay; never replace source paths.
 * No snapping, buffering, repair, hull or fallback to another property.
 */
export function selectPropertyBoundaryLayer(project, { enabled = false } = {}) {
  if (enabled !== true) return fail('disabled');
  const layout = project?.layout || {};
  if (layout.propertyNeighboursVersion !== 1 || !layout.primaryLayerId) return fail('select-property');
  if (!Array.isArray(project.layers)) return fail('select-property');
  const layers = project.layers.filter((layer) => layer?.id === layout.primaryLayerId);
  if (layers.length !== 1) return fail('select-property');
  const layer = layers[0];
  if (layer.role !== 'claims' || layer.visible === false || layer.focus === false) return fail('select-property');
  return { ok: true, layer };
}

export function propertyBoundaryInput(project, options) {
  const selected = selectPropertyBoundaryLayer(project,options);
  if (!selected.ok) return selected;
  const { layer } = selected;
  const features = layerFeatures(layer);
  if (!Array.isArray(features)) return fail('polygon-required');
  if (!features.length) return fail('no-visible-claims');
  if (features.length > BOUNDARY_INPUT_LIMITS.features) return fail('complexity-limit');
  const work = { rings: 0, points: 0, comparisons: 0 }, all = [];
  for (const feature of features) {
    const g = feature?.geometry;
    if (!g || !['Polygon', 'MultiPolygon'].includes(g.type)) return fail('polygon-required');
    const parts = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
    if (!Array.isArray(parts) || !parts.length) return fail('invalid-rings');
    if (all.length+parts.length > BOUNDARY_INPUT_LIMITS.polygons) return fail('complexity-limit');
    for (const rings of parts) {
      const reason = validatePolygon(rings,work);
      if (reason) return fail(reason);
      all.push({ feature, rings });
    }
  }
  const polygons = all.filter(({ feature }) => !isFeatureHidden(layer,feature))
    .map(({ rings }) => rings.map((ring) => ring.map(([x,y]) => [x,y])));
  return polygons.length ? { ok: true, reason: null, layerId: layer.id, polygons }
    : fail('no-visible-claims');
}
