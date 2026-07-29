import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import RevenueTab from '../src/components/admin/RevenueTab';

const base = (over = {}) => ({
  plan_counts: { free: 0, pro_stripe: 0, pro_grandfathered: 0, pro_admin: 0 },
  status_counts: {},
  mrr_cents: 0,
  paying_subscribers: 0,
  unknown_interval_subscribers: 0,
  new_subscribers_30d: 0,
  canceled_30d: 0,
  subscribers: [],
  invoices: [],
  refunded_cents_total: 0,
  upsell_candidates: [],
  ...over,
});

describe('RevenueTab rendering', () => {
  it('shows a skeleton while loading', () => {
    const { container } = render(<RevenueTab data={null} loading />);
    expect(container.querySelectorAll('.adm-skeleton').length).toBeGreaterThan(0);
  });

  it('renders EmptyHints (not zero-frames) on an empty-but-valid payload', () => {
    render(<RevenueTab data={base()} loading={false} />);
    expect(screen.getByText(/No Pro accounts yet/i)).toBeInTheDocument();
    expect(screen.getByText(/No custom invoices yet/i)).toBeInTheDocument();
    expect(screen.getByText(/No free-plan users exporting clean yet/i)).toBeInTheDocument();
  });

  it('formats MRR/ARR as currency, not raw cents', () => {
    render(<RevenueTab data={base({ mrr_cents: 2900 })} loading={false} />);
    expect(screen.getByText('$29.00')).toBeInTheDocument(); // MRR
    expect(screen.getByText('$348.00')).toBeInTheDocument(); // ARR = MRR * 12
  });

  it('flags subscribers with an unknown billing interval instead of silently undercounting', () => {
    render(<RevenueTab data={base({ mrr_cents: 2900, unknown_interval_subscribers: 1 })} loading={false} />);
    expect(screen.getByText(/missing billing interval — undercounted/i)).toBeInTheDocument();
  });

  it('never counts grandfathered/admin accounts as paying — labels them distinctly in the subscriber table', () => {
    const data = base({
      plan_counts: { free: 2, pro_stripe: 1, pro_grandfathered: 3, pro_admin: 0 },
      subscribers: [
        { user_id: '1', email: 'payer@x.com', status: 'active', source: 'stripe', billing_interval: 'month', stripe_customer_id: 'cus_1', current_period_end: null, pro_since: '2026-07-01T00:00:00Z' },
        { user_id: '2', email: 'gf@x.com', status: 'active', source: 'grandfathered', billing_interval: null, stripe_customer_id: null, current_period_end: null, pro_since: '2026-06-01T00:00:00Z' },
      ],
    });
    render(<RevenueTab data={data} loading={false} />);
    expect(screen.getByText(/Pro — Paid/)).toBeInTheDocument();
    expect(screen.getByText(/Pro — Grandfathered/)).toBeInTheDocument();
  });

  it('renders the upsell list as free-plan users, never subscribers', () => {
    const data = base({
      upsell_candidates: [{ user_id: '9', email: 'lead@x.com', clean_exports: 4, last_export: '2026-07-20T00:00:00Z' }],
    });
    render(<RevenueTab data={data} loading={false} />);
    expect(screen.getByText('lead@x.com')).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument();
  });
});
