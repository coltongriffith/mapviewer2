import { safeColor } from './colorUtils.js';

// Editing the legend.
//
// Legend entries are DERIVED from the layers on the map — that is what keeps
// them honest, and why an entry cannot simply be a row in a list the user
// types. Delete a layer and its entry must go; trim every shape out of a layer
// and its entry must go too. A hand-maintained legend drifts from the map, and
// a legend that disagrees with the map is worse than no legend on a document
// someone raises money against.
//
// So editing is a layer of OVERRIDES on top of the derivation, keyed by entry
// id, rather than a replacement for it:
//
//   layout.legendOverrides   { [id]: { label, hidden } }   rename and remove
//   layout.legendCustomItems [ { id, label, symbol, color } ]   additions
//
// An override for an entry that no longer exists is inert, so removing a layer
// and adding it back does not resurrect a stale name silently — but nor does it
// lose one, which matters when a claim block is re-imported.
//
// Custom entries are the exception that proves the rule: they describe things
// that are genuinely on the map but not in the data — a mill site marked by
// hand, an access route drawn as an annotation, a neighbouring operator named
// for context. They carry a fixed symbol from the set below rather than free
// styling, because the swatch has to be drawn identically by three separate
// renderers (editor, PNG, SVG) and an arbitrary style would be honoured by
// some and dropped by others.

// The standard set. Every one of these is already drawn by all three
// renderers — utils/markerIcons.jsx for the editor, drawCanvasMarkerShape for
// PNG, svgMarkerShape for SVG — so a new entry cannot render in one and vanish
// in another. Adding a symbol here means adding it to all three first.
export const LEGEND_SYMBOLS = [
  { value: 'circle', label: 'Circle', type: 'points' },
  { value: 'square', label: 'Square', type: 'points' },
  { value: 'triangle', label: 'Triangle', type: 'points' },
  { value: 'triangle_down', label: 'Triangle (down)', type: 'points' },
  { value: 'diamond', label: 'Diamond', type: 'points' },
  { value: 'hexagon', label: 'Hexagon', type: 'points' },
  { value: 'star', label: 'Star', type: 'points' },
  { value: 'cross', label: 'Cross', type: 'points' },
  { value: 'pin', label: 'Pin', type: 'points' },
  { value: 'drillhole', label: 'Drillhole', type: 'points' },
  { value: 'line', label: 'Line', type: 'line' },
  { value: 'area', label: 'Filled area', type: 'polygon' },
];

export const DEFAULT_LEGEND_SYMBOL = 'circle';
export const DEFAULT_LEGEND_COLOR = '#2563eb';

const SYMBOL_BY_VALUE = new Map(LEGEND_SYMBOLS.map((s) => [s.value, s]));

export function isLegendSymbol(value) {
  return SYMBOL_BY_VALUE.has(value);
}

// A custom entry, expressed in the same shape the derived entries use, so every
// renderer treats it as an ordinary row and none of them needs a special case.
export function customLegendItem(custom) {
  const symbol = SYMBOL_BY_VALUE.get(custom?.symbol) || SYMBOL_BY_VALUE.get(DEFAULT_LEGEND_SYMBOL);
  // Sanitised at the boundary as well as at every renderer. A shared map is
  // replayed from a stored payload whose author is not necessarily its reader,
  // and the share RPC validates only size and top-level shape — so this value
  // is untrusted input by the time it gets here.
  const color = safeColor(custom?.color, DEFAULT_LEGEND_COLOR);
  const base = {
    id: custom?.id,
    role: 'other',
    group: custom?.group || 'Map Data',
    label: custom?.label || 'New item',
    custom: true,
  };
  if (symbol.type === 'line') {
    return { ...base, type: 'line', style: { stroke: color, strokeWidth: 2, fill: color, fillOpacity: 0 } };
  }
  if (symbol.type === 'polygon') {
    return { ...base, type: 'polygon', style: { fill: color, fillOpacity: 0.22, stroke: color, strokeWidth: 1 } };
  }
  return {
    ...base,
    type: 'points',
    markerShape: symbol.value,
    // Both keys: the legend swatch reads markerFill for the interior and
    // markerColor for the outline, and a single colour has to supply both.
    style: { markerShape: symbol.value, markerColor: color, markerFill: color },
  };
}

export const DEFAULT_LEGEND_GROUP = 'Map Data';

// Applied to the FINAL assembled list, after layer entries, overlay entries and
// nearby-claim entries have all been gathered — so every row the reader sees can
// be renamed, regrouped, reordered or removed, not just the ones that came from
// a file.
//
//   layout.legendOverrides[id].group   the heading an entry sits under
//   layout.legendOrder                 entry ids in display order
//   layout.legendGrouped               whether headings are drawn at all
/** Every id an entry answers to: its own first, then the ones it used to have. */
export function legendEntryIds(item) {
  if (!item) return [];
  return [item.id, ...(Array.isArray(item.legacyIds) ? item.legacyIds : [])].filter((id) => id != null);
}

// An entry's override, by its id or by an id it used to have. Class rows
// changed id format twice (a lossy slug, then field and mode encoded); a
// project saved before either still keeps the label, hidden state and
// heading it was given. The editor reads through this too.
export function overrideFor(overrides, item) {
  if (!overrides) return undefined;
  for (const id of legendEntryIds(item)) {
    if (overrides[id]) return overrides[id];
  }
  return undefined;
}

export function applyLegendCustomization(items, layout = {}) {
  const overrides = layout?.legendOverrides || {};
  const regroup = (item) => {
    const group = overrideFor(overrides, item)?.group;
    return group && group.trim() ? { ...item, group: group.trim() } : item;
  };
  const kept = (items || [])
    .filter((item) => !overrideFor(overrides, item)?.hidden)
    .map((item) => {
      const label = overrideFor(overrides, item)?.label;
      // An empty or blank override is not a rename to nothing — it means the
      // user cleared the box, and the derived name is the sensible fallback.
      return regroup(label && label.trim() ? { ...item, label: label.trim() } : item);
    });
  const custom = (layout?.legendCustomItems || [])
    .filter((entry) => entry && entry.id && !overrides[entry.id]?.hidden)
    .map((entry) => regroup(customLegendItem({
      ...entry,
      label: overrides[entry.id]?.label?.trim() || entry.label,
    })));
  return orderLegendItems([...kept, ...custom], layout?.legendOrder);
}

// A stored order is a list of ids. Entries it names come first, in that
// order; anything it does not know about (a layer added since) keeps its
// derived position after them, so a new layer never vanishes into a stale
// order and an order never has to be rebuilt by hand.
export function orderLegendItems(items, order) {
  if (!Array.isArray(order) || !order.length) return items;
  const rank = new Map(order.map((id, i) => [id, i]));
  const rankOf = (item) => { for (const id of legendEntryIds(item)) { if (rank.has(id)) return rank.get(id); } return undefined; };
  return items
    .map((item, i) => ({ item, i, r: rankOf(item) ?? order.length + i }))
    .sort((a, b) => a.r - b.r)
    .map(({ item }) => item);
}

// The full display order with one entry moved a step: what the editor stores
// as legendOrder after an up/down click. Works from the ids as currently
// shown, so the first move on an unordered legend keeps everything else put.
export function moveLegendItem(orderedIds, id, direction) {
  const ids = [...orderedIds];
  const i = ids.indexOf(id);
  const j = direction === 'up' ? i - 1 : i + 1;
  if (i < 0 || j < 0 || j >= ids.length) return ids;
  [ids[i], ids[j]] = [ids[j], ids[i]];
  return ids;
}

// Rows under headings, in first-appearance order — or one unheaded group when
// headings are off, which is the default: every map saved before this existed
// keeps its exact legend. Every renderer (editor, shared page, PNG, SVG) walks
// this, so a heading cannot show on screen and be missing from the file.
export function groupLegendItems(items, layout = {}) {
  const list = items || [];
  if (!layout?.legendGrouped) return [{ heading: null, items: list }];
  const groups = new Map();
  for (const item of list) {
    const heading = (item?.group && String(item.group).trim()) || DEFAULT_LEGEND_GROUP;
    if (!groups.has(heading)) groups.set(heading, []);
    groups.get(heading).push(item);
  }
  return [...groups.entries()].map(([heading, rows]) => ({ heading, items: rows }));
}

// How many rows the legend panel needs: one per entry, plus one per heading
// when headings are on. The templates size the panel from this, so a grouped
// legend does not clip its last entry.
export function legendRowCount(items, layout = {}) {
  const groups = groupLegendItems(items, layout);
  const headings = groups.filter((g) => g.heading).length;
  return (items || []).length + headings;
}

export function nextCustomLegendId(existing = []) {
  const used = new Set(existing.map((entry) => entry?.id));
  let n = existing.length + 1;
  let id = `custom-${n}`;
  while (used.has(id)) { n += 1; id = `custom-${n}`; }
  return id;
}

// Default legend panel width: wide enough for the longest entry label so it is
// not cut off at the panel edge (it used to be a fixed 300 px), capped at 480.
// A width the user dragged (legendWidthPx) wins — except 300, which every new
// project stores as its default and so says nothing about intent. Label start (46 px) and
// the 13 px label font match the exporters' legend row (renderScene LEGEND_ROW).
export function legendAutoWidth(items = [], layout = {}) {
  const lfs = Number(layout?.legendFontScale) || 1;
  const longest = items.reduce((m, it) => Math.max(m, String(it?.label || '').length), 0);
  return Math.max(300, Math.min(480, Math.round(46 + longest * 13 * lfs * 0.56 + 20)));
}

export function legendWidthFor(layout = {}, items = []) {
  const w = Number(layout?.legendWidthPx);
  if (Number.isFinite(w) && w !== 300) return Math.max(180, Math.min(480, w));
  return legendAutoWidth(items, layout);
}

// A near-white outline vanishes on a white legend panel; the editor legend and
// both exporters give such swatches a thin dark edge.
export function isNearWhite(color) {
  const v = String(color || '').trim();
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(v);
  if (!m) return /^white$/i.test(v);
  const h = m[1].length === 3 ? m[1].split('').map((c) => c + c).join('') : m[1];
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 225;
}
export const LIGHT_SWATCH_EDGE = 'rgba(15,23,42,0.55)';

// Rename a legend heading for every entry under it (derived layers and added
// items alike), as the legend currently shows them. Returns the new
// legendOverrides, or null when nothing changes. Shared by the legend on the
// map (click a heading) and the legend editor panel.
export function renameLegendHeading(derivedItems, layout = {}, from, to) {
  const name = String(to || '').trim();
  if (!name || name === from) return null;
  const overrides = layout?.legendOverrides || {};
  const shown = applyLegendCustomization(derivedItems, layout);
  const headingOf = (item) => (item?.group && String(item.group).trim()) || DEFAULT_LEGEND_GROUP;
  const shownById = new Map(shown.map((it) => [it.id, it]));
  const next = { ...overrides };
  for (const d of derivedItems || []) {
    const it = shownById.get(d.id);
    if (it && headingOf(it) === from) {
      next[d.id] = { ...(overrideFor(overrides, d) || {}), group: name };
      for (const old of (d.legacyIds || [])) if (old !== d.id) delete next[old];
    }
  }
  for (const entry of layout?.legendCustomItems || []) {
    const it = shownById.get(entry.id);
    if (it && headingOf(it) === from) next[entry.id] = { ...(overrides[entry.id] || {}), group: name };
  }
  return next;
}

// The height the legend's entries actually occupy, walked the way the
// exporters lay rows out (renderScene legendRowLayout: 40 px to the first row,
// 24 px per entry and 20 px per heading, ×0.75 for the compact legend) plus a
// 12 px bottom margin. A dragged legend height is never allowed below this,
// so no entry is clipped in an export.
export function legendContentHeight(items, layout = {}) {
  const density = layout?.legendCompact ? 0.75 : 1;
  let h = 0;
  for (const group of groupLegendItems(items, layout)) {
    if (group.heading) h += 20 * density;
    h += group.items.length * 24 * density;
  }
  return items && items.length ? Math.ceil(40 + h + 12) : 0;
}
