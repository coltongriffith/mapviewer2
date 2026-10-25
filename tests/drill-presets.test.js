import { describe, it, expect } from 'vitest';
import data from '../shared/drillPresets.json';
import { PRESETS, detectPreset, presetMapping } from '../src/utils/drillPresets.js';
import { autoMapping, buildImport, parseAssay, parseCsv, parseElementHeader, FIELDS } from '../src/utils/drillDb.js';

// Vendor import presets (shared/drillPresets.json) and the assay quirks of
// vendor exports in the shared parsing path (src/utils/drillDb.js).

describe('preset file', () => {
  it('every preset cites a source, names a kind and maps only known fields', () => {
    expect(PRESETS).toBe(data.presets);
    expect(new Set(PRESETS.map((p) => p.id)).size).toBe(PRESETS.length);
    for (const p of PRESETS) {
      expect(p.sources.length).toBeGreaterThan(0);
      for (const u of p.sources) expect(u).toMatch(/^https:\/\//);
      expect(Object.keys(FIELDS)).toContain(p.kind);
      expect(p.required.length).toBeGreaterThan(0);
      for (const k of Object.keys(p.columns)) expect(FIELDS[p.kind].map((f) => f.key)).toContain(k);
    }
  });
});

describe('detection', () => {
  it('MX Deposit collar export: detected by its coordinates. columns and mapped past the auto-detection', async () => {
    const t = await parseCsv('Hole number,coordinates.grid,coordinates.easting,coordinates.northing,converted.coordinates.easting,converted.coordinates.northing\nMX-01,UTM 10N,512000,6700000,-123.1,60.4\n');
    const p = detectPreset(t.header);
    expect(p.id).toBe('mx-deposit-collars');
    const m = presetMapping(p, t.header, autoMapping(p.kind, t.header, t.rows, { crs: 'EPSG:26910' }));
    expect(m.columns).toEqual({ hole_id: 'Hole number', x: 'coordinates.easting', y: 'coordinates.northing' });
    expect(m).toMatchObject({ crs: 'EPSG:26910', preset: 'mx-deposit-collars' });
    expect(buildImport('collars', t, m).rows).toEqual([{ hole_id: 'MX-01', x: 512000, y: 6700000, crs: 'EPSG:26910' }]);
  });

  it('each preset is detected from its own headers', () => {
    for (const p of PRESETS) expect(detectPreset([...p.required, ...Object.values(p.columns)])?.id).toBe(p.id);
  });

  it('offers nothing for an ordinary file or when only part of a signature is there', () => {
    expect(detectPreset(['HoleID', 'Easting', 'Northing'])).toBeNull();
    expect(detectPreset(['Hole number', 'coordinates.easting'])).toBeNull();
  });

  it('offers nothing when two presets match equally; the stronger match wins otherwise', () => {
    const a = { id: 'a', vendor: 'A', kind: 'assays', required: ['HOLEID', 'SAMPFROM'], columns: { hole_id: 'HOLEID', from_m: 'SAMPFROM' } };
    const b = { id: 'b', vendor: 'B', kind: 'lithology', required: ['HOLEID', 'SAMPFROM'], columns: { hole_id: 'HOLEID', from_m: 'SAMPFROM' } };
    expect(detectPreset(['HOLEID', 'SAMPFROM', 'SAMPTO'], [a, b])).toBeNull();
    const c = { ...b, id: 'c', columns: { ...b.columns, to_m: 'SAMPTO' } };
    expect(detectPreset(['HOLEID', 'SAMPFROM', 'SAMPTO'], [a, c])?.id).toBe('c');
  });

  it('a preset keeps the file\'s other columns, sets element names and units, and its own missing codes', async () => {
    const preset = { id: 't', vendor: 'T', kind: 'assays', required: ['BHID'], columns: { hole_id: 'BHID', sample_id: 'SMP' }, elements: [{ column: 'AU1', name: 'Au', unit: 'g/t' }], missing: [-1] };
    const t = await parseCsv('BHID,From,To,SMP,AU1,Cu_pct\nR-1,0,2,S1,-1,0.4\n');
    const m = presetMapping(preset, t.header, autoMapping('assays', t.header, t.rows));
    expect(m.columns).toEqual({ hole_id: 'BHID', from_m: 'From', to_m: 'To', sample_id: 'SMP' });
    expect(m.elements.map(({ column, name, unit, skip }) => ({ column, name, unit, skip }))).toEqual([
      { column: 'AU1', name: 'Au', unit: 'g/t', skip: undefined }, { column: 'Cu_pct', name: 'Cu', unit: '%', skip: undefined },
    ]);
    expect(m.missing).toEqual(['-1']);
    expect(buildImport('assays', t, m).rows[0]).toMatchObject({ values: { Cu: 0.4 }, units: { Cu: '%' } });
  });
});

describe('vendor assay quirks', () => {
  it('element columns carry their unit', () => {
    expect(parseElementHeader('Au_ppm')).toEqual({ name: 'Au', unit: 'ppm' });
    expect(parseElementHeader('Au_ppb')).toEqual({ name: 'Au', unit: 'ppb' });
    expect(parseElementHeader('Cu_pct')).toEqual({ name: 'Cu', unit: '%' });
  });

  it('-99, -999 and -9999 are no value, never a detection limit; a mapping can change the codes', () => {
    for (const v of ['-99', '-999', '-9999', '-999.0']) expect(parseAssay(v)).toEqual({ value: null, missing: true, raw: v });
    expect(parseAssay('-0.005')).toEqual({ value: 0.0025, dl: 0.005 });
    expect(parseAssay('-999', 'half', [])).toEqual({ value: 499.5, dl: 999 });
    expect(parseAssay('-1', 'half', ['-1'])).toEqual({ value: null, missing: true, raw: '-1' });
  });

  it('IS, NSS, NS and LNR are no value with the code kept; <5 is below detection; >10000 stays flagged', () => {
    for (const v of ['IS', 'NSS', 'NS', 'LNR', 'lnr']) expect(parseAssay(v)).toEqual({ value: null, missing: true, raw: v });
    expect(parseAssay('<5')).toEqual({ value: 2.5, dl: 5 });
    expect(parseAssay('>10000')).toEqual({ value: 10000, over: true });
  });

  it('an import reports the codes it stored as no value and the elements over the limit', async () => {
    const t = await parseCsv('HoleID,From,To,Au_ppb,Cu_ppm\nR-1,0,1,IS,-999\nR-1,1,2,NSS,>10000\nR-1,2,3,<5,LNR\nR-1,3,4,12,-9999\n');
    const r = buildImport('assays', t, autoMapping('assays', t.header, t.rows));
    expect(r.errorCount).toBe(0);
    expect(r.rows.map((o) => o.values)).toEqual([{}, { Cu: 10000 }, { Au: 2.5 }, { Au: 12 }]);
    expect(r.rows[2].bdl).toEqual({ Au: 5 });
    expect(r.warnings.map((w) => w.message)).toEqual([
      '1 value over the upper detection limit (">") in Cu kept at the limit, not a measured grade; re-assay by an over-limit method',
      '5 values stored as no value: IS ×1, -999 ×1, NSS ×1, LNR ×1, -9999 ×1',
      '1 value below detection, stored as half the detection limit and flagged',
    ]);
  });
});
