// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { autoMapping, applyTemplate, buildImport, detectKind, diffSentence, drillDb, parseCsv } from '../src/utils/drillDb.js';
import { readWorkbook, sheetTable } from '../src/utils/xlsxRead.js';
import { xlsxFixture } from './fixtures/xlsx.js';
const header = ['HoleID', 'From', 'To', 'Alteration code', 'Description', 'Intensity'];
const build = rows => buildImport('alteration', { header, rows }, autoMapping('alteration', header, rows));

describe('alteration interval mapping', () => {
  it('suggests alteration only from explicit interval headers or filename signals', () => {
    const row = ['H1', '0', '1', '03', '', 'weak'];
    expect(detectKind(header, [row], 'data.csv')).toBe('alteration');
    expect(detectKind(['HoleID', 'From', 'To', 'Code'], [['H1', '0', '1', 'QZ']], 'alteration.csv')).toBe('alteration');
    expect(detectKind(['HoleID', 'From', 'To', 'Code'], [['H1', '0', '1', 'QZ']], 'data.csv')).toBe('lithology');
    expect(detectKind(['HoleID', 'From', 'To', 'Code', 'Intensity'], [row.slice(0, 5)], 'lithology.csv')).not.toBe('alteration');
    expect(detectKind(['Name', 'Value'], [['x', '1']], 'alteration-notes.csv')).toBe(null);
    expect(detectKind(['HoleID', 'Depth', 'Dip'], [['H1', '5', '-60']], 'alteration.csv')).toBe('surveys');
  });
  it('keeps numeric-looking category and intensity as exact trimmed text, including zero', () => {
    const result = build([['0001', '0', '2', '03', '', ' 03 '], ['0001', '2', '4', '', 'Sericite', '0'], ['0001', '4', '6', 'Qz', '', ''], ['0001', '6', '8', 'Qz', '', '1-2']]);
    expect(result.errorCount).toBe(0);
    expect(result.rows).toEqual([{ hole_id: '0001', from_m: 0, to_m: 2, code: '03', intensity: '03' },
      { hole_id: '0001', from_m: 2, to_m: 4, description: 'Sericite', intensity: '0' },
      { hole_id: '0001', from_m: 4, to_m: 6, code: 'Qz' }, { hole_id: '0001', from_m: 6, to_m: 8, code: 'Qz', intensity: '1-2' }]);
  });
  it('prefers explicit alteration headers over generic columns without guessing code from intensity', () => {
    const h = ['HoleID', 'From', 'To', 'Code', 'Alteration code', 'Description', 'Alteration description', 'Intensity', 'Alteration intensity'];
    expect(autoMapping('alteration', h, []).columns).toMatchObject({ code: 'Alteration code', description: 'Alteration description', intensity: 'Alteration intensity' });
    const result = buildImport('alteration', { header: ['HoleID', 'From', 'To', 'Intensity'], rows: [['H1', '0', '1', '03']] }, autoMapping('alteration', ['HoleID', 'From', 'To', 'Intensity'], []));
    expect(result.errors[0].message).toContain('Code or Description');
  });
  it.each([
    [['', '0', '1', 'Qz', '', 'weak'], /Hole ID is empty/],
    [['H1', '-1', '1', 'Qz', '', 'weak'], /Negative depth/],
    [['H1', '1', '1', 'Qz', '', 'weak'], /greater than From/],
    [['H1', '0', 'NaN', 'Qz', '', 'weak'], /To is empty/],
    [['H1', '0', '1e12', 'Qz', '', 'weak'], /not a number/],
    [['H1', '0', '1', '', '', 'weak'], /No code or description/],
    [['H1', '0', '1', 'Qz', '', 'a'.repeat(61)], /Intensity.*60/],
    [['H1', '0', '1', 'a'.repeat(61), '', 'weak'], /Code.*60/],
    [['H1', '0', '1', '', 'a'.repeat(501), 'weak'], /Description.*500/],
  ])('refuses invalid source rows with their physical line', (row, error) => {
    const result = buildImport('alteration', { header, rows: [row], lines: [7] }, autoMapping('alteration', header, [row]));
    expect(result.errorCount).toBeGreaterThan(0); expect(result.errors).toContainEqual({ line: 7, message: expect.stringMatching(error) });
  });
  it('refuses duplicate interval identities, preserves overlaps and labels true gaps neutrally', () => {
    const result = build([['H1', '0', '10', 'Qz', '', 'weak'], ['H1', '0', '10', 'Ser', '', 'strong'], ['H1', '2', '3', 'Ser', '', 'strong'], ['H1', '5', '6', 'Ser', '', 'strong']]);
    expect(result.errorCount).toBe(1); expect(result.errors[0]).toMatchObject({ line: 3, message: expect.stringContaining('also on line 2') });
    expect(result.rows).toHaveLength(3); expect(result.warnings.map(w => w.kind)).toEqual(['overlapping-intervals']);
    const gaps = build([['H1', '0', '1', 'Qz', '', 'weak'], ['H1', '3', '4', 'Qz', '', 'weak']]);
    expect(gaps.warnings[0].message).toBe('Gaps between logged intervals in 1 hole: H1');
  });
  it('normalizes opted-in decimal depths without changing intensity or identifiers', () => {
    const rows = [['000,1', '0,5', '1,5', '03', '', '1,5']];
    const result = buildImport('alteration', { header, rows }, autoMapping('alteration', header, rows, { decimalComma: true }));
    expect(result.errorCount).toBe(0); expect(result.rows[0]).toMatchObject({ hole_id: '000,1', from_m: 0.5, to_m: 1.5, intensity: '1,5' });
  });
  it('produces identical CSV and real Excel imports and supports saved alteration columns', async () => {
    const row = ['0001', '0', '1', '03', '', '03'];
    const bytes = xlsxFixture([{ name: 'Alteration', rows: [header, row] }]);
    const [sheet] = await readWorkbook({ arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) });
    const xlsx = sheetTable(sheet, 1), csv = await parseCsv(`${header.join(',')}\n${row.join(',')}`);
    const saved = { kind: 'alteration', mapping: autoMapping('alteration', header, [row]) };
    expect(buildImport('alteration', xlsx, applyTemplate(saved, xlsx.header))).toEqual(buildImport('alteration', csv, applyTemplate(saved, csv.header)));
    expect(diffSentence('alteration', { new: 2, changed: 1, unchanged: 0 })).toBe('2 new alteration intervals, 1 changed alteration interval');
  });
  it('explains an old database kind rejection while keeping other RPC arguments unchanged', async () => {
    const sb = { rpc: vi.fn().mockResolvedValueOnce({ error: { code: '22023', message: 'INVALID_KIND: alteration' } }).mockResolvedValue({ data: { ok: true } }) };
    const db = drillDb(sb), args = { propertyId: 'p', kind: 'alteration', rows: build([['H1', '0', '1', 'Qz', '', '03']]).rows };
    await expect(db.dryRun(args)).rejects.toThrow(/Alteration imports are not available.*existing drill imports still work/);
    await db.dryRun({ ...args, kind: 'lithology' });
    expect(sb.rpc.mock.calls[1]).toEqual(['drill_import_batch', expect.objectContaining({ p_kind: 'lithology', p_dry_run: true })]);
    await db.saveTemplate('org', 'alteration', 'Source', { columns: { intensity: 'Intensity' } });
    expect(sb.rpc.mock.calls[2]).toEqual(['drill_save_template', expect.objectContaining({ p_kind: 'alteration', p_mapping: { columns: { intensity: 'Intensity' } } })]);
  });
});
