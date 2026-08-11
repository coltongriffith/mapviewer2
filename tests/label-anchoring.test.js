import { describe, it, expect } from 'vitest';
import {
  clusterFeatures, anchorForCluster, layerAnchorGroups, defaultAnchorForLayer,
  isAnchorOrphaned, featureCentroid, haversineKm, clusterLabels,
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
