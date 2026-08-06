import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { ENTITLEMENTS, TIERS } from '../src/utils/entitlements';

// Can a user who already has one group of claims make a second one?
//
// THE BUG THIS EXISTS FOR. "Create a portfolio" lived only inside the
// onboarding branch — `{!active ? <onboarding/> : <portfolio/>}`. The moment a
// first portfolio existed, `active` became truthy, that branch stopped
// rendering, and the control vanished from the entire product. The picker was
// gated on `portfolios.length > 1`, a condition that could then never be
// reached. So Pro's "unlimited portfolios" entitlement and the
// create_monitored_portfolio RPC were both live and both unreachable.
//
// No unit test could have caught it: every function involved was correct. The
// defect was in which branch the button was in, so the test has to render.

vi.mock('../src/utils/track', () => ({ trackEvent: vi.fn(), trackSearch: vi.fn() }));

const authState = { user: { id: 'u1' }, entitlements: ENTITLEMENTS[TIERS.PRO], tier: TIERS.PRO };
vi.mock('../src/hooks/useAuth', () => ({ useAuth: () => authState }));

// Leaflet does not run in jsdom, and the map is not what is under test here.
vi.mock('../src/components/tenure/TenureMap', () => ({
  default: () => null,
  COLOUR_BY: [{ id: 'urgency', label: 'Urgency' }],
}));

const portfolios = [];
vi.mock('../src/utils/tenureMonitor', () => ({
  listPortfolios: vi.fn(async () => portfolios),
  createPortfolio: vi.fn(async () => 'p2'),
  listPortfolioTenures: vi.fn(async () => []),
  portfolioSummary: vi.fn(async () => ({ total_tenures: 0, total_hectares: 0 })),
  portfolioChangeFeed: vi.fn(async () => []),
  addTenures: vi.fn(), removeTenure: vi.fn(), updateMembership: vi.fn(),
  lastSync: vi.fn(async () => null),
  activeSystemNotice: vi.fn(async () => null),
  fetchTenureGeometry: vi.fn(async () => []),
  searchTenures: vi.fn(async () => ({ results: [] })),
}));

async function renderPage(list, entitlements = ENTITLEMENTS[TIERS.PRO]) {
  portfolios.length = 0;
  portfolios.push(...list);
  authState.entitlements = entitlements;
  const { default: TenureMonitorPage } = await import('../src/components/tenure/TenureMonitorPage.jsx');
  return render(<TenureMonitorPage onExit={vi.fn()} onUpgrade={vi.fn()} />);
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({}) })));
});

describe('creating more than one group of claims', () => {
  it('offers a way in from the empty state', async () => {
    await renderPage([]);
    expect(await screen.findByRole('button', { name: /create a claim group/i })).toBeTruthy();
  });

  it('still offers one once a group already exists', async () => {
    // The regression. Before the fix this found nothing: the only create
    // control was in a branch that had stopped rendering.
    await renderPage([{ id: 'p1', name: 'Golden Triangle', alert_policy_id: 'a1' }]);
    expect(await screen.findByRole('button', { name: /new group/i })).toBeTruthy();
  });

  it('shows a picker to switch between them', async () => {
    await renderPage([
      { id: 'p1', name: 'Golden Triangle', alert_policy_id: 'a1' },
      { id: 'p2', name: 'Cariboo', alert_policy_id: 'a2' },
    ]);
    const picker = await screen.findByLabelText(/claim group/i);
    expect([...picker.options].map((o) => o.textContent))
      .toEqual(['Golden Triangle', 'Cariboo']);
  });

  it('keeps the control visible for a plan that cannot use it', async () => {
    // Shown and routed to the upgrade prompt rather than hidden — the same
    // choice the reminder settings make with locked thresholds. Hiding it makes
    // the product look less capable than it is and the upgrade invisible.
    await renderPage(
      [{ id: 'p1', name: 'My B.C. claims', alert_policy_id: 'a1' }],
      ENTITLEMENTS[TIERS.FREE],
    );
    await waitFor(() => expect(screen.getByRole('button', { name: /new group/i })).toBeTruthy());
  });
});
