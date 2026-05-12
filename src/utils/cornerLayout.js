/**
 * cornerLayout utility
 *
 * The cornerLayout data model in project.layout is:
 *   { tl: [[id, ...], [id, ...]], tr: [...], bl: [...], br: [...] }
 *
 * Each corner is an array of rows; each row has 1 or 2 element IDs.
 * Rows are stacked top-to-bottom (for top corners) or bottom-to-top (for
 * bottom corners) — i.e. row[0] is the outermost element in that corner.
 *
 * Element IDs used here match the `key` field for each element:
 *   'title', 'logo', 'inset', 'legend', 'scaleBar', 'northArrow'
 */

/** All supported element IDs and their default corners */
export const ELEMENT_DEFS = [
  { id: 'title',      label: 'Title',       defaultCorner: 'tl' },
  { id: 'logo',       label: 'Logo',        defaultCorner: 'tl' },
  { id: 'inset',      label: 'Inset',       defaultCorner: 'tr' },
  { id: 'legend',     label: 'Legend',      defaultCorner: 'bl' },
  { id: 'scaleBar',   label: 'Scale bar',   defaultCorner: 'bl' },
  { id: 'northArrow', label: 'North arrow', defaultCorner: 'br' },
];

/** Map from element ID to the layout key that stores its corner assignment */
export const CORNER_KEY = {
  title:      'titleCorner',
  logo:       'logoCorner',
  inset:      'insetCorner',
  legend:     'legendCorner',
  scaleBar:   'scaleBarCorner',
  northArrow: 'northArrowCorner',
};

/**
 * Build (or return) the cornerLayout structure.
 * If layout.cornerLayout already contains all elements in valid positions,
 * return it unchanged.  Otherwise rebuild it from the individual *Corner keys,
 * preserving any ordering/beside information that was already stored.
 */
export function getCornerLayout(layout) {
  const stored = layout?.cornerLayout;

  // Collect all element IDs that should appear
  const allIds = ELEMENT_DEFS.map((d) => d.id);

  // Derive each element's assigned corner from individual keys
  const assignedCorner = {};
  for (const { id, defaultCorner } of ELEMENT_DEFS) {
    assignedCorner[id] = layout?.[CORNER_KEY[id]] || defaultCorner;
  }

  if (stored) {
    // Validate: every id must appear in the stored layout and be in the right corner
    const storedIds = new Set();
    const storedCorners = { tl: [], tr: [], bl: [], br: [] };
    let valid = true;

    for (const corner of ['tl', 'tr', 'bl', 'br']) {
      const rows = stored[corner] || [];
      for (const row of rows) {
        for (const id of row) {
          if (storedIds.has(id)) { valid = false; break; }
          storedIds.add(id);
          // Check the individual corner key agrees
          if (assignedCorner[id] !== corner) { valid = false; break; }
          if (!storedCorners[corner]) storedCorners[corner] = [];
          storedCorners[corner].push(id);
        }
        if (!valid) break;
        // Rows max size 2
        if (row.length > 2) { valid = false; break; }
      }
      if (!valid) break;
    }

    // All IDs must be present
    if (valid && allIds.every((id) => storedIds.has(id))) {
      return stored;
    }
  }

  // Rebuild from scratch using individual corner keys, grouping each element
  // into a single-element row (no "beside" grouping by default).
  const result = { tl: [], tr: [], bl: [], br: [] };
  for (const corner of ['tl', 'tr', 'bl', 'br']) {
    const ids = allIds.filter((id) => assignedCorner[id] === corner);
    result[corner] = ids.map((id) => [id]);
  }
  return result;
}

/**
 * Return a flat ordered list of element IDs for a given corner,
 * in stacking order (row[0] first).
 */
export function getCornerOrder(cornerLayout, corner) {
  return (cornerLayout[corner] || []).flat();
}

/**
 * Find which corner and row index an element is in.
 * Returns { corner, rowIndex, colIndex } or null.
 */
export function findElement(cornerLayout, id) {
  for (const corner of ['tl', 'tr', 'bl', 'br']) {
    const rows = cornerLayout[corner] || [];
    for (let ri = 0; ri < rows.length; ri++) {
      const ci = rows[ri].indexOf(id);
      if (ci !== -1) return { corner, rowIndex: ri, colIndex: ci };
    }
  }
  return null;
}

/**
 * Move an element's row up (toward row 0) within its corner.
 * If the element is in a 2-element row, the whole row moves.
 * Returns a new cornerLayout (immutable).
 */
export function moveRowUp(cornerLayout, id) {
  const pos = findElement(cornerLayout, id);
  if (!pos || pos.rowIndex === 0) return cornerLayout;
  const { corner, rowIndex } = pos;
  const rows = [...cornerLayout[corner]];
  // Swap row with the one above
  [rows[rowIndex - 1], rows[rowIndex]] = [rows[rowIndex], rows[rowIndex - 1]];
  return { ...cornerLayout, [corner]: rows };
}

/**
 * Move an element's row down within its corner.
 */
export function moveRowDown(cornerLayout, id) {
  const pos = findElement(cornerLayout, id);
  if (!pos) return cornerLayout;
  const { corner, rowIndex } = pos;
  const rows = [...cornerLayout[corner]];
  if (rowIndex >= rows.length - 1) return cornerLayout;
  [rows[rowIndex], rows[rowIndex + 1]] = [rows[rowIndex + 1], rows[rowIndex]];
  return { ...cornerLayout, [corner]: rows };
}

/**
 * Toggle "beside" for an element with the previous element in the same corner.
 * "Previous" = last element of the row directly above this element's row.
 *
 * When toggling ON:  merge [prevRow] and [thisRow] into one 2-element row.
 * When toggling OFF: split a 2-element row back into two 1-element rows.
 *
 * Returns a new cornerLayout.
 */
export function toggleBeside(cornerLayout, id) {
  const pos = findElement(cornerLayout, id);
  if (!pos) return cornerLayout;
  const { corner, rowIndex, colIndex } = pos;
  const rows = cornerLayout[corner];
  const thisRow = rows[rowIndex];

  if (thisRow.length === 2) {
    // Currently beside → split into two rows
    const newRows = [
      ...rows.slice(0, rowIndex),
      [thisRow[0]],
      [thisRow[1]],
      ...rows.slice(rowIndex + 1),
    ];
    return { ...cornerLayout, [corner]: newRows };
  }

  // Currently solo → try to merge with row above
  if (rowIndex === 0) return cornerLayout; // no row above
  const prevRow = rows[rowIndex - 1];
  if (prevRow.length >= 2) return cornerLayout; // prev row already full

  // Merge: put this element at end of prev row, remove this row
  const merged = [...prevRow, id];
  const newRows = [
    ...rows.slice(0, rowIndex - 1),
    merged,
    ...rows.slice(rowIndex + 1),
  ];
  return { ...cornerLayout, [corner]: newRows };
}

/**
 * Move an element to a new corner.
 * Places it as a new single-element row at the end of the target corner.
 * Returns { cornerLayout, layout } where layout contains updated *Corner key.
 */
export function moveToCorner(cornerLayout, id, newCorner) {
  const pos = findElement(cornerLayout, id);
  if (!pos) return cornerLayout;
  const { corner: oldCorner, rowIndex, colIndex } = pos;

  let rows = [...cornerLayout[oldCorner]];
  const thisRow = rows[rowIndex];

  if (thisRow.length === 1) {
    // Solo row — remove it entirely
    rows.splice(rowIndex, 1);
  } else {
    // Beside row — remove just this element, leave the other
    rows[rowIndex] = thisRow.filter((_, i) => i !== colIndex);
  }

  const targetRows = [...(cornerLayout[newCorner] || []), [id]];

  return {
    ...cornerLayout,
    [oldCorner]: rows,
    [newCorner]: targetRows,
  };
}

/**
 * Check whether the "beside" toggle should be enabled for an element.
 * Enabled when:
 *   - The element is currently a solo row (not already in a 2-element row as the first item)
 *     OR the element is already beside (to allow toggling off)
 *   - If the element is solo: the row above exists and has < 2 elements
 */
export function besideEnabled(cornerLayout, id) {
  const pos = findElement(cornerLayout, id);
  if (!pos) return false;
  const { corner, rowIndex } = pos;
  const rows = cornerLayout[corner];
  const thisRow = rows[rowIndex];

  // If already in a 2-element row, beside is "active" (can toggle off)
  if (thisRow.length === 2) return true;

  // Solo: check if row above exists and has space
  if (rowIndex === 0) return false;
  const prevRow = rows[rowIndex - 1];
  return prevRow.length < 2;
}

/**
 * Check whether "beside" is currently active for an element
 * (i.e. it's in a 2-element row).
 */
export function besideActive(cornerLayout, id) {
  const pos = findElement(cornerLayout, id);
  if (!pos) return false;
  return cornerLayout[pos.corner][pos.rowIndex].length === 2;
}
