import { describe, it, expect } from 'vitest';
import { buildLegendItems, technicalResultsTemplate } from '../src/templates/technicalResultsTemplate.js';
import { layerGeometryKind } from '../src/utils/featureIdentity.js';
import { GALLERY_DEMOS } from '../src/assets/galleryDemos.js';
import { fitProjectToTemplate } from '../src/utils/frameMapForTemplate.js';

const line = { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [[-127.2, 55.4], [-127.1, 55.5]] } }] };
const poly = { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[[-127.2, 55.4], [-127.1, 55.4], [-127.1, 55.5], [-127.2, 55.4]]] } }] };

describe('legend rows for gallery-style layers', () => {
  it('gives a road file a line swatch even though the importer typed it geojson', () => {
    expect(layerGeometryKind({ type: 'geojson', geojson: line })).toBe('line');
    expect(layerGeometryKind({ type: 'geojson', geojson: poly })).toBe('polygon');
    const items = buildLegendItems(technicalResultsTemplate, [
      { id: 'r', type: 'geojson', role: 'roads_access', visible: true, geojson: line, displayName: 'Highway 16', legend: { enabled: true } },
    ]);
    expect(items[0].type).toBe('line');
  });

  it('honours a layer-level legend group on a plain row, not only on class rows', () => {
    const items = buildLegendItems(technicalResultsTemplate, [
      { id: 'n', type: 'geojson', role: 'other', visible: true, geojson: poly, displayName: 'Neighbours', legend: { enabled: true, group: 'Context' } },
      { id: 'p', type: 'points', role: 'labels', visible: true, displayName: 'Town', legend: { enabled: true, group: 'Context' },
        geojson: { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [-127.2, 55.4] } }] } },
    ]);
    expect(items.map((i) => i.group)).toEqual(['Context', 'Context']);
  });

  it('every gallery recipe layer keeps a role the legend and importer know', () => {
    for (const recipe of Object.values(GALLERY_DEMOS)) {
      for (const layer of recipe.layers) {
        expect(layer.data?.features?.length, layer.name).toBeGreaterThan(0);
        if (layer.classification) {
          const field = layer.classification.field;
          expect(layer.data.features.some((f) => f.properties?.[field] != null), `${layer.name} has ${field}`).toBe(true);
        }
      }
    }
  });
});

describe('zoomPadFrac', () => {
  const project = (zoomPadFrac) => ({
    layout: { zoomPadFrac },
    layers: [{ id: 'c', role: 'claims', visible: true, geojson: poly }],
  });
  const fit = (p) => {
    let got = null;
    fitProjectToTemplate(p, { fitBounds: (b) => { got = b; } }, { zones: {} }, 'balanced', { focusRoles: true });
    return got;
  };
  it('pads the focus extent when the layout asks, and leaves it alone otherwise', () => {
    const plain = fit(project(undefined));
    const padded = fit(project(1));
    expect(plain.getWest()).toBeCloseTo(-127.2, 6);
    expect(padded.getWest()).toBeCloseTo(-127.3, 6);
    expect(padded.getNorth()).toBeCloseTo(55.6, 6);
  });
});
