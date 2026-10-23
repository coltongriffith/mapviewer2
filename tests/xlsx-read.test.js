// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { xlsxFixture } from './fixtures/xlsx.js';
import { readWorkbook, guessHeaderRow, sheetTable, checkWorkbookSize } from '../src/utils/xlsxRead.js';
import { autoMapping, buildImport, parseCsv, parseAssay } from '../src/utils/drillDb.js';
const file = bytes => ({ arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) });

describe('Excel drill import', () => {
  it.each([
    ['collars', ['HoleID', 'Easting', 'Northing', 'Elevation', 'Dip'], ['TEST-01', 400000, 5600000, 1000, -60]],
    ['surveys', ['HoleID', 'Depth', 'Azimuth', 'Dip'], ['TEST-01', 0, 90, -60]],
    ['assays', ['HoleID', 'From', 'To', 'Au_ppm', 'Sample_ID'], ['TEST-01', 0, 1, '<0.005', '000123']],
    ['lithology', ['HoleID', 'From', 'To', 'Code', 'Description'], ['TEST-01', 0, 1, 'QMD', 'Quartz monzodiorite']],
  ])('builds the same %s import as CSV', async (kind, header, row) => {
    const [sheet] = await readWorkbook(file(xlsxFixture([{ name: kind, rows: [header, row] }])));
    const xlsx = sheetTable(sheet, guessHeaderRow(sheet.data));
    const csv = await parseCsv(`${header.join(',')}\n${row.join(',')}\n`);
    const opts = { crs: 'EPSG:26910' };
    const a = buildImport(kind, xlsx, autoMapping(kind, xlsx.header, xlsx.rows, opts));
    const b = buildImport(kind, csv, autoMapping(kind, csv.header, csv.rows, opts));
    expect(a.errorCount).toBe(0); expect(a).toEqual(b);
  });

  it('keeps sheet names, original rows, IDs, dates and cached formulas through title/blank rows', async () => {
    const sheets = await readWorkbook(file(xlsxFixture([
      { name: 'Notes', rows: [['Illustrative workbook']] },
      { name: 'Assays', merge: 'A1:F1', rows: [['Illustrative'], [], ['HoleID', 'From', 'To', 'Au_ppm', 'Sample_ID', 'Date'], ['TEST-01', 0, 1, { formula: '1/2', result: 0.5 }, '000123', new Date('2026-10-22T00:00:00Z')], [], ['TEST-01', 1, 2, { formula: '1/0' }, '000124'], []] },
    ])));
    expect(sheets.map(s => s.sheet)).toEqual(['Notes', 'Assays']);
    expect(guessHeaderRow(sheets[1].data)).toBe(3);
    const t = sheetTable(sheets[1], 3);
    expect(t.lines).toEqual([4, 6]);
    expect(t.rows[0]).toEqual(['TEST-01', '0', '1', '0.5', '000123', '2026-10-22T00:00:00.000Z']);
    expect(t.rows[1][3]).toBe('');
  });

  it('normalizes decimal text only in opted-in numeric fields and retains identifier punctuation', () => {
    const t = { header: ['HoleID', 'From', 'To', 'Au_ppm', 'Sample_ID'], rows: [['001,01', '0,5', '1,5', '<0,005', '000,123']] };
    const mapping = autoMapping('assays', t.header, t.rows, { decimalComma: true });
    const result = buildImport('assays', t, mapping);
    expect(result.errorCount).toBe(0);
    expect(result.rows[0]).toMatchObject({ hole_id: '001,01', sample_id: '000,123', from_m: 0.5, to_m: 1.5, values: { Au: 0.0025 }, bdl: { Au: 0.005 } });
    expect(parseAssay('0,52').error).toBeTruthy(); // unchanged legacy default
    expect(buildImport('assays', t, autoMapping('assays', t.header, t.rows)).errorCount).toBeGreaterThan(0);
  });

  it.each([
    [[['HoleID', '', 'To'], ['H1', 0, 1]], 1, /no name/],
    [[['HoleID', 'holeid'], ['H1', 'H2']], 1, /unique/],
    [[['HoleID', 'From'], ['H1', 0, 1]], 1, /Row 2.*beyond/],
    [[['Header'], []], 1, /no data rows/],
    [[['Header'], ['data']], 0, /within this sheet/],
  ])('refuses an invalid header without dropping values', (data, row, message) => {
    expect(() => sheetTable({ data }, row)).toThrow(message);
  });

  it('supports overriding the detected header and caps nonempty data rows', () => {
    const data = [['HoleID', 'From'], ['Cover', 'text'], ['HoleID', 'From', 'To'], ['H1', 0, 1, null], []];
    expect(guessHeaderRow(data)).toBe(1);
    expect(sheetTable({ data }, 3)).toEqual({ header: ['HoleID', 'From', 'To'], rows: [['H1', '0', '1']], lines: [4] });
    expect(() => sheetTable({ data: [['HoleID'], ...Array.from({ length: 20001 }, () => ['H1'])] }, 1)).toThrow(/20,000/);
  });

  it('rejects legacy XLS, invalid archives and expanded-size overflow before parsing', () => {
    expect(() => checkWorkbookSize(new Uint8Array([0xd0, 0xcf]).buffer)).toThrow(/older .xls/);
    expect(() => checkWorkbookSize(new Uint8Array([1, 2, 3]).buffer)).toThrow(/could not be read/);
    const bytes = xlsxFixture([{ name: 'Sheet', rows: [['A']] }]);
    const view = new DataView(bytes.buffer);
    for (let i = 0; i < bytes.length - 46; i++) if (view.getUint32(i, true) === 0x02014b50) { view.setUint32(i + 24, 65 * 1024 * 1024, true); break; }
    expect(() => checkWorkbookSize(bytes.buffer)).toThrow(/64 MB/);
  });
});
