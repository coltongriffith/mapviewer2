import React, { useEffect, useState } from 'react';
import {
  portfolioChangeFeed, listAlerts, portfolioAuditLog, acknowledgeAlert,
} from '../../utils/tenureMonitor';
import { formatSyncTimestamp, formatGovernmentDate } from '../../utils/tenureDates';
import { decisionLabel } from '../../utils/tenureCsv';
import { changeLabel } from './TenureTable';
import { VerificationNotice } from './TenureNotices';

// What happened, and who did what about it.
//
// Three timelines, because they answer three different questions and mixing
// them into one feed makes all three harder to read:
//
//   Detected changes  what the PROVINCE did to these titles
//   Reminders         what WE sent, and whether anyone acknowledged it
//   Activity          what the TEAM decided, and when
//
// The third is the one that turns this from a calendar into a record. When
// somebody asks in eighteen months why a claim was allowed to lapse, the audit
// trail is the answer — so it is written by a database trigger rather than by
// the screen that happens to make the edit, and it cannot be edited from here.

const ALERT_STATUS_LABELS = {
  pending: 'Scheduled',
  sending: 'Sending',
  sent: 'Sent',
  failed: 'Delivery failed',
  superseded: 'Cancelled — the good-to-date changed',
  suppressed: 'Held — government data was incomplete',
  cancelled: 'Cancelled — monitoring stopped',
};

const AUDIT_LABELS = {
  portfolio_created: 'Portfolio created',
  tenures_added: 'Claims added',
  tenure_removed: 'Claim removed',
  decision_changed: 'Maintenance decision changed',
  assignee_changed: 'Responsible person changed',
  note_updated: 'Internal note updated',
  monitoring_toggled: 'Reminders switched',
  acknowledged: 'Reminder acknowledged',
  alerts_paused: 'Reminders paused by an administrator',
  alerts_resumed: 'Reminders resumed by an administrator',
};

function Section({ title, hint, children }) {
  return (
    <section className="tm-activity-section">
      <h3>{title}</h3>
      {hint && <p className="tm-field-hint">{hint}</p>}
      {children}
    </section>
  );
}

export default function PortfolioActivity({ portfolioId, onSelectTenure, rows = [] }) {
  const [changes, setChanges] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [audit, setAudit] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    // Independent requests: one failing must not blank the other two.
    const [c, a, l] = await Promise.allSettled([
      portfolioChangeFeed(portfolioId, { days: 365 }),
      listAlerts(portfolioId),
      portfolioAuditLog(portfolioId),
    ]);
    if (c.status === 'fulfilled') setChanges(c.value);
    if (a.status === 'fulfilled') setAlerts(a.value);
    if (l.status === 'fulfilled') setAudit(l.value);
    const failed = [
      c.status === 'rejected' && 'detected changes',
      a.status === 'rejected' && 'reminders',
      l.status === 'rejected' && 'activity',
    ].filter(Boolean);
    setError(failed.length ? `Could not load ${failed.join(' and ')}.` : null);
    setLoading(false);
  }, [portfolioId]);

  useEffect(() => { load(); }, [load]);

  const rowByTenure = new Map(rows.map((r) => [r.tenure.id, r]));

  // Changes the importer itself judged critical — a title terminated, a status
  // gone terminal, an owner added or removed, a good-to-date pulled EARLIER, a
  // title absent from two consecutive clean runs. The severity is assigned in
  // changeDetect.mjs against the government values, so this reads the
  // importer's judgement rather than inventing a second, divergent one here.
  const materialChanges = changes.filter((c) => c.severity === 'critical');

  async function acknowledge(alert) {
    setBusyId(alert.id);
    try {
      await acknowledgeAlert(alert.id);
      await load();
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setBusyId(null);
    }
  }

  if (loading) return <p className="tm-muted">Loading activity…</p>;

  return (
    <div className="tm-activity">
      {error && <p className="tm-error" role="alert">{error}</p>}

      <Section
        title="Detected changes"
        hint="Differences Exploration Maps found between the latest B.C. tenure dataset and
              what it held before. Confirm anything material in MTO — the government record
              is the one that governs."
      >
        {/* The material ones, lifted out of the timeline.
            A termination and a boundary tweak are both "a change", and a feed
            sorted only by date buries the first under the second. These are the
            events that decide whether somebody acts this week.
            The caution is not decoration: a title leaving the dataset, or
            showing a termination date, is what our copy of the registry says.
            It is not a determination that ground is open, and this product must
            never be the reason somebody staked over live title. */}
        {materialChanges.length > 0 && (
          <div className="tm-material-changes">
            <p className="tm-material-head">
              <strong>{materialChanges.length}</strong>
              {materialChanges.length === 1 ? ' change needs' : ' changes need'} a look
            </p>
            <ul className="tm-material-list">
              {materialChanges.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    className="tm-link-btn"
                    onClick={() => onSelectTenure?.(rowByTenure.get(c.tenure_id))}
                    disabled={!rowByTenure.has(c.tenure_id)}
                  >
                    {c.tenure_number}
                  </button>
                  {c.tenure_name ? ` — ${c.tenure_name}` : ''}
                  {': '}
                  <strong>{changeLabel(c)}</strong>
                  <span className="tm-muted">{` · ${String(c.detected_at).slice(0, 10)}`}</span>
                </li>
              ))}
            </ul>
            <p className="tm-field-hint">
              A status change, a termination date, or a title dropping out of the dataset is
              what the published government data shows — it is not confirmation that the
              ground is available. Check the tenure in MTO before acting on it.
            </p>
          </div>
        )}

        {changes.length === 0 ? (
          <p className="tm-muted">
            No changes detected on these claims. Change detection began when each claim was
            first imported.
          </p>
        ) : (
          <ul className="tm-timeline">
            {changes.map((c) => (
              <li key={c.id} className={`tm-timeline-item tm-change--${c.severity}`}>
                <span className="tm-timeline-date">{String(c.detected_at).slice(0, 10)}</span>
                <span className="tm-timeline-body">
                  <button
                    type="button"
                    className="tm-link-btn"
                    onClick={() => onSelectTenure?.(rowByTenure.get(c.tenure_id))}
                    disabled={!rowByTenure.has(c.tenure_id)}
                  >
                    {c.tenure_number}
                  </button>
                  {c.tenure_name ? ` — ${c.tenure_name}` : ''}
                  <strong className="tm-timeline-what">{changeLabel(c)}</strong>
                  {(c.previous_value || c.current_value) && (
                    <span className="tm-timeline-values">
                      {c.previous_value || '—'} → {c.current_value || '—'}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section
        title="Reminders"
        hint="Scheduled and sent reminders for these claims. Acknowledging one records that
              somebody has seen it — it does not change anything with the province."
      >
        {alerts.length === 0 ? (
          <p className="tm-muted">
            No reminders scheduled yet. They are computed nightly from each claim's
            good-to-date.
          </p>
        ) : (
          <div className="tm-table-wrap">
            <table className="tm-table">
              <caption className="tm-sr-only">Scheduled and sent reminders</caption>
              <thead>
                <tr>
                  <th scope="col">Date</th>
                  <th scope="col">Claim</th>
                  <th scope="col">Reminder</th>
                  <th scope="col">Status</th>
                  <th scope="col">Acknowledged</th>
                </tr>
              </thead>
              <tbody>
                {alerts.map((a) => (
                  <tr key={a.id}>
                    <td>{a.scheduled_for}</td>
                    <th scope="row">
                      {a.tenures?.tenure_number}
                      {a.tenures?.tenure_name ? ` — ${a.tenures.tenure_name}` : ''}
                    </th>
                    <td>
                      {a.alert_type === 'EXPIRY'
                        ? `${a.offset_days} days before ${formatGovernmentDate(a.source_good_to_date)}`
                        : a.alert_type === 'NOT_OBSERVED'
                          ? 'Not in the latest dataset'
                          : 'Change detected'}
                    </td>
                    <td>
                      {ALERT_STATUS_LABELS[a.status] || a.status}
                      {a.sent_at && (
                        <span className="tm-muted"> · {formatSyncTimestamp(a.sent_at)}</span>
                      )}
                    </td>
                    <td>
                      {a.acknowledged_at ? (
                        <span className="tm-muted">{String(a.acknowledged_at).slice(0, 10)}</span>
                      ) : a.status === 'sent' ? (
                        <button
                          type="button"
                          className="tm-link-btn"
                          disabled={busyId === a.id}
                          onClick={() => acknowledge(a)}
                        >
                          {busyId === a.id ? 'Saving…' : 'Acknowledge'}
                        </button>
                      ) : <span className="tm-muted">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section
        title="Activity"
        hint="Every decision, note and acknowledgement on this portfolio, with who made it
              and when. Written automatically and not editable — this is the record for
              anyone who later asks why a claim was handled the way it was."
      >
        {audit.length === 0 ? (
          <p className="tm-muted">No activity recorded yet.</p>
        ) : (
          <ul className="tm-timeline">
            {audit.map((a) => (
              <li key={a.id} className="tm-timeline-item">
                <span className="tm-timeline-date">{String(a.created_at).slice(0, 10)}</span>
                <span className="tm-timeline-body">
                  <strong className="tm-timeline-what">{AUDIT_LABELS[a.action] || a.action}</strong>
                  {a.previous_value && a.new_value && (
                    <span className="tm-timeline-values">
                      {labelValue(a.action, a.previous_value)} → {labelValue(a.action, a.new_value)}
                    </span>
                  )}
                  {!a.previous_value && a.new_value && (
                    <span className="tm-timeline-values">{labelValue(a.action, a.new_value)}</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <VerificationNotice compact />
    </div>
  );
}

/** Render enum values through their human labels; leave free text alone. */
function labelValue(action, value) {
  if (action === 'decision_changed') return decisionLabel(value);
  if (action === 'monitoring_toggled') return value === 'true' ? 'on' : 'off';
  return value;
}
