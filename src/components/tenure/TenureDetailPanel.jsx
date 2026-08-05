import React, { useEffect, useRef, useState } from 'react';
import {
  daysRemaining, urgencyBand, formatDaysRemaining, formatGovernmentDate,
  formatSyncTimestamp,
} from '../../utils/tenureDates';
import { MAINTENANCE_DECISIONS } from '../../utils/tenureCsv';
import { TENURE_NOT_OBSERVED_NOTICE } from '../../utils/tenureDisclaimer';
import { VerifyInMtoLink, SourceValue, VerificationNotice } from './TenureNotices';
import { changeLabel } from './TenureTable';

// One claim, in full.
//
// Ordered by what the user needs first: what is this, when is it due, what did
// we decide, what changed. The full government record sits in a collapsed
// section — showing thirty fields by default buries the four that matter, and
// the four that matter are the ones a deadline decision turns on.

function Field({ label, children }) {
  return (
    <div className="tm-field">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

export default function TenureDetailPanel({
  row,
  now = new Date(),
  changes = [],
  saving,
  onClose,
  onSave,
  onRemove,
  onOpenInEditor,
}) {
  const panelRef = useRef(null);
  const closeRef = useRef(null);
  const [draft, setDraft] = useState(null);
  const [showRaw, setShowRaw] = useState(false);

  // Reset the working copy whenever a different claim is opened, so an
  // unsaved note cannot leak onto the next claim the user clicks.
  useEffect(() => {
    if (!row) { setDraft(null); return; }
    setDraft({
      internalProjectName: row.internalProjectName || '',
      internalNotes: row.internalNotes || '',
      maintenanceDecision: row.maintenanceDecision || 'UNDECIDED',
      decisionDueDate: row.decisionDueDate || '',
      maintenanceReference: row.maintenanceReference || '',
      monitoringEnabled: row.monitoringEnabled !== false,
    });
    setShowRaw(false);
  }, [row?.membershipId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Move focus into the panel when it opens, and close on Escape — the same
  // behaviour the editor's modals already have.
  useEffect(() => {
    if (!row) return undefined;
    closeRef.current?.focus();
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    const node = panelRef.current;
    node?.addEventListener('keydown', onKey);
    return () => node?.removeEventListener('keydown', onKey);
  }, [row, onClose]);

  if (!row || !draft) return null;

  const t = row.tenure;
  const days = daysRemaining(t.good_to_date, now);
  const band = urgencyBand(days, t.status);
  const notObserved = (t.missing_run_count || 0) >= 2;
  const dirty = draft.internalProjectName !== (row.internalProjectName || '')
    || draft.internalNotes !== (row.internalNotes || '')
    || draft.maintenanceDecision !== (row.maintenanceDecision || 'UNDECIDED')
    || draft.decisionDueDate !== (row.decisionDueDate || '')
    || draft.maintenanceReference !== (row.maintenanceReference || '')
    || draft.monitoringEnabled !== (row.monitoringEnabled !== false);

  const set = (k) => (e) => setDraft((d) => ({
    ...d,
    [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value,
  }));

  return (
    <aside
      ref={panelRef}
      className="tm-panel"
      role="dialog"
      aria-modal="false"
      aria-label={`Tenure ${t.tenure_number} details`}
    >
      <header className="tm-panel-head">
        <div>
          <h2 className="tm-panel-title">{t.tenure_name || 'Unnamed claim'}</h2>
          <p className="tm-panel-sub">Tenure {t.tenure_number}</p>
        </div>
        <button ref={closeRef} type="button" className="tm-panel-close" onClick={onClose} aria-label="Close details">✕</button>
      </header>

      {/* Deadline first. */}
      <div className={`tm-deadline tm-deadline--${band.id}`}>
        <span className="tm-deadline-icon" aria-hidden="true">{band.icon}</span>
        <div>
          <strong>{formatDaysRemaining(days)}</strong>
          <span className="tm-deadline-band">{band.label}</span>
          <span className="tm-deadline-date">
            Good-to-date: {formatGovernmentDate(t.good_to_date)}
          </span>
        </div>
      </div>

      <p className="tm-help">
        The <strong>good-to-date</strong> is the date by which the claim must be maintained
        — assessment work recorded, or cash paid in lieu — to stay in good standing.
        Exploration Maps calculates days remaining in Pacific time from the date the
        province publishes. It does not file or pay anything on your behalf.
      </p>

      {notObserved && (
        <p className="tm-panel-warning" role="status">
          <span aria-hidden="true">⚠</span> {TENURE_NOT_OBSERVED_NOTICE}
        </p>
      )}

      <dl className="tm-fields">
        <Field label="Status"><SourceValue value={t.status} /></Field>
        <Field label="Registered owner">
          {row.owners?.length ? (
            <ul className="tm-owner-list">
              {row.owners.map((o) => (
                <li key={o.owner_name}>
                  {o.owner_name}
                  {o.ownership_percentage != null && ` — ${o.ownership_percentage}%`}
                </li>
              ))}
            </ul>
          ) : <SourceValue value={null} />}
        </Field>
        {row.owners?.some((o) => o.ownership_representation === 'single_field') && (
          <Field label="About ownership">
            <span className="tm-muted">
              The B.C. layer publishes owners as one combined field, so ownership
              percentages and the exact number of registered owners are not available here.
              Confirm the full ownership record in MTO.
            </span>
          </Field>
        )}
        <Field label="Type">
          <SourceValue value={[t.tenure_type, t.tenure_subtype].filter(Boolean).join(' — ') || null} />
        </Field>
        <Field label="Area">
          {t.area_hectares == null
            ? <SourceValue value={null} />
            : `${Number(t.area_hectares).toLocaleString(undefined, { maximumFractionDigits: 1 })} ha`}
        </Field>
        <Field label="Issue date">{formatGovernmentDate(t.issue_date)}</Field>
        {t.termination_date && (
          <Field label="Termination date">{formatGovernmentDate(t.termination_date)}</Field>
        )}
        <Field label="Last synchronized">
          {t.last_synced_at ? formatSyncTimestamp(t.last_synced_at) : 'never'}
        </Field>
      </dl>

      {/* What we intend to do about it. */}
      <section className="tm-panel-section">
        <h3>Your record</h3>

        <label className="tm-label" htmlFor="tm-decision">Maintenance decision</label>
        <select
          id="tm-decision"
          className="tm-select"
          value={draft.maintenanceDecision}
          onChange={set('maintenanceDecision')}
        >
          {MAINTENANCE_DECISIONS.map((d) => (
            <option key={d.value} value={d.value}>{d.label}</option>
          ))}
        </select>

        <label className="tm-label" htmlFor="tm-project">Internal project</label>
        <input
          id="tm-project"
          className="tm-input"
          value={draft.internalProjectName}
          onChange={set('internalProjectName')}
          placeholder="e.g. Crystal Lake"
        />

        <label className="tm-label" htmlFor="tm-due">Decision due by</label>
        <input
          id="tm-due"
          className="tm-input"
          type="date"
          value={draft.decisionDueDate}
          onChange={set('decisionDueDate')}
        />

        <label className="tm-label" htmlFor="tm-notes">Internal notes</label>
        <textarea
          id="tm-notes"
          className="tm-textarea"
          rows={3}
          value={draft.internalNotes}
          onChange={set('internalNotes')}
          placeholder="Private to your account."
        />

        <label className="tm-label" htmlFor="tm-ref">Reference note</label>
        <input
          id="tm-ref"
          className="tm-input"
          value={draft.maintenanceReference}
          onChange={set('maintenanceReference')}
          placeholder="e.g. MTO event number after you file"
        />
        {/* Said plainly, next to the field, not buried in a policy page. */}
        <p className="tm-field-hint">
          For your own reference after you complete a filing in MTO. Never store MTO
          passwords or any other credential here — Exploration Maps does not connect to
          your MTO account and never will.
        </p>

        <label className="tm-checkbox">
          <input
            type="checkbox"
            checked={draft.monitoringEnabled}
            onChange={set('monitoringEnabled')}
          />
          <span>
            Send reminders for this claim
            <span className="tm-field-hint">
              Turning this off cancels its scheduled reminders but keeps it in the portfolio.
            </span>
          </span>
        </label>

        <div className="tm-panel-actions">
          <button
            type="button"
            className="btn primary"
            disabled={!dirty || saving}
            onClick={() => onSave?.(draft)}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </section>

      {/* What changed. */}
      <section className="tm-panel-section">
        <h3>Detected changes</h3>
        {changes.length === 0 ? (
          <p className="tm-muted">
            No changes detected since Exploration Maps started watching this title.
          </p>
        ) : (
          <ul className="tm-change-list">
            {changes.map((c) => (
              <li key={c.id} className={`tm-change-item tm-change--${c.severity}`}>
                <strong>{changeLabel(c)}</strong>
                <span className="tm-change-when">{String(c.detected_at).slice(0, 10)}</span>
                {(c.previous_value || c.current_value) && (
                  <span className="tm-change-values">
                    {c.previous_value || '—'} → {c.current_value || '—'}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Everything the province sent, for anyone who wants it. */}
      <section className="tm-panel-section">
        <button
          type="button"
          className="section-toggle-btn tm-raw-toggle"
          aria-expanded={showRaw}
          aria-controls="tm-raw-panel"
          onClick={() => setShowRaw((v) => !v)}
        >
          <span>Full government record</span>
          <span aria-hidden="true">{showRaw ? '−' : '+'}</span>
        </button>
        <div id="tm-raw-panel" hidden={!showRaw}>
          <dl className="tm-fields tm-fields--dense">
            <Field label="Jurisdiction">British Columbia</Field>
            <Field label="Map unit"><SourceValue value={t.map_unit} /></Field>
            <Field label="Source record updated">
              {t.source_updated_at ? formatSyncTimestamp(t.source_updated_at) : <SourceValue value={null} />}
            </Field>
            <Field label="Added to this portfolio">{String(row.addedAt).slice(0, 10)}</Field>
          </dl>
        </div>
      </section>

      <footer className="tm-panel-foot">
        <VerifyInMtoLink tenureNumber={t.tenure_number} className="btn" />
        {onOpenInEditor && (
          <button type="button" className="btn" onClick={() => onOpenInEditor(row)}>
            Open in Exploration Maps
          </button>
        )}
        {onRemove && (
          <button type="button" className="secondary-btn" onClick={() => onRemove(row)}>
            Stop monitoring
          </button>
        )}
      </footer>

      <VerificationNotice compact />
    </aside>
  );
}
