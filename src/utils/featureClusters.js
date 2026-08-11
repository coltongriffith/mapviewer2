// Grouping a layer's shapes into the blocks a person would point at.
//
// Extracted from RegistrySearch, which has clustered a company's claims into
// geographic groups since the search feature was built. The same question comes
// up when anchoring a label: "which part of this ground is the leader line
// pointing at?"
//
// WHY A LABEL NEEDS THIS AT ALL
//   A layer's anchor used to be geojsonCenter(), the MEAN of every feature's
//   centre. For one compact block that is fine. For a company holding a
//   northern block and a southern block 60 km apart, the mean lands halfway
//   between them — open ground the company does not own, with a leader line
//   drawn to nothing. The average of two places is generally not a place.

import { visibleGeojson, layerFeatures, isFeatureHidden } from './featureIdentity.js';

/** Mean of every coordinate in a feature, as [lng, lat]. */
export function featureCentroid(feature) {
  const pts = [];
  function walk(c) {
    if (typeof c[0] === 'number') pts.push(c);
    else c.forEach(walk);
  }
  const geom = feature?.geometry;
  if (geom?.coordinates) walk(geom.coordinates);
  if (!pts.length) return null;
  return [
    pts.reduce((s, p) => s + p[0], 0) / pts.length,
    pts.reduce((s, p) => s + p[1], 0) / pts.length,
  ];
}

export function haversineKm([lng1, lat1], [lng2, lat2]) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Single-link clustering: two shapes join the same group when their centres are
 * within `thresholdKm`, transitively.
 *
 * 8 km rather than the 50 km RegistrySearch uses for company search. That
 * threshold answers "are these the same project?" across a province; this one
 * answers "would a reader see one block or two?", and at map scale a 20 km gap
 * is plainly two blocks. Claim cells are a few hundred metres across, so 8 km
 * still holds a contiguous staking block together through ordinary gaps.
 */
export function clusterFeatures(features, thresholdKm = 8) {
  const n = features.length;
  if (!n) return [];
  const centres = features.map(featureCentroid);
  const parent = Array.from({ length: n }, (_, i) => i);

  function find(x) {
    let r = x;
    while (parent[r] !== r) { parent[r] = parent[parent[r]]; r = parent[r]; }
    return r;
  }
  function unite(x, y) {
    const rx = find(x); const ry = find(y);
    if (rx !== ry) parent[rx] = ry;
  }

  for (let i = 0; i < n; i += 1) {
    if (!centres[i]) continue;
    for (let j = i + 1; j < n; j += 1) {
      if (!centres[j]) continue;
      if (haversineKm(centres[i], centres[j]) < thresholdKm) unite(i, j);
    }
  }

  const groups = new Map();
  for (let i = 0; i < n; i += 1) {
    if (!centres[i]) continue;
    const root = find(i);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(i);
  }

  return [...groups.values()].map((indices) => {
    const feats = indices.map((i) => features[i]);
    const ctrs = indices.map((i) => centres[i]);
    const mean = [
      ctrs.reduce((s, c) => s + c[0], 0) / ctrs.length,
      ctrs.reduce((s, c) => s + c[1], 0) / ctrs.length,
    ];
    return { features: feats, centroid: mean, count: feats.length };
  });
}

/**
 * A point that is ON one of the shapes, not merely near them.
 *
 * A group's mean can still fall in a hole — a ring of claims around an
 * unstaked centre, or an L-shaped block. Snapping to the centre of the member
 * shape closest to the mean guarantees the leader line lands on ground the
 * layer actually covers, which is the whole point of the label.
 */
export function anchorForCluster(cluster) {
  if (!cluster?.features?.length) return null;
  let best = null;
  let bestDist = Infinity;
  for (const feature of cluster.features) {
    const c = featureCentroid(feature);
    if (!c) continue;
    const d = haversineKm(c, cluster.centroid);
    if (d < bestDist) { bestDist = d; best = c; }
  }
  return best ? { lng: best[0], lat: best[1] } : null;
}

/** Short compass names for the anchor picker, where space is tight. */
export const SHORT_COMPASS_GRID = [
  ['Southwest', 'South', 'Southeast'],
  ['West', 'Central', 'East'],
  ['Northwest', 'North', 'Northeast'],
];

/**
 * Compass-style names relative to the spread of the groups themselves.
 *
 * The grid and the one-group name are parameters because two callers want
 * different copy for the same geometry: the anchor dropdown reads better short
 * ("North (12 shapes)"), while the claim-search group cards have always said
 * "Northern Group". Sharing the maths without flattening the wording keeps both
 * exactly as they were — including where the de-duplication counter lands,
 * which a naive "append ' Group'" wrapper would have turned into "South 1 Group".
 */
export function clusterLabels(clusters, grid = SHORT_COMPASS_GRID, singleLabel = 'Claim area') {
  if (clusters.length <= 1) return clusters.map(() => singleLabel);
  const lngs = clusters.map((c) => c.centroid[0]);
  const lats = clusters.map((c) => c.centroid[1]);
  const minLng = Math.min(...lngs); const maxLng = Math.max(...lngs);
  const minLat = Math.min(...lats); const maxLat = Math.max(...lats);
  const third = (v, min, max) => (max - min < 1e-6 ? 1 : Math.min(2, Math.floor(((v - min) / (max - min)) * 3)));
  const labels = clusters.map(
    (c) => grid[third(c.centroid[1], minLat, maxLat)][third(c.centroid[0], minLng, maxLng)],
  );
  const totals = labels.reduce((m, l) => m.set(l, (m.get(l) || 0) + 1), new Map());
  const seen = new Map();
  return labels.map((l) => {
    if ((totals.get(l) || 0) <= 1) return l;
    const n = (seen.get(l) || 0) + 1;
    seen.set(l, n);
    return `${l} ${n}`;
  });
}

/**
 * The groups a label can be anchored to, largest first.
 *
 * Reads visible features ONLY. A shape the user removed is not somewhere a
 * label may point: trimming the western block and then watching the label stay
 * out west, over ground now absent from the map, is the bug that prompted this.
 */
export function layerAnchorGroups(layer, { thresholdKm } = {}) {
  const features = layerFeatures(layer).filter((f) => !isFeatureHidden(layer, f));
  if (!features.length) return [];
  const clusters = clusterFeatures(features, thresholdKm);
  const labels = clusterLabels(clusters);
  return clusters
    .map((c, i) => ({
      label: labels[i],
      count: c.count,
      anchor: anchorForCluster(c),
      centroid: c.centroid,
    }))
    .filter((g) => g.anchor)
    // Largest first: the default anchor should be the block a reader would call
    // the property, not whichever cluster happened to be built first.
    .sort((a, b) => b.count - a.count);
}

/**
 * Is this anchor now pointing at ground the layer no longer covers?
 *
 * Only true when the anchor is far from EVERY remaining shape. A label sitting
 * in a gap inside a block is fine — that is a normal place to put one — so the
 * distance has to be generous enough not to disturb it, and is measured against
 * the nearest shape rather than the block's centre.
 */
export function isAnchorOrphaned(layer, anchor, maxKm = 12) {
  if (!anchor) return false;
  const features = layerFeatures(layer).filter((f) => !isFeatureHidden(layer, f));
  if (!features.length) return false;   // nothing left to re-anchor to
  const point = [anchor.lng, anchor.lat];
  return !features.some((f) => {
    const c = featureCentroid(f);
    return c && haversineKm(c, point) <= maxKm;
  });
}

/**
 * Where a label for this layer should point by default.
 *
 * Falls back to the plain visible centre for layers with no usable geometry, so
 * a caller never has to handle "clustered to nothing" separately.
 */
export function defaultAnchorForLayer(layer) {
  const groups = layerAnchorGroups(layer);
  if (groups.length) return groups[0].anchor;
  const geo = visibleGeojson(layer);
  const features = geo?.features || [];
  const c = features.length ? featureCentroid(features[0]) : null;
  return c ? { lng: c[0], lat: c[1] } : null;
}
