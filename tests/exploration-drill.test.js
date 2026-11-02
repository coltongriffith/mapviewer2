import { describe, expect, it } from 'vitest';
import { createInitialProjectState } from '../shared/projectState.js';
import { applyExplorationDrill } from '../src/utils/explorationDrill.js';
import { DEFAULT_SIDE_PANEL_GRID, sidePanelTemplate, resolveSidePanelZones } from '../src/templates/sidePanelTemplate.js';
import { panelObstacles } from '../src/utils/calloutLayout.js';
import { buildLegendItems } from '../src/templates/technicalResultsTemplate.js';
import { applyLegendCustomization } from '../src/utils/legendCustomization.js';
import { collarCallouts } from '../src/utils/publishedCallouts.js';
import { readFileSync } from 'node:fs';
import Papa from 'papaparse';

function fixture() {
  const p = createInitialProjectState();
  Object.assign(p.layout, { title: 'Project Map', primaryLayerId: 'claims', titleBgColor: '#143d52',
    accentColor: '#c8a538', footerText: 'Supplied source and date' });
  p.layers = [{ id: 'claims', role: 'claims', type: 'geojson', visible: true,
    style: { fill: '#c8a538' }, geojson: { type: 'FeatureCollection', features: [{ type: 'Feature',
      properties: { PROJECT_NAME: 'Supplied Ridge', CLAIM_NAME: 'Provided tenure' },
      geometry: { type: 'Polygon', coordinates: [[[-120,50],[-119.98,50],[-119.98,50.02],[-120,50.02],[-120,50]]] } }] } },
  { id: 'collars', role: 'drillholes', type: 'points', visible: true,
    geojson: { type: 'FeatureCollection', features: [{ type: 'Feature',
      properties: { hole_id: 'QA-1', label: 'QA-1', azimuth: 45, dip: -60, depth: 300 },
      geometry: { type: 'Point', coordinates: [-119.99, 50.01] } }] },
    style: { markerColor: '#192635', markerFill: '#ffffff' } }];
  return p;
}

describe('Exploration & Drill presentation recipe', () => {
  it('uses a supplied unambiguous property title and keeps company branding/source', () => {
    const p = fixture(), next = applyExplorationDrill(p);
    expect(next.layout).toMatchObject({ title: 'Supplied Ridge', subtitle: 'Exploration & Drill',
      titleBgColor: '#143d52', accentColor: '#c8a538', footerText: p.layout.footerText,
      sidePanelGrid: DEFAULT_SIDE_PANEL_GRID, compositionPreset: 'tight', zoomPadFrac: 0.08 });
    expect(p.layout.title).toBe('Project Map');
  });
  it('never labels collar-only or empty data as results', () => {
    for (const layers of [fixture().layers.slice(1), []]) {
      const p = fixture(); p.layers = layers; p.layout.primaryLayerId = 'collars';
      const next = applyExplorationDrill(p);
      expect(next.layout.title).toBe('Exploration & Drill');
      expect(next.layout.subtitle).not.toMatch(/results|approved/i);
      expect(next.layers).toBe(p.layers);
    }
  });
  it('adds supplied short collar IDs through existing callouts without duplicating labels or results', () => {
    const p = fixture(), before = structuredClone(p), next = applyExplorationDrill(p);
    expect(next.callouts).toHaveLength(1);
    expect(next.callouts[0]).toMatchObject({ text: 'QA-1', featureId: 'collars:50.010000:-119.990000', layerId: 'collars',
      anchor: { lat: 50.01, lng: -119.99 }, type: 'plain', subtext: '' });
    expect(applyExplorationDrill(next).callouts).toEqual(next.callouts);
    const removed = { ...next, callouts: [] };
    expect(applyExplorationDrill(removed).callouts).toEqual([]);
    expect(p).toEqual(before);
  });
  it('recognises feature-editor coordinate, feature-id, property-id and legacy annotation identities', () => {
    for (const mode of ['coordinate', 'feature-id', 'property-id', 'legacy']) {
      const p = fixture(), f = p.layers[1].geojson.features[0];
      if (mode === 'feature-id') f.id = 'source-feature';
      if (mode === 'property-id') f.properties.id = 'source-property';
      const featureId = { coordinate: 'collars:50.010000:-119.990000', 'feature-id': 'source-feature',
        'property-id': 'source-property', legacy: 'QA-1' }[mode];
      p.callouts = [{ id: 'existing', layerId: 'collars', featureId, text: 'Existing supplied annotation', isManualPosition: true }];
      const next = applyExplorationDrill(p);
      expect(next.callouts).toBe(p.callouts);
      expect(next.layers[1]).toBe(p.layers[1]);
      const otherLayer = { ...p, callouts: [{ ...p.callouts[0], layerId: 'different-layer' }] };
      expect(applyExplorationDrill(otherLayer).callouts).toHaveLength(2);
    }
  });
  it('does not add an ID beside an actual published-results adapter annotation', () => {
    const p = fixture(), f = p.layers[1].geojson.features[0];
    f.properties = { _holeid: 'EX-021', label: 'EX-021' };
    const data = Papa.parse(readFileSync('tests/fixtures/three-d/published-results.csv', 'utf8').trim(), { skipEmptyLines: true }).data;
    const supplied = collarCallouts(data[0], data.slice(1), p.layers).callouts;
    expect(supplied).toHaveLength(1);
    expect(supplied[0].featureId).toBe('collars:50.010000:-119.990000');
    p.callouts = supplied.map((c) => ({ ...c, id: `supplied-${c.resultId}` }));
    expect(applyExplorationDrill(p).callouts).toBe(p.callouts);
  });
  it('does not match an unused property-id alias when a source feature-id takes precedence', () => {
    const p = fixture(), f = p.layers[1].geojson.features[0];
    f.id = 'source-feature'; f.properties.id = 'unrelated-property-id';
    p.callouts = [{ id: 'other-note', layerId: 'collars', featureId: 'unrelated-property-id', text: 'Different feature note' }];
    const next = applyExplorationDrill(p);
    expect(next.callouts).toHaveLength(2);
    expect(next.callouts[1].featureId).toBe('source-feature');
  });
  it('does not guess IDs, label dense/hidden/manual layers, or choose ambiguous shared feature keys', () => {
    const p = fixture(), collars = p.layers[1], f = collars.geojson.features[0];
    for (const patch of [{ visible: false }, { userStyled: true }, { fx: { label: { on: false } } }]) {
      expect(applyExplorationDrill({ ...p, layers: [{ ...collars, ...patch }] }).callouts || []).toEqual([]);
    }
    const noID = { ...f, properties: { arbitrary_assay: 42 } };
    expect(applyExplorationDrill({ ...p, layers: [{ ...collars, geojson: { ...collars.geojson, features: [noID] } }] }).callouts || []).toEqual([]);
    const dense = Array.from({ length: 81 }, (_, i) => ({ ...f, properties: { ...f.properties, hole_id: `QA-${i}` } }));
    expect(applyExplorationDrill({ ...p, layers: [{ ...collars, geojson: { ...collars.geojson, features: dense } }] }).callouts || []).toEqual([]);
    const duplicate = { ...f, properties: { label: 'QA-duplicate' } };
    const samePosition = { ...duplicate, properties: { label: 'QA-another' } };
    expect(applyExplorationDrill({ ...p, layers: [{ ...collars, geojson: { ...collars.geojson, features: [duplicate, samePosition] } }] }).callouts || []).toEqual([]);
  });
  it('keeps collar captions neutral unless a planned name was actually supplied or manually chosen', () => {
    const p = fixture(), layer = { ...p.layers[1], displayName: 'Planned Drillholes', sourceName: 'collars.csv' };
    const next = applyExplorationDrill({ ...p, layers: [layer] });
    expect(buildLegendItems(sidePanelTemplate, [layer], next.layout)[0].label).toBe('Drill collars');
    expect(buildLegendItems(sidePanelTemplate, [{ ...layer, userStyled: true }], next.layout)[0].label).toBe('Planned Drillholes');
    expect(buildLegendItems(sidePanelTemplate, [{ ...layer, sourceName: 'planned-holes.csv' }], next.layout)[0].label).toBe('Planned Drillholes');
    expect(buildLegendItems(sidePanelTemplate, [{ ...layer, sourceName: 'unplanned-holes.csv' }], next.layout)[0].label).toBe('Drill collars');
  });
  it('does not pick ownership or property title by order when claims are ambiguous', () => {
    const p = fixture(); p.layers.push({ ...p.layers[0], id: 'neighbour' }); p.layout.primaryLayerId = 'collars';
    expect(applyExplorationDrill(p).layout.title).toBe('Exploration & Drill');
  });
  it('preserves all result, survey, class, cutoff, manual style and callout data', () => {
    const p = fixture();
    Object.assign(p.layers[1], { userStyled: true, classification: { field: 'Cu_ppm', cutoff: 100 },
      fx: { label: { on: false } }, sourceAttributes: { unit: 'ppm' } });
    p.callouts = [{ id: 'supplied', text: 'Provided result — unverified QA', featureId: 'QA-1', isManualPosition: true, offset: { x: 40, y: -20 } }];
    p.drillPlan = { section: { azimuth: 40 }, approved: false };
    const before = structuredClone(p), next = applyExplorationDrill(p);
    expect(next.layers).toBe(p.layers);
    expect(next.layout.layoutAlgorithm).toBe(3);
    expect(next.callouts).toEqual(before.callouts); expect(next.drillPlan).toEqual(before.drillPlan);
    expect(p).toEqual(before);
  });
  it('keeps meaningful supplied titles/subtitles, custom formats, fonts and locator', () => {
    const p = fixture();
    Object.assign(p.layout, { title: 'Provided figure heading', subtitle: 'Provided approved-result caption',
      exportRatio: null, exportSettings: { customWidth: 1200, customHeight: 900 },
      fontFamily: 'Provided font', logo: 'data:image/png;base64,example', insetMode: 'custom_image', insetImage: 'provided-image' });
    const next = applyExplorationDrill(p);
    for (const key of ['title', 'subtitle', 'exportRatio', 'exportSettings', 'fontFamily', 'logo', 'insetMode', 'insetImage']) expect(next.layout[key]).toEqual(p.layout[key]);
  });
  it('retains explicit group and overlay choices rather than adding mode-generated noise', () => {
    const p = fixture(); p.layout.legendGrouped = false;
    const next = applyExplorationDrill(p, { rail: false, labels: false, geology: true });
    expect(next.layout.legendGrouped).toBe(false);
    expect(next.layout.referenceOverlays).toEqual({ rail: false, labels: false, geology: true });
  });
  it('gives a no-logo rail zero logo height and keeps title and source inside the figure', () => {
    const next = applyExplorationDrill(fixture());
    const z = resolveSidePanelZones(sidePanelTemplate, next.layout, { width: 1600, height: 900 }, []);
    expect(z.logo.height).toBe(0);
    expect(z.title.height).toBe(100);
    expect(z.footer.top + z.footer.height).toBeLessThanOrEqual(900);
    expect(z.footer.height).toBeGreaterThan(0);
  });
  it('gives supplied legend classes space before a large locator, without changing legacy rails', () => {
    const p = fixture(); p.layout.logo = 'provided-logo'; p.layout.templateId = 'side_panel';
    const next = applyExplorationDrill(p);
    const items = Array.from({ length: 20 }, (_, i) => ({ id: `class-${i}`, label: `Supplied class ${i}`, group: i < 10 ? 'Samples' : 'Drilling', type: 'line' }));
    const current = resolveSidePanelZones(sidePanelTemplate, next.layout, { width: 1600, height: 900 }, items);
    const legacy = resolveSidePanelZones(sidePanelTemplate, { ...next.layout, explorationDrillVersion: undefined }, { width: 1600, height: 900 }, items);
    expect(current.legend.height).toBeGreaterThan(legacy.legend.height);
    expect(current.inset.height).toBeLessThan(legacy.inset.height);
    expect(current.footer.top + current.footer.height).toBeLessThanOrEqual(900);
  });
  it('reserves the technical rail for automatic cards even with a derived empty stored legend', () => {
    const next = applyExplorationDrill(fixture());
    const zones = resolveSidePanelZones(sidePanelTemplate, next.layout, { width: 1600, height: 900 }, []);
    expect(panelObstacles(zones, next.layout)).toContainEqual({ ...zones.sidebar, key: 'technical rail' });
    expect(panelObstacles(zones, { ...next.layout, explorationDrillVersion: undefined }).some((o) => o.key === 'technical rail')).toBe(false);
  });
  it('identifies classified ranges by the exact source field without changing IDs or inventing units', () => {
    const p = fixture();
    const samples = { id: 'samples', role: 'soil_samples', type: 'points', visible: true,
      geojson: { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { id: 'QA-S1', Cu_ppm: 20 },
        geometry: { type: 'Point', coordinates: [-119.99, 50.01] } }] },
      legend: { group: 'Geochemistry', label: 'Supplied samples' },
      classification: { field: 'Cu_ppm', mode: 'graduated', classes: [{ max: 50, color: '#e0cf45' }, { max: null, color: '#a74735' }] } };
    const next = applyExplorationDrill(p);
    const rows = buildLegendItems(sidePanelTemplate, [samples], next.layout);
    const legacy = buildLegendItems(sidePanelTemplate, [samples], { ...next.layout, explorationDrillVersion: undefined });
    expect(rows.length).toBe(2);
    expect(rows.map((r) => r.group)).toEqual(['Geochemistry · Cu_ppm', 'Geochemistry · Cu_ppm']);
    expect(rows.map(({ group: _group, ...r }) => r)).toEqual(legacy.map(({ group: _group, ...r }) => r));
    const customised = applyLegendCustomization(rows, { legendOverrides: { [rows[0].id]: { group: 'User supplied heading' } } });
    expect(customised[0].group).toBe('User supplied heading');
    const unspecified = { ...samples, classification: { ...samples.classification, field: 'Measurement A' } };
    expect(buildLegendItems(sidePanelTemplate, [unspecified], next.layout)[0].group).toBe('Geochemistry · Measurement A');
  });
  it('reserves more title/source space in a narrow rail without changing its text or legacy geometry', () => {
    const p = fixture(); Object.assign(p.layout, { title: 'Cedar Ridge Project',
      subtitle: 'Target Generation — Soil Geochemistry & Drilling',
      footerText: 'Aurora Ridge Minerals Corp. | Cedar Ridge Project, BC' });
    const next = applyExplorationDrill(p), size = { width: 800, height: 1067 };
    const zones = resolveSidePanelZones(sidePanelTemplate, next.layout, size, []);
    const legacy = resolveSidePanelZones(sidePanelTemplate, { ...next.layout, explorationDrillVersion: undefined }, size, []);
    expect(zones.title.height).toBeGreaterThan(legacy.title.height);
    expect(zones.footer.height).toBeGreaterThan(legacy.footer.height);
    expect(next.layout.title).toBe(p.layout.title); expect(next.layout.footerText).toBe(p.layout.footerText);
    expect(zones.footer.top + zones.footer.height).toBeLessThanOrEqual(size.height);
  });
});
