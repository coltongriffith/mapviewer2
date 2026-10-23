// Loaded only after choosing an XLSX. Keep the drill importer's string-table
// contract, including worksheet row numbers; do not evaluate Excel formulas.
import readExcelFile from 'read-excel-file/browser';
import { unzipSync } from 'fflate';
import { FIELDS, MAX_FILE_BYTES, MAX_ROWS } from './drillDb.js';
import { matchCols } from '../three-d/roles.js';

const MAX_EXPANDED_BYTES = 64 * 1024 * 1024;
const text = (v) => v == null ? '' : v instanceof Date ? v.toISOString() : String(v);
const nonempty = (v) => text(v).trim() !== '';
const norm = (s) => text(s).toLowerCase().replace(/[\s\-.()/#]+/g, '_').replace(/^_+|_+$/g, '');

// Inspect ZIP entry sizes without inflating them. The file-size limit alone
// does not bound the memory needed by a highly compressed worksheet.
export function checkWorkbookSize(buffer) {
  const bytes = new Uint8Array(buffer);
  if (bytes.length > MAX_FILE_BYTES) throw new Error('That file is larger than 30 MB. Split it and import each part.');
  if (bytes[0] === 0xd0 && bytes[1] === 0xcf) throw new Error('This is an older .xls file. Save it as .xlsx or CSV in Excel, then try again.');
  let expanded = 0, entries = 0;
  try {
    unzipSync(bytes, { filter: (entry) => {
      expanded += entry.originalSize; entries++;
      if (!Number.isSafeInteger(expanded) || expanded > MAX_EXPANDED_BYTES || entries > 10000) throw new Error('Workbook too large');
      return false;
    } });
  } catch (e) {
    if (e.message === 'Workbook too large') throw new Error('The workbook expands beyond the import limit (64 MB or 10,000 entries). Copy the needed sheet into a smaller workbook.');
    throw new Error('That file could not be read as an Excel workbook. Save it as .xlsx or CSV and try again.');
  }
}

export async function readWorkbook(file) {
  const buffer = await file.arrayBuffer();
  checkWorkbookSize(buffer);
  let timer;
  try {
    const sheets = await Promise.race([
      readExcelFile(buffer, { trim: false, parseNumber: (value) => value }),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Reading the workbook took too long. Copy the needed sheet into a smaller workbook and try again.')), 30000); }),
    ]);
    if (!sheets.length) throw new Error('The workbook has no sheets.');
    return sheets;
  } finally { clearTimeout(timer); }
}

export function guessHeaderRow(data) {
  const extra = Object.values(FIELDS).flat().filter(f => f.re);
  const index = data.findIndex(row => {
    const cells = new Set(Object.values(matchCols(row.map(text))));
    row.forEach((v, i) => { if (extra.some(f => f.re.test(norm(v)))) cells.add(i); });
    return cells.size >= 2;
  });
  return index < 0 ? 1 : index + 1;
}

export function sheetTable(sheet, headerRow) {
  const data = sheet.data;
  if (!Number.isInteger(headerRow) || headerRow < 1 || headerRow > data.length) throw new Error('Choose a header row within this sheet.');
  const rawHeader = data[headerRow - 1];
  let width = rawHeader.length;
  while (width && !nonempty(rawHeader[width - 1])) width--;
  const header = rawHeader.slice(0, width).map(v => text(v).trim());
  if (!header.length) throw new Error('That row is empty. Choose the row containing column names.');
  if (header.some(h => !h)) throw new Error('Some columns have no name. Choose another header row or give each column a name in Excel.');
  if (new Set(header.map(h => h.toLowerCase())).size !== header.length) throw new Error('Column names must be unique. Rename duplicate headers in Excel or choose another row.');
  const rows = [], lines = [];
  for (let i = headerRow; i < data.length; i++) {
    const row = data[i];
    if (!row.some(nonempty)) continue;
    if (row.slice(width).some(nonempty)) throw new Error(`Row ${i + 1} has data beyond the named columns. Choose the correct header row or name those columns in Excel.`);
    rows.push(Array.from({ length: width }, (_, j) => text(row[j]))); lines.push(i + 1);
    if (rows.length > MAX_ROWS) throw new Error('This sheet has more than 20,000 data rows. Split it and import each part.');
  }
  if (!rows.length) throw new Error('There are no data rows below this header.');
  return { header, rows, lines };
}
