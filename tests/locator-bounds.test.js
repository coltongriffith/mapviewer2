import { describe, it, expect } from 'vitest';
import { locatorBounds } from '../src/utils/locatorBounds.js';
import { featureKey } from '../src/utils/featureIdentity.js';
import { geojsonBounds } from '../src/utils/geometry.js';

// Synthetic QA geometry only, not real claims or drill positions.
const polygon = (id, x, y) => ({ type: 'Feature', id, properties: { id },
  geometry: { type: 'Polygon', coordinates: [[[x, y], [x + .02, y], [x + .02, y + .02], [x, y + .02], [x, y]]] } });
const layer = (id, x, y, extra = {}) => ({ id, role: 'claims', visible: true, type: 'geojson', ...extra,
  geojson: { type: 'FeatureCollection', features: [polygon(id, x, y)] } });
const subject = () => layer('subject', -120, 50);
const context = () => layer('context', -115, 52, { focus: false });
const selected = { propertyNeighboursVersion: 1, primaryLayerId: 'subject' };

describe('Property locator subject marker with unchanged regional context', () => {
  it('uses the explicit property marker while retaining a distant context extent', () => {
    const layers = [subject(), context()], before = structuredClone(layers);
    const { markerBounds, contextBounds } = locatorBounds(layers, selected);
    expect(markerBounds).toEqual(geojsonBounds(layers[0].geojson));
    expect(contextBounds).toMatchObject({ minLng: -120, maxLng: -114.98, maxLat: 52.02 });
    expect(layers).toEqual(before);
  });
  it('does not change any other template, unselected property or custom image', () => {
    for (const layout of [{}, { primaryLayerId: 'subject' }, { propertyNeighboursVersion: 1 }, { ...selected, insetMode: 'custom_image' }]) {
      const result = locatorBounds([subject(), context()], layout);
      expect(result.markerBounds).toEqual(result.contextBounds);
    }
  });
  it('does not select a different sole property when the stored subject is stale', () => {
    const result = locatorBounds([subject(), context()], { ...selected, primaryLayerId: 'missing' });
    expect(result.markerBounds).toEqual(result.contextBounds);
  });
  it.each([{ visible: false }, { focus: false }, { role: 'roads_access' }])('falls back safely for an ineligible primary: %j', (patch) => {
    const result = locatorBounds([{ ...subject(), ...patch }, layer('other', -115, 52)], selected);
    expect(result.markerBounds).toEqual(result.contextBounds);
  });
  it('uses only retained subject polygons after trimming', () => {
    const source = subject(), removed = polygon('removed', -100, 45);
    source.geojson.features.push(removed);
    source.featureOverrides = { [featureKey(removed)]: { hidden: true } };
    const result = locatorBounds([source, context()], selected);
    expect(result.markerBounds).toEqual(geojsonBounds(source.geojson.features[0]));
    expect(result.contextBounds.maxLng).toBe(-114.98);
    expect(source.geojson.features).toHaveLength(2);
  });
  it('does not fall through to another property when the selected subject was fully removed', () => {
    const source = subject();
    source.featureOverrides = { [featureKey(source.geojson.features[0])]: { hidden: true } };
    const result = locatorBounds([source, layer('other', -115, 52)], selected);
    expect(result.markerBounds).toEqual(result.contextBounds);
    expect(result.contextBounds).toEqual(geojsonBounds(layer('other', -115, 52).geojson));
  });
  it('never infers a subject in an ambiguous project without a selected ID', () => {
    const result = locatorBounds([subject(), layer('other', -115, 52)], { propertyNeighboursVersion: 1 });
    expect(result.markerBounds).toEqual(result.contextBounds);
  });
  it('ignores hidden context and returns honest null bounds for empty data', () => {
    const result = locatorBounds([subject(), { ...context(), visible: false }], selected);
    expect(result.contextBounds).toEqual(result.markerBounds);
    expect(locatorBounds([], selected)).toEqual({ contextBounds: null, markerBounds: null });
    expect(locatorBounds(null, selected)).toEqual({ contextBounds: null, markerBounds: null });
  });
});
