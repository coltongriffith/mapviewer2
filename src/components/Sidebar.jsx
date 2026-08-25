import React from "react";

/**
 * The five groups every editing control belongs to. The short `label` is what
 * fits across a 312px rail; `name` is the full name used for the accessible
 * name and the tooltip, so nothing is hidden from a screen reader by the
 * abbreviation.
 */
export const INSPECTOR_TABS = [
  { id: 'data', label: 'Data', name: 'Data' },
  { id: 'layers', label: 'Layers', name: 'Layers' },
  { id: 'labels', label: 'Labels', name: 'Labels & annotations' },
  { id: 'layout', label: 'Layout', name: 'Layout' },
  { id: 'export', label: 'Export', name: 'Export' },
];

/**
 * The inspector. One rail on the desktop, a bottom sheet under 900px — the
 * same markup either way, so no control is reachable on one and missing on
 * the other.
 */
export default function Sidebar({ children, footer, tab, onTabChange, open = false, onClose }) {
  return (
    <>
      {open && (
        <button
          type="button"
          className="ed-sheet-scrim"
          aria-label="Close the inspector"
          onClick={onClose}
        />
      )}
      <aside className="inspector" data-open={open ? 'true' : 'false'} aria-label="Map inspector">
        <div className="ins-sheet-head">
          <span className="ins-sheet-grip" aria-hidden="true" />
          <button type="button" className="ui-btn ui-btn--ghost" onClick={onClose}>Done</button>
        </div>
        <div className="ins-tabs" role="tablist" aria-label="Inspector sections">
          {INSPECTOR_TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={`ins-tab-${t.id}`}
              className="ins-tab"
              aria-selected={tab === t.id}
              aria-controls={`ins-panel-${t.id}`}
              aria-label={t.name}
              title={t.name}
              onClick={() => onTabChange(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div
          className="ins-scroll"
          role="tabpanel"
          id={`ins-panel-${tab}`}
          aria-labelledby={`ins-tab-${tab}`}
        >
          {children}
        </div>
        {footer && <div className="ins-footer">{footer}</div>}
      </aside>
    </>
  );
}
