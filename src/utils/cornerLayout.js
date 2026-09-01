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

  // Rebuild from scratch using individual corner keys, one element per row.
  //
  // Ordering within a corner is deliberate: where the logo and the title share
  // one, the logo comes first, so the mark sits directly above the title and
  // the two read as one block against the same margin. Keeping them in
  // separate rows (rather than side by side) is what lets the title, the logo
  // and the legend all hang off a single left rule — the alignment does the
  // work that a box around each of them used to do.
  const result = { tl: [], tr: [], bl: [], br: [] };
  for (const corner of ['tl', 'tr', 'bl', 'br']) {
    const ids = allIds.filter((id) => assignedCorner[id] === corner);
    if (ids.includes('logo') && ids.includes('title')) {
      const rest = ids.filter((id) => id !== 'logo' && id !== 'title');
      result[corner] = [['logo'], ['title'], ...rest.map((id) => [id])];
    } else {
      result[corner] = ids.map((id) => [id]);
    }
  }
  return result;
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

/** Remove an element from wherever it is, returning cleaned rows for its old corner. */
function removeFromCornerLayout(cornerLayout, id) {
  const pos = findElement(cornerLayout, id);
  if (!pos) return cornerLayout;
  const { corner: oldCorner, rowIndex, colIndex } = pos;
  const oldRows = [...cornerLayout[oldCorner]];
  const thisRow = oldRows[rowIndex];
  if (thisRow.length === 1) {
    oldRows.splice(rowIndex, 1);
  } else {
    oldRows[rowIndex] = thisRow.filter((_, i) => i !== colIndex);
  }
  return { ...cornerLayout, [oldCorner]: oldRows };
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
 * Move an element to a new corner, inserting it as the FIRST row (row 0).
 * This places it closest to the corner edge.
 */
export function moveToCornerFirst(cornerLayout, id, newCorner) {
  const cleaned = removeFromCornerLayout(cornerLayout, id);
  const targetRows = [[id], ...(cleaned[newCorner] || [])];
  return { ...cleaned, [newCorner]: targetRows };
}

/**
 * Move an element to a new corner, placing it beside the last element
 * already in that corner (joining its last row). Falls back to a new row
 * if the last row is already full.
 */
export function moveToCornerBeside(cornerLayout, id, newCorner) {
  const cleaned = removeFromCornerLayout(cornerLayout, id);
  const targetRows = [...(cleaned[newCorner] || [])];
  if (targetRows.length === 0) {
    targetRows.push([id]);
  } else {
    const lastRow = targetRows[targetRows.length - 1];
    if (lastRow.length < 2) {
      targetRows[targetRows.length - 1] = [...lastRow, id];
    } else {
      targetRows.push([id]);
    }
  }
  return { ...cleaned, [newCorner]: targetRows };
}
