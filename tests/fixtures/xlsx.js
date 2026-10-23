// Minimal synthetic workbooks for import tests, using the existing ZIP library.
// Strings stay strings; formula results are cached values, never evaluated.
import { zipSync, strToU8 } from 'fflate';
const esc = v => String(v).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const column = i => { let s = ''; for (i++; i; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + (i - 1) % 26) + s; return s; };
export function xlsxFixture(sheets) {
  const ns = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  const rel = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const files = {
    '[Content_Types].xml': `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>`,
    '_rels/.rels': `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${rel}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    'xl/workbook.xml': `<workbook xmlns="${ns}" xmlns:r="${rel}"><sheets>${sheets.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${rel}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="styles" Type="${rel}/styles" Target="styles.xml"/></Relationships>`,
    'xl/styles.xml': `<styleSheet xmlns="${ns}"><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="14" applyNumberFormat="1"/></cellXfs></styleSheet>`,
  };
  sheets.forEach((s, index) => {
    const rows = s.rows.map((row, i) => `<row r="${i + 1}">${row.map((v, j) => {
      if (v == null) return '';
      const r = `${column(j)}${i + 1}`;
      if (v instanceof Date) return `<c r="${r}" s="1"><v>${(v.getTime() - Date.UTC(1899, 11, 30)) / 86400000}</v></c>`;
      if (typeof v === 'object' && 'formula' in v) return `<c r="${r}"><f>${esc(v.formula)}</f>${v.result == null ? '' : `<v>${v.result}</v>`}</c>`;
      if (typeof v === 'number') return `<c r="${r}"><v>${v}</v></c>`;
      return `<c r="${r}" t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
    }).join('')}</row>`).join('');
    files[`xl/worksheets/sheet${index + 1}.xml`] = `<worksheet xmlns="${ns}"><sheetData>${rows}</sheetData>${s.merge ? `<mergeCells><mergeCell ref="${s.merge}"/></mergeCells>` : ''}</worksheet>`;
  });
  return zipSync(Object.fromEntries(Object.entries(files).map(([name, xml]) => [name, strToU8(xml)])));
}
