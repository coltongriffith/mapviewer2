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
  const color = custom?.color || DEFAULT_LEGEND_COLOR;
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

// Applied to the FINAL assembled list, after layer entries, overlay entries and
// nearby-claim entries have all been gathered — so every row the reader sees can
// be renamed or removed, not just the ones that came from a file.
export function applyLegendCustomization(items, layout = {}) {
  const overrides = layout?.legendOverrides || {};
  const kept = (items || [])
    .filter((item) => !overrides[item?.id]?.hidden)
    .map((item) => {
      const label = overrides[item?.id]?.label;
      // An empty or blank override is not a rename to nothing — it means the
      // user cleared the box, and the derived name is the sensible fallback.
      return label && label.trim() ? { ...item, label: label.trim() } : item;
    });
  const custom = (layout?.legendCustomItems || [])
    .filter((entry) => entry && entry.id && !overrides[entry.id]?.hidden)
    .map((entry) => customLegendItem({
      ...entry,
      label: overrides[entry.id]?.label?.trim() || entry.label,
    }));
  return [...kept, ...custom];
}

export function nextCustomLegendId(existing = []) {
  const used = new Set(existing.map((entry) => entry?.id));
  let n = existing.length + 1;
  let id = `custom-${n}`;
  while (used.has(id)) { n += 1; id = `custom-${n}`; }
  return id;
}
