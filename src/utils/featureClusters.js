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

  // ── Spatial grid, not all-pairs ──────────────────────────────────────────
  //
  // The obvious version compares every shape with every other: n(n-1)/2
  // haversines, on the UI thread, with the user waiting. importers.js accepts
  // up to 200,000 features, and at that size this is 2×10^10 distance
  // calculations — the browser does not come back. Even a 2,000-feature
  // shapefile is two million, which is a visible stall every time the Anchor
  // picker renders.
  //
  // Instead, bin the centres into cells at least `thresholdKm` across. Anything
  // within the threshold of a shape must lie in that shape's own cell or one of
  // the eight around it, so only those are compared. That makes the work
  // proportional to the number of shapes times how many share their
  // neighbourhood, rather than to the square of the total.
  //
  // Cell height is fixed; cell WIDTH is computed from the highest latitude in
  // the data, because a degree of longitude shrinks towards the poles. Sizing
  // by the worst case keeps every cell at least thresholdKm wide, which is what
  // makes "check the eight neighbours" sufficient rather than approximate.
  // A LOOP, not Math.max(...array). Spreading pushes one argument per element
  // onto the stack, and V8 gives up somewhere around 130,000 — inside the
  // 200,000 importers.js accepts. Opening the Anchor picker on a large but
  // perfectly valid import would have thrown RangeError before any clustering
  // happened, crashing the render in the name of making it faster.
  let maxAbsLat = 0;
  for (const c of centres) {
    if (!c) continue;
    const a = Math.abs(c[1]);
    if (a > maxAbsLat) maxAbsLat = a;
  }
  const KM_PER_DEG_LAT = 111.32;
  // Clamped so a dataset at the pole cannot produce an infinite cell width.
  const lngShrink = Math.max(Math.cos((maxAbsLat * Math.PI) / 180), 0.01);
  const dLat = thresholdKm / KM_PER_DEG_LAT;

  // Longitude columns WRAP at the antimeridian. Without this, 179.99 and
  // -179.99 — about 2.2 km apart, one cluster under the old all-pairs code —
  // land at opposite ends of the column range and are never compared, so the
  // "optimisation" would quietly return a different answer than the code it
  // replaced. The grid has to be a faster way to get the same result, not a
  // faster way to get a nearly-right one.
  // Columns must tile 360 degrees EXACTLY, so the width is derived from an
  // integer count rather than the other way round. Rounding the count up and
  // keeping the raw width leaves a narrow partial column at the seam, and two
  // points either side of it can then sit two wrapped columns apart — outside
  // the ±1 search, never compared. That is not hypothetical: at the equator,
  // 179.97 and -179.97 are 6.67 km apart, well inside the 8 km threshold, and
  // came back as two clusters.
  //
  // Rounding the count DOWN makes each column slightly wider than the
  // threshold, which is the safe direction: the guarantee needed is that a
  // neighbour is never further than one column away, and wider columns can only
  // help that.
  const rawLng = thresholdKm / (KM_PER_DEG_LAT * lngShrink);
  const columns = Math.max(1, Math.floor(360 / rawLng));
  const dLng = 360 / columns;
  const cells = new Map();
  const cellKey = (row, col) => `${row}:${col}`;
  const wrapCol = (col) => ((col % columns) + columns) % columns;
  const rowOf = (c) => Math.floor(c[1] / dLat);
  const colOf = (c) => wrapCol(Math.floor((c[0] + 180) / dLng));

  for (let i = 0; i < n; i += 1) {
    if (!centres[i]) continue;
    const key = cellKey(rowOf(centres[i]), colOf(centres[i]));
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key).push(i);
  }

  for (let i = 0; i < n; i += 1) {
    if (!centres[i]) continue;
    const row = rowOf(centres[i]);
    const col = colOf(centres[i]);
    for (let dr = -1; dr <= 1; dr += 1) {
      for (let dc = -1; dc <= 1; dc += 1) {
        const bucket = cells.get(cellKey(row + dr, wrapCol(col + dc)));
        if (!bucket) continue;
        for (const j of bucket) {
          // Each unordered pair is considered once.
          if (j <= i) continue;
          if (haversineKm(centres[i], centres[j]) < thresholdKm) unite(i, j);
        }
      }
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
// Grouping is pure and a layer object is replaced whenever it changes, so its
// identity is a sound cache key — and a WeakMap forgets the entry as soon as
// that version of the layer is unreachable.
//
// This is not a micro-optimisation. The Anchor picker calls this from render,
// inside the callout list, so without a cache an open callout re-clusters the
// whole layer on every keystroke in the text field.
const anchorGroupCache = new WeakMap();

export function layerAnchorGroups(layer, { thresholdKm } = {}) {
  if (!layer) return [];
  const byThreshold = anchorGroupCache.get(layer);
  const cacheKey = thresholdKm ?? 'default';
  if (byThreshold?.has(cacheKey)) return byThreshold.get(cacheKey);

  const groups = computeAnchorGroups(layer, thresholdKm);
  if (byThreshold) byThreshold.set(cacheKey, groups);
  else anchorGroupCache.set(layer, new Map([[cacheKey, groups]]));
  return groups;
}

function computeAnchorGroups(layer, thresholdKm) {
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

/**
 * Move labels that a trim has left pointing at ground which is no longer there.
 *
 * Pure, and takes the projection as a parameter, so the rules below can be
 * tested without a Leaflet map — they were written inline in a setProject
 * callback first, where none of this was reachable.
 *
 * @param callouts  the project's callouts
 * @param layer     the layer AFTER trimming
 * @param project   (lat, lng) => {x, y} screen point, or null when unavailable
 */
export function reanchorCalloutsForLayer(callouts, layer, project = null) {
  if (!layer) return callouts || [];
  return (callouts || []).map((c) => {
    if (c.layerId !== layer.id) return c;

    // A callout made from ONE feature carries that feature's name and result
    // text. Moving it to the largest remaining block would attach real,
    // specific data to unrelated ground, in the map and in the exported PDF.
    // That is a worse failure than a stale anchor the user can see and correct,
    // and there is no honest place to relocate it to, so it stays put.
    if (c.featureId) return c;

    if (!isAnchorOrphaned(layer, c.anchor)) return c;
    const anchor = defaultAnchorForLayer(layer);
    if (!anchor) return c;

    // isManualPosition is NOT a manually chosen anchor.
    //
    // `offset` is a pixel offset of the BOX from the anchor, so dragging a label
    // moves the box and leaves the anchor — the leader line's endpoint —
    // exactly where it was. Skipping these would leave the line pointing at the
    // deleted block, which is the whole bug.
    //
    // What the user chose was where the BOX sits, and that is what is preserved:
    // the anchor moves to real ground, and the offset absorbs the screen
    // distance between the old and new anchors so the box does not budge.
    if (!c.isManualPosition || !project) return { ...c, anchor };
    try {
      const from = project(c.anchor.lat, c.anchor.lng);
      const to = project(anchor.lat, anchor.lng);
      if (!from || !to) return { ...c, anchor };
      const offset = c.offset || { x: 0, y: 0 };
      return {
        ...c,
        anchor,
        offset: { x: offset.x + (from.x - to.x), y: offset.y + (from.y - to.y) },
      };
    } catch (_) {
      // A correct leader line matters more than an unmoved box.
      return { ...c, anchor };
    }
  });
}
