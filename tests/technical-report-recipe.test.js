import { describe, it, expect } from 'vitest';
import { applyTechnicalReport } from '../src/utils/technicalReport.js';
import { resolveTitleStripFields } from '../src/templates/technicalReportTemplate.js';
import { buildLegendItemsNI43101, technicalReportTemplate } from '../src/templates/technicalReportTemplate.js';
import { buildLegendItems } from '../src/templates/technicalResultsTemplate.js';
import { applyLegendCustomization, legendNoteLines, noteInLegend } from '../src/utils/legendCustomization.js';

const project = (layout = {}, layers = []) => ({ layout: { title: 'Project Map', ...layout }, layers });
const claims = (id, name, extra = {}) => ({ id, role: 'claims', visible: true, type: 'geojson',
  displayName: 'Claims', ...extra, geojson: { type: 'FeatureCollection', features: [{
    type: 'Feature', properties: { PROJECT_NAME: name }, geometry: { type: 'Polygon',
      coordinates: [[[-120, 50], [-119, 50], [-119, 51], [-120, 50]]] },
  }] } });

describe('explicit Technical Report recipe', () => {
  it('prints a supplied source note through the existing legend-note contract and respects a hidden footer', () => {
    const next = applyTechnicalReport(project({ footerText: 'Supplied source disclosure', templateId: 'ni_43101_technical' }));
    const rows = [{ id: 'source', label: 'Sample', type: 'points' }];
    expect(noteInLegend(next.layout, rows)).toBe(true);
    expect(legendNoteLines(next.layout, rows).join(' ')).toBe('Supplied source disclosure');
    expect(noteInLegend({ ...next.layout, footerEnabled: false }, rows)).toBe(false);
  });
  it.each([buildLegendItems, buildLegendItemsNI43101])('prints literal supplied class field context without changing row IDs or overrides', (build) => {
    const sample = { id: 'sample', role: 'soil_samples', type: 'points', visible: true, style: { markerSize: 6 },
      geojson: { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { Cu_ppm: 20 }, geometry: { type: 'Point', coordinates: [-120, 50] } }] },
      classification: { field: 'Cu_ppm', mode: 'numeric', classes: [{ id: 'low', max: 50, color: '#aabbcc' }, { id: 'high', max: null, color: '#112233' }] } };
    const before = structuredClone(sample);
    const legacy = build(technicalReportTemplate, [sample], {});
    const selected = build(technicalReportTemplate, [sample], { technicalReportVersion: 1 });
    expect(selected.map((row) => row.id)).toEqual(legacy.map((row) => row.id));
    expect(selected.map((row) => row.label)).toEqual(legacy.map((row) => row.label));
    expect(selected.every((row) => row.group.endsWith(' · Cu_ppm'))).toBe(true);
    const changed = applyLegendCustomization(selected, { legendOverrides: { [selected[0].id]: { group: 'My supplied heading' } } });
    expect(changed[0].group).toBe('My supplied heading');
    const explicit = build(technicalReportTemplate, [{ ...sample, legend: { group: 'Explicit heading' } }], { technicalReportVersion: 1 });
    expect(explicit.every((row) => row.group === 'Explicit heading')).toBe(true);
    expect(sample).toEqual(before);
  });
  it('uses only a supplied unambiguous project title', () => {
    const source = project({}, [claims('subject', 'Illustrative Ridge')]);
    expect(applyTechnicalReport(source).layout.title).toBe('Illustrative Ridge');
    expect(source.layout.title).toBe('Project Map');
  });
  it('does not infer a subject from file order or an owner', () => {
    const source = project({}, [claims('one', 'One'), claims('two', 'Two')]);
    expect(applyTechnicalReport(source).layout.title).toBe('Technical Report');
  });
  it('retains explicit figure, QP, source, brand and scientific settings', () => {
    const values = { title: 'Supplied title', stripTitle: 'Figure title', stripSubtitle: 'Supplied property',
      qpName: 'Supplied QA name', qpCredentials: 'Supplied credentials', companyName: 'Supplied company',
      figureNumber: '7', figureRevision: 'B', mapDate: '2025-04-01', projectionName: 'Supplied CRS',
      manualScaleDenom: 25000, footerText: 'Supplied disclosure', logo: 'data:image/png;base64,qa',
      fonts: { title: 'Lato' }, accentColor: '#133455', brandStyle: { brandKitId: 'owned' },
      callouts: [{ id: 'result', pinned: true, text: 'Supplied result' }], cutoff: 0.2 };
    const result = applyTechnicalReport(project(values));
    for (const [key, value] of Object.entries(values)) expect(result.layout[key]).toEqual(value);
  });
  it('leaves all source layers and their visibility/styles exactly intact', () => {
    const layers = [claims('subject', 'Ridge', { visible: false, userStyled: true, style: { fill: '#ff0000' } }),
      { id: 'sample', visible: true, role: 'soil_samples', classification: { field: 'Cu_ppm' } }];
    expect(applyTechnicalReport(project({}, layers)).layers).toBe(layers);
  });
  it('changes furniture only and leaves supplied geographic annotation endpoints and manual pins intact', () => {
    const source = { ...project(), distanceLines: [{ id: 'distance', p1: { lat: 50, lng: -120 }, p2: { lat: 50.02, lng: -120.02 }, label: 'Supplied distance caption' }],
      callouts: [{ id: 'manual', anchor: { lat: 50, lng: -120 }, offset: { x: 20, y: 15 }, isManualPosition: true }] };
    const next = applyTechnicalReport(source);
    expect(next.distanceLines).toBe(source.distanceLines);
    expect(next.callouts).toBe(source.callouts);
    expect(next.layout.legendCorner).toBe('tl');
    expect(next.layout.cornerLayout.tl).toContainEqual(['legend']);
  });
  it('reuses missing metadata and render-time date fallbacks without saving them', () => {
    const next = applyTechnicalReport(project());
    const fields = resolveTitleStripFields(next.layout, { now: new Date('2026-01-02T00:00:00Z') });
    expect(fields.qpName).toBe('NOT SET');
    expect(fields.figureNumber).toBe('NOT SET');
    expect(fields.figureRevision).toBe('Rev. NOT SET');
    expect(fields.date).toBe('2026-01-02');
    for (const key of ['qpName', 'figureNumber', 'figureRevision', 'mapDate']) expect(next.layout[key]).toBeUndefined();
  });
  it('preserves custom format, locator, explicit grouping choice and meaningful subtitle', () => {
    const values = { exportSettings: { customWidth: 700, customHeight: 1100 }, insetMode: 'custom_image',
      insetCustomImage: 'supplied', legendGrouped: false, subtitle: 'Supplied soil survey' };
    const next = applyTechnicalReport(project(values));
    expect(next.layout.exportRatio).toBeNull();
    for (const [key, value] of Object.entries(values)) expect(next.layout[key]).toEqual(value);
  });
  it('removes generic results captions and remains stable on reselection', () => {
    const once = applyTechnicalReport(project({ subtitle: 'Technical Results' }));
    expect(once.layout.subtitle).toBe('');
    expect(applyTechnicalReport(once)).toEqual(once);
  });
});
