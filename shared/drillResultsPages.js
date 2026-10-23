// Page geometry in points. Canvas exports use two pixels per point (144 dpi).
export const RESULTS_PAGE = { width: 792, height: 612, margin: 36, fontSize: 10, lineHeight: 14, maxPages: 100 };
export class ResultsPageError extends Error {}
const fail = (why) => { throw new ResultsPageError(`${why} Download HTML or Excel instead.`); };

// Keep every character, even in unbroken IDs; measure with the same font used to draw.
export function wrapResultsText(value, width, measure, size = 10, bold = false) {
  const text = String(value ?? '');
  if (text.length > 32768) fail('A results cell is too long for page export.');
  return text.split('\n').flatMap((paragraph) => {
    let chars = Array.from(paragraph), lines = [];
    while (chars.length) {
      let lo = 1, hi = chars.length, fit = 0;
      while (lo <= hi) {
        const n = Math.floor((lo + hi) / 2);
        if (measure(chars.slice(0, n).join(''), size, bold) <= width) { fit = n; lo = n + 1; } else hi = n - 1;
      }
      if (!fit) fail('A character cannot fit on the results page.');
      if (fit < chars.length) {
        const space = chars.slice(0, fit).lastIndexOf(' ');
        if (space > 0) fit = space + 1;
      }
      lines.push(chars.slice(0, fit).join('')); chars = chars.slice(fit);
    }
    return lines.length ? lines : [''];
  });
}

// Pure layout: all numbers/wording are supplied by the canonical publication snapshot.
// Wide tables use column groups, repeating the hole/depth/type and interval wording.
export function layoutResultsPages(snapshot, measure) {
  const { width, height, margin, lineHeight, maxPages } = RESULTS_PAGE;
  const usable = width - 2 * margin, bottom = height - margin - 16;
  if (snapshot.header.length > 70 || snapshot.rows.length > 10000) fail('This table is too large for page export.');
  const wrap = (text, w = usable, size = 10, bold = false) => wrapResultsText(text, w, measure, size, bold);
  const title = wrap(snapshot.title, usable, 16, true), provenance = wrap(snapshot.provenance);
  const headingHeight = title.length * 20 + provenance.length * lineHeight + 16;
  if (headingHeight > 140) fail('The property or recipe name is too long for page export.');
  const pages = []; let page, y;
  const addPage = () => {
    if (pages.length >= maxPages) fail(`This table exceeds ${maxPages} pages.`);
    page = { blocks: [] }; pages.push(page); y = margin;
    page.blocks.push({ kind: 'text', x: margin, y, lines: title, size: 16, lineHeight: 20, bold: true }); y += title.length * 20 + 6;
    page.blocks.push({ kind: 'text', x: margin, y, lines: provenance, size: 10, lineHeight }); y += provenance.length * lineHeight + 10;
  };
  const textBlock = (text, { bold = false, color } = {}) => {
    const lines = wrap(text, usable, 10, bold);
    for (let offset = 0; offset < lines.length;) {
      if (y + lineHeight > bottom) addPage();
      const count = Math.min(lines.length - offset, Math.floor((bottom - y) / lineHeight));
      page.blocks.push({ kind: 'text', x: margin, y, lines: lines.slice(offset, offset + count), size: 10, lineHeight, bold, color });
      y += count * lineHeight; offset += count;
    }
    y += 8;
  };
  addPage();
  for (const text of snapshot.limitations) textBlock(`Data limitation: ${text}`, { color: '#92400e' });
  const gradeIndices = snapshot.header.slice(5, -1).map((_, i) => i + 5);
  const groups = [];
  for (let i = 0; i < gradeIndices.length; i += 4) groups.push(gradeIndices.slice(i, i + 4));
  if (!groups.length) groups.push([]);
  groups.forEach((grades, groupIndex) => {
    const indices = [0, 1, 2, 3, 4, ...grades, snapshot.header.length - 1];
    const widths = [92, 42, 48, 48, 52, ...grades.map(() => 58), usable - 282 - grades.length * 58];
    const cellLines = (row, bold) => indices.map((index, i) => wrap(row[index], widths[i] - 12, 10, bold));
    const headerLines = cellLines(snapshot.header, true);
    const headerHeight = Math.max(...headerLines.map(x => x.length)) * lineHeight + 12;
    const label = groups.length > 1 ? `Calculated intervals - column group ${groupIndex + 1} of ${groups.length}` : 'Calculated drill intervals';
    const tableHeader = () => {
      textBlock(label, { bold: true });
      page.blocks.push({ kind: 'row', x: margin, y, widths, cells: headerLines, header: true, height: headerHeight }); y += headerHeight;
    };
    // A header and at least one line of data must fit below the repeating page title.
    if (headingHeight + headerHeight + 58 > bottom - margin) fail('A column heading is too long for page export.');
    if (groupIndex > 0 || y + headerHeight + 58 > bottom) addPage();
    tableHeader();
    snapshot.rows.forEach((row, rowIndex) => {
      const cells = cellLines(row, false);
      const rowHeight = Math.max(...cells.map(x => x.length)) * lineHeight + 12;
      // Never truncate or split a single result across pages.
      if (rowHeight > bottom - margin - headingHeight - headerHeight - 30) fail('A result row is too tall for page export.');
      if (y + rowHeight > bottom) { addPage(); tableHeader(); }
      page.blocks.push({ kind: 'row', x: margin, y, widths, cells, height: rowHeight, rowIndex, indices, shaded: rowIndex % 2 === 1 }); y += rowHeight;
    });
    y += 16;
  });
  if (y + 56 > bottom) addPage();
  textBlock('Recipe notes', { bold: true });
  for (const text of snapshot.footnotes) textBlock(text);
  return pages;
}
