import { describe, it, expect } from 'vitest';
import { claimKeyCandidates } from '../src/utils/claimKeyCandidates.js';
import { featureKey } from '../src/utils/featureIdentity.js';

const feature = (id, number) => ({ type: 'Feature', id, properties: { TENURE_NUMBER_ID: number },
  geometry: { type: 'Polygon', coordinates: [[[0,0],[1,0],[1,1],[0,0]]] } });
const project = (features = [feature('source-b', '002'), feature('source-a', '001')]) => ({
  layout: { propertyNeighboursVersion: 1, primaryLayerId: 'subject' },
  layers: [{ id: 'subject', role: 'claims', visible: true, geojson: { type: 'FeatureCollection', features } }],
});
const resolve = (p, options) => claimKeyCandidates(p, 'TENURE_NUMBER_ID', options);
describe('explicit compact claim-key candidates', () => {
  it('separates actual feature identity, literal source identifiers and display references without mutation', () => {
    const p = project(), before = structuredClone(p), result = resolve(p);
    expect(result.entries).toEqual([
      { identity: 'source-a', identifier: '001', label: '001', reference: 'K1' },
      { identity: 'source-b', identifier: '002', label: '002', reference: 'K2' },
    ]);
    expect(p).toEqual(before);
    p.layers[0].geojson.features.reverse();
    expect(resolve(p)).toEqual(result);
  });
  it('honours original shared hide keys and keeps numeric source values unchanged', () => {
    const p = project([feature('one', 0), feature('two', 2)]);
    p.layers[0].featureOverrides = { [featureKey(p.layers[0].geojson.features[1])]: { hidden: true } };
    expect(resolve(p).entries).toEqual([{ identity: 'one', identifier: 0, label: '0', reference: 'K1' }]);
  });
  it.each([null, '', ' ', 'ID\u0000', {}, [], true, Infinity, 1.5])('rejects incomplete or nonidentifier values %s', (value) => {
    expect(resolve(project([feature('one', value)]))).toMatchObject({ ok: false, reason: 'incomplete-identifiers', entries: [] });
  });
  it('rejects duplicate identifiers and identity collisions rather than creating misleading rows', () => {
    expect(resolve(project([feature('a', '1'), feature('b', 1)])).reason).toBe('duplicate-identifiers');
    expect(resolve(project([feature('a', '1'), feature('a', '2')])).reason).toBe('duplicate-feature-identity');
  });
  it('does not invent geometry identities or silently drop rows', () => {
    const f = feature(undefined, undefined);
    expect(resolve(project([f])).reason).toBe('supplied-identity-required');
    expect(resolve(project(), { maxRows: 1 })).toEqual({ ok: false, reason: 'row-limit', total: 2, entries: [] });
    expect(resolve(project(Array.from({ length: 5001 }, (_, i) => feature(i, i)))).reason).toBe('feature-limit');
  });
  it('requires an eligible explicit property and an explicit literal field', () => {
    const p = project();
    expect(claimKeyCandidates(p, '').reason).toBe('select-identifier-field');
    expect(claimKeyCandidates(p, 'ID\u0000').reason).toBe('select-identifier-field');
    delete p.layout.primaryLayerId;
    expect(resolve(p).reason).toBe('select-property');
    for (const patch of [{ visible: false }, { focus: false }, { role: 'roads_access' }]) {
      const q = project(); Object.assign(q.layers[0], patch);
      expect(resolve(q).reason).toBe('select-property');
    }
  });
  it('refuses empty, nonpolygon and invalid row limits', () => {
    expect(resolve(project([])).reason).toBe('no-visible-claims');
    const p = project(); p.layers[0].geojson.features[0].geometry.type = 'Point';
    expect(resolve(p).reason).toBe('polygon-required');
    expect(resolve(project(), { maxRows: 201 }).reason).toBe('invalid-row-limit');
  });
});
