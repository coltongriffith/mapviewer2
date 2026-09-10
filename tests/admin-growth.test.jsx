import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import GrowthTab, { cohortRate } from '../src/components/admin/GrowthTab';
import { growthReport } from './fixtures/growth-report';

describe('growth dashboard', () => {
  it('shows explicit cohort denominators and distinguishes estimated revenue', () => {
    render(<GrowthTab data={growthReport} onOpenUser={() => {}} />);
    expect(screen.getByText('Estimated MRR · USD')).toBeInTheDocument();
    expect(screen.getByText('$58.00')).toBeInTheDocument();
    expect(screen.getByText('3 of 8 at the previous step')).toBeInTheDocument();
    expect(screen.getByText(/1 unclassified/)).toBeInTheDocument();
    expect(screen.getByText('1 of 3')).toBeInTheDocument();
    expect(screen.queryByText(/ROAS\s*[0-9]/)).not.toBeInTheDocument();
  });
  it('opens a value-producing account without sending outreach', () => {
    const open = vi.fn();
    render(<GrowthTab data={growthReport} onOpenUser={open} />);
    fireEvent.click(screen.getByRole('button', { name: 'prospect@example.test' }));
    expect(open).toHaveBeenCalledWith(growthReport.follow_up[0].user_id);
  });
  it('charts daily visitor tabs on the landing tab, not signed-in users only', () => {
    // Signed-in active users (admins excluded) is zero on almost every day of a
    // young product, so a chart of that alone reads as "no data" while dozens
    // of visitor tabs a day go unseen. Bars are visitor tabs here.
    const daily = { loading: false, error: null, data: [
      { d: '2026-09-01T00:00:00+00:00', sessions: 22, page_views: 40, active_users: 0, signups: 0 },
      { d: '2026-09-02T00:00:00+00:00', sessions: 33, page_views: 51, active_users: 1, signups: 1 },
    ] };
    const pick = vi.fn();
    render(<GrowthTab data={growthReport} onOpenUser={() => {}} daily={daily} onPickDay={pick} />);
    expect(screen.getByRole('img', { name: 'Daily visitor tabs' })).toBeInTheDocument();
    expect(screen.getByText('visitor tabs')).toBeInTheDocument();
    expect(screen.getByText('signed-in users')).toBeInTheDocument();
    expect(screen.getByText('signups')).toBeInTheDocument();
    const bars = document.querySelectorAll('rect.admx-col-bar');
    expect(bars).toHaveLength(2);
    // Tallest bar is the 33-tab day, not a zero-height signed-in bar.
    expect(Number(bars[1].getAttribute('height'))).toBeGreaterThan(Number(bars[0].getAttribute('height')));
    expect(Number(bars[0].getAttribute('height'))).toBeGreaterThan(0);
    fireEvent.click(bars[0]);
    expect(pick).toHaveBeenCalledWith('2026-09-01');
  });
  it('shows the daily chart failure without hiding the rest of the report', () => {
    render(<GrowthTab data={growthReport} onOpenUser={() => {}} daily={{ loading: false, error: 'boom', data: null }} />);
    expect(screen.getByRole('alert')).toHaveTextContent('boom');
    expect(screen.getByText('Estimated MRR · USD')).toBeInTheDocument();
  });
  it('never turns an immature cohort into a zero-percent failure', () => {
    expect(cohortRate(0,0)).toBe('Not ready');
    expect(cohortRate(0,3)).toBe('0 of 3');
  });
});
