import { describe, it, expect } from 'vitest';
import {
  attributeFields, suggestBreaks, buildGraduated, buildCategorical, classIndexFor,
  classStyle, classLabel, classLegendItems, isClassified, MAX_CATEGORIES,
} from '../src/utils/classification.js';
import { getFeatureStyle } from '../src/utils/featureStyle.js';

// A soil grid reads as four colours and four sizes from one layer; a geology
// sheet shows each unit in its own colour from one polygon file. Before this
// the only way was a layer per class, split in another program.

const pt = (cu, unit = 'Finlayson', extra = {}) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: { Cu_ppm: cu, Unit: unit, ...extra } });
const soils = { id: 'soil', type: 'points', role: 'soil_samples', geojson: { type: 'FeatureCollection', features: [
  pt(12), pt(30), pt(45), pt(60), pt(80), pt(95), pt(120), pt(150), pt(180), pt(260), pt('>300'), pt(''), pt(null),
] } };

describe('attributeFields', () => {
  it('lists columns and says which read as numbers', () => {
    const fields = attributeFields(soils);
    expect(fields.find((f) => f.key === 'Cu_ppm').numeric).toBe(true);
    expect(fields.find((f) => f.key === 'Unit').numeric).toBe(false);
  });

  it('hides internal columns', () => {
    const l = { geojson: { type: 'FeatureCollection', features: [pt(1, 'x', { _holeid: 'a' })] } };
    expect(attributeFields(l).map((f) => f.key)).not.toContain('_holeid');
  });
});

describe('suggestBreaks', () => {
  it('returns n-1 ascending nice boundaries', () => {
    const b = suggestBreaks([12, 30, 45, 60, 80, 95, 120, 150, 180, 260, 300], 4);
    expect(b.length).toBe(3);
    for (let i = 1; i < b.length; i += 1) expect(b[i]).toBeGreaterThan(b[i - 1]);
    for (const v of b) expect(String(v)).toMatch(/^[125]0*$/);
  });

  it('collapses duplicate boundaries on skewed data rather than emitting empty classes', () => {
    expect(suggestBreaks([1, 1, 1, 1, 1, 1, 1, 100], 4).length).toBeLessThan(3);
    expect(suggestBreaks([5], 4)).toEqual([]);
  });
});

describe('graduated classes', () => {
  const c = buildGraduated(soils, 'Cu_ppm', 4);

  it('builds an open-ended top class with a colour and size per class', () => {
    expect(c.mode).toBe('graduated');
    expect(c.classes[c.classes.length - 1].max).toBeNull();
    expect(new Set(c.classes.map((k) => k.color)).size).toBe(c.classes.length);
    expect(c.classes[1].size).toBeGreaterThan(c.classes[0].size);
    expect(isClassified({ classification: c })).toBe(true);
  });

  it('assigns a feature to the first class whose ceiling holds it', () => {
    const manual = { field: 'Cu_ppm', mode: 'graduated', classes: [{ max: 50, color: '#1' }, { max: 100, color: '#2' }, { max: 200, color: '#3' }, { max: null, color: '#4' }] };
    expect(classIndexFor(manual, pt(50))).toBe(0);
    expect(classIndexFor(manual, pt(51))).toBe(1);
    expect(classIndexFor(manual, pt(999))).toBe(3);
    expect(classIndexFor(manual, pt('>300'))).toBe(3);
    expect(classIndexFor(manual, pt(''))).toBe(-1);
    expect(classIndexFor(manual, pt('n/a'))).toBe(-1);
  });

  it('labels ranges the way a legend reads them', () => {
    const manual = { field: 'Cu_ppm', mode: 'graduated', classes: [{ max: 50 }, { max: 100 }, { max: 200 }, { max: null }] };
    expect([0, 1, 2, 3].map((i) => classLabel(manual, i))).toEqual(['≤ 50', '50 – 100', '100 – 200', '> 200']);
    expect(classLabel({ ...manual, classes: [{ max: 50, label: ' low ' }, { max: null }] }, 0)).toBe('low');
    expect(classLabel({ ...manual, classes: [{ max: null }] }, 0)).toBe('All values');
  });
});

describe('categorical classes', () => {
  const geology = { id: 'geo', type: 'polygon', role: 'claims', geojson: { type: 'FeatureCollection', features: [
    pt(0, 'Snowcap'), pt(0, 'Finlayson'), pt(0, 'Snowcap'), pt(0, 'Stikine'), pt(0, 'Snowcap'),
  ] } };

  it('lists unique values most frequent first with a colour each', () => {
    const c = buildCategorical(geology, 'Unit');
    expect(c.classes.map((k) => k.value)).toEqual(['Snowcap', 'Finlayson', 'Stikine']);
    expect(c.truncated).toBe(false);
    expect(classIndexFor(c, pt(0, 'Stikine'))).toBe(2);
    expect(classIndexFor(c, pt(0, 'Other'))).toBe(-1);
  });

  it('caps the number of categories', () => {
    const many = { geojson: { type: 'FeatureCollection', features: Array.from({ length: 40 }, (_, i) => pt(0, `u${i}`)) } };
    const c = buildCategorical(many, 'Unit');
    expect(c.classes.length).toBe(MAX_CATEGORIES);
    expect(c.truncated).toBe(true);
  });

  it('colours an area by fill and leaves its outline to the layer', () => {
    const c = buildCategorical(geology, 'Unit');
    expect(classStyle(c, pt(0, 'Snowcap'), false)).toEqual({ fill: c.classes[0].color });
    expect(classStyle(c, pt(0, 'nope'), false)).toBeNull();
  });
});

describe('style resolution with a class', () => {
  const template = { roleStyles: { soil_samples: { markerColor: '#000', markerSize: 10 } } };
  const layer = { ...soils, style: { stroke: '#123' }, classification: { field: 'Cu_ppm', mode: 'graduated', classes: [{ max: 100, color: '#aaa', size: 6 }, { max: null, color: '#bbb', size: 14 }] }, featureOverrides: { k: { markerShape: 'square' } } };

  it('sits between the layer style and a per-feature override', () => {
    const low = getFeatureStyle(template, layer, pt(20), null);
    expect(low).toMatchObject({ stroke: '#123', markerColor: '#aaa', markerFill: '#aaa', markerSize: 6 });
    const high = getFeatureStyle(template, layer, pt(500), 'k');
    expect(high).toMatchObject({ markerColor: '#bbb', markerSize: 14, markerShape: 'square' });
  });

  it('falls back to the layer style for a feature with no value', () => {
    expect(getFeatureStyle(template, layer, pt(''), null).markerColor).toBe('#000');
  });
});

describe('classLegendItems', () => {
  it('emits one row per class with stable ids and growing swatches', () => {
    const layer = { ...soils, classification: buildGraduated(soils, 'Cu_ppm', 4) };
    const rows = classLegendItems(layer, { markerColor: '#000' }, 'Soil Cu', 'Soil Geochemistry', true);
    expect(rows.length).toBe(layer.classification.classes.length);
    expect(rows[0].id).toBe('soil::class:graduated:Cu_ppm:0');
    expect(rows[0].legacyIds).toContain('soil::class:0');
    expect(rows[0].group).toBe('Soil Geochemistry');
    expect(rows.every((r) => r.type === 'points')).toBe(true);
    expect(rows[rows.length - 1].swatchSize).toBeGreaterThan(rows[0].swatchSize);
    expect(rows[0].style.markerColor).toBe(layer.classification.classes[0].color);
  });
});


describe('Codex follow-ups', () => {
  it('colours the open-ended top class row like the map does', () => {
    const layer = { id: 'l', type: 'points', role: 'soil_samples', classification: { field: 'Cu_ppm', mode: 'graduated', classes: [{ max: 100, color: '#aaa', size: 6 }, { max: null, color: '#bbb', size: 14 }] } };
    const rows = classLegendItems(layer, { markerColor: '#000' }, 'Soil', 'G', true);
    expect(rows[1].style.markerColor).toBe('#bbb');
    expect(rows[1].style.markerSize).toBe(14);
  });

  it('gives a line layer its class colour as stroke', () => {
    const c = { field: 'Unit', mode: 'categorical', classes: [{ value: 'a', color: '#123456' }] };
    expect(classStyle(c, { properties: { Unit: 'a' } }, 'line')).toEqual({ stroke: '#123456' });
    const rows = classLegendItems({ id: 'x', type: 'line', classification: c }, { stroke: '#000' }, 'Faults', 'G', false);
    expect(rows[0].type).toBe('line');
    expect(rows[0].style.stroke).toBe('#123456');
  });

  it('scopes legend ids to the field and mode', () => {
    const base = { id: 'x', type: 'points' };
    const a = classLegendItems({ ...base, classification: buildGraduated(soils, 'Cu_ppm', 3) }, {}, 'S', 'G', true)[0].id;
    const b = classLegendItems({ ...base, classification: buildCategorical(soils, 'Unit') }, {}, 'S', 'G', true)[0].id;
    expect(a).not.toBe(b);
    expect(b).toContain('categorical');
  });

  it('does not count a drill trace as an observation', () => {
    const withTrace = { ...soils, geojson: { type: 'FeatureCollection', features: [pt(10), pt(1000), { ...pt(1000), properties: { Cu_ppm: 1000, _trace: true } }] } };
    expect(attributeFields(withTrace).length).toBeGreaterThan(0);
    const c = buildCategorical(withTrace, 'Cu_ppm');
    // Two real observations, one each: the trace must not make 1000 win.
    expect(c.classes.map((k) => k.value).sort()).toEqual(['10', '1000']);
  });
});


describe('class ids over time', () => {
  it('keeps two categories that slug alike as two rows', () => {
    const c = { field: 'Unit', mode: 'categorical', classes: [{ value: 'A B', color: '#1' }, { value: 'A/B', color: '#2' }] };
    const rows = classLegendItems({ id: 'g', type: 'polygon', classification: c }, {}, 'Geo', 'G', false);
    expect(new Set(rows.map((r) => r.id)).size).toBe(2);
  });

  it('still honours a rename or hide saved under the old id format', async () => {
    const { applyLegendCustomization, orderLegendItems } = await import('../src/utils/legendCustomization.js');
    const layer = { id: 'soil', type: 'points', classification: { field: 'Cu_ppm', mode: 'graduated', classes: [{ max: 50, color: '#a' }, { max: null, color: '#b' }] } };
    const rows = classLegendItems(layer, {}, 'Soil', 'G', true);
    const out = applyLegendCustomization(rows, { legendOverrides: { 'soil::class:0': { label: 'Background' }, 'soil::class:1': { hidden: true } } });
    expect(out.map((r) => r.label)).toEqual(['Background']);
    expect(orderLegendItems(rows, ['soil::class:1']).map((r) => r.legacyIds[1])).toEqual(['soil::class:1', 'soil::class:0']);
  });
});


describe('the slugged id format of the previous release', () => {
  it('still resolves a saved override', async () => {
    const { overrideFor } = await import('../src/utils/legendCustomization.js');
    const c = { field: 'Unit Name', mode: 'categorical', classes: [{ value: 'A/B', color: '#1' }] };
    const [row] = classLegendItems({ id: 'g', type: 'polygon', classification: c }, {}, 'Geo', 'G', false);
    expect(row.legacyIds).toContain('g::class:categorical:Unit_Name:A_B');
    expect(overrideFor({ 'g::class:categorical:Unit_Name:A_B': { label: 'Old name' } }, row).label).toBe('Old name');
    expect(overrideFor({ [row.id]: { label: 'New' }, 'g::class:categorical:Unit_Name:A_B': { label: 'Old' } }, row).label).toBe('New');
  });
});
