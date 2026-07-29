import React from 'react';
import { fmtNum, relTime } from './metrics';

/**
 * Service health: recent client and API failures, grouped by fingerprint
 * (audit P1-12).
 *
 * Before this the only record of a frontend crash was the user's console, so
 * a broken export, import, share or billing path was invisible until someone
 * complained. Grouping means one bad deploy reads as one row rather than
 * thousands.
 */
export default function HealthTab({ data, loading, error }) {
  if (loading) {
    return (
      <section className="adm-card">
        <div className="adm-skeleton adm-skeleton-block" style={{ height: 160 }} />
      </section>
    );
  }

  if (error) {
    return (
      <section className="adm-card">
        <h3 className="adm-card-title">Errors</h3>
        <p className="claims-error">Couldn’t load the error summary: {error}</p>
      </section>
    );
  }

  const groups = data?.groups || [];
  const total = Number(data?.total || 0);
  const hours = Number(data?.window_hours || 24);

  return (
    <>
      <section className="adm-card adm-card-full">
        <div className="adm-card-head">
          <div>
            <div className="admx-eyebrow">Last {hours}h</div>
            <h3 className="adm-card-title">
              Errors{' '}
              <span style={{ color: total > 0 ? '#dc2626' : '#16a34a' }}>
                {fmtNum(total)}
              </span>
            </h3>
          </div>
        </div>

        {groups.length === 0 ? (
          <p className="adm-empty" style={{ color: '#16a34a' }}>
            No errors reported in the last {hours} hours.
          </p>
        ) : (
          <table className="adm-table">
            <thead>
              <tr>
                <th>Error</th>
                <th>Where</th>
                <th>Release</th>
                <th>Count</th>
                <th>Users</th>
                <th>Last seen</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <tr key={g.fingerprint}>
                  <td>
                    <div className="adm-truncate" title={g.message} style={{ maxWidth: 420, fontWeight: 600 }}>
                      {g.message}
                    </div>
                    {g.sample_stack && (
                      <details>
                        <summary className="adm-muted" style={{ cursor: 'pointer', fontSize: 12 }}>stack</summary>
                        <pre style={{ fontSize: 11, whiteSpace: 'pre-wrap', maxHeight: 200, overflow: 'auto' }}>
                          {g.sample_stack}
                        </pre>
                      </details>
                    )}
                  </td>
                  <td>
                    <span className="adm-mono">{g.kind}</span>
                    {g.path && <div className="adm-muted adm-truncate" style={{ maxWidth: 180 }}>{g.path}</div>}
                  </td>
                  <td className="adm-mono">{g.release || '—'}</td>
                  <td>{fmtNum(g.count)}</td>
                  <td>{fmtNum(g.users)}</td>
                  <td>{g.last_seen ? relTime(g.last_seen) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="adm-card adm-card-full">
        <h3 className="adm-card-title">Alerting</h3>
        <p className="adm-muted">
          This table is the first-party record and requires someone to look at it.
          Routed alerting (email/Slack/phone when the error rate spikes) is set up
          outside the app — see <code>docs/monitoring.md</code>.
        </p>
      </section>
    </>
  );
}
