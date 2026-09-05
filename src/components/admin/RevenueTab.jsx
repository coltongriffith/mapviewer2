import React from 'react';
import { Card, StatTile, EmptyHint } from './primitives';
import { fmtNum, fmtDate, relTime } from './metrics';


function fmtMoney(cents, currency = 'USD') {
  if (cents == null) return '—';
  return (Number(cents) / 100).toLocaleString('en-US', { style: 'currency', currency: currency || 'USD' });
}

const SOURCE_LABEL = { stripe: 'Paid', grandfathered: 'Grandfathered', admin: 'Admin-granted' };
const STATUS_COLOR = { active: '#287454', trialing: '#176b87', past_due: '#9a6715', canceled: '#5f6e72', incomplete: '#7c898c' };

function PlanBadge({ plan, source, status }) {
  if (plan !== 'pro') return <span className="admx-badge" style={{ color: '#5f6e72', background: '#5f6e721a' }}>Free</span>;
  const color = STATUS_COLOR[status] || '#435459';
  return (
    <span className="admx-badge" style={{ color, background: `${color}1a` }}>
      Pro — {SOURCE_LABEL[source] || source}{status && status !== 'active' ? ` (${status})` : ''}
    </span>
  );
}

// Current subscription state and standalone invoices. Catalog MRR is an
// estimate; trials and complimentary plans are displayed separately.
export default function RevenueTab({ data, loading }) {
  if (loading) return <Card title="Revenue"><div className="adm-skeleton adm-skeleton-block" style={{ height: 160 }} /></Card>;

  const pc = data?.plan_counts || {};
  const proTotal = (pc.pro_stripe || 0) + (pc.pro_grandfathered || 0) + (pc.pro_admin || 0);
  const subscribers = data?.subscribers || [];
  const invoices = data?.invoices || [];
  const upsell = data?.upsell_candidates || [];
  const unknownInterval = Number(data?.unknown_interval_subscribers || 0);

  return (
    <>
      <div className="admx-tile-row">
        <StatTile label="Estimated MRR · USD" accent="#287454"
          value={fmtMoney(data?.mrr_cents)}
          detail={unknownInterval > 0 ? `${unknownInterval} subscriber${unknownInterval === 1 ? '' : 's'} missing billing interval — undercounted` : 'Catalog prices · excludes trials and free Pro'} />
        <StatTile label="Estimated ARR · USD" accent="#287454" value={fmtMoney((data?.mrr_cents || 0) * 12)} detail="MRR × 12" />
        <StatTile label="Active subscriptions" accent="#142126" value={fmtNum(data?.paying_subscribers ?? 0)} detail="Stripe status active · excludes trials" />
        <StatTile label="Active, started in 30d" accent="#176b87" value={fmtNum(data?.new_subscribers_30d ?? 0)} />
        <StatTile label="Canceled, updated in 30d" accent="#aa3e3e" value={fmtNum(data?.canceled_30d ?? 0)} />
        <StatTile label="Trials / past due" accent="#9a6715" value={`${data?.trial_subscribers || 0} / ${data?.past_due_subscribers || 0}`} detail="Excluded from estimated MRR" />
      </div>

      <p className="admx-since-note">MRR uses the current USD catalog ($29 monthly or $290 yearly ÷ 12). Discounts, tax, actual collections and refunds are not included. Canceled counts reflect the last record update, not a historical churn ledger. Known administrators are excluded.</p>
      <Card title="Custom invoice refunds" eyebrow="Lifetime · currencies kept separate">
        {data?.refunds_by_currency?.length ? data.refunds_by_currency.map(r => <p key={r.currency}>{r.currency}: {fmtMoney(r.cents, r.currency)}</p>) : <EmptyHint>No recorded custom invoice refunds.</EmptyHint>}
      </Card>
      <Card title="Plan breakdown" eyebrow="Non-admin accounts">
        <div className="admx-health">
          <div className="admx-health-stat"><strong>{fmtNum(pc.free ?? 0)}</strong><span>Free</span></div>
          <div className="admx-health-stat"><strong>{fmtNum(proTotal)}</strong><span>Pro (total)</span></div>
          <div className="admx-health-stat"><strong>{fmtNum(pc.pro_stripe ?? 0)}</strong><span>— paid</span></div>
          <div className="admx-health-stat"><strong>{fmtNum(pc.pro_grandfathered ?? 0)}</strong><span>— grandfathered</span></div>
          <div className="admx-health-stat"><strong>{fmtNum(pc.pro_admin ?? 0)}</strong><span>— admin-granted</span></div>
        </div>
        <p className="admx-since-note">Grandfathered and admin-granted accounts are free Pro forever by design — they never count toward MRR or paying-subscriber figures above.</p>
      </Card>

      <Card title="Subscribers" eyebrow="Every Pro account" count={subscribers.length} full>
        {subscribers.length === 0 ? <EmptyHint>No Pro accounts yet.</EmptyHint> : (
          <table className="adm-table">
            <thead><tr><th>User</th><th>Plan</th><th>Interval</th><th>Pro since</th><th>Current period ends</th><th>Stripe customer</th></tr></thead>
            <tbody>
              {subscribers.map((s) => (
                <tr key={s.user_id}>
                  <td className="adm-mono adm-truncate">{s.email}</td>
                  <td><PlanBadge plan="pro" source={s.source} status={s.status} /></td>
                  <td className="adm-muted">{s.billing_interval ? (s.billing_interval === 'year' ? 'Yearly' : 'Monthly') : '—'}</td>
                  <td className="adm-muted">{s.pro_since ? relTime(s.pro_since) : '—'}</td>
                  <td className="adm-muted">{s.current_period_end ? fmtDate(s.current_period_end) : '—'}</td>
                  <td className="adm-mono adm-muted">{s.stripe_customer_id || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card title="Custom invoices" tip="One-off Stripe Invoicing — bespoke work outside the self-serve subscription. See docs/billing.md." eyebrow="Most recent 100" count={invoices.length} full>
        {invoices.length === 0 ? <EmptyHint>No custom invoices yet.</EmptyHint> : (
          <table className="adm-table">
            <thead><tr><th>User</th><th>Number</th><th>Status</th><th>Amount due</th><th>Paid</th><th>Refunded</th><th>Created</th></tr></thead>
            <tbody>
              {invoices.map((inv) => (
                <tr key={inv.stripe_invoice_id}>
                  <td className="adm-mono adm-truncate">{inv.email || <span className="adm-muted">—</span>}</td>
                  <td>{inv.hosted_invoice_url
                    ? <a href={inv.hosted_invoice_url} target="_blank" rel="noopener noreferrer">{inv.number || inv.stripe_invoice_id}</a>
                    : (inv.number || inv.stripe_invoice_id)}</td>
                  <td><span className={inv.status === 'paid' ? 'admx-tag-clean' : 'adm-muted'}>{inv.status}</span></td>
                  <td>{fmtMoney(inv.amount_due, inv.currency)}</td><td>{fmtMoney(inv.amount_paid, inv.currency)}</td>
                  <td className="adm-muted">{inv.amount_refunded > 0 ? fmtMoney(inv.amount_refunded, inv.currency) : '—'}</td>
                  <td className="adm-muted">{fmtDate(inv.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card title="Free customers getting value" tip="Free accounts with an explicitly recorded real-data export. Removing the large watermark alone is not a paid-intent signal." eyebrow="Last 30 days · real-data tracking began September 5" count={upsell.length} full>
        {upsell.length === 0 ? <EmptyHint>No qualifying real-data exports from free accounts yet.</EmptyHint> : (
          <table className="adm-table">
            <thead><tr><th>User</th><th>Real-data exports</th><th>Last export</th></tr></thead>
            <tbody>
              {upsell.map((u) => (
                <tr key={u.user_id}>
                  <td className="adm-mono adm-truncate">{u.email}</td>
                  <td><strong>{fmtNum(u.exports)}</strong></td>
                  <td className="adm-muted">{relTime(u.last_export)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}
