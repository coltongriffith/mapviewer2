import { describe, it, expect, vi } from 'vitest';
import { applyLocationAccess } from '../src/utils/locationAccess.js';
import { applyPropertyNeighbours } from '../src/utils/propertyNeighbours.js';
import { createInitialProjectState } from '../shared/projectState.js';
import { getCornerLayout } from '../src/utils/cornerLayout.js';
import { fitProjectToTemplate } from '../src/utils/frameMapForTemplate.js';
import { technicalResultsTemplate, resolveTemplateZones } from '../src/templates/technicalResultsTemplate.js';

function project() {
  const p = createInitialProjectState();
  p.layout.accentColor = '#d2ae32'; p.layout.titleBgColor = '#113d52';
  p.layout.primaryLayerId = 'property'; p.layout.footerText = 'Supplied source and date';
  p.layers = [{ id: 'property', name: 'Property claims', type: 'geojson', role: 'claims', visible: true,
    style: { fill: '#cccccc' }, geojson: { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { PROJECT_NAME: 'Example Ridge', CLAIM_NAME: 'Example 1' },
      geometry: { type: 'Polygon', coordinates: [[[-120,50],[-119.98,50],[-119.98,50.02],[-120,50.02],[-120,50]]] } }] } },
  { id: 'roads', name: 'Provided roads', type: 'line', role: 'roads_access', visible: true, style: { stroke: '#826139', dashArray: '5 3' },
    geojson: { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { ROAD_NAME: 'Supplied route', route_status: 'seasonal' },
      geometry: { type: 'LineString', coordinates: [[-120,50],[-119,50]] } }] } }];
  return p;
}

describe('Location & Access first-result recipe', () => {
  it('reuses supplied project and brand information in a regional composition', () => {
    const p = project(), next = applyLocationAccess(p);
    expect(next.layout).toMatchObject({ title: 'Example Ridge', subtitle: 'Location & Access', locationAccessVersion: 1,
      accentColor: '#d2ae32', titleBgColor: '#113d52', footerText: 'Supplied source and date', exportRatio: 'landscape', legendCorner: 'br' });
    expect(next.layout.propertyNeighboursVersion).toBeUndefined();
    expect(next.layout.zoomPadFrac).toBeGreaterThan(applyPropertyNeighbours(p).layout.zoomPadFrac);
    expect(next.layers[0].style.fill).toBe('#d2ae32');
  });
  it('uses one project label instead of creating a tenure-ID carpet', () => {
    const next = applyLocationAccess(project());
    expect(next.layers[0].fx.label).toMatchObject({ text: 'Example Ridge', per: 'layer' });
    expect(next.layers[0].fx.label.field).toBeUndefined();
  });
  it('labels supplied road names without changing route status or line symbology', () => {
    const p = project(), next = applyLocationAccess(p);
    expect(next.layers[1].fx.label).toMatchObject({ field: 'ROAD_NAME', per: 'feature', side: 'left' });
    expect(next.layers[1].style).toEqual(p.layers[1].style);
    expect(next.layers.map((l) => l.geojson)).toEqual(p.layers.map((l) => l.geojson));
    expect(p.layers[1].fx).toBeUndefined();
  });
  it('does not infer seasonality, ownership or road names from arbitrary columns', () => {
    const p = project(); p.layers[1].geojson.features[0].properties = { capacity: 30, owner: 'Example', status: 'unknown' };
    expect(applyLocationAccess(p).layers[1].fx).toBeUndefined();
  });
  it('preserves manual, classified and explicit label-off decisions', () => {
    for (const extra of [{ userStyled: true }, { classification: { field: 'route_status', classes: [{ value: 'seasonal', color: '#aa1133' }] } }, { fx: { label: { on: false } } }]) {
      const p = project(); Object.assign(p.layers[1], extra);
      expect(applyLocationAccess(p).layers[1]).toEqual(p.layers[1]);
    }
  });
  it('keeps the no-logo corner arrangement valid and consumes no logo space', () => {
    const next = applyLocationAccess(project());
    expect(getCornerLayout(next.layout)).toEqual(next.layout.cornerLayout);
    const zones = resolveTemplateZones(technicalResultsTemplate, next.layout, { width: 1600, height: 900 }, []);
    expect(zones.logo).toMatchObject({ width: 0, height: 0 });
    expect(zones.title.top).toBe(18);
  });
  it('preserves custom output sizes, logo and meaningful project subtitle', () => {
    const p = project(); Object.assign(p.layout, { logo: 'data:image/png;base64,example', subtitle: 'Provided project context', exportRatio: 'portrait' });
    p.layout.referenceOverlays.rail = true;
    const next = applyLocationAccess(p);
    expect(next.layout.logo).toBe(p.layout.logo); expect(next.layout.subtitle).toBe(p.layout.subtitle);
    expect(next.layout.exportRatio).toBe('portrait');
    expect(next.layout.referenceOverlays.rail).toBe(true);
  });
  it('only deliberately designated routes may widen framing past the property', () => {
    const p = project();
    const fit = () => {
      const next = applyLocationAccess(p), map = { getSize: () => ({ x: 1600, y: 900 }), fitBounds: vi.fn() };
      fitProjectToTemplate(next, map, technicalResultsTemplate, 'access', { focusRoles: true });
      return map.fitBounds.mock.calls[0][0];
    };
    expect(fit().getEast()).toBeLessThan(-119.8);
    p.layers[1].focus = true;
    expect(fit().getEast()).toBeGreaterThan(-119);
    p.layers[1].focus = false;
    expect(fit().getEast()).toBeLessThan(-119.8);
  });
});
