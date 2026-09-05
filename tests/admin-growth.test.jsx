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
  it('never turns an immature cohort into a zero-percent failure', () => {
    expect(cohortRate(0,0)).toBe('Not ready');
    expect(cohortRate(0,3)).toBe('0 of 3');
  });
});
