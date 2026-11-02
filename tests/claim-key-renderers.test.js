import { describe, it, expect, vi, afterEach } from 'vitest';
import L from 'leaflet';
import { syncFx } from '../src/utils/fxLayers.js';
import { claimKeyObstacles } from '../src/utils/claimKeyComposition.js';
import { createClaimKeySnapshot } from '../src/utils/claimKeyCandidates.js';
import { renderSceneToSvg } from '../src/export/renderScene.js';
import { getTemplate } from '../src/templates/index.js';
import { boxesOverlap } from '../src/utils/geoStyle.js';

let map;
afterEach(() => { map?.remove(); map = null; document.body.innerHTML = ''; vi.restoreAllMocks(); });
function setup() {
  const ctx = new Proxy({}, { get: (_, key) => key === 'measureText' ? (text) => ({ width: String(text).length * 6 })
    : key === 'getTransform' ? () => ({ a: 1, b: 0 }) : () => ({ addColorStop() {} }), set: () => true });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx);
  const el = document.createElement('div'); document.body.appendChild(el);
  Object.defineProperties(el, { clientWidth: { value: 1000 }, clientHeight: { value: 800 } });
  el.getBoundingClientRect = () => ({ left: 0, top: 0, right: 1000, bottom: 800, width: 1000, height: 800 });
  map = L.map(el, { center: [50, -120], zoom: 10 });
  const p = { layout: { templateId: 'technical_results_v2', propertyNeighboursVersion: 1, primaryLayerId: 'claims',
    basemap: 'blank', showTitle: false, showLegend: false, showNorthArrow: false, showScaleBar: false, insetEnabled: false, legendItems: [] },
  callouts: [{ id: 'pinned', text: 'Manual source note', type: 'boxed', anchor: { lat: 50, lng: -120 }, offset: { x: 260, y: 270 }, isManualPosition: true }],
  layers: [{ id: 'claims', role: 'claims', type: 'polygons', visible: true, style: { fill: '#123456' }, geojson: { type: 'FeatureCollection', features: [
    { type: 'Feature', id: 'one', properties: { ID: 'Supplied 001' }, geometry: { type: 'Polygon',
      coordinates: [[[-120.1,49.9],[-119.9,49.9],[-119.9,50.1],[-120.1,50.1],[-120.1,49.9]]] } },
  ] } }] };
  p.layout.claimKey = createClaimKeySnapshot(p, 'ID').snapshot;
  return { p, el, template: getTemplate('technical_results_v2') };
}
describe('actual claim-key render consumers', () => {
  it('creates the editor/read-only label canvas without ordinary fx and clears it on removal', () => {
    const { p, template } = setup(), before = structuredClone(p);
    let state = syncFx(map, null, { project: p, template, geometry: (layer) => layer.geojson });
    expect(state.canvases.labels).toBeTruthy();
    expect(map.emFxReport.claimKey.ok).toBe(true);
    expect(map.emFxReport.claimKey.rows[0].identifier).toBe('Supplied 001');
    const cards = claimKeyObstacles(p, map);
    expect(cards).toHaveLength(1);
    expect(boxesOverlap(map.emFxReport.claimKey.tableBox, cards[0])).toBe(false);
    expect(p).toEqual(before);
    state = syncFx(map, state, { project: { ...p, layout: { ...p.layout, claimKey: null } }, template, geometry: (layer) => layer.geojson });
    expect(state.canvases.labels).toBeUndefined();
    expect(map.emFxReport.claimKey).toBeUndefined();
  });
  it('uses the export pipeline to print the same reference, full identifier and manual callout', async () => {
    const { p, el, template } = setup();
    const svg = await renderSceneToSvg({ width: 1000, height: 800, map, container: el, project: p, template },
      { pixelRatio: 1, embedFonts: false, noWatermark: true, layer: 'annotations' });
    expect(svg).toContain('Claim key'); expect(svg).toContain('K1'); expect(svg).toContain('Supplied 001');
    expect(svg).toContain('Manual source note');
  });
});
