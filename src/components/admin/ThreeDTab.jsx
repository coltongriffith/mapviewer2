import React from 'react';
import { StatTile, Card, ColumnChart, EmptyHint, HBarsV2 } from './primitives';
import {
  fmtNum, fmtDate, relTime, METRIC_DEFS, THREE_D_EXPORT_LABEL, THREE_D_DATA_LABEL, kindRows, sharedMapsDaily, splitText,
  threeDTrackingNote,
} from './metrics';

// The 3D figure maker (/3d) and shared maps, 2D and 3D. Data: admin_get_three_d_usage
// (supabase/migrations/20261030100000_admin_three_d_usage.sql), which leaves out what the Overview leaves out.

const KIND = { map: '2D map', figure: '3D figure' };

function Owner({ email, userId, agent, onOpenUser }) {
  if (email) return userId && onOpenUser
    ? <button type="button" className="adm-link" onClick={() => onOpenUser(userId)}>{email}</button>
    : <span>{email}</span>;
  return <span className="adm-muted">{agent ? 'AI connector' : 'Signed out'}</span>;
}

export default function ThreeDTab({ data, onOpenUser }) {
  const t = data.totals;
  const sm = data.shared_maps;
  const st = sm.totals;
  const exportsTotal = Number(t.exports) || 0;
  return <>
    <div className="growth-tiles">
      <StatTile label="3D opens" tip={METRIC_DEFS.three_d_opens} value={fmtNum(t.opens)}
        detail={`${fmtNum(t.data_sessions)} added their own data · ${fmtNum(t.export_sessions)} exported`} />
      <StatTile label="Active 3D users" tip={METRIC_DEFS.three_d_active} value={fmtNum(t.active_users)} accent="#176b87"
        detail="Signed in, did something in 3D" />
      <StatTile label="3D projects" tip={METRIC_DEFS.three_d_projects} value={fmtNum(t.projects_created)} accent="#287454"
        detail={`created · ${fmtNum(t.projects_updated)} updated · ${fmtNum(t.versions)} versions published`} />
      <StatTile label="3D exports" tip={METRIC_DEFS.three_d_exports} value={fmtNum(exportsTotal)} accent="#435459"
        detail={data.exports_by_kind.length ? data.exports_by_kind.map((k) => `${fmtNum(k.n)} ${k.kind}`).join(' · ') : 'None in this period'} />
    </div>
    <p className="admx-since-note sum-excluded">{threeDTrackingNote(data.tracking_since)} Your own visits, admin accounts and bots are left out.</p>

    <Card title="3D opens per day" tip={METRIC_DEFS.three_d_opens} full>
      <ColumnChart series={data.daily} barKey="opens" barLabel="3D opens" lineKey="active_users" lineLabel="active 3D users"
        ariaLabel="3D opens per day" sharedScale empty="No one opened /3d in this period." />
    </Card>

    <div className="growth-grid">
      <Card title="Exports by kind" tip={METRIC_DEFS.three_d_exports} count={exportsTotal || null}>
        <HBarsV2 rows={kindRows(data.exports_by_kind, THREE_D_EXPORT_LABEL)} color="#435459"
          empty={<EmptyHint since={data.tracking_since ? fmtDate(data.tracking_since) : null}>No 3D exports in this period.</EmptyHint>} />
      </Card>

      <Card title="Data added" tip={METRIC_DEFS.three_d_data} eyebrow="Tabs that added each kind">
        <HBarsV2 rows={kindRows(data.data_by_kind, THREE_D_DATA_LABEL, 'sessions')} color="#287454"
          empty={<EmptyHint>No one added their own data in this period.</EmptyHint>} />
      </Card>

      <Card title="3D share links" tip={METRIC_DEFS.shared_created}>
        <div className="admx-health">
          <div className="admx-health-stat"><strong>{fmtNum(t.shares_created)}</strong><span>links made</span></div>
          <div className="admx-health-stat"><strong>{fmtNum(t.share_views)}</strong><span>tabs viewed one</span></div>
          <div className="admx-health-stat"><strong>{fmtNum(t.share_forks)}</strong><span>saved a copy</span></div>
        </div>
        <p className="admx-since-note">{fmtNum(st.live_3d)} live 3D links · {fmtNum(st.lifetime_views_3d)} views all time</p>
      </Card>

      <Card title="3D figures saved" tip={METRIC_DEFS.three_d_projects}>
        <div className="admx-health">
          <div className="admx-health-stat"><strong>{fmtNum(t.projects_created)}</strong><span>created</span></div>
          <div className="admx-health-stat"><strong>{fmtNum(t.projects_updated)}</strong><span>updated</span></div>
          <div className="admx-health-stat"><strong>{fmtNum(t.versions)}</strong><span>versions published</span></div>
        </div>
        <p className="admx-since-note">{fmtNum(t.saves)} saves recorded · {fmtNum(t.projects_deleted)} deleted</p>
      </Card>
    </div>

    <Card title="Top 3D projects" tip={METRIC_DEFS.three_d_top_projects} count={data.top_projects.length || null} full>
      {data.top_projects.length === 0 ? <EmptyHint>No 3D figure was created, saved, shared or published in this period.</EmptyHint> : (
        <div className="adm-table-wrap"><table className="adm-table">
          <thead><tr><th scope="col">Figure</th><th scope="col">Owner</th><th scope="col">Last saved</th>
            <th scope="col" className="adm-num">Saves</th><th scope="col" className="adm-num">Links</th>
            <th scope="col" className="adm-num">Link views</th><th scope="col" className="adm-num">Versions</th></tr></thead>
          <tbody>{data.top_projects.map((p) => (
            <tr key={p.id}>
              <th scope="row">{p.name || 'Untitled'}{p.deleted && <span className="adm-muted"> · deleted</span>}
                <div className="adm-muted sum-sub">created {fmtDate(p.created_at)}</div></th>
              <td><Owner email={p.owner_email} userId={p.user_id} onOpenUser={onOpenUser} /></td>
              <td title={p.updated_at}>{relTime(p.updated_at)}</td>
              <td className="adm-num">{fmtNum(p.saves)}</td>
              <td className="adm-num">{fmtNum(p.shares)}</td>
              <td className="adm-num">{fmtNum(p.share_views)}</td>
              <td className="adm-num">{fmtNum(p.versions)}</td>
            </tr>))}</tbody>
        </table></div>
      )}
    </Card>

    <div className="adm-section-header"><h2 className="adm-section-title">Shared maps · 2D and 3D</h2></div>
    <div className="growth-tiles">
      <StatTile label="Links made" tip={METRIC_DEFS.shared_created} value={fmtNum((Number(st.created_2d) || 0) + (Number(st.created_3d) || 0))}
        detail={`${splitText(st.created_2d, st.created_3d)}${Number(st.created_2d_agent) ? ` · ${fmtNum(st.created_2d_agent)} by AI` : ''}`} />
      <StatTile label="Link views" tip={METRIC_DEFS.shared_viewed} value={fmtNum((Number(st.viewed_2d) || 0) + (Number(st.viewed_3d) || 0))} accent="#176b87"
        detail={splitText(st.viewed_2d, st.viewed_3d)} />
      <StatTile label="Live links" value={fmtNum((Number(st.live_2d) || 0) + (Number(st.live_3d) || 0))} accent="#287454"
        tip="Links not revoked or expired, all time." detail={splitText(st.live_2d, st.live_3d)} />
      <StatTile label="Views all time" value={fmtNum((Number(st.lifetime_views_2d) || 0) + (Number(st.lifetime_views_3d) || 0))} accent="#435459"
        tip="The servers' view counters on every link, all time; at most one a minute per link, the owner's own views included." detail={splitText(st.lifetime_views_2d, st.lifetime_views_3d)} />
    </div>

    <Card title="Shared maps per day" tip={METRIC_DEFS.shared_viewed} full>
      <ColumnChart series={sharedMapsDaily(sm.daily)} barKey="created" barLabel="links made" lineKey="viewed" lineLabel="tabs that viewed a link"
        ariaLabel="Shared maps made and viewed per day" empty="No shared maps in this period." />
    </Card>

    <Card title="Most-viewed shares" tip={METRIC_DEFS.shared_top} count={sm.top.length || null} full>
      {sm.top.length === 0 ? <EmptyHint>No live link was made or viewed in this period.</EmptyHint> : (
        <div className="adm-table-wrap"><table className="adm-table">
          <thead><tr><th scope="col">Title</th><th scope="col">Kind</th><th scope="col">Owner</th>
            <th scope="col" className="adm-num">Views</th><th scope="col">Created</th><th scope="col">Link</th></tr></thead>
          <tbody>{sm.top.map((s) => (
            <tr key={s.path}>
              <th scope="row">{s.title || <span className="adm-muted">Untitled</span>}
                {s.last_viewed_at && <div className="adm-muted sum-sub">last viewed {relTime(s.last_viewed_at)}</div>}</th>
              <td>{KIND[s.kind] || s.kind}</td>
              <td><Owner email={s.owner_email} userId={s.user_id} agent={s.agent} onOpenUser={onOpenUser} /></td>
              <td className="adm-num">{fmtNum(s.views)}</td>
              <td>{fmtDate(s.created_at)}</td>
              <td className="adm-mono sum-path"><a href={s.path} target="_blank" rel="noopener noreferrer" title={s.path}>{s.path}</a></td>
            </tr>))}</tbody>
        </table></div>
      )}
    </Card>
  </>;
}
