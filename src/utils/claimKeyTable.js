import { advances } from './geoStyle.js';

/** Shared canvas/SVG table primitives. No clipped/truncated identifiers: an
 * undersized table fails the complete key rather than printing partial rows.
 */
export function claimKeyTable(rows, field, box, { omitted = 0, hidden = 0, family = 'Inter' } = {}) {
  const empty = (reason) => ({ ok: false, reason, primitives: [] });
  if (!Array.isArray(rows) || rows.length > 200 || typeof field !== 'string' || field.length > 256
    || !box || !['left', 'top', 'width', 'height'].every((key) => Number.isFinite(box[key]))
    || box.width < 180 || box.height < 100) return empty('key-box-too-small');
  if (![omitted, hidden].every((n) => Number.isInteger(n) && n >= 0 && n <= 5000)) return empty('invalid-key-count');
  const fontSize = 11, lineHeight = 15, padding = 12, referenceWidth = 42;
  const primitives = [{ t: 'poly', pts: [[box.left, box.top], [box.left + box.width, box.top],
    [box.left + box.width, box.top + box.height], [box.left, box.top + box.height]], fill: '#ffffff', opacity: .96 }];
  const text = (value, x, y, size = fontSize, weight = 400) => {
    const chars = Array.from(value), widths = advances(chars, size, weight, family);
    let next = x;
    primitives.push({ t: 'glyphs', role: 'claim-key', family, size, weight, fill: '#172b3a', opacity: 1,
      glyphs: chars.map((ch, i) => { const glyph = { ch, x: next, y, rot: 0 }; next += widths[i]; return glyph; }) });
  };
  const wrap = (value, width) => {
    const chars = Array.from(value), widths = advances(chars, fontSize, 400, family);
    const lines = []; let line = '', used = 0;
    for (let i = 0; i < chars.length; i++) {
      if (widths[i] > width) return null;
      if (used + widths[i] > width) { lines.push(line); line = ''; used = 0; }
      line += chars[i]; used += widths[i];
    }
    if (line) lines.push(line);
    return lines.length ? lines : [''];
  };
  const fullWidth = box.width - padding * 2;
  const fieldLines = wrap(`Source: ${field}`, fullWidth);
  if (!fieldLines) return empty('key-text-too-wide');
  let y = box.top + padding + 13;
  text('Claim key', box.left + padding, y, 13, 700); y += 19;
  for (const line of fieldLines) { text(line, box.left + padding, y); y += lineHeight; }
  y += 4;
  text('Ref', box.left + padding, y, 11, 700);
  text('Supplied identifier', box.left + padding + referenceWidth, y, 11, 700); y += 18;
  for (const row of rows) {
    if (!row || typeof row.label !== 'string' || row.label.length > 256 || typeof row.reference !== 'string' || !/^K\d{1,3}$/.test(row.reference)) return empty('invalid-key-row');
    const lines = wrap(row.label, fullWidth - referenceWidth);
    if (!lines) return empty('key-text-too-wide');
    text(row.reference, box.left + padding, y, 11, 700);
    for (const line of lines) { text(line, box.left + padding + referenceWidth, y); y += lineHeight; }
    y += 3;
  }
  const notice = [`${rows.length} located`, ...(omitted ? [`${omitted} not located in this view`] : []), ...(hidden ? [`${hidden} hidden`] : [])].join(' · ');
  const noticeLines = wrap(notice, fullWidth);
  if (!noticeLines) return empty('key-text-too-wide');
  y += 4;
  for (const line of noticeLines) { text(line, box.left + padding, y); y += lineHeight; }
  const requiredHeight = y - lineHeight - box.top + padding;
  if (requiredHeight > box.height) return { ...empty('key-table-overflow'), requiredHeight };
  return { ok: true, reason: null, primitives, notice, requiredHeight };
}
