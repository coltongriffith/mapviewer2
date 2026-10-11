import React from "react";

/**
 * The five steps every editing control belongs to, in the order a map is
 * made: get data, pick a look, tweak it, label it, export it. The short
 * `label` is what fits across a 312px rail and is also the accessible name;
 * the step number is decoration for sighted users.
 */
export const INSPECTOR_TABS = [
  { id: 'data', label: 'Data', name: 'Add your data' },
  { id: 'style', label: 'Style', name: 'Pick a style, frame and basemap' },
  { id: 'customize', label: 'Customize', name: 'Title, colors, fonts, legend and map elements' },
  { id: 'annotate', label: 'Annotate', name: 'Callouts, labels and drawing tools' },
  { id: 'export', label: 'Export', name: 'Download your map' },
];

const CHECK = (
  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M5 12l5 5 9-10" />
  </svg>
);

/**
 * The inspector. One rail on the desktop, a bottom sheet under 900px — the
 * same markup either way, so no control is reachable on one and missing on
 * the other.
 *
 * `done` maps a step id to true once that step is complete, `next` is the
 * button that moves to the following step ({ label, onClick }).
 */
export default function Sidebar({ children, footer, tab, onTabChange, done = {}, next = null, open = false, onClose }) {
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
        <div className="ins-tabs ins-steps" role="tablist" aria-label="Map steps">
          {INSPECTOR_TABS.map((t, i) => {
            const isDone = Boolean(done[t.id]) && tab !== t.id;
            return (
              <button
                key={t.id}
                type="button"
                role="tab"
                id={`ins-tab-${t.id}`}
                className={`ins-tab ins-step${isDone ? ' is-done' : ''}`}
                aria-selected={tab === t.id}
                aria-controls={`ins-panel-${t.id}`}
                aria-label={t.label}
                title={`Step ${i + 1}: ${t.name}${isDone ? ' (done)' : ''}`}
                onClick={() => onTabChange(t.id)}
              >
                <span className="ins-step-dot" aria-hidden="true">{isDone ? CHECK : i + 1}</span>
                <span className="ins-step-label">{t.label}</span>
              </button>
            );
          })}
        </div>
        <div
          className="ins-scroll"
          role="tabpanel"
          id={`ins-panel-${tab}`}
          aria-labelledby={`ins-tab-${tab}`}
        >
          {children}
        </div>
        {(next || footer) && (
          <div className="ins-footer">
            {next && (
              <div className="ins-next">
                <button type="button" className="ui-btn ui-btn--primary ui-btn--block ins-next-btn" onClick={next.onClick}>
                  {next.label}
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M5 12h14M13 6l6 6-6 6" />
                  </svg>
                </button>
              </div>
            )}
            {footer}
          </div>
        )}
      </aside>
    </>
  );
}
