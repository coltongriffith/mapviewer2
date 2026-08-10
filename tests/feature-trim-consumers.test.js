import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { hasVisibleFeatures, visibleGeojson, featureKey } from '../src/utils/featureIdentity.js';
import { buildLegendItems } from '../src/templates/technicalResultsTemplate.js';
import { buildLegendItemsNI43101 } from '../src/templates/technicalReportTemplate.js';
import { buildSidePanelLegendItems } from '../src/templates/sidePanelTemplate.js';
import { getLayerGeojson } from '../src/export/renderScene.js';

// Hiding a feature is only honest if EVERY consumer of the layer's geometry
// agrees it is gone. Filtering the two vector renderers was not enough: framing,
// the locator insets and three separate legend builders all still read
// layer.geojson, so "Refit Map" zoomed back out over the block the user had just
// removed and the legend went on naming a layer with nothing left on the page.

const cell = (lng, lat, id) => ({
  type: 'Feature',
  properties: { TENURE_NUMBER_ID: id, CLAIM_NAME: `CELL ${id}` },
  geometry: {
    type: 'Polygon',
    coordinates: [[
      [lng - 0.01, lat - 0.01], [lng + 0.01, lat - 0.01],
      [lng + 0.01, lat + 0.01], [lng - 0.01, lat + 0.01], [lng - 0.01, lat - 0.01],
    ]],
  },
});

const layerWith = (features, overrides = {}) => ({
  id: 'l1', name: 'Claims', displayName: 'Claims', role: 'claims', type: 'polygon',
  visible: true, legend: { enabled: true }, style: {},
  geojson: { type: 'FeatureCollection', features },
  featureOverrides: overrides,
});

const north = cell(-120, 56, 1);
const south = cell(-120, 50, 2);

describe('hasVisibleFeatures', () => {
  it('is false only when every shape is gone', () => {
    const all = layerWith([north, south]);
    expect(hasVisibleFeatures(all)).toBe(true);
    expect(hasVisibleFeatures(layerWith([north, south], { 'TENURE_NUMBER_ID:2': { hidden: true } }))).toBe(true);
    expect(hasVisibleFeatures(layerWith([north, south], {
      'TENURE_NUMBER_ID:1': { hidden: true }, 'TENURE_NUMBER_ID:2': { hidden: true },
    }))).toBe(false);
  });

  it('treats an empty layer as absent', () => {
    expect(hasVisibleFeatures(layerWith([]))).toBe(false);
  });
});

describe('the legend does not name a layer with nothing left', () => {
  const emptied = layerWith([north, south], {
    'TENURE_NUMBER_ID:1': { hidden: true }, 'TENURE_NUMBER_ID:2': { hidden: true },
  });
  const partly = layerWith([north, south], { 'TENURE_NUMBER_ID:2': { hidden: true } });
  const template = { roleOrder: ['claims'], roleStyles: {}, roleGroups: {} };

  it('drops a fully trimmed layer from the technical-results legend', () => {
    expect(buildLegendItems(template, [emptied])).toHaveLength(0);
    expect(buildLegendItems(template, [partly]).length).toBeGreaterThan(0);
  });

  it('drops it from the NI 43-101 legend', () => {
    expect(buildLegendItemsNI43101(template, [emptied])).toHaveLength(0);
    expect(buildLegendItemsNI43101(template, [partly]).length).toBeGreaterThan(0);
  });

  it('drops it from the side-panel legend', () => {
    // Third builder, and the one the review did not mention — found by sweeping
    // for the rule rather than by fixing the two that were reported.
    expect(buildSidePanelLegendItems([emptied], {})).toHaveLength(0);
    expect(buildSidePanelLegendItems([partly], {}).length).toBeGreaterThan(0);
  });

  it('still names a layer that was never trimmed', () => {
    const untouched = layerWith([north, south]);
    expect(buildLegendItems(template, [untouched]).length).toBeGreaterThan(0);
    expect(buildSidePanelLegendItems([untouched], {}).length).toBeGreaterThan(0);
  });
});

describe('framing and locator bounds follow the trim', () => {
  it('frames to the remaining shapes, not the original extent', async () => {
    // The workflow this feature exists for: drop the southern block so the
    // northern one can fill the page. Framing to the untrimmed extent would
    // zoom straight back out and undo it.
    const { default: L } = await import('leaflet');
    const trimmed = layerWith([north, south], { 'TENURE_NUMBER_ID:2': { hidden: true } });

    const full = L.geoJSON(trimmed.geojson).getBounds();
    const kept = L.geoJSON(visibleGeojson(trimmed)).getBounds();

    expect(full.getSouth()).toBeLessThan(51);       // reaches the southern block
    expect(kept.getSouth()).toBeGreaterThan(55);    // does not
  });

  it('has no geometry consumer left reading layer.geojson directly', () => {
    // The defect class, not one instance of it: every place that measures a
    // layer must measure what is on the map. Reported for framing and the two
    // locator insets; this also caught the nearby-claims search origin.
    const files = [
      'src/utils/frameMapForTemplate.js',
      'src/components/LocatorInset.jsx',
      'src/export/renderScene.js',
    ];
    for (const file of files) {
      const src = readFileSync(file, 'utf8');
      expect(
        /geojsonBounds\(\s*(?:layer|l)\.geojson\s*\)|L\.geoJSON\(\s*layer\.geojson\s*\)/.test(src),
        `${file} measures layer.geojson directly — removed shapes would still `
        + 'pull the frame or the locator box out over ground the user deleted',
      ).toBe(false);
    }
  });
});

describe('trimming a dissolved layer', () => {
  it('cannot key an override off dissolved output', async () => {
    // dissolveGeo emits ONE feature with EMPTY properties, so a click on a
    // dissolved layer used to hand featureKey a shape with no registry
    // identity: the override landed under the merged outline's coordinates,
    // matched no original feature, and the click silently did nothing.
    const { default: dissolveGeo } = await import('@turf/dissolve');
    const west = cell(-120.00, 55, 301);
    const east = cell(-119.98, 55, 302);
    const merged = dissolveGeo({ type: 'FeatureCollection', features: [west, east] });

    expect(merged.features).toHaveLength(1);
    expect(merged.features[0].properties).toEqual({});

    const mergedKey = featureKey(merged.features[0]);
    const realKeys = [west, east].map(featureKey);
    expect(realKeys).not.toContain(mergedKey);
  });

  it('suspends dissolve for the layer being trimmed', () => {
    // The fix: while trimming, the layer renders un-dissolved, so clicks land on
    // real cells that carry a registry identity — and the user can actually see
    // the individual cells they are being asked to pick.
    const src = readFileSync('src/components/MapCanvas.jsx', 'utf8');
    expect(src).toMatch(/const trimming = trimLayerId === layer\.id;/);
    expect(src).toMatch(/if \(style\.dissolve && !trimming/);
  });

  it('rebuilds rather than taking the style-only path when trim mode changes', () => {
    // Entering trim mode changes whether the layer is dissolved, which is a
    // geometry change. The fast path would otherwise leave the dissolved
    // outline on screen with nothing clickable.
    const src = readFileSync('src/components/MapCanvas.jsx', 'utf8');
    const guard = src.slice(src.indexOf('const trimChanged'), src.indexOf('if (isStyleOnly)'));
    expect(guard).toMatch(/!trimChanged/);
  });

  it('exports the same geometry the map draws', () => {
    const trimmed = layerWith([north, south], { 'TENURE_NUMBER_ID:2': { hidden: true } });
    expect(getLayerGeojson(trimmed).features).toHaveLength(1);
  });
});
