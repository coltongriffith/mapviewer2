import { describe, it, expect } from 'vitest';
import {
  assertWithinComplexityLimits, MAX_FEATURES, MAX_VERTICES,
} from '../src/utils/importers';

// P0-12: the only bound used to be a 50 MB compressed-file cap. A small file
// could still carry millions of vertices, freezing the UI and bloating every
// subsequent save, share, and export.

const pointFC = (n) => ({
  type: 'FeatureCollection',
  features: Array.from({ length: n }, (_, i) => ({
    type: 'Feature', properties: {},
    geometry: { type: 'Point', coordinates: [i % 180, i % 90] },
  })),
});

const hugePolygon = (vertices) => ({
  type: 'FeatureCollection',
  features: [{
    type: 'Feature', properties: {},
    geometry: {
      type: 'Polygon',
      coordinates: [Array.from({ length: vertices }, (_, i) => [i % 180, i % 90])],
    },
  }],
});

describe('feature-count ceiling', () => {
  it('accepts an ordinary collection', () => {
    expect(() => assertWithinComplexityLimits(pointFC(1000))).not.toThrow();
  });

  it('rejects a collection over the feature cap', () => {
    expect(() => assertWithinComplexityLimits(pointFC(MAX_FEATURES + 1)))
      .toThrow(/maximum is/i);
  });
});

describe('vertex ceiling', () => {
  it('accepts a detailed but reasonable polygon', () => {
    expect(() => assertWithinComplexityLimits(hugePolygon(50_000))).not.toThrow();
  });

  it('rejects a single million-vertex polygon that passes the feature cap', () => {
    // ONE feature — the old feature-count-only thinking would let this in.
    expect(() => assertWithinComplexityLimits(hugePolygon(MAX_VERTICES + 10)))
      .toThrow(/too detailed/i);
  });

  it('bails out at the cap instead of walking the whole payload', () => {
    // Deterministic instead of wall-clock: a lazy coordinate array records how
    // many entries the validator actually touched. A timing assertion here
    // flakes under CI load, which is worse than no assertion.
    let touched = 0;
    const probe = new Proxy([], {
      get(target, prop) {
        if (prop === 'length') return MAX_VERTICES * 2;
        if (typeof prop === 'string' && /^\d+$/.test(prop)) {
          touched += 1;
          return [0, 0];
        }
        return Reflect.get(target, prop);
      },
    });
    const fc = {
      type: 'FeatureCollection',
      features: [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [probe] } }],
    };
    expect(() => assertWithinComplexityLimits(fc)).toThrow(/too detailed/i);
    // Stops shortly after the cap rather than traversing all 6M entries.
    expect(touched).toBeLessThanOrEqual(MAX_VERTICES + 10);
  });
});

describe('shape tolerance', () => {
  it('handles a bare Feature', () => {
    const f = { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [0, 0] } };
    expect(assertWithinComplexityLimits(f)).toBe(f);
  });

  it('handles an empty collection', () => {
    expect(() => assertWithinComplexityLimits({ type: 'FeatureCollection', features: [] })).not.toThrow();
  });

  it('ignores features with null geometry instead of throwing', () => {
    const fc = { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: null }] };
    expect(() => assertWithinComplexityLimits(fc)).not.toThrow();
  });

  it('counts multipolygon rings at the correct depth', () => {
    const mp = {
      type: 'FeatureCollection',
      features: [{
        type: 'Feature', properties: {},
        geometry: {
          type: 'MultiPolygon',
          coordinates: [[[[0, 0], [1, 1], [2, 2], [0, 0]]]],
        },
      }],
    };
    expect(() => assertWithinComplexityLimits(mp)).not.toThrow();
  });
});
