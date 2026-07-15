import { describe, it, expect } from 'vitest';
import { ringsToGeoJSON, esriGeometryToGeoJSON } from '../api/_lib/esri.js';

// Ring helpers. Esri convention: exterior rings are CLOCKWISE, holes are
// counter-clockwise. In x-east/y-north coordinates, clockwise means the
// vertices run e.g. (0,0) → (0,10) → (10,10) → (10,0) → (0,0).
const cw = (x0, y0, size) => [
  [x0, y0], [x0, y0 + size], [x0 + size, y0 + size], [x0 + size, y0], [x0, y0],
];
const ccw = (x0, y0, size) => [
  [x0, y0], [x0 + size, y0], [x0 + size, y0 + size], [x0, y0 + size], [x0, y0],
];

describe('ringsToGeoJSON', () => {
  it('simple polygon: one exterior ring → Polygon', () => {
    const g = ringsToGeoJSON([cw(0, 0, 10)]);
    expect(g.type).toBe('Polygon');
    expect(g.coordinates).toHaveLength(1);
    expect(g.coordinates[0]).toEqual(cw(0, 0, 10)); // ring closure preserved
  });

  it('polygon with hole: exterior + contained CCW ring → Polygon with 2 rings', () => {
    const g = ringsToGeoJSON([cw(0, 0, 10), ccw(3, 3, 2)]);
    expect(g.type).toBe('Polygon');
    expect(g.coordinates).toHaveLength(2);
    expect(g.coordinates[0]).toEqual(cw(0, 0, 10));
    expect(g.coordinates[1]).toEqual(ccw(3, 3, 2));
  });

  it('two separate polygons → MultiPolygon (NOT one polygon with a fake hole)', () => {
    const g = ringsToGeoJSON([cw(0, 0, 10), cw(100, 100, 5)]);
    expect(g.type).toBe('MultiPolygon');
    expect(g.coordinates).toHaveLength(2);
    expect(g.coordinates[0]).toEqual([cw(0, 0, 10)]);
    expect(g.coordinates[1]).toEqual([cw(100, 100, 5)]);
  });

  it('two polygons, each with holes: holes attach to the CORRECT exterior', () => {
    const g = ringsToGeoJSON([
      cw(0, 0, 10), cw(100, 100, 10),      // two exteriors
      ccw(102, 102, 2),                     // hole in the SECOND polygon
      ccw(2, 2, 2),                         // hole in the FIRST polygon
    ]);
    expect(g.type).toBe('MultiPolygon');
    expect(g.coordinates[0]).toEqual([cw(0, 0, 10), ccw(2, 2, 2)]);
    expect(g.coordinates[1]).toEqual([cw(100, 100, 10), ccw(102, 102, 2)]);
  });

  it('invalid ring input is handled safely', () => {
    expect(ringsToGeoJSON(null)).toBeNull();
    expect(ringsToGeoJSON([])).toBeNull();
    expect(ringsToGeoJSON([[[0, 0], [1, 1]]])).toBeNull();               // too short
    expect(ringsToGeoJSON([[[0, 0], ['x', 1], [1, 1], [0, 0]]])).toBeNull(); // NaN coords
    // A valid ring among invalid ones still converts
    const g = ringsToGeoJSON([[[0, 0], [1, 1]], cw(0, 0, 5)]);
    expect(g.type).toBe('Polygon');
  });

  it('all-counter-clockwise input (nonconforming server) still yields polygons', () => {
    const g = ringsToGeoJSON([ccw(0, 0, 10), ccw(50, 50, 10)]);
    expect(g.type).toBe('MultiPolygon');
    expect(g.coordinates).toHaveLength(2);
  });

  it('does not mutate source coordinates', () => {
    const src = [cw(0, 0, 10), ccw(3, 3, 2)];
    const snapshot = JSON.parse(JSON.stringify(src));
    ringsToGeoJSON(src);
    expect(src).toEqual(snapshot);
  });
});

describe('esriGeometryToGeoJSON', () => {
  it('converts points, multipoints, and paths', () => {
    expect(esriGeometryToGeoJSON({ x: -123, y: 49 })).toEqual({ type: 'Point', coordinates: [-123, 49] });
    expect(esriGeometryToGeoJSON({ points: [[-123, 49], [-124, 50]] }).type).toBe('MultiPoint');
    expect(esriGeometryToGeoJSON({ paths: [[[0, 0], [1, 1]]] }).type).toBe('LineString');
    expect(esriGeometryToGeoJSON({ paths: [[[0, 0], [1, 1]], [[2, 2], [3, 3]]] }).type).toBe('MultiLineString');
  });

  it('handles empty or malformed geometry safely', () => {
    expect(esriGeometryToGeoJSON(null)).toBeNull();
    expect(esriGeometryToGeoJSON({})).toBeNull();
    expect(esriGeometryToGeoJSON({ x: 'nope', y: 49 })).toBeNull();
    expect(esriGeometryToGeoJSON({ rings: 'garbage' })).toBeNull();
    expect(esriGeometryToGeoJSON({ paths: [] })).toBeNull();
  });
});
