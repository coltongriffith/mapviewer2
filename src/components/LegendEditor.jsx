import React from 'react';
import { MarkerSvgIcon } from '../utils/markerIcons.jsx';
import {
  LEGEND_SYMBOLS, DEFAULT_LEGEND_SYMBOL, DEFAULT_LEGEND_COLOR,
  customLegendItem, nextCustomLegendId,
} from '../utils/legendCustomization.js';

// Editing the legend without letting it drift from the map.
//
// Derived entries can be renamed and removed but not restyled: their swatch is
// the layer's own styling, and a legend swatch that disagrees with the shape on
// the map is the one failure a legend cannot have. Change the layer's colour
// and the legend follows.
//
// Added entries are for things genuinely on the page but not in the data — a
// mill site marked by hand, a neighbouring operator named for context. They get
// a symbol from the standard set and a colour, and nothing else, because the
// swatch must be drawn identically by the editor, the PNG exporter and the SVG
// exporter.

function SymbolPreview({ symbol, color }) {
  const item = customLegendItem({ symbol, color, label: '' });
  if (item.type === 'line') {
    return <svg width="22" height="14" aria-hidden="true"><line x1="1" y1="7" x2="21" y2="7" stroke={color} strokeWidth="2" /></svg>;
  }
  if (item.type === 'polygon') {
    return <svg width="22" height="14" aria-hidden="true"><rect x="1" y="2" width="20" height="10" fill={color} fillOpacity="0.22" stroke={color} /></svg>;
  }
  // The same component the map markers and the legend itself use, so the
  // preview cannot promise a shape the map does not draw.
  return <MarkerSvgIcon type={item.markerShape} size={14} color={color} fillColor={color} />;
}

export default function LegendEditor({ derivedItems, layout, updateLayout }) {
  const overrides = layout?.legendOverrides || {};
  const customItems = layout?.legendCustomItems || [];

  const setOverride = (id, patch) => {
    const next = { ...overrides, [id]: { ...overrides[id], ...patch } };
    // Drop an override that no longer says anything, so the stored project does
    // not accumulate empty records for every entry the user touched.
    if (!next[id].hidden && !next[id].label) delete next[id];
    updateLayout({ legendOverrides: next });
  };

  const setCustom = (id, patch) => {
    updateLayout({
      legendCustomItems: customItems.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry)),
    });
  };

  const addCustom = () => {
    const id = nextCustomLegendId(customItems);
    updateLayout({
      legendCustomItems: [...customItems, {
        id, label: '', symbol: DEFAULT_LEGEND_SYMBOL, color: DEFAULT_LEGEND_COLOR,
      }],
    });
  };

  const removeCustom = (id) => {
    const nextOverrides = { ...overrides };
    delete nextOverrides[id];
    updateLayout({
      legendCustomItems: customItems.filter((entry) => entry.id !== id),
      legendOverrides: nextOverrides,
    });
  };

  const hiddenCount = derivedItems.filter((item) => overrides[item.id]?.hidden).length;

  return (
    <div className="legend-editor">
      {derivedItems.length === 0 && customItems.length === 0 && (
        <p className="small-note">Legend entries appear here as you add layers to the map.</p>
      )}

      {derivedItems.map((item) => {
        const hidden = !!overrides[item.id]?.hidden;
        return (
          <div className={`legend-editor-row${hidden ? ' is-hidden' : ''}`} key={item.id}>
            <input
              className="legend-editor-label"
              value={overrides[item.id]?.label ?? ''}
              placeholder={item.label}
              aria-label={`Legend label for ${item.label}`}
              disabled={hidden}
              onChange={(e) => setOverride(item.id, { label: e.target.value })}
            />
            <button
              type="button"
              className="legend-editor-btn"
              aria-label={hidden ? `Show ${item.label} in the legend` : `Remove ${item.label} from the legend`}
              title={hidden ? 'Show in legend' : 'Remove from legend'}
              onClick={() => setOverride(item.id, { hidden: !hidden })}
            >
              {hidden ? 'Show' : 'Remove'}
            </button>
          </div>
        );
      })}

      {hiddenCount > 0 && (
        // The layer is still drawn — only its legend row is gone. Saying so
        // prevents "I removed it and it's still on the map" being read as a bug.
        <p className="small-note">
          {hiddenCount} {hiddenCount === 1 ? 'entry is' : 'entries are'} hidden from the legend.
          The layer itself is still drawn — hide the layer to remove it from the map.
        </p>
      )}

      {customItems.map((entry) => (
        <div className="legend-editor-row is-custom" key={entry.id}>
          <SymbolPreview symbol={entry.symbol} color={entry.color} />
          <input
            className="legend-editor-label"
            value={entry.label}
            placeholder="Item name"
            aria-label="Custom legend item name"
            onChange={(e) => setCustom(entry.id, { label: e.target.value })}
          />
          <select
            className="legend-editor-symbol"
            value={entry.symbol}
            aria-label="Symbol"
            onChange={(e) => setCustom(entry.id, { symbol: e.target.value })}
          >
            {LEGEND_SYMBOLS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
          <input
            type="color"
            className="legend-editor-color"
            value={entry.color}
            aria-label="Colour"
            onChange={(e) => setCustom(entry.id, { color: e.target.value })}
          />
          <button
            type="button"
            className="legend-editor-btn"
            aria-label={`Delete ${entry.label || 'custom legend item'}`}
            title="Delete"
            onClick={() => removeCustom(entry.id)}
          >
            Delete
          </button>
        </div>
      ))}

      <button type="button" className="btn-secondary legend-editor-add" onClick={addCustom}>
        + Add legend item
      </button>
      <p className="small-note">
        Added items are labels only — they describe something already on the map, and do not draw anything.
      </p>
    </div>
  );
}
