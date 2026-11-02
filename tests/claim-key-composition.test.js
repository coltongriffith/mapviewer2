import { describe, it, expect } from 'vitest';
import { claimKeyComposition } from '../src/utils/claimKeyComposition.js';
import { createClaimKeySnapshot } from '../src/utils/claimKeyCandidates.js';
import { fxScene, boxesOverlap } from '../src/utils/geoStyle.js';

const view = { pt: (x,y) => [x*10,-y*10], world: (x,y) => [x,-y], k: 10, W: 1000, H: 800, family: 'Inter', obstacles: [] };
function fixture() {
  const layer = { id: 'property', role: 'claims', style: { fill: '#123456' }, geojson: { type: 'FeatureCollection', features: [
    { type: 'Feature', id: 'claim', properties: { ID: 'Supplied 001' }, geometry: { type: 'Polygon', coordinates: [[[10,-10],[30,-10],[30,-30],[10,-30],[10,-10]]] } },
  ] } };
  const p = { layers: [layer], layout: { primaryLayerId: 'property', propertyNeighboursVersion: 1 } };
  p.layout.claimKey = createClaimKeySnapshot(p, 'ID').snapshot;
  return p;
}
describe('shared claim-key composition', () => {
  it('keeps legacy primitives exactly unchanged without explicit selection', () => {
    expect(claimKeyComposition([], view, { layout: {} })).toEqual(fxScene([], view));
  });
  it('avoids furniture and annotation obstacles and emits markers/table together', () => {
    const p = fixture(), obstacle = { left: 650, top: 600, width: 350, height: 200, key: 'manual annotation' };
    const result = claimKeyComposition([], { ...view, obstacles: [obstacle] }, p);
    expect(result.claimKey.ok).toBe(true);
    expect(boxesOverlap(result.claimKey.tableBox, obstacle)).toBe(false);
    expect(result.claimKey.rows[0].identifier).toBe('Supplied 001');
    expect(result.labels).toEqual([...result.claimKey.labels, ...result.claimKey.table]);
  });
  it('keeps coordinate-frame margins clear', () => {
    const frame = { left: 70, top: 60, right: 800, bottom: 700 };
    const { tableBox: box } = claimKeyComposition([], { ...view, frame }, fixture()).claimKey;
    expect(box.left).toBeGreaterThanOrEqual(frame.left);
    expect(box.top).toBeGreaterThanOrEqual(frame.top);
    expect(box.left + box.width).toBeLessThanOrEqual(frame.right);
    expect(box.top + box.height).toBeLessThanOrEqual(frame.bottom);
  });
  it('does not cover an existing expert label kept at its original spot', () => {
    const p = fixture(), layer = { ...p.layers[0], fx: { label: { text: 'Existing label', size: 16, per: 'feature', nudge: false } },
      geojson: { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Polygon',
        coordinates: [[[70,-65],[98,-65],[98,-78],[70,-78],[70,-65]]] } }] } };
    const entries = [{ layer, features: layer.geojson.features, styleOf: () => layer.style }];
    const result = claimKeyComposition(entries, view, p);
    expect(result.claimKey.ok).toBe(true);
    const ordinary = result.placed.filter((item) => !item.link);
    expect(ordinary).toHaveLength(1);
    expect(ordinary.every((item) => !boxesOverlap(item.box, result.claimKey.tableBox))).toBe(true);
  });
  it('fails honestly with no space or a stale key and preserves normal output', () => {
    const p = fixture(), blocked = { ...view, obstacles: [{ left: 0, top: 0, width: 1000, height: 800 }] };
    const result = claimKeyComposition([], blocked, p);
    expect(result.claimKey.reason).toBe('no-key-space'); expect(result.labels).toEqual([]);
    p.layers[0].geojson.features[0].properties.ID = 'Changed';
    expect(claimKeyComposition([], view, p).claimKey.reason).toBe('rebuild-key');
  });
});
