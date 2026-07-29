import React from 'react';
import { StatTile, InfoTip, EmptyHint } from './primitives';
import { fmtNum, fmtDate, relTime } from './metrics';

const Card = ({ title, tip, eyebrow, count, children, full }) => (
  <section className={`adm-card${full ? ' adm-card-full' : ''}`}>
    <div className="adm-card-head">
      <div>{eyebrow && <div className="admx-eyebrow">{eyebrow}</div>}
        <h3 className="adm-card-title">{title}{tip && <InfoTip text={tip} label={title} />}</h3></div>
      {count != null && <span className="adm-pill">{count}</span>}
    </div>
    {children}
  </section>
);

function fmtMoney(cents, currency = 'USD') {
  if (cents == null) return '—';
  return (Number(cents) / 100).toLocaleString('en-US', { style: 'currency', currency: currency || 'USD' });
}

const SOURCE_LABEL = { stripe: 'Paid', grandfathered: 'Grandfathered', admin: 'Admin-granted' };
const STATUS_COLOR = { active: '#16a34a', trialing: '#0891b2', past_due: '#d97706', canceled: '#64748b', incomplete: '#94a3b8' };

function PlanBadge({ plan, source, status }) {
  if (plan !== 'pro') return <span className="admx-badge" style={{ color: '#64748b', background: '#64748b1a' }}>Free</span>;
  const color = STATUS_COLOR[status] || '#334155';
  return (
    <span className="admx-badge" style={{ color, background: `${color}1a` }}>
      Pro — {SOURCE_LABEL[source] || source}{status && status !== 'active' ? ` (${status})` : ''}
    </span>
  );
}

/**
 * Real billing analytics. Replaces the pre-launch "Monetization" tab, whose
 * only signal was "exported without a watermark" — a proxy for paid intent
 * invented before there was anyone to actually pay. Stripe is live now,
 * so this reads user_plans/custom_invoices directly: real subscribers, real
 * MRR, real invoices. The one thing worth keeping from the old tab — clean
 * exporters as upsell targets — is kept, but now correctly excludes anyone
 * who has already subscribed.
 */
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
        <StatTile label="MRR" accent="#16a34a"
          value={fmtMoney(data?.mrr_cents)}
          detail={unknownInterval > 0 ? `${unknownInterval} subscriber${unknownInterval === 1 ? '' : 's'} missing billing interval — undercounted` : 'paying subscribers only'} />
        <StatTile label="ARR" accent="#16a34a" value={fmtMoney((data?.mrr_cents || 0) * 12)} detail="MRR × 12" />
        <StatTile label="Paying subscribers" accent="#2563eb" value={fmtNum(data?.paying_subscribers ?? 0)} detail="active + trialing, Stripe-sourced only" />
        <StatTile label="New (30d)" accent="#0891b2" value={fmtNum(data?.new_subscribers_30d ?? 0)} />
        <StatTile label="Canceled (30d)" accent="#dc2626" value={fmtNum(data?.canceled_30d ?? 0)} />
        <StatTile label="Refunded" accent="#d97706" value={fmtMoney(data?.refunded_cents_total)} detail="lifetime, custom invoices" />
      </div>

      <Card title="Plan breakdown" eyebrow="All registered accounts">
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
              {subscribers.slice(0, 50).map((s) => (
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
            <thead><tr><th>User</th><th>Number</th><th>Status</th><th>Amount</th><th>Refunded</th><th>Created</th></tr></thead>
            <tbody>
              {invoices.slice(0, 50).map((inv) => (
                <tr key={inv.stripe_invoice_id}>
                  <td className="adm-mono adm-truncate">{inv.email || <span className="adm-muted">—</span>}</td>
                  <td>{inv.hosted_invoice_url
                    ? <a href={inv.hosted_invoice_url} target="_blank" rel="noopener noreferrer">{inv.number || inv.stripe_invoice_id}</a>
                    : (inv.number || inv.stripe_invoice_id)}</td>
                  <td><span className={inv.status === 'paid' ? 'admx-tag-clean' : 'adm-muted'}>{inv.status}</span></td>
                  <td>{fmtMoney(inv.amount_due, inv.currency)}</td>
                  <td className="adm-muted">{inv.amount_refunded > 0 ? fmtMoney(inv.amount_refunded, inv.currency) : '—'}</td>
                  <td className="adm-muted">{fmtDate(inv.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card title="Upsell candidates" tip="Free-plan users who already export clean (no watermark) — the clearest signal that they'd get more value from Pro. Excludes anyone already subscribed." eyebrow="Free plan · exports clean" count={upsell.length} full>
        {upsell.length === 0 ? <EmptyHint>No free-plan users exporting clean yet.</EmptyHint> : (
          <table className="adm-table">
            <thead><tr><th>User</th><th>Clean exports</th><th>Last export</th></tr></thead>
            <tbody>
              {upsell.map((u) => (
                <tr key={u.user_id}>
                  <td className="adm-mono adm-truncate">{u.email}</td>
                  <td><strong>{fmtNum(u.clean_exports)}</strong></td>
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
