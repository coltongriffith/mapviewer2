import React from 'react';
import { render, screen, within } from '@testing-library/react';
import { expect, it } from 'vitest';
import TenureTab from '../src/components/admin/TenureTab';

it.each([
  ['company', 19, '19 / 500', false], ['company', 400, '400 / 500', true],
  ['pro', 19, '19 / 50', false], ['pro', 40, '40 / 50', true],
  ['free', 7, '7 / 10', false], ['free', 8, '8 / 10', true],
])('shows the %s monitoring quota and warning at %i claims', (plan, monitored, count, nearLimit) => {
  render(<TenureTab loading={false} data={{ portfolios: [{
    portfolio_id: 'portfolio', name: 'Test portfolio', plan, monitored,
    alerts_paused: false, created_at: '2026-10-01T00:00:00Z',
  }] }} />);
  const row = screen.getByText('Test portfolio').closest('tr');
  expect(within(row).getByText(`${count}${nearLimit ? ' — near limit' : ''}`)).toBeInTheDocument();
  if (!nearLimit) expect(within(row).queryByText(/near limit/)).not.toBeInTheDocument();
});
