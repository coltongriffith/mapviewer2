import React, { useMemo, useState } from 'react';
import {
  featureKey, featureLabel, layerFeatures, isFeatureHidden,
} from '../utils/featureIdentity.js';

// The list view of "which shapes are on the map".
//
// WHY THIS EXISTS ALONGSIDE CLICKING AND BOX-DRAGGING
//   Selecting on the map is the fast path and it fails in two ordinary cases:
//   a claim too small to hit at the zoom you need to see the whole block, and a
//   user who cannot or does not want to drive a drag with a mouse. Everything
//   else in this codebase pairs a map interaction with a table that does the
//   same job — TenureTable behind TenureMap — and this is that table.
//
//   It is also the only view that can answer "what did I remove?" precisely.
//   The map can only show what is left.
//
// SEARCH IS THE BULK TOOL
//   Removing forty claims one checkbox at a time is no better than clicking
//   forty polygons. Filtering to "SOUTH" and pressing one button is the reason
//   to open this list at all, so the bulk action always acts on exactly what
//   the filter is showing — never on the whole layer behind it.

// Above this many rows the DOM cost starts to show on a mid-range laptop, and a
// list that long is not being read anyway — it is being searched.
const RENDER_CAP = 300;

export default function FeatureTrimList({ layer, onSetHidden }) {
  const [query, setQuery] = useState('');

  const rows = useMemo(() => layerFeatures(layer).map((feature) => ({
    feature,
    key: featureKey(feature),
    label: featureLabel(feature),
    hidden: isFeatureHidden(layer, feature),
  })), [layer]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => r.label.search.includes(q));
  }, [rows, query]);

  const shown = filtered.slice(0, RENDER_CAP);
  const overflow = filtered.length - shown.length;
  const removedHere = filtered.filter((r) => r.hidden);
  const keptHere = filtered.filter((r) => !r.hidden);

  if (!rows.length) return null;

  const bulk = (targets, hidden) => {
    if (!targets.length) return;
    onSetHidden(targets.map((r) => r.feature), hidden);
  };

  const filtering = query.trim().length > 0;

  return (
    <div className="ftl">
      <div className="ftl-search">
        <label className="ftl-sr-only" htmlFor="ftl-q">Filter shapes by name or number</label>
        <input
          id="ftl-q"
          type="search"
          value={query}
          placeholder="Filter by name or claim number"
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      <div className="ftl-bulk">
        {/* Both actions are scoped to the filter, and say so, because a button
            that silently emptied the whole layer when the user believed it
            applied to their search would be unrecoverable-feeling even though
            Restore all exists. */}
        <button
          type="button"
          className="link-btn"
          disabled={!keptHere.length}
          onClick={() => bulk(keptHere, true)}
        >
          Remove {filtering ? `these ${keptHere.length}` : 'all'}
        </button>
        <button
          type="button"
          className="link-btn"
          disabled={!removedHere.length}
          onClick={() => bulk(removedHere, false)}
        >
          Restore {filtering ? `these ${removedHere.length}` : 'all'}
        </button>
      </div>

      {filtered.length === 0 ? (
        <p className="ftl-empty">No shapes match “{query}”.</p>
      ) : (
        <ul className="ftl-list">
          {shown.map((row) => (
            <li key={row.key} className={row.hidden ? 'ftl-row ftl-off' : 'ftl-row'}>
              <label>
                <input
                  type="checkbox"
                  checked={!row.hidden}
                  onChange={() => onSetHidden([row.feature], !row.hidden)}
                />
                <span className="ftl-text">
                  <span className="ftl-title">{row.label.title}</span>
                  {row.label.subtitle && <span className="ftl-sub">{row.label.subtitle}</span>}
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}

      {overflow > 0 && (
        <p className="ftl-more">
          Showing {RENDER_CAP} of {filtered.length}. Filter to reach the rest —
          the buttons above still act on all {filtered.length}.
        </p>
      )}
    </div>
  );
}
