import { describe, it, expect } from 'vitest';
import dissolve from '@turf/dissolve';
import { propertyBoundaryInput, BOUNDARY_INPUT_LIMITS } from '../src/utils/propertyBoundaryInput.js';
import { canDissolve } from '../src/utils/featureStyle.js';

const ring = (x = 0, y = 0, w = 1) => [[x,y],[x+w,y],[x+w,y+1],[x,y+1],[x,y]];
const feature = (id = 'A', coordinates = [ring()]) => ({ type: 'Feature', id,
  properties: { TENURE_NUMBER_ID: id, Au_ppm: 7 }, geometry: { type: 'Polygon', coordinates } });
const project = (features = [feature()]) => ({ layout: { propertyNeighboursVersion: 1, primaryLayerId: 'subject' },
  layers: [{ id: 'subject', role: 'claims', visible: true, geojson: { type: 'FeatureCollection', features } }] });
const candidate = (p) => propertyBoundaryInput(p, { enabled: true });
const failed = (p, reason) => expect(candidate(p)).toEqual({ ok: false, reason, polygons: [] });

describe('Bounded explicit input for a future property exterior overlay', () => {
  it('defaults off, without a saved setting or automatic subject inference', () => {
    expect(propertyBoundaryInput(project()).reason).toBe('disabled');
    const p = project(); delete p.layout.primaryLayerId; failed(p,'select-property');
  });
  it.each([{ propertyNeighboursVersion: undefined }, { primaryLayerId: 'stale' }])('rejects inactive/stale selections: %j', (patch) => {
    const p = project(); Object.assign(p.layout,patch); failed(p,'select-property');
  });
  it.each([{ visible: false }, { focus: false }, { role: 'roads_access' }])('does not replace an ineligible selected layer: %j', (patch) => {
    const p = project(); Object.assign(p.layers[0],patch);
    p.layers.push({ ...p.layers[0], id: 'other', visible: true, focus: true, role: 'claims' });
    failed(p,'select-property');
  });
  it('refuses duplicate selected layer IDs instead of choosing the first', () => {
    const p = project(); p.layers.push(structuredClone(p.layers[0])); failed(p,'select-property');
  });
  it('copies only 2D coordinates, preserving all source fields, IDs, classes and expert styles', () => {
    const p = project(); Object.assign(p.layers[0], { style: { dissolve: true }, featureOverrides: { A: { fill: '#123456' } },
      classification: { field: 'Au_ppm', mode: 'numeric', classes: [{ max: 10, color: '#ffffff' }] } });
    p.layers[0].geojson.features[0].geometry.coordinates[0].forEach((point) => point.push(200));
    const before = structuredClone(p), result = candidate(p);
    expect(result).toMatchObject({ ok: true, layerId: 'subject', polygons: [[ring()]] });
    expect(canDissolve(p.layers[0])).toBe(false);
    result.polygons[0][0][0][0] = 99;
    expect(p).toEqual(before);
  });
  it('retains a narrow gap and hole in validated input through the existing union', () => {
    const outer = [[0,0],[3,0],[3,3],[0,3],[0,0]], hole = ring(1,1).reverse();
    const p = project([feature('A',[outer,hole]), feature('B',[ring(3.00001,0)])]);
    const result = candidate(p); expect(result.ok).toBe(true);
    const union = dissolve({ type: 'FeatureCollection', features: result.polygons.map((coordinates) => ({ type: 'Feature',
      properties: {}, geometry: { type: 'Polygon', coordinates } })) });
    expect(union.features).toHaveLength(2);
    expect(union.features.map((f) => f.geometry.coordinates.length).sort()).toEqual([1,2]);
  });
  it('flattens MultiPolygon parts without connecting them', () => {
    const p = project(); p.layers[0].geojson.features[0].geometry = { type: 'MultiPolygon', coordinates: [[ring()],[ring(4,0)]] };
    expect(candidate(p).polygons).toEqual([[ring()],[ring(4,0)]]);
  });
  it('excludes hidden claims using the existing identity contract', () => {
    const p = project([feature('A'),feature('B',[ring(2,0)])]);
    p.layers[0].featureOverrides = { B: { hidden: true } };
    expect(candidate(p).polygons).toEqual([[ring()]]);
    p.layers[0].featureOverrides.A = { hidden: true }; failed(p,'no-visible-claims');
    expect(p.layers[0].geojson.features).toHaveLength(2);
  });
  it('refuses an open ring, without closing or repairing it', () => {
    failed(project([feature('A',[[[0,0],[1,0],[1,1],[0,1]]])]),'open-ring');
  });
  it.each([NaN, Infinity, '1', 181])('rejects invalid coordinates: %s', (value) => {
    const p = project(); p.layers[0].geojson.features[0].geometry.coordinates[0][1][0] = value; failed(p,'invalid-coordinate');
  });
  it('refuses antimeridian edges rather than drawing across the entire map', () => {
    failed(project([feature('A',[[[179,0],[-179,0],[-179,1],[179,1],[179,0]]])]),'antimeridian-unsupported');
  });
  it.each([
    [[0,0],[2,2],[0,2],[2,0],[0,0]],
    [[0,0],[2,0],[1,0],[1,1],[0,0]],
    [[0,0],[2,0],[2,2],[1,0],[0,2],[0,0]],
  ].map((r) => ({ ring: r })))('rejects crossed, backtracking or self-touching rings', ({ ring: r }) => {
    failed(project([feature('A',[r])]),'invalid-topology');
  });
  it('rejects a hole outside the shell or nested inside another hole', () => {
    failed(project([feature('A',[ring(),ring(4,4)])]),'invalid-hole');
    const shell = [[0,0],[6,0],[6,6],[0,6],[0,0]], h1 = [[1,1],[5,1],[5,5],[1,5],[1,1]];
    failed(project([feature('A',[shell,h1,ring(2,2)])]),'invalid-hole');
  });
  it('refuses shell/hole touching instead of silently repairing topology', () => {
    const shell = [[0,0],[3,0],[3,3],[0,3],[0,0]];
    failed(project([feature('A',[shell,ring(0,1)])]),'invalid-topology');
  });
  it('bounds source count even when every feature is hidden', () => {
    const p = project(Array.from({ length: BOUNDARY_INPUT_LIMITS.features+1 }, (_,i) => feature(String(i))));
    p.layers[0].featureOverrides = Object.fromEntries(p.layers[0].geojson.features.map((f) => [f.id,{ hidden: true }]));
    failed(p,'complexity-limit');
  });
  it('bounds polygon count before topology work', () => {
    const p = project(); p.layers[0].geojson.features[0].geometry = { type: 'MultiPolygon',
      coordinates: Array.from({ length: BOUNDARY_INPUT_LIMITS.polygons+1 }, () => [ring()]) };
    failed(p,'complexity-limit');
  });
  it('bounds ring and coordinate counts before scanning topology', () => {
    failed(project([feature('A',Array.from({ length: BOUNDARY_INPUT_LIMITS.rings+1 }, () => ring()))]),'complexity-limit');
    const oversized = Array.from({ length: BOUNDARY_INPUT_LIMITS.points+1 }, () => [0,0]);
    failed(project([feature('A',[oversized])]),'complexity-limit');
  });
  it('bounds segment-pair comparisons even when coordinate count is under its limit', () => {
    const r = Array.from({ length: 700 }, (_,i) => [Math.cos(i/700*2*Math.PI),Math.sin(i/700*2*Math.PI)]);
    r.push([...r[0]]); failed(project([feature('A',[r])]),'complexity-limit');
  });
  it('rejects non-polygon or malformed source arrays without throwing', () => {
    const p = project(); p.layers[0].geojson.features[0].geometry = { type: 'Point', coordinates: [0,0] }; failed(p,'polygon-required');
    p.layers[0].geojson.features = {}; failed(p,'polygon-required');
    p.layers = {}; failed(p,'select-property');
  });
});
