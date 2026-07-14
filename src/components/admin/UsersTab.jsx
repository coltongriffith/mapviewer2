import React, { useState, useMemo } from 'react';
import { RetentionLadder, StatTile, StatusBadge, ActivityDots, EmptyHint, InfoTip } from './primitives';
import { METRIC_DEFS, formatRate, fmtNum, fmtDate, relTime } from './metrics';

const Card = ({ title, tip, eyebrow, action, children, full }) => (
  <section className={`adm-card${full ? ' adm-card-full' : ''}`}>
    <div className="adm-card-head">
      <div>{eyebrow && <div className="admx-eyebrow">{eyebrow}</div>}
        <h3 className="adm-card-title">{title}{tip && <InfoTip text={tip} label={title} />}</h3></div>
      {action}
    </div>
    {children}
  </section>
);

const FILTERS = [
  ['all', 'All'], ['new', 'New (7d)'], ['never_activated', 'Never activated'],
  ['dormant', 'Dormant'], ['power', 'Power'],
];

export default function UsersTab({ data, loading, detail, onLoadDetail, onOpenSession }) {
  const [filter, setFilter] = useState('all');
  const [q, setQ] = useState('');
  const [openUser, setOpenUser] = useState(null);

  const users = data?.users || [];
  const filtered = useMemo(() => users.filter((u) => {
    if (filter === 'new' && u.status !== 'new') return false;
    if (filter === 'never_activated' && u.status !== 'never_activated') return false;
    if (filter === 'dormant' && u.status !== 'dormant') return false;
    if (filter === 'power' && u.status !== 'power') return false;
    if (q) {
      const hay = `${u.email || ''} ${u.company || ''}`.toLowerCase();
      if (!hay.includes(q.toLowerCase())) return false;
    }
    return true;
  }), [users, filter, q]);

  const toggle = (id) => {
    const next = openUser === id ? null : id;
    setOpenUser(next);
    if (next) onLoadDetail?.(next);
  };

  const cohorts = data?.cohorts || [];
  const maturedD7 = cohorts.filter((c) => c.d7?.matured > 0);
  const pooledD7n = maturedD7.reduce((s, c) => s + (c.d7?.n || 0), 0);
  const pooledD7of = maturedD7.reduce((s, c) => s + (c.d7?.matured || 0), 0);

  if (loading) return <Card title="Users"><div className="adm-skeleton adm-skeleton-block" style={{ height: 120 }} /></Card>;

  return (
    <>
      <div className="admx-grid-2-1">
        <Card title="Retention ladder" tip={METRIC_DEFS.retention_ladder} eyebrow="Every registered account by recency">
          <RetentionLadder buckets={data?.ladder || []} onPick={(b) => {
            if (b === 'Never activated') setFilter('never_activated');
            else if (b.startsWith('Active this week')) setFilter('power');
            else setFilter('all');
          }} />
        </Card>
        <div className="admx-mini-tiles">
          <StatTile label="Returning this week" accent="#0891b2"
            value={formatRate(data?.returning_week?.n, data?.returning_week?.of).text}
            detail="active this week who used it before" />
          {Number(data?.activated_count) >= 5 && (
            <StatTile label="Median days → first value" accent="#16a34a"
              value={data?.median_days_to_value != null ? `${data.median_days_to_value}d` : '—'}
              detail="signup to first meaningful action" />
          )}
        </div>
      </div>

      <Card title="Weekly cohorts" tip={METRIC_DEFS.cohorts} eyebrow="Signup week → return rate" full>
        {cohorts.length === 0 ? <EmptyHint>No signups in the last 8 weeks.</EmptyHint> : (
          <>
            {pooledD7of >= 1 && (
              <div className="admx-cohort-summary">D7 return: <strong>{pooledD7n} of {pooledD7of}</strong> users from the last {maturedD7.length} matured week{maturedD7.length === 1 ? '' : 's'}.</div>
            )}
            <table className="adm-table">
              <thead><tr><th>Cohort week</th><th>Signups</th><th>Activated</th><th>Returned ≤7d</th><th>Returned ≤30d</th></tr></thead>
              <tbody>
                {cohorts.map((c) => (
                  <tr key={c.week}>
                    <td className="adm-mono">{fmtDate(c.week)}</td>
                    <td>{fmtNum(c.signups)}</td>
                    <td>{formatRate(c.activated, c.signups).text}</td>
                    <td>{c.d7?.matured > 0 ? formatRate(c.d7.n, c.d7.matured).text : <span className="adm-muted">—</span>}</td>
                    <td>{c.d30?.matured > 0 ? formatRate(c.d30.n, c.d30.matured).text : <span className="adm-muted">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </Card>

      <Card title="Users" eyebrow={`${fmtNum(users.length)} registered`} full
        action={
          <div className="admx-user-controls">
            <div className="admx-chips">
              {FILTERS.map(([k, l]) => <button key={k} className={`admx-chip${filter === k ? ' active' : ''}`} onClick={() => setFilter(k)}>{l}</button>)}
            </div>
            <input className="admx-search" placeholder="email or company…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        }>
        {filtered.length === 0 ? <EmptyHint>No users match this filter.</EmptyHint> : (
          <table className="adm-table">
            <thead><tr><th>User</th><th>Signed up</th><th>Last active</th><th>Activity (14d)</th><th>Projects</th><th>Exports</th><th>Status</th><th /></tr></thead>
            <tbody>
              {filtered.map((u) => (
                <React.Fragment key={u.user_id}>
                  <tr>
                    <td>
                      <div className="adm-truncate" title={u.email}>{u.email}</div>
                      {u.company && <div className="adm-muted admx-user-co">{u.company}</div>}
                    </td>
                    <td>{fmtDate(u.created_at)}{u.status === 'new' && <span className="admx-tag-new">New</span>}</td>
                    <td title={u.last_sign_in_at ? `last login ${fmtDate(u.last_sign_in_at)}` : ''}>{u.last_event_at ? relTime(u.last_event_at) : <span className="adm-muted">—</span>}</td>
                    <td><ActivityDots dots={u.dots || []} /></td>
                    <td>{fmtNum(u.projects)}</td>
                    <td>{fmtNum(u.exports_total)}{u.premium_exports > 0 && <span className="admx-tag-clean"> {u.premium_exports} clean</span>}</td>
                    <td><StatusBadge status={u.status} /></td>
                    <td><button className="admx-details-btn" onClick={() => toggle(u.user_id)}>{openUser === u.user_id ? 'Hide' : 'Details'}</button></td>
                  </tr>
                  {openUser === u.user_id && (
                    <tr className="admx-drawer-row"><td colSpan={8}>
                      <UserDrawer d={detail.byId[u.user_id]} loading={detail.loadingId === u.user_id} onOpenSession={onOpenSession} />
                    </td></tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}

function UserDrawer({ d, loading, onOpenSession }) {
  if (loading || !d) return <div className="adm-skeleton adm-skeleton-block" style={{ height: 80 }} />;
  const id = d.identity || {};
  const ck = d.checklist || {};
  return (
    <div className="admx-drawer">
      <div className="admx-drawer-col">
        <div className="admx-drawer-h">Identity</div>
        <div className="admx-kv"><span>Email</span><a href={`mailto:${id.email}`}>{id.email}</a></div>
        {id.company && <div className="admx-kv"><span>Company</span><b>{id.company}</b></div>}
        {id.qp_name && <div className="admx-kv"><span>QP</span><b>{id.qp_name}{id.qp_credentials ? `, ${id.qp_credentials}` : ''}</b></div>}
        <div className="admx-kv"><span>Joined</span><b>{fmtDate(id.created_at)}</b></div>
        <div className="admx-kv"><span>Last login</span><b>{id.last_sign_in_at ? relTime(id.last_sign_in_at) : '—'}</b></div>
        <div className="admx-drawer-h" style={{ marginTop: 10 }}>Activation</div>
        <div className="admx-drawer-checks">
          {[['Opened', ck.opened], ['Added data', ck.added_data], ['Map work', ck.map_work], ['Exported/shared', ck.artifact]].map(([l, on]) => (
            <span key={l} className={on ? 'admx-chk-on' : 'admx-chk-off'}>{on ? '✓' : '–'} {l}</span>
          ))}
        </div>
      </div>
      <div className="admx-drawer-col">
        <div className="admx-drawer-h">Projects ({(d.projects || []).length})</div>
        <ul className="admx-drawer-projects">
          {(d.projects || []).slice(0, 8).map((p) => <li key={p.id}><span className="adm-truncate">{p.name || 'Untitled'}</span><span className="adm-muted">{fmtDate(p.updated_at)}</span></li>)}
          {(d.projects || []).length === 0 && <li className="adm-muted">No cloud projects</li>}
        </ul>
        {(d.exports_by_format || []).length > 0 && (
          <div className="admx-drawer-exports">{d.exports_by_format.map((x) => <span key={x.format}>{String(x.format).toUpperCase()} {x.n}</span>)}</div>
        )}
      </div>
      <div className="admx-drawer-col">
        <div className="admx-drawer-h">Recent activity</div>
        <ul className="admx-drawer-events">
          {(d.recent_events || []).slice(0, 10).map((e, i) => (
            <li key={i}>
              <span className="admx-de-event">{e.event}</span>
              <span className="admx-de-time">{relTime(e.t)}</span>
              {e.session_id && <button className="admx-feed-link" onClick={() => onOpenSession?.(e.session_id)}>↳</button>}
            </li>
          ))}
          {(d.recent_events || []).length === 0 && <li className="adm-muted">No events recorded</li>}
        </ul>
      </div>
    </div>
  );
}
