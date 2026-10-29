import { describe, it, expect, vi } from 'vitest';
import { applyPropertyNeighbours, propertySubject } from '../src/utils/propertyNeighbours.js';
import { createInitialProjectState } from '../shared/projectState.js';
import { buildLegendItems, technicalResultsTemplate } from '../src/templates/technicalResultsTemplate.js';
import { fitProjectToTemplate } from '../src/utils/frameMapForTemplate.js';

const layer = (id, extra = {}) => ({ id, role: 'claims', type: 'geojson', visible: true, displayName: id,
  style: { fill: '#cccccc' }, legend: { enabled: true, label: id },
  geojson: { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { CLAIM_NAME: `${id} 01`, PROJECT_NAME: 'Example Property' }, geometry: { type: 'Polygon', coordinates: [[[-120,50],[-119.9,50],[-119.9,50.1],[-120,50.1],[-120,50]]] } }] }, ...extra });
const project = () => ({ ...createInitialProjectState(), layers: [layer('Project'), layer('Neighbour', { focus: false })] });

describe('Property & Neighbours explicit template application', () => {
  it('populates the supplied project title and label field and fits its subject', () => {
    const p = project(), next = applyPropertyNeighbours(p);
    expect(next.layout).toMatchObject({ title: 'Example Property', primaryLayerId: 'Project', propertyNeighboursVersion: 1 });
    expect(next.layers[0].fx.label).toMatchObject({ field: 'CLAIM_NAME', per: 'feature', fit: 'hide' });
    expect(next.layers[1].style.fillOpacity).toBeLessThan(next.layers[0].style.fillOpacity);
    expect(p.layers[0].fx).toBeUndefined();
    expect(p.layout.title).toBe('Project Map');
  });
  it('uses the already supplied brand and preserves title, logo, fonts and disclosures', () => {
    const p = project();
    Object.assign(p.layout, { accentColor: '#d4a626', titleBgColor: '#143b54', title: 'Approved project title',
      logo: 'data:image/png;base64,example', companyName: 'Example Corp', fonts: { title: 'Lato' }, footerText: 'Dated source', brandStyle: { brandKitId: 'owned-kit' } });
    const next = applyPropertyNeighbours(p);
    for (const key of ['title','accentColor','titleBgColor','logo','companyName','fonts','footerText','brandStyle']) expect(next.layout[key]).toEqual(p.layout[key]);
    expect(next.layers[0].style.fill).toBe('#d4a626');
    expect(next.layout.cornerLayout.tl).toEqual([['logo', 'title']]);
  });
  it('does not invent an owner/subject when multiple claims have no explicit project role', () => {
    const p = project(); delete p.layers[1].focus;
    expect(propertySubject(p)).toBeNull();
    const next = applyPropertyNeighbours(p);
    expect(next.layers.map((l) => l.style.fill)).toEqual(['#cccccc','#cccccc']);
    expect(next.layout.primaryLayerId).toBeNull();
  });
  it('uses an explicit eligible framing layer but never an explicitly contextual one', () => {
    const p = project(); delete p.layers[1].focus;
    p.layout.primaryLayerId = 'Neighbour';
    expect(propertySubject(p).id).toBe('Neighbour');
    p.layers[1].focus = false;
    expect(propertySubject(p).id).toBe('Project');
  });
  it('leaves manual styles, classifications, hidden features and source properties intact', () => {
    const p = project(); p.layers[0].userStyled = true;
    p.layers[1].classification = { enabled: true, field: 'owner', classes: [{ value: 'A', label: 'A', color: '#ff0000' }] };
    p.layers[0].featureOverrides = { 'kept-id': { fill: '#114488', hidden: false } };
    const saved = structuredClone(p);
    const next = applyPropertyNeighbours(p);
    expect(next.layers).toEqual(saved.layers);
  });
  it('does not replace an explicit label setup or a label-off decision', () => {
    const p = project(); p.layers[0].fx = { label: { on: false, field: 'MY_FIELD' }, feather: 2 };
    expect(applyPropertyNeighbours(p).layers[0].fx).toEqual(p.layers[0].fx);
  });
  it('requires a complete unambiguous label column; never labels with assay values', () => {
    const p = project(); p.layers[0].geojson.features[0].properties = { Cu_pct: 0.5, OWNER: 'Owner' };
    expect(applyPropertyNeighbours(p).layers[0].fx).toBeUndefined();
    p.layers[0].geojson.features[0].properties = { CLAIM_NAME: 'One', 'Claim Name': 'Another' };
    expect(applyPropertyNeighbours(p).layers[0].fx).toBeUndefined();
  });
  it('does not choose a hidden/empty/nonpolygon layer as the property', () => {
    for (const patch of [{ visible: false }, { geojson: { type: 'FeatureCollection', features: [] } }, { type: 'points' }]) {
      const p = project(); Object.assign(p.layers[0], patch);
      expect(propertySubject(p)).toBeNull();
    }
  });
  it('keeps a custom supplied inset and does not fabricate a missing logo', () => {
    const p = project(); Object.assign(p.layout, { insetMode: 'custom_image', insetImage: 'data:image/png;base64,custom' });
    const next = applyPropertyNeighbours(p);
    expect(next.layout.insetMode).toBe('custom_image');
    expect(next.layout.insetImage).toBe(p.layout.insetImage);
    expect(next.layout.logo).toBeNull();
  });
  it('starts in a standardized landscape frame but honours a supplied format', () => {
    const p = project();
    expect(applyPropertyNeighbours(p).layout.exportRatio).toBe('landscape');
    p.layout.exportRatio = 'portrait';
    expect(applyPropertyNeighbours(p).layout.exportRatio).toBe('portrait');
    p.layout.exportRatio = null; Object.assign(p.layout.exportSettings, { customWidth: 1200, customHeight: 900 });
    expect(applyPropertyNeighbours(p).layout.exportRatio).toBeNull();
  });
  it('makes legend swatches from the actual branded and contextual layer styles', () => {
    const next = applyPropertyNeighbours(project());
    const rows = buildLegendItems(technicalResultsTemplate, next.layers, next.layout);
    expect(rows.find((r) => r.id === 'Project').style.fill).toBe(next.layers[0].style.fill);
    expect(rows.find((r) => r.id === 'Neighbour').style.fill).toBe('#9ca9ad');
  });
  it('replaces only generic import captions with readable supplied file names', () => {
    const p = project();
    Object.assign(p.layers[0], { displayName: 'Project Claims', sourceName: 'North_Ridge_claims.geojson', legend: { enabled: true, label: 'Project Claims' } });
    expect(applyPropertyNeighbours(p).layers[0].legend.label).toBe('North Ridge claims');
    p.layers[0].legend.label = 'Approved legend caption';
    expect(applyPropertyNeighbours(p).layers[0].legend.label).toBe('Approved legend caption');
  });
  it('keeps dense uploads bounded rather than starting a registry-sized label job', () => {
    const p = project(); p.layers[0].geojson.features = Array.from({ length: 81 }, () => structuredClone(p.layers[0].geojson.features[0]));
    expect(applyPropertyNeighbours(p).layers[0].fx).toBeUndefined();
  });
  it('does not manufacture labels for incomplete field values', () => {
    const p = project(); p.layers[0].geojson.features.push({ ...p.layers[0].geojson.features[0], properties: { CLAIM_NAME: '' } });
    expect(applyPropertyNeighbours(p).layers[0].fx).toBeUndefined();
  });
  it('frames the explicit property instead of widening to distant claim context', () => {
    const p = project(); p.layout.primaryLayerId = 'Project';
    p.layers[1].geojson.features[0].geometry.coordinates = [[[-100,40],[-99,40],[-99,41],[-100,41],[-100,40]]];
    delete p.layers[1].focus;
    const next = applyPropertyNeighbours(p);
    const map = { getSize: () => ({ x: 1600, y: 900 }), fitBounds: vi.fn() };
    fitProjectToTemplate(next, map, technicalResultsTemplate, 'balanced', { focusRoles: true });
    const bounds = map.fitBounds.mock.calls[0][0];
    expect(bounds.getWest()).toBeLessThan(-120);
    expect(bounds.getEast()).toBeLessThan(-119);
  });
});
