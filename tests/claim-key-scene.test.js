import { describe, it, expect } from 'vitest';
import { createClaimKeySnapshot } from '../src/utils/claimKeyCandidates.js';
import { claimKeyScene } from '../src/utils/claimKeyScene.js';
import { paintFxSvg } from '../src/utils/geoStyle.js';

const polygon = (id, x) => ({ type: 'Feature', id, properties: { CLAIM_ID: id }, geometry: { type: 'Polygon',
  coordinates: [[[x,-10],[x+10,-10],[x+10,-20],[x,-20],[x,-10]]] } });
const project = () => ({ layout: { propertyNeighboursVersion: 1, primaryLayerId: 'claims' }, layers: [{
  id: 'claims', role: 'claims', style: { fill: '#123456' }, geojson: { type: 'FeatureCollection',
    features: [polygon('one', 10), polygon('two', 40), polygon('outside', 140)] } }] });
const view = { pt: (x,y) => [x*10,-y*10], world: (x,y) => [x,-y], k: 10, W: 1000, H: 800, family: 'Inter', obstacles: [] };
const table = { left: 700, top: 400, width: 250, height: 300 };
describe('shared compact-key placement foundation', () => {
  it('prints rows only for actually placed references, with literal IDs and unchanged source', () => {
    const p = project(), before = structuredClone(p), saved = createClaimKeySnapshot(p, 'CLAIM_ID').snapshot;
    const result = claimKeyScene(p, saved, view, table);
    expect(result.rows.map((row) => row.identifier)).toEqual(['one', 'two']);
    expect(result.omitted).toBe(1);
    expect(result.rows.map((row) => row.reference)).toEqual(result.placed.map((item) => item.link.reference));
    const svg = paintFxSvg(result.labels);
    expect(svg).toContain('K1'); expect(svg).toContain('K3'); expect(svg).not.toContain('K2');
    expect(p).toEqual(before);
  });
  it('does not promise locations covered by the reserved table or another panel', () => {
    const p = project(), saved = createClaimKeySnapshot(p, 'CLAIM_ID').snapshot;
    const covered = claimKeyScene(p, saved, view, { left: 0, top: 0, width: 1000, height: 800 });
    expect(covered.rows).toEqual([]); expect(covered.labels).toEqual([]); expect(covered.omitted).toBe(3);
    const blocked = claimKeyScene(p, saved, { ...view, obstacles: [{ left: 0, top: 0, width: 1000, height: 800, key: 'panel' }] }, table);
    expect(blocked.rows).toEqual([]);
  });
  it('requires a valid reserved table and refuses stale source rather than printing partial rows', () => {
    const p = project(), saved = createClaimKeySnapshot(p, 'CLAIM_ID').snapshot;
    expect(claimKeyScene(p, saved, view, null).reason).toBe('key-box-required');
    p.layers[0].geojson.features[0].properties.CLAIM_ID = 'changed';
    expect(claimKeyScene(p, saved, view, table).reason).toBe('rebuild-key');
  });
});
