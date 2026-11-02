import { describe, it, expect, vi } from 'vitest';
import dissolve from '@turf/dissolve';
import { createPropertyBoundaryResolver } from '../src/utils/propertyBoundaryGeometry.js';
import { BOUNDARY_INPUT_LIMITS } from '../src/utils/propertyBoundaryInput.js';

const ring = (x, y = 0) => [[x,y],[x+1,y],[x+1,y+1],[x,y+1],[x,y]];
const feature = (id, coordinates) => ({ type: 'Feature', id, properties: { TENURE_NUMBER_ID: id },
  geometry: { type: 'Polygon', coordinates } });
const project = () => ({ layout: { propertyNeighboursVersion: 1, primaryLayerId: 'subject' }, layers: [{ id: 'subject', role: 'claims',
  style: { fill: '#ffffff' }, geojson: { type: 'FeatureCollection', features: [feature('A',[ring(0)]),feature('B',[ring(1)])] } }] });
const enabled = { enabled: true };

describe('Property boundary union output and immutable visibility cache', () => {
  it('returns a separate exterior with no shared internal edge or copied identifiers', () => {
    const p = project(), before = structuredClone(p);
    const result = createPropertyBoundaryResolver()(p,enabled);
    expect(result).toMatchObject({ ok: true, layerId: 'subject' });
    expect(result.geometry.features).toHaveLength(1);
    expect(result.geometry.features[0].properties).toEqual({});
    const r = result.geometry.features[0].geometry.coordinates[0];
    expect(r.slice(1).some((point,i) => r[i][0] === 1 && point[0] === 1)).toBe(false);
    expect(p).toEqual(before);
  });
  it('preserves a hole and narrow positive gap in the actual derived output', () => {
    const p = project(), shell = [[0,0],[3,0],[3,3],[0,3],[0,0]];
    p.layers[0].geojson.features = [feature('A',[shell,ring(1,1).reverse()]),feature('B',[ring(3.00001)])];
    const result = createPropertyBoundaryResolver()(p,enabled);
    expect(result.ok).toBe(true);
    expect(result.geometry.features).toHaveLength(2);
    expect(result.geometry.features.map((f) => f.geometry.coordinates.length).sort()).toEqual([1,2]);
  });
  it('reuses the exact frozen geometry across layer and per-feature styling changes', () => {
    const union = vi.fn(dissolve), resolve = createPropertyBoundaryResolver(union), p = project();
    const first = resolve(p,enabled);
    const layer = { ...p.layers[0], style: { fill: '#112233' }, featureOverrides: { A: { stroke: '#aabbcc' }, unused: { hidden: true } },
      classification: { field: 'Au_ppm', mode: 'numeric', classes: [{ max: 10, color: '#ffffff' }] } };
    const second = resolve({ ...p, layers: [layer] },enabled);
    expect(second.geometry).toBe(first.geometry);
    expect(union).toHaveBeenCalledTimes(1);
    expect(Object.isFrozen(first.geometry.features[0].geometry.coordinates[0][0])).toBe(true);
    expect(() => { first.geometry.features[0].geometry.coordinates[0][0][0] = 99; }).toThrow();
  });
  it('recomputes hidden geometry and reuses its prior output when visibility is restored', () => {
    const union = vi.fn(dissolve), resolve = createPropertyBoundaryResolver(union), p = project();
    const first = resolve(p,enabled);
    const hidden = { ...p, layers: [{ ...p.layers[0], featureOverrides: { B: { hidden: true } } }] };
    const trimmed = resolve(hidden,enabled);
    expect(Math.max(...trimmed.geometry.features[0].geometry.coordinates[0].map(([x]) => x))).toBe(1);
    expect(resolve(p,enabled).geometry).toBe(first.geometry);
    expect(union).toHaveBeenCalledTimes(2);
    expect(p.layers[0].geojson.features).toHaveLength(2);
  });
  it('recomputes after immutable source geometry replacement', () => {
    const union = vi.fn(dissolve), resolve = createPropertyBoundaryResolver(union), p = project();
    const first = resolve(p,enabled), copy = structuredClone(p);
    expect(resolve(copy,enabled).geometry).not.toBe(first.geometry);
    expect(union).toHaveBeenCalledTimes(2);
  });
  it('rechecks explicit selection and visibility even after a successful cache entry', () => {
    const union = vi.fn(dissolve), resolve = createPropertyBoundaryResolver(union), p = project();
    resolve(p,enabled);
    expect(resolve(p).reason).toBe('disabled');
    expect(resolve({ ...p, layout: { ...p.layout, primaryLayerId: 'missing' } },enabled).reason).toBe('select-property');
    expect(resolve({ ...p, layers: [{ ...p.layers[0], visible: false }] },enabled).reason).toBe('select-property');
    expect(union).toHaveBeenCalledTimes(1);
  });
  it('does not invoke union for invalid or wholly hidden source input', () => {
    const union = vi.fn(dissolve), resolve = createPropertyBoundaryResolver(union), p = project();
    expect(resolve({ ...p, layers: [{ ...p.layers[0], featureOverrides: { A: { hidden: true }, B: { hidden: true } } }] },enabled).reason).toBe('no-visible-claims');
    const invalid = structuredClone(p); invalid.layers[0].geojson.features[0].geometry.coordinates[0].pop();
    expect(resolve(invalid,enabled).reason).toBe('open-ring');
    expect(union).not.toHaveBeenCalled();
  });
  it('returns no fallback outline after union failure and caches the failure', () => {
    const union = vi.fn(() => { throw new Error('topology'); }), resolve = createPropertyBoundaryResolver(union), p = project();
    expect(resolve(p,enabled)).toEqual({ ok: false, reason: 'union-failed', geometry: null });
    expect(resolve(p,enabled).geometry).toBeNull();
    expect(union).toHaveBeenCalledTimes(1);
  });
  it.each([null, {}, { type: 'FeatureCollection', features: [] }, { type: 'FeatureCollection', features: [feature('bad',[[[0,0],[1,0],[1,1],[0,1]]])] }])('rejects malformed or invalid derived output', (output) => {
    expect(createPropertyBoundaryResolver(() => output)(project(),enabled)).toEqual({ ok: false, reason: 'invalid-derived-geometry', geometry: null });
  });
  it('bounds derived output even when the source was small', () => {
    const output = { type: 'FeatureCollection', features: Array.from({ length: BOUNDARY_INPUT_LIMITS.features+1 }, () => feature('x',[ring(0)])) };
    expect(createPropertyBoundaryResolver(() => output)(project(),enabled)).toEqual({ ok: false, reason: 'derived-complexity-limit', geometry: null });
  });
  it('keeps only four visibility states per immutable geometry', () => {
    const p = project(); p.layers[0].geojson.features.push(feature('C',[ring(4)]));
    const union = vi.fn(dissolve), resolve = createPropertyBoundaryResolver(union);
    for (const flags of ['111','110','101','100','011','111']) {
      const featureOverrides = Object.fromEntries(p.layers[0].geojson.features.map((f,i) => [f.id,{ hidden: flags[i] === '0' }]));
      expect(resolve({ ...p, layers: [{ ...p.layers[0], featureOverrides }] },enabled).ok).toBe(true);
    }
    expect(union).toHaveBeenCalledTimes(6);
  });
});
