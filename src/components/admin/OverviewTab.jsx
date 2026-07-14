import React from 'react';
import {
  StatTile, DeltaChip, Sparkline, ColumnChart, ActivityDots, EmptyHint, InfoTip,
} from './primitives';
import { METRIC_DEFS, formatRate, fmtNum, fmtDate, relTime } from './metrics';

const RangeToggle = ({ value, onChange }) => (
  <div className="admx-range">
    {[7, 30, 90].map((r) => (
      <button key={r} className={`admx-range-btn${value === r ? ' active' : ''}`} onClick={() => onChange(r)}>{r}d</button>
    ))}
  </div>
);

const Card = ({ title, tip, eyebrow, action, children, full, className = '' }) => (
  <section className={`adm-card${full ? ' adm-card-full' : ''} ${className}`}>
    <div className="adm-card-head">
      <div>
        {eyebrow && <div className="admx-eyebrow">{eyebrow}</div>}
        <h3 className="adm-card-title">{title}{tip && <InfoTip text={tip} label={title} />}</h3>
      </div>
      {action}
    </div>
    {children}
  </section>
);

// Feed row copy from a server event descriptor.
function feedText(f) {
  const m = f.meta || {};
  const who = f.actor || 'A visitor';
  const name = m.name ? `"${m.name}"` : '';
  switch (f.kind) {
    case 'signup': return <><strong>{who}</strong> signed up</>;
    case 'project_created': return <><strong>{who}</strong> created project {name}</>;
    case 'project_saved': return <><strong>{who}</strong> worked on {name}</>;
    case 'export_completed': return <><strong>{who}</strong> exported {String(m.format || '').toUpperCase()} {name}{m.clean ? <em className="admx-tag-clean"> clean</em> : ''}</>;
    case 'export_failed': return <span className="admx-feed-warn"><strong>{who}</strong> — export failed ({String(m.format || '').toUpperCase()})</span>;
    case 'share_created': return <><strong>{who}</strong> shared a map</>;
    case 'share_forked': return <><strong>A visitor</strong> forked {name || 'a shared map'}</>;
    case 'share_viewed': return <>Shared map viewed{Number(m.n) > 1 ? ` ×${m.n}` : ''}</>;
    case 'registry_claims_imported': return <><strong>{who}</strong> imported {fmtNum(m.features)} claims{m.province ? ` (${String(m.province).toUpperCase()})` : ''}</>;
    case 'lead': return <>Lead captured: <strong>{f.actor}</strong></>;
    default: return <>{f.kind}</>;
  }
}
const FEED_ICON = {
  signup: '◍', project_created: '＋', project_saved: '✎', export_completed: '⤓',
  export_failed: '⚠', share_created: '↗', share_forked: '⑃', share_viewed: '👁',
  registry_claims_imported: '⬡', lead: '✉',
};

export default function OverviewTab({ data, loading, range, onRange, onPickDay, onOpenSession, onOpenUser }) {
  const k = data?.kpis || {};
  const spark = data?.spark || {};
  const since = data?.since || {};
  const instrDate = data?.meta?.instrumentation_date;

  const activatedRate = formatRate(k.activated?.done, k.activated?.of);
  const actionKinds = (k.actions?.kinds || []).slice(0, 3)
    .map((x) => `${x.n} ${String(x.kind).replace('project_', '').replace('_completed', '').replace('registry_claims_imported', 'imports').replace('share_created', 'shares')}`)
    .join(' · ');

  return (
    <>
      {/* Row 1 — 6 KPI tiles */}
      <div className="admx-tile-row">
        <StatTile label="Active today" tip={METRIC_DEFS.active_today} accent="#2563eb" loading={loading}
          value={fmtNum(k.active_today ?? 0)}
          detail={`yesterday ${fmtNum(k.active_yesterday ?? 0)} · 7d avg ${k.active_7d_avg ?? 0}`}
          spark={<Sparkline points={spark.active} />} />
        <StatTile label="New signups" tip={METRIC_DEFS.new_signups} accent="#6366f1" loading={loading}
          value={fmtNum(k.signups?.cur ?? 0)}
          delta={<DeltaChip cur={k.signups?.cur} prior={k.signups?.prev} />}
          spark={<Sparkline points={spark.signups} accent="#6366f1" />}
          detail={`vs ${fmtNum(k.signups?.prev ?? 0)} prior`} />
        <StatTile label="Activated" tip={METRIC_DEFS.activated} accent="#16a34a" loading={loading}
          value={activatedRate.text}
          detail={`${fmtNum(k.activated?.pending ?? 0)} pending (signed up <7d ago)`} />
        <StatTile label="Meaningful actions" tip={METRIC_DEFS.meaningful_actions} accent="#0ea5e9" loading={loading}
          value={<>{fmtNum(k.actions?.cur ?? 0)} <span className="admx-tile-sub">· {fmtNum(k.actions?.users ?? 0)} users</span></>}
          delta={<DeltaChip cur={k.actions?.cur} prior={k.actions?.prev} />}
          spark={<Sparkline points={spark.actions} accent="#0ea5e9" />}
          detail={actionKinds || 'no value actions yet'} />
        <StatTile label="Maps & exports" tip={METRIC_DEFS.maps_exports} accent="#8b5cf6" loading={loading}
          value={<>{fmtNum(k.maps?.created ?? 0)} <span className="admx-tile-sub">created · {fmtNum(k.maps?.exports ?? 0)} exports</span></>}
          delta={<DeltaChip cur={k.maps?.exports} prior={k.maps?.prev_exports} />}
          spark={<Sparkline points={spark.exports} accent="#8b5cf6" />}
          detail={Number(k.maps?.failures) > 0 ? <span className="admx-feed-warn">{k.maps.failures} failed export{k.maps.failures === 1 ? '' : 's'}</span> : `${fmtNum(k.maps?.worked_on ?? 0)} worked on`} />
        <StatTile label="Returning users" tip={METRIC_DEFS.returning} accent="#0891b2" loading={loading}
          value={formatRate(k.returning?.cur, k.returning?.of_active).text}
          delta={<DeltaChip cur={k.returning?.cur} prior={k.returning?.prev} />}
          detail="active who came back on a later day" />
      </div>

      {/* Row 2 — daily activity */}
      <Card title="Daily active users" eyebrow={`Signed-in activity · last ${range} days`} action={<RangeToggle value={range} onChange={onRange} />} full>
        {loading ? <div className="adm-skeleton adm-skeleton-block" style={{ height: 200 }} />
          : <ColumnChart series={data?.daily || []} onPick={onPickDay} />}
      </Card>

      {/* Row 3 — activation checklist + needs attention */}
      <div className="admx-grid-2-1">
        <Card title="Recent signups" tip={METRIC_DEFS.activation_funnel} eyebrow="Last 14 days · activation progress">
          {(data?.checklist || []).length === 0
            ? <EmptyHint>No signups in the last 14 days.</EmptyHint>
            : (
              <table className="adm-table admx-checklist">
                <thead><tr><th>User</th><th>Opened</th><th>Added data</th><th>Map work</th><th>Exported/shared</th><th>Age</th></tr></thead>
                <tbody>
                  {(data.checklist).map((u) => {
                    const stalled = !u.activated && u.days_ago >= 3 && !u.map_work && !u.artifact;
                    return (
                      <tr key={u.user_id} className={stalled ? 'admx-row-amber' : ''} onClick={() => onOpenUser?.(u.user_id)} style={{ cursor: 'pointer' }}>
                        <td className="adm-truncate" title={u.email}>{u.email}</td>
                        <Chk on={u.opened} /><Chk on={u.added_data} /><Chk on={u.map_work} /><Chk on={u.artifact} />
                        <td className="adm-muted">{u.days_ago}d</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
        </Card>
        <Card title="Needs attention" eyebrow="Outreach candidates">
          <NeedsList title="Never activated" empty="Nobody needs outreach — every recent signup has activated."
            rows={(data?.needs_attention?.never_activated || []).map((u) => ({ id: u.user_id, email: u.email, note: `signed up ${relTime(u.created_at)}` }))}
            onOpenUser={onOpenUser} />
          <NeedsList title="Went quiet" empty={null}
            rows={(data?.needs_attention?.went_quiet || []).map((u) => ({ id: u.user_id, email: u.email, note: `last active ${relTime(u.last_active)} · ${u.value_count} actions` }))}
            onOpenUser={onOpenUser} />
        </Card>
      </div>

      {/* Row 4 — feed + most active */}
      <div className="admx-grid-2-1">
        <Card title="Activity feed" eyebrow="Meaningful actions only">
          {(data?.feed || []).length === 0
            ? <EmptyHint since={fmtDate(since.project_created)}>Product actions will stream here — saves, exports, shares, imports.</EmptyHint>
            : (
              <ul className="admx-feed">
                {data.feed.map((f, i) => (
                  <li key={i} className="admx-feed-row">
                    <span className="admx-feed-icon" aria-hidden="true">{FEED_ICON[f.kind] || '•'}</span>
                    <span className="admx-feed-text">{feedText(f)}</span>
                    <span className="admx-feed-time">{relTime(f.event_time)}</span>
                    {f.session_id && <button className="admx-feed-link" onClick={() => onOpenSession?.(f.session_id)}>Timeline</button>}
                  </li>
                ))}
              </ul>
            )}
        </Card>
        <Card title="Most active" eyebrow={`Top users · last ${range} days`}>
          {(data?.most_active || []).length === 0
            ? <EmptyHint>Once people use the editor, your most engaged accounts appear here.</EmptyHint>
            : (
              <ul className="admx-active-list">
                {data.most_active.map((u) => (
                  <li key={u.user_id} onClick={() => onOpenUser?.(u.user_id)}>
                    <span className="adm-truncate" title={u.email}>{u.email}</span>
                    <ActivityDots dots={u.dots || []} />
                    <span className="admx-active-count">{u.value_actions} actions</span>
                  </li>
                ))}
              </ul>
            )}
        </Card>
      </div>
    </>
  );
}

const Chk = ({ on }) => <td className={`admx-chk ${on ? 'admx-chk-on' : 'admx-chk-off'}`}>{on ? '✓' : '–'}</td>;

function NeedsList({ title, rows, empty, onOpenUser }) {
  if (!rows.length) return empty ? <div className="admx-needs-empty">{empty}</div> : null;
  return (
    <div className="admx-needs">
      <div className="admx-needs-title">{title}</div>
      {rows.map((r) => (
        <div key={r.id} className="admx-needs-row">
          <button className="admx-needs-email" onClick={() => onOpenUser?.(r.id)} title={r.email}>{r.email}</button>
          <a className="admx-needs-mail" href={`mailto:${r.email}`} title="Email this user" onClick={(e) => e.stopPropagation()}>✉</a>
          <span className="admx-needs-note">{r.note}</span>
        </div>
      ))}
    </div>
  );
}
