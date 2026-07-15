import React, { useState } from 'react';
import { FunnelV2, HBarsV2, EmptyHint, InfoTip } from './primitives';
import { fmtNum, fmtDate, relTime } from './metrics';

const Card = ({ title, tip, eyebrow, children, full }) => (
  <section className={`adm-card${full ? ' adm-card-full' : ''}`}>
    <div className="adm-card-head">
      <div>{eyebrow && <div className="admx-eyebrow">{eyebrow}</div>}
        <h3 className="adm-card-title">{title}{tip && <InfoTip text={tip} label={title} />}</h3></div>
    </div>
    {children}
  </section>
);

export default function ProductTab({ data, loading, range }) {
  const [stuck, setStuck] = useState(null);
  if (loading) return <Card title="Product"><div className="adm-skeleton adm-skeleton-block" style={{ height: 160 }} /></Card>;

  const f = data?.funnels || {};
  const eh = data?.export_health || {};
  const su = data?.search_users || {};

  const newUserSteps = (f.new_user || []).map((s) => ({ stage: s.stage, count: s.users, stuck: s.stuck || [] }));
  const sessionSteps = (f.session_value || []).map((s) => ({ stage: s.stage, count: s.sessions }));
  const gateSteps = (f.gate || []).map((s) => ({ stage: s.stage, count: s.sessions }));

  return (
    <>
      <div className="admx-grid-2-1">
        <Card title="New-user activation" tip="New signups (last 28 days) reaching each stage within 7 days of signup. Click a stage to see who's stuck." eyebrow="Users">
          <FunnelV2 steps={newUserSteps} unit="users" onPickStage={(s) => setStuck(s)} />
          {stuck && (
            <div className="admx-stuck">
              <div className="admx-stuck-h">Stuck after “{stuck.stage}” ({(stuck.stuck || []).length}) <button onClick={() => setStuck(null)}>×</button></div>
              {(stuck.stuck || []).map((e) => <a key={e} href={`mailto:${e}`} className="admx-stuck-email">{e}</a>)}
            </div>
          )}
        </Card>
        <Card title="Session → value" eyebrow="Sessions this window">
          <FunnelV2 steps={sessionSteps} unit="sessions" />
        </Card>
      </div>

      <div className="admx-grid-2-1">
        <Card title="Feature usage" eyebrow="What people actually use">
          <HBarsV2 rows={(data?.features || []).map((r) => ({ label: r.feature, value: r.events, sub: `by ${r.users} user${r.users === 1 ? '' : 's'}` }))}
            empty={<EmptyHint>Feature events will appear as people work. Tracking began at the migration date.</EmptyHint>} />
        </Card>
        <Card title="Export gate" eyebrow="Sessions this window">
          <FunnelV2 steps={gateSteps} unit="sessions" />
        </Card>
      </div>

      <div className="admx-grid-3">
        <Card title="Claim imports by province">
          <HBarsV2 color="#0ea5e9" rows={(data?.registry_imports || []).map((r) => ({ label: r.province, value: r.imports, sub: `${fmtNum(r.features)} claims` }))} />
        </Card>
        <Card title="Annotations by type">
          <HBarsV2 color="#8b5cf6" rows={(data?.elements || []).map((r) => ({ label: r.type, value: r.sessions, sub: 'sessions' }))} />
        </Card>
        <Card title="Layers by source">
          <HBarsV2 color="#6366f1" rows={(data?.layer_sources || []).map((r) => ({ label: r.source, value: r.count }))} />
        </Card>
      </div>

      {eh.ever_failed && (
        <Card title="Export health" eyebrow="Completed vs failed" full>
          <div className="admx-health">
            <div className="admx-health-stat"><strong>{fmtNum(eh.completed)}</strong><span>completed</span></div>
            <div className="admx-health-stat admx-health-bad"><strong>{fmtNum(eh.failed)}</strong><span>failed</span></div>
          </div>
          {(eh.recent_failures || []).length > 0 && (
            <table className="adm-table"><thead><tr><th>When</th><th>Format</th><th>Message</th></tr></thead>
              <tbody>{eh.recent_failures.map((r, i) => (
                <tr key={i}><td>{relTime(r.t)}</td><td className="adm-mono">{String(r.format || '').toUpperCase()}</td><td className="adm-truncate" title={r.message}>{r.message}</td></tr>
              ))}</tbody>
            </table>
          )}
        </Card>
      )}

      <Card title="Search demand" eyebrow="Registry searches this window" full>
        <div className="admx-health">
          <div className="admx-health-stat"><strong>{fmtNum(su.total ?? 0)}</strong><span>searches</span></div>
          <div className="admx-health-stat"><strong>{fmtNum(su.attributed ?? 0)}</strong><span>by signed-in users</span></div>
        </div>
        {su.since && <div className="admx-since-note">User attribution began {fmtDate(su.since)}; earlier searches are session-scoped.</div>}
      </Card>
    </>
  );
}
