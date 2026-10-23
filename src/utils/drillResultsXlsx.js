import writeExcelFile from 'write-excel-file/universal';
import { resultsTableSnapshot } from '../../shared/drillResultsTable.js';

// Only loaded after Download Excel. Keep the canonical display strings as text:
// this preserves rounding/leading zeros and never turns a hole ID into a formula.
const cell = (value, style = {}) => {
  const text = String(value ?? '');
  if (text.length > 32767) throw new Error('A results cell is too long for Excel. Download HTML instead.');
  return { value: text, type: String, verticalAlign: 'top', ...style };
};

export async function resultsTableXlsx(out, recipe, options) {
  const { title, provenance, header, rows, limitations, footnotes } = resultsTableSnapshot(out, recipe, options);
  const wide = (text, style = {}) => [cell(text, { columnSpan: header.length, wrap: true, height: 32, ...style }), ...header.slice(1).map(() => null)];
  const data = [
    wide(title, { fontWeight: 'bold', fontSize: 16 }),
    wide(provenance),
    ...limitations.map((text) => wide(`Data limitation: ${text}`, { textColor: '#92400E', height: 48 })),
    header.map((text) => cell(text, { fontWeight: 'bold', backgroundColor: '#E2E8F0', wrap: true, height: 30 })),
    ...rows.map((row) => row.map((text, i) => cell(text, { wrap: true, height: 45, ...(i === 0 ? { fontWeight: 'bold' } : {}) }))),
    [], wide('Recipe notes', { fontWeight: 'bold' }),
    ...footnotes.map((text) => wide(text, { height: Math.max(32, Math.ceil(text.length / 120) * 16) })),
  ];
  return writeExcelFile(data, {
    sheet: 'Drill results', stickyRowsCount: 3 + limitations.length, stickyColumnsCount: 1,
    orientation: 'landscape', columns: header.map((_, i) => ({ width: i === 0 ? 22 : i === header.length - 1 ? 80 : 16 })),
  }, { fontFamily: 'Calibri', fontSize: 11 }).toBlob();
}
