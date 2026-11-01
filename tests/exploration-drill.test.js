import { describe, expect, it } from 'vitest';
import { createInitialProjectState } from '../shared/projectState.js';
import { applyExplorationDrill } from '../src/utils/explorationDrill.js';
import { DEFAULT_SIDE_PANEL_GRID, sidePanelTemplate, resolveSidePanelZones } from '../src/templates/sidePanelTemplate.js';
import { panelObstacles } from '../src/utils/calloutLayout.js';

function fixture() {
  const p = createInitialProjectState();
  Object.assign(p.layout, { title: 'Project Map', primaryLayerId: 'claims', titleBgColor: '#143d52',
    accentColor: '#c8a538', footerText: 'Supplied source and date' });
  p.layers = [{ id: 'claims', role: 'claims', type: 'geojson', visible: true,
    style: { fill: '#c8a538' }, geojson: { type: 'FeatureCollection', features: [{ type: 'Feature',
      properties: { PROJECT_NAME: 'Supplied Ridge', CLAIM_NAME: 'Provided tenure' },
      geometry: { type: 'Polygon', coordinates: [[[-120,50],[-119.98,50],[-119.98,50.02],[-120,50.02],[-120,50]]] } }] } },
  { id: 'collars', role: 'drillholes', type: 'points', visible: true,
    points: [{ id: 'QA-1', lat: 50.01, lng: -119.99, label: 'QA-1', azimuth: 45, dip: -60, depth: 300 }],
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
});
