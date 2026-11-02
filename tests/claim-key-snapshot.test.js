import { describe, it, expect } from 'vitest';
import { createClaimKeySnapshot, resolveClaimKeySnapshot } from '../src/utils/claimKeyCandidates.js';

const feature = (id, number) => ({ type: 'Feature', id, properties: { CLAIM_ID: number },
  geometry: { type: 'Polygon', coordinates: [[[0,0],[1,0],[1,1],[0,0]]] } });
const project = () => ({ layout: { propertyNeighboursVersion: 1, primaryLayerId: 'subject' },
  layers: [{ id: 'subject', role: 'claims', geojson: { type: 'FeatureCollection',
    features: [feature('a', '001'), feature('b', '002'), feature('c', '003')] } }] });
const snapshot = (p) => createClaimKeySnapshot(p, 'CLAIM_ID').snapshot;

describe('explicit saved claim references', () => {
  it('survives JSON restore and source reorder without renumbering or changing inputs', () => {
    const p = project(), saved = snapshot(p), before = JSON.stringify(saved);
    const restored = JSON.parse(JSON.stringify(p)); restored.layers[0].geojson.features.reverse();
    expect(resolveClaimKeySnapshot(restored, JSON.parse(before)).entries).toEqual(saved.entries);
    expect(JSON.stringify(saved)).toBe(before);
  });
  it('keeps a gap for a hidden shape, and restores exactly its old reference', () => {
    const p = project(), saved = snapshot(p);
    p.layers[0].featureOverrides = { b: { hidden: true } };
    const visible = resolveClaimKeySnapshot(p, saved);
    expect(visible.entries.map((entry) => entry.reference)).toEqual(['K1', 'K3']);
    expect(visible.hidden).toBe(1);
    p.layers[0].featureOverrides.b.hidden = false;
    expect(resolveClaimKeySnapshot(p, saved).entries).toEqual(saved.entries);
  });
  it.each(['added', 'removed', 'changed', 'type-changed', 'subject-changed'])('requires explicit rebuild when source is %s', (change) => {
    const p = project(), saved = snapshot(p), features = p.layers[0].geojson.features;
    if (change === 'added') features.push(feature('d', '004'));
    if (change === 'removed') features.pop();
    if (change === 'changed') features[0].properties.CLAIM_ID = '009';
    if (change === 'type-changed') features[0].properties.CLAIM_ID = 1;
    if (change === 'subject-changed') p.layout.primaryLayerId = 'other';
    expect(resolveClaimKeySnapshot(p, saved)).toMatchObject({ ok: false, reason: 'rebuild-key', entries: [] });
  });
  it('rejects malformed saved reference maps instead of guessing', () => {
    const p = project(), saved = snapshot(p);
    for (const patch of [{ reference: 'Claim 1' }, { reference: ['K1'] }, { reference: 'K201' }, { label: 'invented' }, { identity: '' }]) {
      const bad = structuredClone(saved); Object.assign(bad.entries[0], patch);
      expect(resolveClaimKeySnapshot(p, bad).reason).toBe('invalid-key');
    }
    const duplicate = structuredClone(saved); duplicate.entries[1].reference = duplicate.entries[0].reference;
    expect(resolveClaimKeySnapshot(p, duplicate).reason).toBe('invalid-key');
    expect(resolveClaimKeySnapshot(p, { ...saved, entries: Array(201).fill(saved.entries[0]) }).reason).toBe('invalid-key');
  });
  it('does not create a saved mapping when candidate validation fails', () => {
    const p = project(); p.layers[0].geojson.features[0].properties.CLAIM_ID = '';
    expect(createClaimKeySnapshot(p, 'CLAIM_ID')).toMatchObject({ ok: false, snapshot: null, entries: [] });
  });
});
