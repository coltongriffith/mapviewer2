const fontScale = (layout) => Math.max(0.7, Math.min(1.4, Number(layout?.stripFontScale) || 1));
export const technicalStripHeight = (layout) => layout?.technicalReportVersion === 1
  ? Math.ceil(112 * fontScale(layout)) : 72;

// A conservative, deterministic wrap shared by DOM/SVG/canvas, including long
// unbroken supplied identifiers. It needs no browser/font-loading side effects.
function wrap(value, capacity) {
  const text = String(value || '').trim();
  if (!text) return [];
  const lines = [];
  let line = '';
  for (const word of text.split(/\s+/u)) {
    if (line && line.length + 1 + word.length > capacity) { lines.push(line); line = ''; }
    let rest = word;
    while (rest.length > capacity) {
      if (line) { lines.push(line); line = ''; }
      lines.push(rest.slice(0, capacity)); rest = rest.slice(capacity);
    }
    line = line ? `${line} ${rest}` : rest;
  }
  if (line) lines.push(line);
  return lines;
}

/** Presentation-only line plan. Extreme text stays saved in full; the final
 * visible line is marked with an ellipsis rather than bleeding into a neighbour.
 */
export function technicalStripPlan(layout, fields, width) {
  const fs = fontScale(layout), height = technicalStripHeight(layout);
  const titleFont = `${layout.fonts?.title || 'Arial'}, sans-serif`;
  const mono = "'Courier New', Courier, monospace";
  const missing = fields.missing || {};
  const cellFields = [
    [['TITLE', 8, true], [fields.title, 14, true, false, titleFont], [fields.subtitle, 9, false, false, titleFont]],
    [['SCALE', 7, true], [fields.scale, 10, false, missing.scale], ['PROJECTION', 7, true], [fields.projection, 8]],
    [['QUALIFIED PERSON', 7, true], [fields.qpName, 10, false, missing.qpName], [fields.qpCredentials, 8], [fields.companyName, 7]],
    [['FIGURE', 7, true], [fields.figureNumber, 12, true, missing.figureNumber], [fields.figureRevision, 8, false, missing.figureRevision], [fields.date, 7, false, missing.date]],
  ];
  const edges = [0, .45, .65, .85, 1].map((f) => width * f);
  const cells = cellFields.map((entries, index) => {
    const x = edges[index], cellWidth = edges[index + 1] - x;
    let lines = entries.flatMap(([text, size, bold, italic, family = mono]) => {
      const fontSize = size * fs;
      const capacity = Math.max(1, Math.floor((cellWidth - 16) / fontSize));
      return wrap(text, capacity).map((part) => ({ text: part, fontSize, bold: !!bold, italic: !!italic, family }));
    });
    const lineHeight = (line) => line.fontSize * 1.2 + 1;
    // Keep the user-selected font scale. A very long field cannot consume the
    // next cell or the map; normal report metadata fits without truncation.
    let used = 0;
    const count = lines.findIndex((line) => { used += lineHeight(line); return used > height - 16; });
    const truncated = count !== -1;
    if (truncated) {
      lines = lines.slice(0, Math.max(1, count));
      const last = lines[lines.length - 1];
      last.text = `${last.text.slice(0, -1)}…`;
    }
    const contentHeight = lines.reduce((sum, line) => sum + lineHeight(line), 0);
    let y = Math.max(8, (height - contentHeight) / 2);
    lines = lines.map((line) => {
      const next = { ...line, x: x + 8, y: y + line.fontSize * .9 };
      y += lineHeight(line); return next;
    });
    return { x, width: cellWidth, lines, truncated };
  });
  return { width, height, cells, dividers: edges.slice(1, -1) };
}
