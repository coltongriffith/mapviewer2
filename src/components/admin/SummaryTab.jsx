import React from 'react';
import { StatTile, Card, ColumnChart, EmptyHint, InfoTip } from './primitives';
import { fmtNum, relTime } from './metrics';

// The one analytics page: how many real people came, where from, what they
// did, where they got stuck, and who they were. Data: admin_get_summary,
// which already leaves out your own visits and bots.

const PEOPLE_TIP = 'Real visitors: someone who stayed 45 seconds or more, viewed more than one page, clicked, searched or did something in the editor, plus quick exits that a search engine or another site sent. Your own visits and bots are left out.';

function when(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-CA', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function place(r) {
  return [r.city, r.country].filter(Boolean).join(', ') || 'Unknown';
}

function Steps({ steps }) {
  if (!steps?.length) return <span className="adm-muted">Looked around</span>;
  return <span className="sum-steps">{steps.map(s => <span key={s} className={`sum-step${s === 'Error' ? ' sum-step-bad' : ''}`}>{s}</span>)}</span>;
}

export default function SummaryTab({ data, onOpenSession, onOpenUser, onOpenFeedback }) {
  const t = data.totals;
  const steps = data.usage.steps;
  const ai = data.usage.ai;
  const stuck = data.problems.stuck.filter(s => Number(s.n) > 0);
  const { errors, failed_searches: failed, feedback_open: feedbackOpen } = data.problems;

  return <>
    <div className="growth-tiles">
      <StatTile label="People" tip={PEOPLE_TIP} value={fmtNum(t.people)}
        detail={`${fmtNum(t.engaged)} stayed or did something · ${fmtNum(t.bounced)} left right away`} />
      <StatTile label="Made a map" value={fmtNum(t.made_map)} accent="#287454"
        detail="Exported or shared a map on the site" />
      <StatTile label="New signups" value={fmtNum(t.signups)} accent="#176b87"
        detail={t.signups ? 'Listed below' : 'None in this period'} />
      <StatTile label="AI assistant maps" value={fmtNum(ai.maps)} accent="#435459"
        tip="Map previews made through the Claude or ChatGPT connector. Anonymous connector use includes your own testing."
        detail={`${fmtNum(ai.chats)} chats${ai.signed_in ? ` · ${fmtNum(ai.signed_in)} signed in` : ''}`} />
    </div>
    <p className="admx-since-note sum-excluded">Not counted: {fmtNum(t.you)} visits by you and {fmtNum(t.bots)} by bots or automated browsers.</p>

    <Card title="People per day" full>
      <ColumnChart series={data.daily} barKey="engaged" barLabel="stayed or did something"
        lineKey="bounced" lineLabel="left right away" ariaLabel="Real visitors per day" sharedScale
        empty="No real visitors in this period." />
    </Card>

    <div className="growth-grid">
      <Card title="Where they came from">
        {data.sources.length === 0 ? <EmptyHint>No real visitors in this period.</EmptyHint> : (
          <div className="adm-table-wrap"><table className="adm-table">
            <thead><tr><th scope="col">Source</th><th scope="col" className="adm-num">People</th>
              <th scope="col" className="adm-num">Stayed</th><th scope="col" className="adm-num">Made a map</th>
              <th scope="col" className="adm-num">Signed up</th></tr></thead>
            <tbody>{data.sources.map(s => (
              <tr key={s.channel}>
                <th scope="row">{s.channel}{s.sites?.length > 0 && s.channel !== 'Direct' && <div className="adm-muted sum-sub">{s.sites.join(', ')}</div>}</th>
                <td className="adm-num">{fmtNum(s.people)}</td>
                <td className="adm-num">{fmtNum(s.engaged)}</td>
                <td className="adm-num">{fmtNum(s.made_map)}</td>
                <td className="adm-num">{fmtNum(s.signups)}</td>
              </tr>))}</tbody>
          </table></div>
        )}
      </Card>

      <Card title="First page they saw">
        {data.pages.length === 0 ? <EmptyHint>No real visitors in this period.</EmptyHint> : (
          <div className="adm-table-wrap"><table className="adm-table">
            <thead><tr><th scope="col">Page</th><th scope="col" className="adm-num">People</th><th scope="col" className="adm-num">Stayed</th></tr></thead>
            <tbody>{data.pages.map(p => (
              <tr key={p.path}><th scope="row" className="adm-mono sum-path" title={p.path}>{p.path}</th>
                <td className="adm-num">{fmtNum(p.people)}</td><td className="adm-num">{fmtNum(p.engaged)}</td></tr>))}</tbody>
          </table></div>
        )}
      </Card>

      <Card title="What they did" tip="Each step counts people who reached it in this period, out of everyone who visited.">
        <ol className="sum-funnel">
          {steps.map(s => {
            const top = Number(steps[0].n) || 0;
            const w = top ? (Number(s.n) / top) * 100 : 0;
            return <li key={s.key}>
              <span className="sum-funnel-label">{s.label}</span>
              <span className="sum-funnel-track"><span style={{ width: `${Math.max(w, s.n ? 2 : 0)}%` }} /></span>
              <strong>{fmtNum(s.n)}</strong>
            </li>;
          })}
        </ol>
        <p className="admx-since-note">Features used: {data.usage.features.map(f => `${f.label} ${fmtNum(f.n)}`).join(' · ')}</p>
      </Card>

      <Card title="Where people get stuck">
        {stuck.length === 0 && errors.length === 0 && failed.length === 0 && !feedbackOpen
          ? <EmptyHint>Nothing stood out in this period.</EmptyHint> : <>
          {stuck.length > 0 && <ul className="sum-stuck">
            {stuck.map(s => <li key={s.key}><strong>{fmtNum(s.n)}</strong> {s.label.toLowerCase()}</li>)}
          </ul>}
          {feedbackOpen > 0 && <p className="sum-feedback">
            <strong>{fmtNum(feedbackOpen)}</strong> open feedback report{feedbackOpen === 1 ? '' : 's'}{' '}
            <button type="button" className="adm-btn adm-btn-ghost adm-btn-sm" onClick={onOpenFeedback}>Read them</button>
          </p>}
          {errors.length > 0 && <>
            <h4 className="sum-subhead">Errors people saw</h4>
            <ul className="sum-list">{errors.map((e, i) => (
              <li key={i}><span className="sum-msg" title={e.message}>{e.message}</span>
                <span className="adm-muted">{fmtNum(e.people)} {Number(e.people) === 1 ? 'person' : 'people'} · {fmtNum(e.times)}× · {relTime(e.last_seen)}{e.path ? ` · ${e.path}` : ''}</span></li>))}</ul>
          </>}
          {failed.length > 0 && <>
            <h4 className="sum-subhead">Searches that found nothing <InfoTip label="Searches that found nothing" text="If the company really holds claims in that province, the search missed it and is worth a look." /></h4>
            <ul className="sum-list">{failed.map((f, i) => (
              <li key={i}><span className="adm-mono">{f.query}</span>
                <span className="adm-muted">{f.province || '—'} · {fmtNum(f.times)}×{f.errored ? ' · search errored' : ''} · {relTime(f.last_seen)}</span></li>))}</ul>
          </>}
        </>}
      </Card>
    </div>

    {data.signups.length > 0 && (
      <Card title="New signups" count={data.signups.length} full>
        <div className="adm-table-wrap"><table className="adm-table">
          <thead><tr><th scope="col">Account</th><th scope="col">Signed up</th><th scope="col">Came from</th><th scope="col">First page</th></tr></thead>
          <tbody>{data.signups.map(u => (
            <tr key={u.user_id}>
              <th scope="row"><button type="button" className="adm-link" onClick={() => onOpenUser(u.user_id)}>{u.email}</button>
                {!u.confirmed && <span className="adm-muted"> · not confirmed</span>}
                {u.session_id && <div><button type="button" className="adm-link sum-journey" onClick={() => onOpenSession(u.session_id)}>Journey</button></div>}</th>
              <td>{when(u.created_at)}</td>
              <td>{u.source || '—'}</td>
              <td className="adm-mono">{u.landing || '—'}</td>
            </tr>))}</tbody>
        </table></div>
      </Card>
    )}

    <Card title="Recent visitors" eyebrow="People who stayed or did something · newest first" count={data.recent.length || null} full>
      {data.recent.length === 0 ? <EmptyHint>No one stayed or did anything in this period.</EmptyHint> : (
        <div className="adm-table-wrap"><table className="adm-table">
          <thead><tr><th scope="col">When</th><th scope="col">Where</th><th scope="col">Came from</th><th scope="col">First page</th><th scope="col">What they did</th></tr></thead>
          <tbody>{data.recent.map(r => (
            <tr key={r.session_id}>
              <td style={{ whiteSpace: 'nowrap' }}>{when(r.first_at)}
                <div><button type="button" className="adm-link sum-journey" onClick={() => onOpenSession(r.session_id)}>Journey</button></div></td>
              <td>{place(r)}{r.device === 'mobile' && <span className="adm-muted"> · phone</span>}
                {r.email && <div><button type="button" className="adm-link" onClick={() => onOpenUser(r.user_id)}>{r.email}</button></div>}</td>
              <td>{r.channel}{r.referrer && r.channel !== 'Direct' && <div className="adm-muted sum-sub">{r.referrer}</div>}</td>
              <td className="adm-mono sum-path" title={r.landing}>{r.landing}</td>
              <td><Steps steps={r.steps} /></td>
            </tr>))}</tbody>
        </table></div>
      )}
    </Card>
  </>;
}
