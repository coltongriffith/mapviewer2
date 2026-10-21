import React from 'react';
import Dialog from './Dialog.jsx';
import { summaryLine, hasErrors } from '../../shared/figureDiagnostics.js';

// The opt-in publication check's result, shown before a download when the
// preflight (export/preflight.js) found something. One summary line and the
// findings in a list that opens on demand. A visual warning can be accepted
// and exported anyway; an error (wrong geometry) has to be fixed, or the check
// turned off for an ordinary export.
const MARK = { error: 'Problem', warning: 'Warning', info: 'Note' };

export default function PublicationCheck({ diagnostics, onExport, onClose }) {
  const blocked = hasErrors(diagnostics);
  return (
    <Dialog onClose={onClose} panelClassName="export-hd-card pubcheck-card" labelledBy="pubcheck-title">
      <button className="export-hd-close" type="button" onClick={onClose} aria-label="Close">✕</button>
      <h3 id="pubcheck-title" className="export-hd-title">Publication check</h3>
      <p className="export-hd-desc pubcheck-summary">{summaryLine(diagnostics)} {blocked ? 'to fix before downloading.' : 'to review before downloading.'}</p>
      <details className="pubcheck-details" open={diagnostics.length <= 3}>
        <summary>Show details</summary>
        <ul className="pubcheck-list">
          {diagnostics.map((d, i) => (
            <li key={`${d.code}-${d.elementId}-${i}`} className={`pubcheck-item is-${d.severity}`}>
              <span className="pubcheck-mark">{MARK[d.severity]}</span>
              <span>{d.message}.{d.action ? <span className="pubcheck-action"> {d.action}.</span> : null}</span>
            </li>
          ))}
        </ul>
      </details>
      <div className="export-hd-actions">
        {blocked
          ? <p className="export-hd-small">Fix the problems to export with the check, or turn the check off for an ordinary export.</p>
          : <button className="btn primary export-hd-btn-primary" type="button" onClick={onExport}>Export anyway</button>}
        <button className="export-hd-skip" type="button" onClick={onClose}>Back to the map</button>
      </div>
    </Dialog>
  );
}
