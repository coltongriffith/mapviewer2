import { describe, it, expect, vi } from 'vitest';
import { createLayerGeometryCache } from '../src/utils/layerGeometry';
import { featureKey } from '../src/utils/featureIdentity';
import regions from '../src/assets/regionsNA.json';
import index from '../src/assets/regionsIndex.json';
const { dissolve } = vi.hoisted(() => ({ dissolve: vi.fn(fc => ({ ...fc, dissolved: true })) }));
vi.mock('@turf/dissolve', () => ({ default: dissolve }));
const a = { type: 'Feature', properties: { id: 'a' }, geometry: { type: 'Polygon', coordinates: [[[0,0],[1,0],[1,1],[0,0]]] } };
const b = { type: 'Feature', properties: { id: 'b' }, geometry: { type: 'Polygon', coordinates: [[[1,0],[2,0],[2,1],[1,0]]] } };

describe('layer geometry reuse', () => {
  it('reuses expensive dissolve across unrelated style edits, but bypasses it for trim', () => {
    dissolve.mockClear();
    const get = createLayerGeometryCache();
    const layer = { geojson: { type: 'FeatureCollection', features: [a,b] } };
    const result = get(layer, { dissolve: true });
    expect(get({ ...layer, style: { stroke: 'red' } }, { dissolve: true })).toBe(result);
    expect(dissolve).toHaveBeenCalledTimes(1);
    expect(get(layer).features).toEqual([a,b]);
    expect(get(layer).dissolved).toBeUndefined();
  });
  it('invalidates hidden-feature geometry before dissolving and on replacement data', () => {
    const get = createLayerGeometryCache();
    const layer = { geojson: { type: 'FeatureCollection', features: [a,b] } };
    const before = get(layer, { dissolve: true });
    const hidden = { ...layer, featureOverrides: { [featureKey(a)]: { hidden: true } } };
    expect(get(hidden, { dissolve: true }).features).toEqual([b]);
    expect(get({ ...layer, geojson: { ...layer.geojson } }, { dissolve: true })).not.toBe(before);
  });
  it('keeps the lightweight region index aligned with full geometry metadata', () => {
    expect(index).toEqual(regions.map(({ id, name, abbrev }) => ({ id, name, abbrev })));
  });
});
