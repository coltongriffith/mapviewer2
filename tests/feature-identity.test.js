import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  featureKey, isFeatureHidden, hiddenCount, visibleGeojson, featuresInBounds, layerFeatures,
} from '../src/utils/featureIdentity.js';

// Removing a claim from a map is only safe if "which claim is this" means the
// same thing everywhere. It used to be written out three times — App.jsx,
// MapCanvas.jsx and export/renderScene.js — and the export copy is the one that
// matters most: if it ever disagreed, a claim the user removed would vanish
// from the screen and still print in the client's PDF.

const claim = (tenureId, name, ring) => ({
  type: 'Feature',
  properties: { TENURE_NUMBER_ID: tenureId, CLAIM_NAME: name },
  geometry: { type: 'Polygon', coordinates: [ring] },
});

// A square cell centred on (lng, lat).
const cell = (lng, lat, id, name = 'BLOCK') => claim(id, name, [
  [lng - 0.01, lat - 0.01], [lng + 0.01, lat - 0.01],
  [lng + 0.01, lat + 0.01], [lng - 0.01, lat + 0.01], [lng - 0.01, lat - 0.01],
]);

describe('featureKey', () => {
  it('identifies a claim by its registry number, not its name', () => {
    // 22% of B.C. titles have no name and 1,719 names are shared by more than
    // one title, so a name-keyed override would hide claims the user never
    // touched. Two cells of one block, same name, different titles:
    const north = cell(-120, 55, 1084001, 'CRYSTAL LAKE');
    const south = cell(-120, 54, 1084002, 'CRYSTAL LAKE');
    expect(featureKey(north)).not.toBe(featureKey(south));
    expect(featureKey(north)).toBe('TENURE_NUMBER_ID:1084001');
  });

  it('falls back to TAG_NUMBER for registries without a tenure id', () => {
    // api/claims.js normalizes every jurisdiction's claim identifier onto
    // TAG_NUMBER — B.C. tag, BLM serial, Saskatchewan disposition.
    const us = { type: 'Feature', properties: { TAG_NUMBER: 'NMC1234567' }, geometry: null };
    expect(featureKey(us)).toBe('TAG_NUMBER:NMC1234567');
  });

  it('leaves drill-hole keying exactly as it was', () => {
    // Drill-hole records carry none of the claim fields, so inserting those
    // ahead of the old chain cannot change how an existing point layer keys —
    // which matters, because a changed key orphans a style a user already set.
    expect(featureKey({ type: 'Feature', properties: { hole_id: 'DDH-21-001' } })).toBe('DDH-21-001');
    expect(featureKey({ id: 7, properties: { hole_id: 'DDH-21-001' } })).toBe('7');
    expect(featureKey({ properties: { name: 'Target A' } })).toBe('Target A');
  });

  it('always returns a key for a real feature', () => {
    // A feature with no key could not be hidden, styled, or restored.
    const anonymous = { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [1, 2] } };
    expect(featureKey(anonymous)).toBeTruthy();
    expect(featureKey(null)).toBeNull();
  });
});

describe('hiding features', () => {
  const layer = {
    id: 'l1',
    geojson: { type: 'FeatureCollection', features: [cell(-120, 55, 1), cell(-120, 54, 2)] },
    featureOverrides: { 'TENURE_NUMBER_ID:2': { hidden: true } },
  };

  it('drops hidden features from what gets drawn', () => {
    const visible = visibleGeojson(layer);
    expect(visible.features).toHaveLength(1);
    expect(visible.features[0].properties.TENURE_NUMBER_ID).toBe(1);
  });

  it('keeps them in the layer, so they can come back', () => {
    // The whole reason removal is a flag and not a splice.
    expect(layerFeatures(layer)).toHaveLength(2);
    expect(hiddenCount(layer)).toBe(1);
  });

  it('returns the identical object when nothing is hidden', () => {
    // Both renderers and Leaflet's own layer diffing lean on this.
    const untouched = { id: 'l2', geojson: layer.geojson };
    expect(visibleGeojson(untouched)).toBe(untouched.geojson);
  });

  it('does not count an override left behind by a removed feature', () => {
    const stale = { ...layer, featureOverrides: { ...layer.featureOverrides, 'TENURE_NUMBER_ID:999': { hidden: true } } };
    expect(hiddenCount(stale)).toBe(1);
  });

  it('treats a style-only override as visible', () => {
    const styled = { ...layer, featureOverrides: { 'TENURE_NUMBER_ID:1': { markerShape: 'square' } } };
    expect(isFeatureHidden(styled, layerFeatures(styled)[0])).toBe(false);
  });
});

describe('featuresInBounds', () => {
  // The north/south case this was built for: two groups of claims, a box drawn
  // around the southern one.
  const layer = {
    geojson: {
      type: 'FeatureCollection',
      features: [
        cell(-120.0, 55.0, 101), cell(-120.05, 55.05, 102),   // north block
        cell(-120.0, 54.0, 201), cell(-120.05, 54.05, 202),   // south block
      ],
    },
  };
  const southBox = { minLng: -120.2, maxLng: -119.8, minLat: 53.8, maxLat: 54.2 };

  it('catches only the block inside the box', () => {
    const caught = featuresInBounds(layer, southBox);
    expect(caught.map((f) => f.properties.TENURE_NUMBER_ID).sort()).toEqual([201, 202]);
  });

  it('ignores a claim that merely clips the box edge', () => {
    // Centre containment, not overlap. A northern claim whose corner crosses
    // the line is not what the user was pointing at, and overlap selection
    // surprises people in exactly this case.
    const clipping = cell(-120.0, 54.205, 103); // centre just outside, edge inside
    const withClip = { geojson: { type: 'FeatureCollection', features: [...layer.geojson.features, clipping] } };
    const caught = featuresInBounds(withClip, southBox);
    expect(caught.map((f) => f.properties.TENURE_NUMBER_ID)).not.toContain(103);
  });

  it('skips features already removed, so the count reports only real changes', () => {
    const partly = { ...layer, featureOverrides: { 'TENURE_NUMBER_ID:201': { hidden: true } } };
    expect(featuresInBounds(partly, southBox)).toHaveLength(1);
  });

  it('returns nothing for an empty box rather than everything', () => {
    expect(featuresInBounds(layer, null)).toEqual([]);
  });
});

describe('the map and the export cannot disagree', () => {
  it('has exactly one definition of the feature key', () => {
    // The defect this guards is silent and lands in the paid path: a claim
    // removed on screen that still prints in the client's PDF. A behavioural
    // test cannot see a re-introduced copy, so this reads the source.
    const files = [
      'src/App.jsx',
      'src/components/MapCanvas.jsx',
      'src/export/renderScene.js',
    ];
    for (const file of files) {
      const src = readFileSync(file, 'utf8');
      expect(
        /properties\??\.\s*hole_id\s*\|\|/.test(src),
        `${file} re-implements the feature key instead of importing featureKey() `
        + 'from utils/featureIdentity.js — if the copies drift, the map and the '
        + 'export will disagree about which features are hidden',
      ).toBe(false);
      expect(src).toMatch(/from '\.\.?\/[^']*featureIdentity\.js'/);
    }
  });

  it('keeps a removed claim out of the export, even when dissolve is on', async () => {
    // Dissolve merges adjacent polygons into one outline, so a filter applied
    // afterwards is too late: the removed claim has already been absorbed into
    // the block's outer boundary and still prints, just no longer separable.
    //
    // Behavioural, not a source-order check. The source-order version of this
    // test passed against a deliberately broken renderer.
    const { getLayerGeojson } = await import('../src/export/renderScene.js');

    // Two cells side by side, sharing an edge, so dissolve has something to do.
    const west = cell(-120.00, 55, 301);
    const east = cell(-119.98, 55, 302);
    const layer = {
      id: 'l1',
      type: 'polygon',
      style: { dissolve: true },
      geojson: { type: 'FeatureCollection', features: [west, east] },
      featureOverrides: { 'TENURE_NUMBER_ID:302': { hidden: true } },
    };

    const rendered = getLayerGeojson(layer);
    const lngs = JSON.stringify(rendered).match(/-1[12]\d\.\d+/g).map(Number);
    // The removed eastern cell reached to -119.97. If it survived into the
    // dissolve, the merged outline still extends that far east.
    expect(Math.max(...lngs)).toBeLessThan(-119.98);
  });

  it('keeps a removed claim out of the export when dissolve is off', async () => {
    const { getLayerGeojson } = await import('../src/export/renderScene.js');
    const layer = {
      id: 'l1',
      type: 'polygon',
      geojson: { type: 'FeatureCollection', features: [cell(-120, 55, 401), cell(-120, 54, 402)] },
      featureOverrides: { 'TENURE_NUMBER_ID:402': { hidden: true } },
    };
    expect(getLayerGeojson(layer).features).toHaveLength(1);
  });

  it('rebuilds the map when featureOverrides change', () => {
    // MapCanvas has a style-only fast path that skips the rebuild. Removing a
    // feature changes neither geojson nor style, so without featureOverrides in
    // that guard the removed claim stays on screen until an unrelated edit
    // forces a redraw.
    const src = readFileSync('src/components/MapCanvas.jsx', 'utf8');
    const guard = src.slice(src.indexOf('const isStyleOnly'), src.indexOf('if (isStyleOnly)'));
    expect(guard).toMatch(/nl\.featureOverrides === ol\.featureOverrides/);
  });
});
