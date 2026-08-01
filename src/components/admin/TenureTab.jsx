import React, { useState } from 'react';
import { supabase } from '../../lib/supabase';
import { StatTile, InfoTip, EmptyHint } from './primitives';
import { fmtNum, relTime } from './metrics';

const Card = ({ title, tip, eyebrow, count, children, full }) => (
  <section className={`adm-card${full ? ' adm-card-full' : ''}`}>
    <div className="adm-card-head">
      <div>
        {eyebrow && <div className="admx-eyebrow">{eyebrow}</div>}
        <h3 className="adm-card-title">{title}{tip && <InfoTip text={tip} label={title} />}</h3>
      </div>
      {count != null && <span className="adm-pill">{count}</span>}
    </div>
    {children}
  </section>
);

// Tenure Monitor operations.
//
// The question this tab has to answer at a glance is "is the government data
// pipeline healthy, and did anybody's reminder fail?" — because both failures
// are silent from a customer's point of view until a deadline is missed.
//
// It leads with the last SUCCESSFUL sync rather than the last attempted one.
// A run history full of red with a green line at the top would be reassuring
// and wrong; what matters is how long ago the stored data was last known good.

const RUN_STATUS_COLOR = {
  succeeded: '#16a34a',
  running: '#0891b2',
  aborted: '#d97706',   // stopped on purpose, data intact
  failed: '#dc2626',
};

function RunStatus({ status, alertsSafe }) {
  const color = RUN_STATUS_COLOR[status] || '#64748b';
  return (
    <span className="admx-badge" style={{ color, background: `${color}1a` }}>
      {status}
      {status === 'succeeded' && !alertsSafe ? ' (change alerts held)' : ''}
    </span>
  );
}

export default function TenureTab({ data, loading, onReload }) {
  const [busy, setBusy] = useState(null);
  const [message, setMessage] = useState(null);

  if (loading) {
    return <Card title="Tenure Monitor"><div className="adm-skeleton adm-skeleton-block" style={{ height: 160 }} /></Card>;
  }

  const last = data?.last_successful_sync;
  const runs = data?.recent_runs || [];
  const alerts = data?.alerts || {};
  const portfolios = data?.portfolios || [];
  const changes = data?.recent_changes || [];
  const bounced = data?.bounced_recipients || [];
  const notices = data?.active_notices || [];

  const syncAgeHours = last?.completed_at
    ? (Date.now() - new Date(last.completed_at).getTime()) / 3_600_000
    : null;
  const syncStale = syncAgeHours == null || syncAgeHours > 48;

  // Every override below is recorded in tenure_audit_log by the RPC itself,
  // so an action taken here is attributable even though it happens outside the
  // customer's own workflow.
  async function act(kind, fn) {
    setBusy(kind);
    setMessage(null);
    try {
      await fn();
      setMessage({ tone: 'ok', text: 'Done. Recorded in the audit log.' });
      onReload?.();
    } catch (e) {
      setMessage({ tone: 'err', text: String(e?.message || e) });
    } finally {
      setBusy(null);
    }
  }

  const pauseAll = (paused) => act(paused ? 'pause' : 'resume', async () => {
    const reason = paused
      ? window.prompt('Why are reminders being paused? (recorded in the audit log)', 'Government data incident')
      : null;
    if (paused && reason === null) throw new Error('Cancelled.');
    const { error } = await supabase.rpc('admin_set_tenure_alert_pause', {
      p_portfolio_id: null, p_paused: paused, p_reason: reason,
    });
    if (error) throw error;
  });

  const postNotice = () => act('notice', async () => {
    const msg = window.prompt(
      'Banner text shown to every Tenure Monitor user (leave empty to clear the current notice):',
      'B.C. tenure data is currently delayed. Verify time-sensitive claims in MTO.',
    );
    if (msg === null) throw new Error('Cancelled.');
    const { error } = await supabase.rpc('admin_set_tenure_notice', {
      p_message: msg || 'cleared', p_severity: 'warning', p_active: Boolean(msg.trim()),
    });
    if (error) throw error;
  });

  return (
    <>
      <div className="admx-tile-row">
        <StatTile
          label="Last successful sync"
          accent={syncStale ? '#dc2626' : '#16a34a'}
          value={last?.completed_at ? relTime(last.completed_at) : 'never'}
          detail={last
            ? `${fmtNum(last.records_processed)} records · ${fmtNum(last.records_rejected)} rejected`
            : 'no successful government import yet'}
          tip="The age of the data customers are looking at. A failed run does not replace
               stored records, so this is what actually matters — not the last attempt."
        />
        <StatTile label="Tenures held" accent="#2563eb" value={fmtNum(data?.tenure_count)}
          detail={`${fmtNum(data?.owner_count)} owner records`} />
        <StatTile
          label="Not in latest dataset"
          accent={data?.not_observed_count ? '#d97706' : '#64748b'}
          value={fmtNum(data?.not_observed_count)}
          detail="absent from 2+ successful imports"
          tip="Not evidence of a lapse — these are titles worth investigating in MTO." />
        <StatTile label="Reminders due now" accent="#0891b2" value={fmtNum(alerts.due_now)}
          detail={`${fmtNum(alerts.pending)} scheduled · ${fmtNum(alerts.sent_7d)} sent in 7d`} />
        <StatTile
          label="Failed reminders"
          accent={alerts.failed ? '#dc2626' : '#64748b'}
          value={fmtNum(alerts.failed)}
          detail={`${fmtNum(alerts.suppressed)} held pending a clean import`} />
      </div>

      {message && (
        <div className={message.tone === 'ok' ? 'adm-flash' : 'adm-error-bar'} role="status">
          {message.text}
        </div>
      )}

      <Card
        title="Controls"
        tip="Every action here is recorded in tenure_audit_log with the administrator's id."
      >
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="adm-btn" type="button" disabled={busy === 'pause'} onClick={() => pauseAll(true)}>
            Pause all reminders
          </button>
          <button className="adm-btn" type="button" disabled={busy === 'resume'} onClick={() => pauseAll(false)}>
            Resume all reminders
          </button>
          <button className="adm-btn" type="button" disabled={busy === 'notice'} onClick={postNotice}>
            {notices.length ? 'Update / clear incident banner' : 'Post an incident banner'}
          </button>
        </div>
        <p className="adm-card-note">
          Triggering a synchronization is a workflow dispatch, not a database action: run
          <code> Tenure Monitor — B.C. tenure sync </code> from the repository&apos;s Actions
          tab, or <code>node scripts/tenure-sync/run.mjs</code> locally with the service-role
          key. Use <code>--discover</code> first if the government schema is suspected to
          have changed.
        </p>
        {notices.length > 0 && (
          <p className="adm-card-note">
            Active banner: <strong>{notices[0].message}</strong>
          </p>
        )}
      </Card>

      <Card title="Recent import runs" count={runs.length} full
        tip="An aborted run wrote nothing — stored tenure records are unchanged and the
             guardrail report explains why it stopped.">
        {runs.length === 0 ? <EmptyHint>No import runs recorded yet.</EmptyHint> : (
          <div className="adm-table-wrap">
            <table className="adm-table">
              <thead>
                <tr>
                  <th scope="col">Started</th>
                  <th scope="col">Mode</th>
                  <th scope="col">Status</th>
                  <th scope="col">Received</th>
                  <th scope="col">Processed</th>
                  <th scope="col">Rejected</th>
                  <th scope="col">Changes</th>
                  <th scope="col">Schema</th>
                  <th scope="col">Notes</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.id}>
                    <td>{relTime(r.started_at)}</td>
                    <td>{r.mode}</td>
                    <td><RunStatus status={r.status} alertsSafe={r.alerts_safe} /></td>
                    <td>{fmtNum(r.records_received)}</td>
                    <td>{fmtNum(r.records_processed)}</td>
                    <td style={{ color: r.records_rejected > 0 ? '#d97706' : undefined }}>
                      {fmtNum(r.records_rejected)}
                    </td>
                    <td>{fmtNum(r.material_changes_detected)}</td>
                    <td><code style={{ fontSize: 11 }}>{r.schema_fingerprint || '—'}</code></td>
                    <td style={{ maxWidth: 340 }}>{r.error_summary || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="Recent tenure changes" count={changes.length} full
        tip="Material changes detected across the whole mirror, not just monitored claims.">
        {changes.length === 0 ? <EmptyHint>No changes detected yet.</EmptyHint> : (
          <div className="adm-table-wrap">
            <table className="adm-table">
              <thead>
                <tr>
                  <th scope="col">Detected</th>
                  <th scope="col">Tenure</th>
                  <th scope="col">Change</th>
                  <th scope="col">From → to</th>
                  <th scope="col">Severity</th>
                </tr>
              </thead>
              <tbody>
                {changes.map((c, i) => (
                  <tr key={`${c.tenure_number}-${c.detected_at}-${i}`}>
                    <td>{relTime(c.detected_at)}</td>
                    <td>{c.tenure_number}</td>
                    <td>{c.event_type}</td>
                    <td>{c.previous_value || '—'} → {c.current_value || '—'}</td>
                    <td>{c.severity}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="Portfolios" count={portfolios.length} full
        tip="Who is monitoring what, and who is close to their plan limit.">
        {portfolios.length === 0 ? <EmptyHint>No portfolios created yet.</EmptyHint> : (
          <div className="adm-table-wrap">
            <table className="adm-table">
              <thead>
                <tr>
                  <th scope="col">Portfolio</th>
                  <th scope="col">Plan</th>
                  <th scope="col">Monitored</th>
                  <th scope="col">Reminders</th>
                  <th scope="col">Created</th>
                </tr>
              </thead>
              <tbody>
                {portfolios.map((p) => {
                  const limit = p.plan === 'pro' ? 50 : 10;
                  const nearLimit = p.monitored >= limit * 0.8;
                  return (
                    <tr key={p.portfolio_id}>
                      <td>{p.name}</td>
                      <td>{p.plan}</td>
                      <td style={{ color: nearLimit ? '#d97706' : undefined }}>
                        {p.monitored} / {limit}
                        {nearLimit && ' — near limit'}
                      </td>
                      <td>{p.alerts_paused ? 'paused' : 'active'}</td>
                      <td>{relTime(p.created_at)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {(alerts.failed > 0 || bounced.length > 0) && (
        <Card title="Delivery problems" full
          tip="A failed reminder is invisible to the customer until they miss a deadline.">
          {bounced.length > 0 && (
            <>
              <p className="adm-card-note">
                <strong>Bounced addresses</strong> — these stop receiving reminders until the
                bounce flag is cleared.
              </p>
              <ul className="adm-list">
                {bounced.map((b) => (
                  <li key={b.email}>{b.email} — {b.reason || 'no reason recorded'} ({relTime(b.bounced_at)})</li>
                ))}
              </ul>
            </>
          )}
          {alerts.failed > 0 && (
            <p className="adm-card-note">
              {fmtNum(alerts.failed)} reminders are in a failed state. Re-queue one with{' '}
              <code>select public.admin_retry_tenure_alert(&apos;&lt;alert id&gt;&apos;);</code>{' '}
              — or find them with{' '}
              <code>select id, tenure_id, delivery_metadata from public.tenure_alert_instances where status = &apos;failed&apos;;</code>
            </p>
          )}
        </Card>
      )}
    </>
  );
}
