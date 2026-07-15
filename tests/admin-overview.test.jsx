import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import OverviewTab from '../src/components/admin/OverviewTab';
import { DeltaChip } from '../src/components/admin/primitives';

const noop = () => {};
const base = (over = {}) => ({
  kpis: {
    active_today: 0, active_yesterday: 0, active_7d_avg: 0,
    signups: { cur: 0, prev: 0 },
    activated: { done: 0, of: 3, pending: 2 },
    actions: { cur: 0, prev: 0, users: 0, kinds: [] },
    maps: { created: 0, worked_on: 0, exports: 0, failures: 0, prev_exports: 0 },
    returning: { cur: 0, of_active: 0, prev: 0 },
  },
  daily: [], spark: {}, checklist: [], needs_attention: { never_activated: [], went_quiet: [] },
  most_active: [], feed: [], since: {}, meta: { instrumentation_date: '2026-07-13' },
  ...over,
});

describe('OverviewTab rendering', () => {
  it('shows skeletons while loading (null data)', () => {
    const { container } = render(
      <OverviewTab data={null} loading range={30} onRange={noop} onPickDay={noop} onOpenSession={noop} onOpenUser={noop} />
    );
    expect(container.querySelectorAll('.adm-skeleton').length).toBeGreaterThan(0);
  });

  it('renders EmptyHints (not zero-frames) on an empty-but-valid payload', () => {
    render(<OverviewTab data={base()} loading={false} range={30} onRange={noop} onPickDay={noop} onOpenSession={noop} onOpenUser={noop} />);
    expect(screen.getByText(/No signups in the last 14 days/i)).toBeInTheDocument();
    expect(screen.getByText(/Product actions will stream here/i)).toBeInTheDocument();
    // celebratory needs-attention empty state
    expect(screen.getByText(/Nobody needs outreach/i)).toBeInTheDocument();
  });

  it('renders the activated tile as "0 of 3", never "0%"', () => {
    render(<OverviewTab data={base()} loading={false} range={30} onRange={noop} onPickDay={noop} onOpenSession={noop} onOpenUser={noop} />);
    expect(screen.getByText('0 of 3')).toBeInTheDocument();
    expect(screen.queryByText(/0%/)).not.toBeInTheDocument();
  });

  it('tints a stalled recent-signup row amber and links a mailto for outreach', () => {
    const data = base({
      checklist: [{ user_id: 'u1', email: 'stalled@acme.com', signed_up_at: '2026-07-10', days_ago: 5, opened: true, added_data: false, map_work: false, artifact: false, activated: false }],
      needs_attention: { never_activated: [{ user_id: 'u2', email: 'lapsed@acme.com', created_at: '2026-07-01' }], went_quiet: [] },
    });
    const { container } = render(<OverviewTab data={data} loading={false} range={30} onRange={noop} onPickDay={noop} onOpenSession={noop} onOpenUser={noop} />);
    expect(container.querySelector('.admx-row-amber')).toBeTruthy();
    expect(container.querySelector('a[href="mailto:lapsed@acme.com"]')).toBeTruthy();
  });

  it('coalesces repeated share views with a ×N pill in the feed', () => {
    const data = base({
      feed: [{ event_time: '2026-07-14T10:00:00Z', kind: 'share_viewed', actor: null, session_id: null, meta: { mapId: 'abc', n: 4 } }],
    });
    render(<OverviewTab data={data} loading={false} range={30} onRange={noop} onPickDay={noop} onOpenSession={noop} onOpenUser={noop} />);
    expect(screen.getByText(/×4/)).toBeInTheDocument();
  });
});

describe('DeltaChip', () => {
  it('renders nothing when both windows are zero', () => {
    const { container } = render(<DeltaChip cur={0} prior={0} />);
    expect(container.firstChild).toBeNull();
  });
  it('renders "+3 new" against a zero prior', () => {
    render(<DeltaChip cur={3} prior={0} />);
    expect(screen.getByText('+3 new')).toBeInTheDocument();
  });
});
