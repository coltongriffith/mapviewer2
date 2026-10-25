import { describe, expect, it } from 'vitest';
import { autoQaqcMapping, buildQaqcImport, parseQaqcValue, qaqcJsonBytes } from '../src/utils/drillQaqcImport';
import { parseCsv } from '../src/utils/drillDb';

const table = (rows, extra = {}) => ({ header: ['Sample', 'Type', 'Au'], rows, ...extra });
const mapping = () => ({ columns: { sample_id: 'Sample', sample_type: 'Type' }, constants: { lab_id: 'LAB-01', lab_batch_id: 'JOB-001' }, elements: [{ column: 'Au', element: 'Au', unit: 'g/t', skip: false }] });
const build = (rows, m = mapping(), extra) => buildQaqcImport('samples', table(rows, extra), m);
const crmTable = { header: ['crm_id', 'revision', 'element', 'unit', 'expected', 'sd', 'source'], rows: [['001', 'cert-v1', 'Au', 'g/t', '1.020', '0.03', 'Manufacturer certificate 001']] };

describe('strict QA/QC measurements', () => {
  it('preserves original reporting and censoring without numeric substitution', () => {
    expect(parseQaqcValue(' 1.020 ')).toEqual({ value: 1.02, raw: ' 1.020 ' });
    expect(parseQaqcValue('<0.005')).toEqual({ value: null, bdl: 0.005, raw: '<0.005' });
    for (const raw of ['BDL', 'nd', '<DL', '<LOD']) expect(parseQaqcValue(raw)).toEqual({ value: null, bdl: true, raw });
    expect(parseQaqcValue('1.2e-3')).toMatchObject({ value: 0.0012 });
  });
  it.each(['', 'NA', 'N/A', 'IS', 'NS', '--', 'null'])('does not treat missing %j as BDL', raw => {
    expect(parseQaqcValue(raw).error).toBeTruthy();
  });
  it.each(['-999', '-0.005', '>10', '>=10', '<=0.005', '<0', 'Infinity', 'NaN', '1e12', '1e999', '1e-999', '0x10', '1,000', '1 000'])('refuses unsupported result %j', raw => {
    expect(parseQaqcValue(raw).error).toBeTruthy();
  });
  it('changes decimal convention only by explicit choice, never guesses thousands', () => {
    expect(parseQaqcValue('1,020').error).toBeTruthy();
    expect(parseQaqcValue('1,020', { decimalComma: true })).toEqual({ value: 1.02, raw: '1,020' });
    expect(parseQaqcValue('<0,005', { decimalComma: true })).toEqual({ value: null, bdl: 0.005, raw: '<0,005' });
    expect(parseQaqcValue('1.020', { decimalComma: true }).error).toBeTruthy();
    expect(parseQaqcValue('1,000,000', { decimalComma: true }).error).toBeTruthy();
    expect(parseQaqcValue('1'.repeat(101)).error).toMatch(/100/);
  });
});

describe('explicit sample mapping', () => {
  it('suggests headers only and requires a deliberate element/type/unit choice', () => {
    const auto = autoQaqcMapping('samples', ['Sample ID', 'Au_ppm', 'lab_id']);
    expect(auto.columns).toEqual({ sample_id: 'Sample ID', lab_id: 'lab_id' });
    expect(auto.elements).toEqual([{ column: 'Au_ppm', element: 'Au_ppm', unit: '', skip: true }]);
    expect(auto.constants).toEqual({});
    expect(build([['001', 'routine', '1']], { ...mapping(), elements: [{ column: 'Au', element: 'Au', unit: '' }] }).errorCount).toBeGreaterThan(0);
    expect(build([['001', 'STD', '1']]).errors[0].message).toMatch(/exact sample type/);
  });
  it('preserves exact identities, raw values and original row order without fake intervals', () => {
    const source = table([['00002', 'blank', '<0.005'], [' 00001 ', 'routine', '1.020']], { lines: [7, 11] });
    const before = JSON.stringify(source);
    const result = buildQaqcImport('samples', source, mapping());
    expect(result.errorCount).toBe(0); expect(result.lines).toEqual([7, 11]);
    expect(result.rows[0]).toEqual({ lab_id: 'LAB-01', lab_batch_id: 'JOB-001', sample_id: '00002', sample_type: 'blank', values: { Au: null }, units: { Au: 'g/t' }, raw_values: { Au: '<0.005' }, bdl: { Au: 0.005 } });
    expect(result.rows[1]).toMatchObject({ sample_id: ' 00001 ', values: { Au: 1.02 }, raw_values: { Au: '1.020' } });
    expect(result.rows[0]).not.toHaveProperty('hole_id'); expect(result.rows[0]).not.toHaveProperty('from_m');
    expect(JSON.stringify(source)).toBe(before);
  });
  it('supports explicit file constants but never fills a blank mapped cell from one', () => {
    const m = mapping(); delete m.columns.sample_type; m.constants.sample_type = 'blank';
    expect(build([['001', '', '<0.005']], m).rows[0].sample_type).toBe('blank');
    m.columns.sample_type = 'Type';
    expect(build([['001', '', '<0.005']], m).errorCount).toBeGreaterThan(0);
  });
  it('reports every invalid source row and preserves physical CSV lines', async () => {
    const parsed = await parseCsv('Sample,Type,Au\n001,routine,1\n\n002,blank,\n003,routine,>10\n004,routine,-99');
    const result = buildQaqcImport('samples', parsed, mapping());
    expect(result.errorCount).toBe(3); expect(result.errors.map(e => e.line)).toEqual([4, 5, 6]);
    expect(result.rows).toHaveLength(1); expect(result.lines).toEqual([2]);
  });
  it('refuses ambiguous mappings, duplicate element names and repeated sample identities', () => {
    expect(build([['001', 'routine', '1']], { ...mapping(), columns: { sample_id: 'missing', sample_type: 'Type' } }).errors[0].message).toMatch(/missing/);
    const m = mapping(); m.columns.sample_id = 'Au';
    expect(build([['001', 'routine', '1']], m).errors[0].message).toMatch(/more than once/);
    m.columns.sample_id = 'Sample'; m.elements.push({ column: 'Type', element: 'Au', unit: 'g/t' });
    expect(build([['001', 'routine', '1']], m).errors.some(e => /Element Au.*more than once/.test(e.message))).toBe(true);
    expect(build([['001', 'routine', '1'], ['001', 'routine', '2']]).errors).toEqual([{ line: 3, message: 'This identity also appears on line 2.' }]);
    expect(buildQaqcImport('samples', table([['001', 'routine', '1']], { header: ['Sample', 'Type', 'Type'] }), mapping()).errorCount).toBeGreaterThan(0);
  });
  it('requires CRM provenance and duplicate identity, and checks intervals independently', () => {
    expect(build([['001', 'standard', '1']]).errors[0].message).toMatch(/exact revision/);
    expect(build([['001', 'field_dup', '1']]).errors[0].message).toMatch(/parent/);
    const m = mapping(); m.columns = { ...m.columns, parent_sample_id: 'Parent', from_m: 'From', to_m: 'To', hole_id: 'Hole' };
    const data = { header: ['Sample', 'Type', 'Au', 'Parent', 'From', 'To', 'Hole'], rows: [['D1', 'field_dup', '1', 'R1', '', '', ''], ['R1', 'routine', '2', '', '0', '1', 'H1']] };
    expect(buildQaqcImport('samples', data, m).errors[0].message).toMatch(/parent is in this file/);
    data.rows = [['D1', 'field_dup', '1', 'R1', '', '', '']];
    expect(buildQaqcImport('samples', data, m).warnings[0].message).toMatch(/previously imported/);
    data.rows = [['R1', 'routine', '1', '', '2', '1', 'H1']];
    expect(buildQaqcImport('samples', data, m).errors[0].message).toMatch(/interval/);
  });
  it('preserves dictionary keys such as __proto__ without mutating prototypes', () => {
    const m = mapping(); m.elements[0].element = '__proto__';
    const result = build([['001', 'routine', '1']], m);
    expect(result.errorCount).toBe(0);
    expect(JSON.parse(JSON.stringify(result.rows[0])).values).toEqual(JSON.parse('{"__proto__":1}'));
  });
});

describe('CRM mapping and bounded requests', () => {
  it('counts JSONB separator spaces without treating quoted punctuation as structural', () => {
    const value = { filename: '岩,:".csv', columns: ['a', 'b'] };
    const jsonb = '{"filename": "岩,:\\".csv", "columns": ["a", "b"]}';
    expect(qaqcJsonBytes(value)).toBe(new TextEncoder().encode(jsonb).length);
    expect(qaqcJsonBytes({ tiny: 1e-300 })).toBe('{"tiny": '.length + 302 + 1);
    expect(qaqcJsonBytes([1e-7, 1e21, -1.23e-8])).toBe('[0.0000001, 1000000000000000000000, -0.0000000123]'.length);
  });
  it('uses supplied certified numeric values and exact revision/unit/source', () => {
    const m = autoQaqcMapping('crms', crmTable.header);
    const result = buildQaqcImport('crms', crmTable, m);
    expect(result.errorCount).toBe(0);
    expect(result.rows[0]).toEqual({ crm_id: '001', revision: 'cert-v1', element: 'Au', unit: 'g/t', expected: 1.02, sd: 0.03, source: 'Manufacturer certificate 001' });
    for (const sd of ['0', '-1', '<0.03', 'ND']) {
      const t = { ...crmTable, rows: [[...crmTable.rows[0]]] }; t.rows[0][5] = sd;
      expect(buildQaqcImport('crms', t, m).errorCount).toBeGreaterThan(0);
    }
  });
  it('bounds row count, diagnostics and UTF-8 JSON bytes without discarding scientific data', () => {
    expect(build([]).errorCount).toBe(1);
    expect(build(Array.from({ length: 5001 }, () => ['001', 'routine', '1'])).errors[0].message).toMatch(/5,000/);
    const bad = build(Array.from({ length: 60 }, (_, i) => [String(i), 'routine', '>1']));
    expect(bad.errorCount).toBe(60); expect(bad.errors).toHaveLength(50);
    const t = { ...crmTable, rows: Array.from({ length: 1500 }, (_, i) => [String(i), 'v1', 'Au', 'g/t', '1', '0.1', '岩'.repeat(1000)]) };
    expect(buildQaqcImport('crms', t, autoQaqcMapping('crms', t.header)).errors.at(-1).message).toMatch(/4 MB/);
  });
});
