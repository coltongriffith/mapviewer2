import React from 'react';
import { StatTile, EmptyHint, Card, ColumnChart } from './primitives';
import { fmtNum } from './metrics';

export function cohortRate(n, total) {
  return Number(total) > 0 ? `${fmtNum(n)} of ${fmtNum(total)}` : 'Not ready';
}
const money = cents => (Number(cents) / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });

export default function GrowthTab({ data, onOpenUser, daily, onPickDay }) {
  const f = data.funnel;
  const c = data.cohort;
  const b = data.billing;
  const friction = data.friction;
  const steps = [
    ['Tracked sessions', f.sessions], ['Opened editor', f.opened],
    ['Imported real data', f.imported], ['Exported after import', f.exported],
  ];
  return <>
    <div className="growth-heading">
      <h1>Useful maps. Paying customers. Repeat use.</h1>
      <p>Follow the path from a prospect’s first map to a recurring subscription.</p>
    </div>
    <div className="growth-tiles">
      <StatTile label="Active subscriptions" value={fmtNum(b.active_subscribers)} accent="#287454"
        detail="Current Stripe status · trials and free Pro excluded" />
      <StatTile label="Estimated MRR · USD" value={money(b.estimated_mrr_cents)} accent="#287454"
        tip="Current active subscriptions × $29/month or $290/year ÷ 12. Catalog estimate; discounts, taxes, refunds and actual collections are not in this number."
        detail={b.unknown_interval ? `${b.unknown_interval} missing intervals excluded` : 'Catalog prices · not collected revenue'} />
      <StatTile label="Confirmed real-data exports" value={fmtNum(data.exports.real)}
        detail={`${fmtNum(data.exports.total)} completed exports · ${fmtNum(data.exports.unclassified)} unclassified`} />
      <StatTile label="Returned in week two" value={cohortRate(c.returned, c.return_eligible)}
        detail={`${fmtNum(c.return_pending)} accounts still pending · signup cohort below`} />
    </div>
    {(b.past_due > 0 || b.stale_periods > 0) && <p className="adm-error-bar" role="status">
      Billing needs a check: {b.past_due} past due; {b.stale_periods} active records with an ended billing period. Review Revenue and Stripe.
    </p>}
    {daily && (
      <Card title="Daily activity" eyebrow="Visitor tabs per Pacific day · click a bar to inspect that day" full>
        {daily.error ? <p className="adm-error-bar" role="alert">Could not load daily activity: {daily.error}</p>
          : daily.loading || !daily.data ? <div className="adm-skeleton adm-skeleton-block" style={{ height: 200 }} role="status" aria-label="Loading daily activity" />
          : <ColumnChart series={daily.data} onPick={onPickDay}
              barKey="sessions" barLabel="visitor tabs" lineKey="active_users" lineLabel="signed-in users"
              ariaLabel="Daily visitor tabs" empty="No tracked visits in this window." />}
        <p className="admx-since-note">A visitor tab is one browser tab with at least one recorded page view; known admin activity is excluded. Signed-in users are accounts that did something in the editor that day. Signup dots mark confirmed accounts.</p>
      </Card>
    )}
    <div className="growth-grid">
      <Card title="First-map journey" eyebrow="Same tab session · steps in order">
        {f.sessions === 0 ? <EmptyHint>No sessions in this window. Use tagged links in your next working sessions.</EmptyHint> : <ol className="growth-funnel">
          {steps.map(([label, n], i) => <li key={label}>
            <div><span>{label}</span><strong>{fmtNum(n)}</strong></div>
            <div className="growth-track" aria-hidden="true"><span style={{ width: `${Math.max(0, Math.min(100, n / f.sessions * 100))}%` }} /></div>
            {i > 0 && <small>{fmtNum(n)} of {fmtNum(steps[i - 1][1])} at the previous step</small>}
          </li>)}
        </ol>}
        <p className="admx-since-note">{fmtNum(f.real_exported)} of those sessions explicitly confirmed real data in the exported map. Importing and exporting in one tab alone does not prove it was the same map.</p>
        <p className="admx-since-note">Sessions are browser tabs, not people. Known admin activity is excluded; unidentified tests, bots and blocked tracking remain limitations.</p>
      </Card>
      <Card title="Next customer actions" eyebrow="Decisions from this window">
        <ul className="growth-actions">
          {friction.export_failures > 0 && <li><strong>Resolve failed exports.</strong> {fmtNum(friction.export_failures)} failures were recorded. Check Health and the session timelines.</li>}
          {f.imported > f.exported && <li><strong>Watch someone finish a map.</strong> {fmtNum(f.imported - f.exported)} sessions imported data without a later export in this window. Observe a working session to learn why.</li>}
          <li><strong>Start with recurring map makers.</strong> Use your mining network to reach consultants and IR/design teams. Build a map with their claims and ask for a paid subscription when the result is useful.</li>
          <li><strong>Track the source of each conversation.</strong> Use campaign links such as <code>?utm_source=founder&amp;utm_medium=outreach&amp;utm_campaign=first_customers</code>. Conversations and demos need a separate sales record.</li>
        </ul>
        <div className="growth-signals"><span><b>{fmtNum(friction.pro_gate_sessions)}</b> sessions saw a Pro gate</span><span><b>{fmtNum(friction.checkout_sessions)}</b> started checkout</span></div>
        <p className="admx-since-note">These are intent signals. Subscription status above comes from the billing database. Spend and cash receipts are not connected, so CAC and ROAS are not calculated.</p>
      </Card>
    </div>
    <Card title="New-account cohort" eyebrow="Accounts whose email was confirmed in the selected window" full>
      <div className="growth-cohort">
        <div><strong>{fmtNum(c.signups)}</strong><span>Confirmed accounts</span></div>
        <div><strong>{cohortRate(c.current_subscribers, c.signups)}</strong><span>Currently active on Stripe</span></div>
        <div><strong>{cohortRate(c.activated, c.activation_eligible)}</strong><span>Real-data export within seven days</span></div>
        <div><strong>{cohortRate(c.returned, c.return_eligible)}</strong><span>Used the product on days 7–13</span></div>
      </div>
      <p className="admx-since-note">Export activation waits seven complete days; week-two return waits fourteen, measured at the end of this window. Return means recorded editor or tenure activity, not just signing in. Anonymous work is not automatically linked across devices.</p>
      <p className="admx-since-note">Real-data export tracking began September 5, 2026. {fmtNum(c.activation_pending)} accounts are pending and {fmtNum(c.activation_untracked)} predate that tracking. Earlier exports remain unclassified. Current subscribers are a present-day snapshot, not a historical purchase-conversion rate.</p>
    </Card>
    <div className="growth-grid">
      <Card title="Sources that produce maps" eyebrow="Top 30 · first recorded page in each tab within this window">
        {!data.sources.length ? <EmptyHint>No source data in this window.</EmptyHint> : <div className="adm-table-scroll"><table className="adm-table">
          <thead><tr><th>Source / medium</th><th>Sessions</th><th>Editor</th><th>Import</th><th>Export</th></tr></thead>
          <tbody>{data.sources.map(s => <tr key={s.source}><th scope="row">{s.source}</th><td>{fmtNum(s.sessions)}</td><td>{fmtNum(s.opened)}</td><td>{fmtNum(s.imported)}</td><td>{fmtNum(s.exported)}</td></tr>)}</tbody>
        </table></div>}
        <p className="admx-since-note">Steps follow the same sequence as the first-map journey. Unattributed includes direct, missing and blocked attribution; it is not proof of direct traffic.</p>
      </Card>
      <Card title="Sources that produce accounts" eyebrow="Signup-time first touch · same new-account cohort">
        {!data.signup_sources.length ? <EmptyHint>No confirmed accounts in this window.</EmptyHint> : <div className="adm-table-scroll"><table className="adm-table">
          <thead><tr><th>Source / medium</th><th>Accounts</th><th>Active subscriptions now</th></tr></thead>
          <tbody>{data.signup_sources.map(s => <tr key={s.source}><th scope="row">{s.source}</th><td>{fmtNum(s.signups)}</td><td>{fmtNum(s.current_subscribers)}</td></tr>)}</tbody>
        </table></div>}
        <p className="admx-since-note">Signup attribution is stored browser context, not a verified ad-platform report. Its account cohort differs from the session cohort on the left.</p>
      </Card>
    </div>
    <Card title="Free customers getting value" eyebrow="Confirmed real-data exports in this window · up to 10 accounts" full>
      {!data.follow_up.length ? <EmptyHint>No qualifying accounts recorded yet. Use working sessions to establish the first useful-map → paid-customer examples.</EmptyHint> : <div className="adm-table-scroll"><table className="adm-table">
        <thead><tr><th>Account</th><th>Real-data exports</th><th>Next step</th></tr></thead>
        <tbody>{data.follow_up.map(u => <tr key={u.user_id}><td><button className="admx-feed-link" onClick={() => onOpenUser(u.user_id)}>{u.email}</button></td><td>{fmtNum(u.exports)}</td><td>Review their work and discuss recurring needs.</td></tr>)}</tbody>
      </table></div>}
    </Card>
  </>;
}
