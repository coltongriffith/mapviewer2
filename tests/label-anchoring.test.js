import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  clusterFeatures, anchorForCluster, layerAnchorGroups, defaultAnchorForLayer,
  isAnchorOrphaned, featureCentroid, haversineKm, clusterLabels, reanchorCalloutsForLayer,
} from '../src/utils/featureClusters.js';
import { geojsonCenter } from '../src/utils/geometry.js';

// A label's leader line has to land on ground the layer actually covers.
//
// The anchor was geojsonCenter(layer.geojson) — the MEAN of every feature's
// centre — which fails twice on split ground:
//
//   1. It counts shapes the user removed. Trim the western block and the anchor
//      stays out west, pointing at country that is no longer on the map.
//   2. For a northern block and a southern block it lands halfway between them.
//      The average of two places is generally not a place.

// A ~1 km claim cell centred on (lng, lat).
const cell = (lng, lat, id) => ({
  type: 'Feature',
  properties: { TENURE_NUMBER_ID: id },
  geometry: {
    type: 'Polygon',
    coordinates: [[
      [lng - 0.005, lat - 0.005], [lng + 0.005, lat - 0.005],
      [lng + 0.005, lat + 0.005], [lng - 0.005, lat + 0.005], [lng - 0.005, lat - 0.005],
    ]],
  },
});

// Two blocks about 110 km apart in latitude — plainly separate on any map.
const NORTH = [cell(-120.00, 56.0, 1), cell(-120.01, 56.0, 2), cell(-120.02, 56.0, 3)];
const SOUTH = [cell(-120.00, 55.0, 4), cell(-120.01, 55.0, 5)];

const layerOf = (features, overrides = {}) => ({
  id: 'l1', role: 'claims', featureOverrides: overrides,
  geojson: { type: 'FeatureCollection', features },
});

const nearestShapeKm = (features, anchor) => Math.min(
  ...features.map((f) => haversineKm(featureCentroid(f), [anchor.lng, anchor.lat])),
);

describe('the old anchor really did land in empty country', () => {
  it('puts the mean of two blocks between them, on neither', () => {
    // Not a strawman — this is what geojsonCenter returns, and it is what the
    // label used. Roughly 55 km from the nearest claim in either block.
    const mean = geojsonCenter({ type: 'FeatureCollection', features: [...NORTH, ...SOUTH] });
    expect(nearestShapeKm([...NORTH, ...SOUTH], mean)).toBeGreaterThan(40);
  });
});

describe('clusterFeatures', () => {
  it('sees two blocks where there are two blocks', () => {
    expect(clusterFeatures([...NORTH, ...SOUTH])).toHaveLength(2);
  });

  it('keeps a contiguous staking block together', () => {
    // Cells a few hundred metres apart must not each become their own "block",
    // or the picker would list forty groups instead of one.
    expect(clusterFeatures(NORTH)).toHaveLength(1);
  });

  it('handles a layer with no usable geometry', () => {
    expect(clusterFeatures([])).toEqual([]);
    expect(clusterFeatures([{ type: 'Feature', geometry: null }])).toEqual([]);
  });
});

describe('the anchor sits on a shape, not merely near one', () => {
  it('snaps to a real claim rather than the block mean', () => {
    const [cluster] = clusterFeatures(NORTH);
    const anchor = anchorForCluster(cluster);
    // Exactly the centre of one of the cells.
    const centres = NORTH.map(featureCentroid);
    expect(centres.some((c) => Math.abs(c[0] - anchor.lng) < 1e-9 && Math.abs(c[1] - anchor.lat) < 1e-9)).toBe(true);
  });

  it('never lands between two blocks', () => {
    // The reported bug, stated as the property that must hold.
    const anchor = defaultAnchorForLayer(layerOf([...NORTH, ...SOUTH]));
    expect(nearestShapeKm([...NORTH, ...SOUTH], anchor)).toBeLessThan(1);
  });

  it('defaults to the larger block', () => {
    // A reader calls the bigger block "the property"; the label should too.
    const anchor = defaultAnchorForLayer(layerOf([...NORTH, ...SOUTH]));
    expect(nearestShapeKm(NORTH, anchor)).toBeLessThan(1);
    expect(nearestShapeKm(SOUTH, anchor)).toBeGreaterThan(50);
  });
});

describe('removed shapes are not places a label may point', () => {
  it('ignores trimmed features when choosing the anchor', () => {
    // "I added claims, deleted some on the west side, but the label connected
    // to the west side even though there were no claims there."
    const trimmed = layerOf([...NORTH, ...SOUTH], {
      'TENURE_NUMBER_ID:1': { hidden: true },
      'TENURE_NUMBER_ID:2': { hidden: true },
      'TENURE_NUMBER_ID:3': { hidden: true },
    });
    const anchor = defaultAnchorForLayer(trimmed);
    // Only the southern block is left, so that is where the label goes.
    expect(nearestShapeKm(SOUTH, anchor)).toBeLessThan(1);
  });

  it('offers only the groups that still have shapes', () => {
    const trimmed = layerOf([...NORTH, ...SOUTH], {
      'TENURE_NUMBER_ID:4': { hidden: true },
      'TENURE_NUMBER_ID:5': { hidden: true },
    });
    const groups = layerAnchorGroups(trimmed);
    expect(groups).toHaveLength(1);
    expect(groups[0].count).toBe(3);
  });

  it('lists groups largest first, with counts for the picker', () => {
    const groups = layerAnchorGroups(layerOf([...NORTH, ...SOUTH]));
    expect(groups.map((g) => g.count)).toEqual([3, 2]);
    expect(groups[0].label).toBeTruthy();
    expect(groups[0].label).not.toBe(groups[1].label);
  });

  it('gives one block a neutral name rather than a compass direction', () => {
    // "North" is meaningless when there is nothing to be north of.
    expect(layerAnchorGroups(layerOf(NORTH))[0].label).toBe('Claim area');
  });
});

describe('isAnchorOrphaned', () => {
  const layer = layerOf([...NORTH, ...SOUTH], {
    'TENURE_NUMBER_ID:1': { hidden: true },
    'TENURE_NUMBER_ID:2': { hidden: true },
    'TENURE_NUMBER_ID:3': { hidden: true },
  });

  it('is true for a label left over the block that was removed', () => {
    expect(isAnchorOrphaned(layer, { lng: -120.0, lat: 56.0 })).toBe(true);
  });

  it('is false for a label still over remaining ground', () => {
    expect(isAnchorOrphaned(layer, { lng: -120.0, lat: 55.0 })).toBe(false);
  });

  it('tolerates a label sitting in a gap inside a block', () => {
    // A normal place to put a label — it must not be yanked away.
    expect(isAnchorOrphaned(layerOf(NORTH), { lng: -120.01, lat: 56.02 })).toBe(false);
  });

  it('does not re-anchor when nothing is left to point at', () => {
    // Everything trimmed: leave the label where it is rather than inventing a
    // position. hasVisibleFeatures already drops the layer from the legend.
    const empty = layerOf(NORTH, {
      'TENURE_NUMBER_ID:1': { hidden: true },
      'TENURE_NUMBER_ID:2': { hidden: true },
      'TENURE_NUMBER_ID:3': { hidden: true },
    });
    expect(isAnchorOrphaned(empty, { lng: -120, lat: 56 })).toBe(false);
  });

  it('says no for a label with no anchor at all', () => {
    expect(isAnchorOrphaned(layer, null)).toBe(false);
  });
});

describe('sharing the maths did not change the search wording', () => {
  // The claim-search group cards have always said "Northern Group". Extracting
  // the clustering must not quietly reword them, and a naive wrapper that
  // appended " Group" to the short names would also have put the
  // de-duplication counter in the wrong place — "South 1 Group".
  const SEARCH_GRID = [
    ['Southwest Group', 'Southern Group', 'Southeast Group'],
    ['Western Group', 'Central Group', 'Eastern Group'],
    ['Northwest Group', 'Northern Group', 'Northeast Group'],
  ];
  const spread = [{ centroid: [-120, 56] }, { centroid: [-120, 55] }, { centroid: [-121, 55] }];

  it('keeps the long names for search', () => {
    const labels = clusterLabels(spread, SEARCH_GRID, 'Claim Area');
    expect(labels.every((l) => l.endsWith('Group'))).toBe(true);
    expect(labels).toContain('Northeast Group');
  });

  it('uses short names for the anchor picker', () => {
    const labels = clusterLabels(spread);
    expect(labels.some((l) => l.includes('Group'))).toBe(false);
    expect(labels).toContain('Northeast');
  });

  it('puts the de-duplication counter at the end of the label', () => {
    // Two groups that fall in the SAME third of the spread, plus one that does
    // not — so exactly two labels collide and need numbering.
    const colliding = [
      { centroid: [-120, 55] }, { centroid: [-120, 55] }, { centroid: [-121, 56] },
    ];
    const labels = clusterLabels(colliding, SEARCH_GRID, 'Claim Area');
    const numbered = labels.filter((l) => /\d$/.test(l));
    expect(numbered).toHaveLength(2);
    // The counter belongs at the END. Appending " Group" to a short name after
    // numbering would have produced "Southeast 1 Group".
    for (const l of numbered) expect(l).toMatch(/^[A-Za-z]+ Group \d$/);
    expect(labels.filter((l) => !/\d$/.test(l))).toHaveLength(1);
  });

  it('keeps the single-group name each caller expects', () => {
    expect(clusterLabels([{ centroid: [-120, 56] }], SEARCH_GRID, 'Claim Area')).toEqual(['Claim Area']);
    expect(clusterLabels([{ centroid: [-120, 56] }])).toEqual(['Claim area']);
  });
});

describe('clustering scales to the layers the importer accepts', () => {
  // importers.js caps an import at 200,000 features. The first version compared
  // every shape with every other — n(n-1)/2 haversines on the UI thread — which
  // at that size is 2x10^10 distance calculations and a browser that does not
  // come back. Even 2,000 features is two million, and the Anchor picker runs
  // this from render.
  const grid = (count, originLng, originLat) => Array.from({ length: count }, (_, i) => cell(
    originLng + (i % 50) * 0.01,
    originLat + Math.floor(i / 50) * 0.01,
    i + 1,
  ));

  it('clusters 10,000 shapes without stalling', () => {
    // Measured on this codebase, grid versus the all-pairs version it replaced:
    //
    //        n      grid    all-pairs
    //    2,000     62 ms       143 ms
    //    5,000    138 ms       895 ms
    //   10,000    265 ms     3,534 ms
    //   20,000    550 ms    14,153 ms
    //
    // Quadratic: four times the shapes, a hundred times the work. Extrapolated
    // to the importer's 200,000 cap that is about 23 MINUTES on the UI thread.
    //
    // The bound is set between the two columns at n=10,000 with room either
    // side — roughly 5x the grid's time and under half the all-pairs time — so
    // it survives a slow CI box but still fails if the loop goes quadratic
    // again. An earlier version of this test used 5,000 shapes and a 2,000 ms
    // bound, which the quadratic version passed comfortably.
    const features = grid(10000, -120, 55);
    const started = Date.now();
    const clusters = clusterFeatures(features);
    const elapsed = Date.now() - started;
    expect(elapsed).toBeLessThan(1500);
    expect(clusters.length).toBeGreaterThan(0);
  });

  it('still separates distant blocks at that size', () => {
    // Speed is worthless if the grid stopped grouping correctly.
    const clusters = clusterFeatures([...grid(500, -120, 55), ...grid(500, -110, 45)]);
    expect(clusters).toHaveLength(2);
    expect(clusters.every((c) => c.count === 500)).toBe(true);
  });

  it('groups the same way the all-pairs version did', () => {
    // The grid must be an optimisation, not a different answer. Two shapes
    // either side of a cell boundary have to still find each other.
    const straddling = [cell(-120.0, 55.0, 1), cell(-119.99, 55.0, 2)];
    expect(clusterFeatures(straddling, 8)).toHaveLength(1);
    expect(clusterFeatures([cell(-120, 55, 1), cell(-119.0, 55, 2)], 8)).toHaveLength(2);
  });

  it('does not divide by zero at the pole', () => {
    // A degree of longitude vanishes at 90°, which would make the cell width
    // infinite without the clamp.
    expect(() => clusterFeatures([cell(0, 89.99, 1), cell(0.5, 89.99, 2)])).not.toThrow();
  });

  it('caches per layer, so rendering the picker does not re-cluster', () => {
    const layer = layerOf(grid(3000, -120, 55));
    const first = Date.now();
    layerAnchorGroups(layer);
    const cold = Date.now() - first;
    const second = Date.now();
    for (let i = 0; i < 50; i += 1) layerAnchorGroups(layer);
    const warm = Date.now() - second;
    // 50 further calls must cost far less than the one that did the work.
    expect(warm).toBeLessThanOrEqual(Math.max(cold, 5));
  });

  it('re-clusters when the layer changes', () => {
    // The cache is keyed on layer identity, so trimming must not serve a stale
    // answer — layers are replaced, never mutated.
    const features = [...NORTH, ...SOUTH];
    expect(layerAnchorGroups(layerOf(features))).toHaveLength(2);
    const trimmed = layerOf(features, {
      'TENURE_NUMBER_ID:4': { hidden: true }, 'TENURE_NUMBER_ID:5': { hidden: true },
    });
    expect(layerAnchorGroups(trimmed)).toHaveLength(1);
  });
});

describe('re-anchoring labels after a trim', () => {
  // The layer after trimming: the northern block is gone, the southern remains.
  const trimmed = layerOf([...NORTH, ...SOUTH], {
    'TENURE_NUMBER_ID:1': { hidden: true },
    'TENURE_NUMBER_ID:2': { hidden: true },
    'TENURE_NUMBER_ID:3': { hidden: true },
  });
  const overNorth = { lat: 56.0, lng: -120.0 };
  // A plate carrée stand-in for Leaflet's projection: enough to check that the
  // offset absorbs exactly the screen distance the anchor moved.
  const project = (lat, lng) => ({ x: lng * 1000, y: -lat * 1000 });

  it('moves a layer label off ground that has been removed', () => {
    const [c] = reanchorCalloutsForLayer(
      [{ id: 'c1', layerId: 'l1', anchor: overNorth }], trimmed, project,
    );
    expect(nearestShapeKm(SOUTH, c.anchor)).toBeLessThan(1);
  });

  it('leaves a label that still sits over remaining ground', () => {
    const stay = { id: 'c1', layerId: 'l1', anchor: { lat: 55.0, lng: -120.0 } };
    expect(reanchorCalloutsForLayer([stay], trimmed, project)[0]).toBe(stay);
  });

  it('ignores callouts belonging to another layer', () => {
    const other = { id: 'c1', layerId: 'other', anchor: overNorth };
    expect(reanchorCalloutsForLayer([other], trimmed, project)[0]).toBe(other);
  });

  it('never moves a callout made from a single feature', () => {
    // It carries that feature's name and result text. Relocating it to the
    // largest remaining block would attach specific data to unrelated ground,
    // on the map and in the exported PDF.
    const featureCallout = {
      id: 'c1', layerId: 'l1', featureId: 'TENURE_NUMBER_ID:1',
      anchor: overNorth, text: 'CELL 1', subtext: '12.4 g/t over 3 m',
    };
    expect(reanchorCalloutsForLayer([featureCallout], trimmed, project)[0]).toBe(featureCallout);
  });

  it('re-anchors a DRAGGED label instead of leaving its line over nothing', () => {
    // isManualPosition records a hand-placed BOX, not a hand-placed anchor:
    // `offset` is a pixel offset from the anchor, so dragging never moved the
    // leader line's endpoint. Skipping these left the line pointing at the
    // deleted block — the very bug this is meant to fix.
    const dragged = {
      id: 'c1', layerId: 'l1', anchor: overNorth,
      isManualPosition: true, offset: { x: 40, y: -25 },
    };
    const [c] = reanchorCalloutsForLayer([dragged], trimmed, project);
    expect(nearestShapeKm(SOUTH, c.anchor)).toBeLessThan(1);
  });

  it('keeps a dragged box exactly where the user put it', () => {
    const dragged = {
      id: 'c1', layerId: 'l1', anchor: overNorth,
      isManualPosition: true, offset: { x: 40, y: -25 },
    };
    const [c] = reanchorCalloutsForLayer([dragged], trimmed, project);

    // Box position is projected anchor + offset. It must not move.
    const before = project(dragged.anchor.lat, dragged.anchor.lng);
    const after = project(c.anchor.lat, c.anchor.lng);
    expect(after.x + c.offset.x).toBeCloseTo(before.x + dragged.offset.x, 6);
    expect(after.y + c.offset.y).toBeCloseTo(before.y + dragged.offset.y, 6);
  });

  it('still fixes the line when no map is available to reproject', () => {
    // A correct leader line matters more than an unmoved box.
    const dragged = {
      id: 'c1', layerId: 'l1', anchor: overNorth,
      isManualPosition: true, offset: { x: 40, y: -25 },
    };
    const [c] = reanchorCalloutsForLayer([dragged], trimmed, null);
    expect(nearestShapeKm(SOUTH, c.anchor)).toBeLessThan(1);
    expect(c.offset).toEqual({ x: 40, y: -25 });
  });

  it('leaves labels alone when the layer has been trimmed to nothing', () => {
    const empty = layerOf(NORTH, {
      'TENURE_NUMBER_ID:1': { hidden: true },
      'TENURE_NUMBER_ID:2': { hidden: true },
      'TENURE_NUMBER_ID:3': { hidden: true },
    });
    const c = { id: 'c1', layerId: 'l1', anchor: overNorth };
    expect(reanchorCalloutsForLayer([c], empty, project)[0]).toBe(c);
  });
});

describe('the grid optimisation does not introduce its own failures', () => {
  it('survives a layer near the importer limit', () => {
    // Math.max(...array) pushes one argument per element onto the stack and V8
    // gives up somewhere around 130,000 — INSIDE the 200,000 importers.js
    // accepts. Opening the Anchor picker on a large but valid import threw
    // RangeError before any clustering happened, so the change meant to stop
    // the tab freezing would instead have crashed the render.
    //
    // The points are spread WIDELY on purpose. What breaks the spread is the
    // array's LENGTH, and this isolates that: at half a degree apart nothing is
    // within the 8 km threshold, so each point is its own cluster and the grid
    // does no comparison work. Packing the same count into a few kilometres
    // would instead measure single-link clustering of 140,000 mutual
    // neighbours, which is slow for reasons that have nothing to do with the
    // bug under test.
    const many = [];
    for (let latStep = 0; latStep < 195; latStep += 1) {
      for (let lngStep = 0; lngStep < 720; lngStep += 1) {
        many.push({
          type: 'Feature',
          properties: { TENURE_NUMBER_ID: many.length },
          geometry: { type: 'Point', coordinates: [-180 + lngStep * 0.5, -80 + latStep * 0.82] },
        });
      }
    }
    expect(many.length).toBeGreaterThan(130_000);
    expect(() => clusterFeatures(many)).not.toThrow();
  }, 120_000);

  it('groups across the antimeridian, as all-pairs did', () => {
    // AT THE EQUATOR, and that matters. The first version of this test used
    // latitude 51, where columns are wide enough that both points land in the
    // same one — so it passed for the wrong reason and missed a real defect.
    //
    // 179.97 and -179.97 at the equator are 6.67 km apart, inside the 8 km
    // threshold, and came back as TWO clusters: the column count was rounded up
    // from the raw width, leaving a narrow partial column at the seam, and the
    // two points sat two wrapped columns apart — outside the ±1 search.
    expect(clusterFeatures([cell(179.97, 0, 1), cell(-179.97, 0, 2)], 8)).toHaveLength(1);
    // And the milder case it used to cover.
    expect(clusterFeatures([cell(179.99, 51.0, 1), cell(-179.99, 51.0, 2)], 8)).toHaveLength(1);
  });

  it('tiles the world in whole columns', () => {
    // The property behind the seam fix: column width is derived from an integer
    // count so the columns cover exactly 360 degrees, leaving no partial one to
    // fall into.
    const src = readFileSync('src/utils/featureClusters.js', 'utf8');
    expect(src).toMatch(/const columns = Math\.max\(1, Math\.floor\(360 \/ rawLng\)\)/);
    expect(src).toMatch(/const dLng = 360 \/ columns/);
  });

  it('still separates genuinely distant points near the antimeridian', () => {
    // Wrapping must not glue together things that are actually far apart.
    expect(clusterFeatures([cell(179.99, 51.0, 1), cell(-170.0, 51.0, 2)], 8)).toHaveLength(2);
  });
});
