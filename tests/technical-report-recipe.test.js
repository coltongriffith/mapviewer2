import { describe, it, expect } from 'vitest';
import { applyTechnicalReport } from '../src/utils/technicalReport.js';
import { resolveTitleStripFields } from '../src/templates/technicalReportTemplate.js';

const project = (layout = {}, layers = []) => ({ layout: { title: 'Project Map', ...layout }, layers });
const claims = (id, name, extra = {}) => ({ id, role: 'claims', visible: true, type: 'geojson',
  displayName: 'Claims', ...extra, geojson: { type: 'FeatureCollection', features: [{
    type: 'Feature', properties: { PROJECT_NAME: name }, geometry: { type: 'Polygon',
      coordinates: [[[-120, 50], [-119, 50], [-119, 51], [-120, 50]]] },
  }] } });

describe('explicit Technical Report recipe', () => {
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
