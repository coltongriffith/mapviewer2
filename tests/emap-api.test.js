import { describe, it, expect, vi } from 'vitest';
import { createInitialProjectState } from '../shared/projectState.js';
import {
  createApi, opts, num, hex, latLng, bounds, featureCollection, fxPatch, labelPatch, stylePatch, calloutPatch, mapLabelPatch,
  LINE_TYPES, NORTH_STYLES, PDF_SIZES as API_PDF_SIZES, PLAN_KINDS,
} from '../src/emap/api.js';
import { SECTIONS, HELP, helpText } from '../src/emap/help.js';
import { LINE_TYPES as GEO_LINE_TYPES } from '../src/utils/geoStyle.js';
import { NORTH_ARROW_STYLES } from '../src/components/NorthArrow.jsx';
import { PDF_SIZES } from '../src/export/exportPDF.js';
import { KINDS } from '../src/utils/drillPlanData.js';

// window.EMAP (src/emap/api.js): the 2D editor's agent API. Argument checks say what is allowed; setters write the
// editor's own project through the bridge's actions; the help is in sections.

// A stand-in for App's bridge: its project, and the actions the API calls, written as App writes them.
function bridge(over = {}) {
  const b = {
    screen: 'editor', mapReady: false, map: null, isDirty: false, user: null, projectId: null, projectName: 'Test map',
    entitlements: { allowed_export_formats: ['png'], clean_export: false, max_export_pixels: 2400 },
    bandDefault: true, recentProjects: [], legend: [], zones: {},
    project: createInitialProjectState(),
    ...over,
  };
  b.setProject = (fn) => { b.project = typeof fn === 'function' ? fn(b.project) : fn; };
  b.updateLayout = (patch) => b.setProject((p) => ({ ...p, layout: { ...p.layout, ...patch, exportSettings: patch.exportSettings ? { ...p.layout.exportSettings, ...patch.exportSettings } : p.layout.exportSettings } }));
  b.updateLayer = (id, patch) => b.setProject((p) => ({ ...p, layers: p.layers.map((l) => (l.id === id ? { ...l, ...patch, style: { ...(l.style || {}), ...(patch.style || {}) }, userStyled: true } : l)) }));
  b.setDisplayLabel = (id, v) => b.updateLayer(id, { displayName: v, legend: { label: v } });
  b.updateDrillPlan = (patch) => b.setProject((p) => (p.drillPlan ? { ...p, drillPlan: { ...p.drillPlan, ...patch } } : p));
  b.newMap = vi.fn(() => b.setProject(createInitialProjectState()));
  b.saveAs = vi.fn(async (name) => { b.projectName = name; b.projectId = 'p1'; b.isDirty = false; });
  b.exportFile = vi.fn(async () => ({ file: 'data:image/png;base64,AAAA', clamped: false, warnings: [] }));
  return b;
}
const ring = (pts) => [[...pts, pts[0]]];
const area = { id: 'unit', name: 'Durand Stock', displayName: 'Durand Stock', type: 'geojson', visible: true, role: 'other', style: { fill: '#e7a1bf' }, legend: { enabled: true, label: 'Durand Stock' }, geojson: { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { unit: 'Jd', rock: 'diorite' }, geometry: { type: 'Polygon', coordinates: ring([[-120.71, 50.59], [-120.68, 50.59], [-120.68, 50.61]]) } }] } };
const line = { id: 'trend', name: 'Thunder trend', displayName: 'Thunder trend', type: 'geojson', visible: true, role: 'faults_structures', style: { stroke: '#f5b425' }, legend: { enabled: true, label: 'Thunder trend' }, geojson: { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { name: 'Thunder' }, geometry: { type: 'LineString', coordinates: [[-120.72, 50.58], [-120.66, 50.62]] } }] } };
const withLayers = (over) => { const b = bridge(over); b.project = { ...b.project, layers: [area, line] }; return b; };

describe('argument checks say what is allowed', () => {
  it('rejects unknown keys and names the keys a function takes', () => {
    expect(() => opts({ titel: 'x' }, 'setTitle', ['title', 'subtitle'])).toThrow('setTitle does not take "titel". It takes: title, subtitle.');
    expect(() => opts('x', 'setTitle', ['title'])).toThrow('setTitle takes an object');
    expect(opts(undefined, 'f', ['a'])).toEqual({});
  });
  it('numbers, colours, places and bounds', () => {
    expect(() => num(2, 'opacity', 0, 1)).toThrow('opacity must be a number from 0 to 1.');
    expect(() => num('0.5', 'opacity', 0, 1)).toThrow('opacity must be a number');
    expect(hex('#ABCDEF', 'fill')).toBe('#abcdef');
    expect(() => hex('red', 'fill')).toThrow('fill must be a hex colour like #2563eb.');
    expect(hex(null, 'glowColor', true)).toBe(null);
    expect(latLng([50.6, -120.7])).toEqual({ lat: 50.6, lng: -120.7 });
    expect(latLng({ lat: 50.6, lon: -120.7 })).toEqual({ lat: 50.6, lng: -120.7 });
    expect(() => latLng({ lat: 663420, lng: 5607760 })).toThrow('lat -90 to 90');
    expect(bounds([[50, -121], [51, -120]])).toEqual({ south: 50, west: -121, north: 51, east: -120 });
    expect(() => bounds({ south: 51, west: -121, north: 50, east: -120 })).toThrow('south below north');
  });
  it('GeoJSON: a geometry or feature is wrapped; metres and empty collections are refused', () => {
    const fc = featureCollection({ type: 'LineString', coordinates: [[-120.7, 50.6], [-120.6, 50.7]] });
    expect(fc.type).toBe('FeatureCollection');
    expect(fc.features[0].properties).toEqual({});
    expect(() => featureCollection({ type: 'Point', coordinates: [663420, 5607760] })).toThrow('perhaps metres');
    expect(() => featureCollection({ type: 'FeatureCollection', features: [] })).toThrow('no features');
    expect(() => featureCollection({ type: 'Topology' })).toThrow('type "Topology" is none of these');
  });
  it('geology styling: line options for lines, area options for areas, the line types listed', () => {
    expect(() => fxPatch({ lineType: 'wavy' }, 'line')).toThrow('lineType must be one of "plain", "zone", "trend", "fault", "thrust".');
    expect(() => fxPatch({ feather: 6 }, 'line', 'Thunder trend')).toThrow('"feather" is for areas; Thunder trend is a line layer');
    expect(() => fxPatch({ glow: 6 }, 'polygon')).toThrow('"glow" is for lines');
    expect(() => fxPatch({ feather: 50 }, 'polygon')).toThrow('feather must be a number from 0 to 40.');
    expect(fxPatch({ lineType: 'zone' }, 'line')).toEqual({ lineType: 'zone', casing: true });
    expect(fxPatch({ lineType: 'thrust', casing: true }, 'line')).toEqual({ lineType: 'thrust', casing: true });
    expect(fxPatch({ plume: true }, 'polygon')).toEqual({ plume: { az: 225, tail: 0, blur: 4 } });
    expect(fxPatch({ plume: { az: 90 } }, 'polygon')).toEqual({ plume: { az: 90, tail: 0, blur: 4 } });
    expect(() => fxPatch({ plume: { bearing: 90 } }, 'polygon')).toThrow('plume does not take "bearing"');
  });
  it('labels: along lines or in areas, fields from the features', () => {
    expect(labelPatch({ side: 'right', offset: 6, start: 60 }, 'line')).toEqual({ side: 'right', offset: 6, start: 60 });
    expect(() => labelPatch({ sub: 'diorite' }, 'line')).toThrow('"sub" is for area labels');
    expect(() => labelPatch({ side: 'left' }, 'polygon')).toThrow('"side" is for line labels');
    expect(labelPatch({ rotate: 'auto', per: 'feature', field: 'unit' }, 'polygon', ['unit'])).toEqual({ rotate: 'auto', per: 'feature', field: 'unit' });
    expect(() => labelPatch({ field: 'name' }, 'polygon', ['unit', 'rock'])).toThrow('field must be a property of the layer\'s features ("unit", "rock")');
    expect(() => labelPatch({ fit: 'squash' }, 'polygon')).toThrow('fit must be one of "shrink", "hide".');
  });
  it('layer style: one colour to both its area and point keys; points take their own options', () => {
    expect(stylePatch({ fill: '#112233', dash: true }, 'polygon')).toEqual({ fill: '#112233', markerFill: '#112233', dashArray: '8 5' });
    expect(stylePatch({ dash: '4 2' }, 'line')).toEqual({ dashArray: '4 2' });
    expect(() => stylePatch({ dash: 'dotted' }, 'line')).toThrow('dash must be true, false or a dash pattern');
    expect(() => stylePatch({ markerSize: 9 }, 'polygon')).toThrow('"markerSize" is not for an area or line layer');
    expect(() => stylePatch({ fillOpacity: 0.3 }, 'points')).toThrow('"fillOpacity" is not for a points layer');
    expect(() => stylePatch({ markerShape: 'blob' }, 'points')).toThrow('markerShape must be one of "circle"');
  });
  it('callouts and map labels', () => {
    expect(calloutPatch({ text: 'RN-001', type: 'boxed', at: [50.6, -120.7], offset: { x: 40 } })).toEqual({ text: 'RN-001', type: 'boxed', anchor: { lat: 50.6, lng: -120.7 }, offset: { x: 40, y: 0 } });
    expect(() => calloutPatch({ type: 'bubble' })).toThrow('type must be one of "plain", "leader", "boxed", "badge".');
    expect(() => calloutPatch({ style: { colour: '#fff' } })).toThrow('style does not take "colour"');
    expect(mapLabelPatch({ text: 'THUNDER VALLEY', at: { lat: 50.6, lng: -120.7 }, size: 30 })).toEqual({ label: 'THUNDER VALLEY', lat: 50.6, lng: -120.7, size: 30 });
  });
  it('the lists kept in the API match the modules that own them', () => {
    expect(LINE_TYPES).toEqual(GEO_LINE_TYPES.map(([k]) => k));
    expect([...NORTH_STYLES].sort()).toEqual(NORTH_ARROW_STYLES.map((s) => s.key).sort());
    expect(API_PDF_SIZES).toEqual(Object.keys(PDF_SIZES));
    expect(PLAN_KINDS).toEqual(Object.keys(KINDS));
  });
});

describe('help in sections', () => {
  it('help() is the overview and lists every section; help(name) is that section', () => {
    const api = createApi(() => bridge());
    const top = api.help();
    expect(top).toContain('window.EMAP');
    for (const [k] of SECTIONS) { expect(top).toContain(`  ${k} `); expect(HELP[k], k).toBeTruthy(); }
    expect(api.help('labels')).toBe(HELP.labels);
    expect(api.help('LABELS')).toBe(HELP.labels);
    expect(api.help('labels')).toContain('EMAP.setLayerLabel');
    expect(() => api.help('colours')).toThrow('No help section "colours". Sections: start, state, view');
    expect(helpText('all')).toContain(HELP.export);
  });
  it('every function of the API is documented, with an example in each how-to section', () => {
    const api = createApi(() => bridge()), all = helpText('all');
    const fns = Object.keys(api).filter((k) => typeof api[k] === 'function');
    expect(fns.length).toBeGreaterThan(50);
    for (const f of fns) expect(all, f).toContain(`EMAP.${f}(`);
    for (const k of ['view', 'layers', 'geology', 'labels', 'cards', 'export']) expect(HELP[k], k).toMatch(/Example/);
  });
});

describe('setters write the editor\'s project through its actions', () => {
  it('geology style and labels on the layer, as the inspector writes them; null turns them off', async () => {
    const b = withLayers(), api = createApi(() => b, null);
    await api.setGeoStyle('Thunder trend', { lineType: 'trend', glow: 6 });
    expect(b.project.layers[1].fx).toEqual({ lineType: 'trend', casing: false, glow: 6 });
    expect(b.project.layers[1].userStyled).toBe(true);
    await api.setLayerLabel('trend', { text: 'THUNDER TREND', side: 'left', offset: 6 });
    expect(b.project.layers[1].fx.label).toEqual({ text: 'THUNDER TREND', side: 'left', offset: 6, on: true });
    await api.setLayerLabel('Durand Stock', { sub: 'diorite', rotate: 'auto' });
    expect(b.project.layers[0].fx).toEqual({ label: { sub: 'diorite', rotate: 'auto', on: true } });
    await api.setLayerLabel('trend', null);
    expect(b.project.layers[1].fx.label.on).toBe(false);
    await api.setGeoStyle('trend', null);
    expect(b.project.layers[1].fx).toBeUndefined();
    await expect(api.setGeoStyle('Faults', { glow: 2 })).rejects.toThrow('No layer "Faults". Layers: unit (Durand Stock), trend (Thunder trend).');
  });
  it('cards: title, legend items, inset, scale and north, studio card style, corners', async () => {
    const b = withLayers({ legend: [{ id: 'unit', label: 'Durand Stock' }] }), api = createApi(() => b, null);
    const st = await api.setTitle({ title: 'Rabbit North', subtitle: 'Geology', kicker: 'SAMPLE CORP', corner: 'tr' });
    expect(st.title).toMatchObject({ title: 'Rabbit North', subtitle: 'Geology', kicker: 'SAMPLE CORP', corner: 'tr' });
    expect(b.project.layout.cornerLayout.tr.flat()).toContain('title');
    await api.setLegend({ title: 'Units', items: { unit: { label: 'Durand Stock (Jd)' } } });
    expect(b.project.layout.legendOverrides).toEqual({ unit: { label: 'Durand Stock (Jd)' } });
    await expect(api.setLegend({ items: { nope: { hidden: true } } })).rejects.toThrow('No legend item "nope". Items: unit.');
    await api.setInset({ style: 'satellite', title: 'Project location', pill: 'TSXV: SMP' });
    expect(b.project.layout).toMatchObject({ insetMode: 'satellite_locator', insetBasemap: 'satellite', insetTitle: 'Project location', studio: { pill: 'TSXV: SMP', kicker: 'SAMPLE CORP' } });
    await api.setScaleNorth({ home: 'panel', northStyle: 'rose', datumNote: 'NAD83 / UTM 10N' });
    expect(b.project.layout).toMatchObject({ northArrowStyle: 'rose', studio: { titleScale: false, scaleNorth: true, datumNote: 'NAD83 / UTM 10N' } });
    await api.setCard('scale', { tone: 'dark', radius: 12 });
    expect(b.project.layout.studio.cards.scale).toEqual({ tone: 'dark', radius: 12 });
    await expect(api.setCard('compass', {})).rejects.toThrow('kind must be one of "title", "legend", "inset", "scale", "callout".');
    await expect(api.setTheme({ theme: 'neon' })).rejects.toThrow('theme must be one of "investor_clean"');
  });
  it('the wash, the export settings and the basemap', async () => {
    const b = bridge(), api = createApi(() => b, null);
    await api.setWash({ amount: 0.2 });
    expect(b.project.layout.wash).toEqual({ amount: 0.2, vignette: 0, color: '#ffffff' });
    await api.setWash({ amount: 0 });
    expect(b.project.layout.wash).toBe(null);
    expect(api.getState().export.draft).toBe(true);
    await api.setExport({ band: false, draft: false, bandClient: 'Sample Corp' });
    expect(api.getState().export.draft).toBe(false);
    await expect(api.setExport({ draft: 'false' })).rejects.toThrow('draft must be true or false');
    expect(b.project.layout.exportSettings).toMatchObject({ band: false, draft: false, bandClient: 'Sample Corp', pixelRatio: 2 });
    await expect(api.setBasemap('osm')).rejects.toThrow('basemap must be one of "light"');
  });
  it('the drill plan setters need a plan, and check result ids', async () => {
    const b = bridge(), api = createApi(() => b, null);
    await expect(api.setResultsCard({ show: true })).rejects.toThrow('This map has no drill plan: EMAP.setDrillPlan');
    b.project = { ...b.project, drillPlan: { show: { traces: true }, holes: [{ id: '077', lat: 50.6, lng: -120.7 }], results: [{ resultId: 'R1', holeId: '077' }], assays: { elements: [{ name: 'Au_gpt' }] } } };
    await api.setResultsCard({ show: true, title: 'Holes 077 & 078', isNew: true });
    expect(b.project.drillPlan).toMatchObject({ show: { traces: true, card: true }, release: { title: 'Holes 077 & 078', isNew: true } });
    await api.setIntervalTags({ headings: { R1: 'Upper Blue Sky' } });
    expect(b.project.drillPlan.headings).toEqual({ R1: 'Upper Blue Sky' });
    await expect(api.setIntervalTags({ headings: { R9: 'x' } })).rejects.toThrow('No published result "R9". Results: R1.');
    await api.setHighlightCard({ at: '077', heading: 'Discovery', main: '198.75 m @ 0.69 g/t Au' });
    expect(b.project.drillPlan.highlight).toMatchObject({ at: { lat: 50.6, lng: -120.7 }, heading: 'Discovery', main: '198.75 m @ 0.69 g/t Au' });
    await expect(api.updateDrillPlan({ element: 'Cu_pct' })).rejects.toThrow('element must be one of "Au_gpt".');
  });
  it('no dialogs: leaving unsaved work needs discard, saveAs takes its name', async () => {
    const b = bridge({ isDirty: true }), api = createApi(() => b, null);
    await expect(api.newMap()).rejects.toThrow('This map has unsaved changes: EMAP.save() first, or newMap(…, { discard: true })');
    await api.newMap({ discard: true });
    expect(b.newMap).toHaveBeenCalledTimes(1);
    await expect(api.saveAs('  ')).rejects.toThrow('saveAs needs a name');
    const st = await api.saveAs('Rabbit North Fig 1');
    expect(b.saveAs).toHaveBeenCalledWith('Rabbit North Fig 1');
    expect(st.map).toMatchObject({ id: 'p1', name: 'Rabbit North Fig 1', unsaved: false });
    await expect(api.openProject('Nope', { discard: true })).rejects.toThrow('No saved map "Nope". Saved maps: none.');
  });
  it('exports follow the plan: a format it lacks is refused; the map must be ready', async () => {
    const b = bridge(), api = createApi(() => b, null);
    await expect(api.exportSVG()).rejects.toThrow('SVG export is not on this plan. This account exports: PNG.');
    await expect(api.exportPNG({ as: 'jpeg' })).rejects.toThrow('as must be one of "dataUrl", "blob".');
    await expect(api.exportPNG()).rejects.toThrow('The map is not ready yet');
    b.mapReady = true; b.map = {};
    await expect(api.exportPNG({ width: 1000 })).rejects.toThrow('Give width and height together');
    const out = await api.exportPNG({ band: false, pixelRatio: 2 });
    expect(b.exportFile).toHaveBeenCalledWith('png', { band: false, pixelRatio: 2, as: 'dataUrl' });
    expect(out).toEqual({ data: 'data:image/png;base64,AAAA', clamped: false, warnings: [] });
  });
  it.each(['png', 'svg', 'pdf', 'layers'])('passes an explicit draft override to %s without changing saved settings', async (format) => {
    const map = { getCenter: () => ({ lat: 50.6, lng: -120.7 }), getZoom: () => 12, getBounds: () => ({ getSouth: () => 50, getWest: () => -121, getNorth: () => 51, getEast: () => -120 }) };
    const b = bridge({ mapReady: true, map, entitlements: { allowed_export_formats: ['png', 'svg', 'pdf'] } });
    const api = createApi(() => b, null);
    await api.setExport({ draft: true });
    const method = { png: 'exportPNG', svg: 'exportSVG', pdf: 'exportPDF', layers: 'exportLayers' }[format];
    await api[method]({ draft: false });
    expect(b.exportFile).toHaveBeenCalledWith(format, expect.objectContaining({ draft: false }));
    expect(api.getState().export.draft).toBe(true);
    await expect(api[method]({ draft: 1 })).rejects.toThrow('draft must be true or false');
  });
  it('only on the editor screen', async () => {
    const api = createApi(() => bridge({ screen: 'dashboard' }), null);
    await expect(api.setTitle({ title: 'x' })).rejects.toThrow('Open the map editor first');
  });
});
