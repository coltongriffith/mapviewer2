import { describe, it, expect, vi, afterEach } from 'vitest';
import L from 'leaflet';
import { syncFx } from '../src/utils/fxLayers.js';
import { propertyBoundaryScene } from '../src/utils/propertyBoundaryScene.js';
import { mapView } from '../src/utils/geoStyle.js';
import { getTemplate } from '../src/templates/index.js';
import { renderSceneToSvg } from '../src/export/renderScene.js';

let map;
afterEach(() => { map?.remove(); map = null; document.body.innerHTML = ''; vi.restoreAllMocks(); });
function setup() {
  const ctx = new Proxy({}, { get: (_,key) => key === 'measureText' ? () => ({ width: 20 })
    : key === 'getTransform' ? () => ({ a: 1, b: 0 }) : () => ({ addColorStop() {} }), set: () => true });
  vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue(ctx);
  const el = document.createElement('div'); document.body.appendChild(el);
  Object.defineProperties(el,{ clientWidth: { value: 1000 }, clientHeight: { value: 800 } });
  el.getBoundingClientRect = () => ({ left: 0, top: 0, right: 1000, bottom: 800, width: 1000, height: 800 });
  map = L.map(el,{ center: [.5,1], zoom: 7 });
  const p = { layout: { templateId: 'technical_results_v2', propertyNeighboursVersion: 1, primaryLayerId: 'claims', propertyBoundaryOutline: true,
    basemap: 'blank', showTitle: false, showLegend: false, showNorthArrow: false, showScaleBar: false, insetEnabled: false, legendItems: [] },
  layers: [{ id: 'claims', role: 'claims', type: 'polygons', style: { fill: '#d5b961', stroke: '#112233', strokeWidth: 2.2 },
    geojson: { type: 'FeatureCollection', features: [0,1].map((x) => ({ type: 'Feature', id: `claim-${x}`, properties: { ID: `QA-${x}` },
      geometry: { type: 'Polygon', coordinates: [[[x,0],[x+1,0],[x+1,1],[x,1],[x,0]]] } })) } }] };
  return { p, template: getTemplate('technical_results_v2'), el };
}

describe('Actual property boundary renderer consumers', () => {
  it('uses a separate noninteractive native pane and shared stroke, then removes it on disable', () => {
    const { p, template } = setup(), before = structuredClone(p);
    let state = syncFx(map,null,{ project: p, template, geometry: (l) => l.geojson });
    expect(state.canvases.boundary).toBeTruthy();
    expect(map.getPane('emFxboundary').style.pointerEvents).toBe('none');
    expect(map.getPane('emFxboundary').style.zIndex).toBe('460');
    expect(map.emFxReport.propertyBoundary).toEqual({ ok: true, reason: null });
    expect(state.scene.boundary).toEqual(propertyBoundaryScene(p,mapView(map,1000,800),{ template }).primitives);
    expect(p).toEqual(before);
    state = syncFx(map,state,{ project: { ...p, layout: { ...p.layout, propertyBoundaryOutline: false } }, template, geometry: (l) => l.geojson });
    expect(state.canvases.boundary).toBeUndefined();
    expect(map.emFxReport.propertyBoundary).toBeUndefined();
  });
  it('exports both original filled polygons and the separate exterior through the real SVG pipeline', async () => {
    const { p, template, el } = setup(), before = structuredClone(p);
    const svg = await renderSceneToSvg({ width: 1000, height: 800, map, container: el, project: p, template },
      { pixelRatio: 1, embedFonts: false, noWatermark: true });
    const doc = new DOMParser().parseFromString(svg,'image/svg+xml');
    const boundary = doc.querySelector('#em-property-boundary');
    expect(boundary).toBeTruthy();
    expect(boundary.querySelector('[stroke="#112233"]').getAttribute('stroke-width')).toBe('4.2');
    expect([...doc.querySelectorAll('path[fill="#d5b961"]')].filter((path) => !boundary.contains(path))).toHaveLength(2);
    expect(p).toEqual(before);
  });
  it('updates the boundary report when an existing geology canvas repaints first', () => {
    const { p, template } = setup();
    p.layers[0].fx = { outline: true };
    let state = syncFx(map,null,{ project: { ...p, layout: { ...p.layout, propertyBoundaryOutline: false } }, template, geometry: (l) => l.geojson });
    expect(map.emFxReport.propertyBoundary).toBeUndefined();
    state = syncFx(map,state,{ project: p, template, geometry: (l) => l.geojson });
    expect(state.canvases.band).toBeTruthy();
    expect(map.emFxReport.propertyBoundary).toEqual({ ok: true, reason: null });
  });
  it('does not add an export group for legacy maps or failed derivation', async () => {
    const { p, template, el } = setup();
    for (const layout of [{ ...p.layout, propertyBoundaryOutline: false }, { ...p.layout, primaryLayerId: 'stale' }]) {
      const svg = await renderSceneToSvg({ width: 1000, height: 800, map, container: el, project: { ...p, layout }, template },
        { pixelRatio: 1, embedFonts: false, noWatermark: true });
      expect(svg).not.toContain('id="em-property-boundary"');
    }
  });
});
