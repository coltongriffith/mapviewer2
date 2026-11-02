import { it, expect } from 'vitest';
import { applyPropertyNeighbours } from '../src/utils/propertyNeighbours.js';
import { createClaimKeySnapshot } from '../src/utils/claimKeyCandidates.js';
import { claimKeyScene } from '../src/utils/claimKeyScene.js';

it('keeps the 80-shape automatic-label cap and reports unlocated references in an explicit dense key', () => {
  const features = Array.from({ length: 81 }, (_, i) => {
    const x = 10 + i * 20;
    return { type: 'Feature', id: `source-${i}`, properties: { TENURE_NUMBER_ID: String(i).padStart(4, '0') },
      geometry: { type: 'Polygon', coordinates: [[[x,-10],[x+10,-10],[x+10,-20],[x,-20],[x,-10]]] } };
  });
  const original = { layout: { primaryLayerId: 'claims' }, layers: [{ id: 'claims', role: 'claims', visible: true,
    geojson: { type: 'FeatureCollection', features } }] };
  const p = applyPropertyNeighbours(original);
  expect(p.layers[0].fx?.label).toBeUndefined();
  expect(p.layers[0].geojson).toEqual(original.layers[0].geojson);
  const saved = createClaimKeySnapshot(p, 'TENURE_NUMBER_ID', { maxRows: 200 });
  expect(saved.snapshot.entries).toHaveLength(81);
  const view = { pt: (x,y) => [x*10,-y*10], world: (x,y) => [x,-y], k: 10, W: 1000, H: 800, family: 'Inter' };
  const scene = claimKeyScene(p, saved.snapshot, view, { left: 700, top: 400, width: 260, height: 350 });
  expect(scene.ok).toBe(true);
  expect(scene.rows.length).toBeGreaterThan(0);
  expect(scene.rows.length).toBeLessThan(81);
  expect(scene.omitted + scene.rows.length).toBe(81);
  expect(scene.notice).toContain(`${scene.omitted} not located in this view`);
});
