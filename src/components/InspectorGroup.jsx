import React from 'react';

/**
 * One collapsible group in the Customize step. The header carries a one-line
 * summary of what is inside, so a closed group still says what it holds.
 * The toggle is a real <button> inside the <h2> (keyboard reachable, same
 * contract as every other disclosure in the inspector).
 */
export default function InspectorGroup({ id, title, summary, open, onToggle, groupRef, children }) {
  return (
    <section className={`control-section ins-acc${open ? ' is-open' : ''}`} ref={groupRef}>
      <h2 className="control-section-heading ins-acc-heading">
        <button
          type="button"
          className="section-toggle-btn"
          aria-expanded={open}
          aria-controls={`group-${id}`}
          onClick={onToggle}
        >
          <span className="ins-acc-title">{title}</span>
          {!open && summary != null && <span className="ins-acc-summary">{summary}</span>}
          <span aria-hidden="true" className={`section-chevron${open ? ' open' : ''}`}>›</span>
        </button>
      </h2>
      {open && <div id={`group-${id}`} className="control-grid ins-acc-body">{children}</div>}
    </section>
  );
}
