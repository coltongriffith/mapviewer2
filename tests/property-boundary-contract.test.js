import { describe, it, expect } from 'vitest';
import dissolve from '@turf/dissolve';
import { visibleGeojson, featureKey } from '../src/utils/featureIdentity.js';
import { canDissolve } from '../src/utils/featureStyle.js';

// Feasibility fixtures only: synthetic rectangles, not actual titles. This
// prototype is deliberately test-local, with no editor, saved-map or export
// binding. A production resolver still needs validation and work limits.
const ring = (x, y, w = 1, h = 1) => [[x,y],[x+w,y],[x+w,y+h],[x,y+h],[x,y]];
const polygon = (id, coordinates) => ({ type: 'Feature', id, properties: { TENURE_NUMBER_ID: id, Cu_ppm: 12 },
  geometry: { type: 'Polygon', coordinates } });
const layer = (features, extra = {}) => ({ id: 'subject', role: 'claims', visible: true, ...extra,
  geojson: { type: 'FeatureCollection', features } });
function overlayOnly(source) {
  const polygons = visibleGeojson(source).features.flatMap((feature) => {
    const geometry = feature.geometry;
    const parts = geometry.type === 'Polygon' ? [geometry.coordinates]
      : geometry.type === 'MultiPolygon' ? geometry.coordinates : null;
    if (!parts) throw new Error('Polygon geometry required');
    return parts.map((coordinates) => ({ type: 'Feature', properties: {},
      geometry: { type: 'Polygon', coordinates: structuredClone(coordinates) } }));
  });
  return polygons.length ? dissolve({ type: 'FeatureCollection', features: polygons })
    : { type: 'FeatureCollection', features: [] };
}
const signedArea = (r) => r.slice(1).reduce((sum, point, i) => sum + r[i][0]*point[1] - point[0]*r[i][1], 0) / 2;
const filledArea = (fc) => fc.features.reduce((sum, f) => sum + Math.abs(signedArea(f.geometry.coordinates[0]))
  - f.geometry.coordinates.slice(1).reduce((holes, r) => holes + Math.abs(signedArea(r)), 0), 0);
const segments = (fc) => fc.features.flatMap((f) => f.geometry.coordinates.flatMap((r) => r.slice(1).map((p, i) => [r[i], p])));

describe('Property exterior overlay feasibility, without replacing source claims', () => {
  it('removes a shared internal edge from only the derived outline', () => {
    const source = layer([polygon('A', [ring(0,0)]), polygon('B', [ring(1,0)])]);
    const before = structuredClone(source), outline = overlayOnly(source);
    expect(outline.features).toHaveLength(1);
    expect(filledArea(outline)).toBe(2);
    expect(segments(outline).some(([a,b]) => a[0] === 1 && b[0] === 1)).toBe(false);
    expect(source).toEqual(before);
    expect(source.geojson.features.map(featureKey)).toEqual(['A', 'B']);
  });
  it('preserves even a narrow positive gap, with no coordinate snapping', () => {
    const gap = .00001;
    const outline = overlayOnly(layer([polygon('A', [ring(0,0)]), polygon('B', [ring(1+gap,0)])]));
    expect(outline.features).toHaveLength(2);
    expect(filledArea(outline)).toBeCloseTo(2, 12);
    expect(outline.features.flatMap((f) => f.geometry.coordinates[0]).some(([x]) => x === 1+gap)).toBe(true);
  });
  it('preserves an interior hole when an adjacent polygon joins the exterior', () => {
    const outline = overlayOnly(layer([polygon('A', [ring(0,0,3,3), ring(1,1).reverse()]), polygon('B', [ring(3,0)])]));
    expect(outline.features).toHaveLength(1);
    expect(outline.features[0].geometry.coordinates).toHaveLength(2);
    expect(Math.abs(signedArea(outline.features[0].geometry.coordinates[1]))).toBe(1);
    expect(filledArea(outline)).toBe(9);
  });
  it('retains disconnected MultiPolygon parts as separate derived polygons', () => {
    const feature = polygon('A', []);
    feature.geometry = { type: 'MultiPolygon', coordinates: [[ring(0,0)], [ring(4,0)]] };
    const before = structuredClone(feature), outline = overlayOnly(layer([feature]));
    expect(outline.features).toHaveLength(2);
    expect(filledArea(outline)).toBe(2);
    expect(feature).toEqual(before);
  });
  it('filters a trimmed claim before deriving the outline and retains its saved record', () => {
    const source = layer([polygon('A', [ring(0,0)]), polygon('B', [ring(1,0)])], { featureOverrides: { B: { hidden: true } } });
    const before = structuredClone(source), outline = overlayOnly(source);
    expect(filledArea(outline)).toBe(1);
    expect(Math.max(...outline.features[0].geometry.coordinates[0].map(([x]) => x))).toBe(1);
    expect(source).toEqual(before);
    expect(source.geojson.features).toHaveLength(2);
  });
  it('does not weaken the existing classified/per-feature dissolve guard', () => {
    const source = layer([polygon('A', [ring(0,0)]), polygon('B', [ring(1,0)])], {
      style: { dissolve: true }, featureOverrides: { A: { fill: '#112233' } },
      classification: { field: 'Cu_ppm', mode: 'numeric', classes: [{ max: 20, color: '#aabbcc' }] },
    });
    const before = structuredClone(source);
    expect(canDissolve(source)).toBe(false);
    expect(filledArea(overlayOnly(source))).toBe(2);
    expect(canDissolve(source)).toBe(false);
    expect(source).toEqual(before);
  });
  it('unions overlapping display geometry without removing either source identity', () => {
    const source = layer([polygon('A', [ring(0,0)]), polygon('B', [ring(.5,0)])]);
    const outline = overlayOnly(source);
    expect(filledArea(outline)).toBe(1.5);
    expect(source.geojson.features.map(featureKey)).toEqual(['A', 'B']);
    expect(outline.features.every((f) => Object.keys(f.properties).length === 0)).toBe(true);
  });
  it('does not give derived coordinates an alias into the source', () => {
    const source = layer([polygon('A', [ring(0,0)])]), before = structuredClone(source);
    const outline = overlayOnly(source);
    outline.features[0].geometry.coordinates[0][0][0] = 99;
    expect(source).toEqual(before);
  });
  it('produces no outline when the entire selected property is hidden', () => {
    const source = layer([polygon('A', [ring(0,0)])], { featureOverrides: { A: { hidden: true } } });
    expect(overlayOnly(source).features).toHaveLength(0);
  });
  it('refuses non-polygon geometry instead of inventing an enclosing shape', () => {
    const point = { type: 'Feature', geometry: { type: 'Point', coordinates: [0,0] }, properties: {} };
    expect(() => overlayOnly(layer([point]))).toThrow('Polygon geometry required');
  });
});
