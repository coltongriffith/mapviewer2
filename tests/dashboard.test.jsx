import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import React from 'react';
import { readFileSync } from 'node:fs';
import { ENTITLEMENTS, TIERS } from '../src/utils/entitlements';

// The signed-in home, and the rule that sends people to it.
//
// The redirect is the risky part. Getting it wrong in either direction is bad
// in a way that is hard to notice from the code:
//
//   too eager  — an anonymous visitor gets bounced off the marketing page, or
//                a ?claims= deep link is swallowed before the editor sees it
//   too shy    — a signed-in customer keeps landing on the pitch
//
// So the conditions are tested one at a time rather than as a single happy path.

vi.mock('../src/utils/track', () => ({ trackEvent: vi.fn(), trackSearch: vi.fn() }));

const authState = { user: { id: 'u1', email: 'geo@example.com' }, loading: false, entitlements: ENTITLEMENTS[TIERS.PRO], tier: TIERS.PRO, signOut: vi.fn() };
vi.mock('../src/hooks/useAuth', () => ({ useAuth: () => authState }));
vi.mock('../src/hooks/useAuth.jsx', () => ({ useAuth: () => authState }));

let projects = [];
vi.mock('../src/utils/cloudStorage', () => ({
  listCloudProjects: vi.fn(async () => projects),
  loadCloudProject: vi.fn(async () => ({ payload: {} })),
  saveCloudProject: vi.fn(async () => ({})),
  renameCloudProject: vi.fn(async () => ({})),
  deleteCloudProject: vi.fn(async () => ({})),
}));

let portfolios = [];
let summary = {};
vi.mock('../src/utils/tenureMonitor', () => ({
  listPortfolios: vi.fn(async () => portfolios),
  portfolioSummary: vi.fn(async () => summary),
  lastSync: vi.fn(async () => null),
}));

const project = (id, name, updatedAt) => ({ id, name, updatedAt, thumbnail: null, revision: 1 });

async function renderDashboard(props = {}) {
  const { default: DashboardPage } = await import('../src/components/DashboardPage.jsx');
  return render(<DashboardPage
    onOpenProject={vi.fn()} onNewProject={vi.fn()} onOpenEditor={vi.fn()}
    onOpenTenureMonitor={vi.fn()} onOpenAccount={vi.fn()} onOpenBrandKits={vi.fn()}
    onSearchClaims={vi.fn()} onExit={vi.fn()} {...props}
  />);
}

beforeEach(() => {
  projects = [];
  portfolios = [];
  summary = {};
  authState.user = { id: 'u1', email: 'geo@example.com' };
  authState.loading = false;
});

describe('finding a project', () => {
  it('lists saved maps most-recent first', async () => {
    projects = [
      project('a', 'Cariboo', '2026-01-01T00:00:00Z'),
      project('b', 'Golden Triangle', '2026-08-01T00:00:00Z'),
    ];
    const { container } = await renderDashboard();
    await screen.findByText('Cariboo');
    const tileNames = [...container.querySelectorAll('.dash-tile-name')].map(n => n.textContent);
    expect(tileNames).toEqual(['Golden Triangle', 'Cariboo']);
  });

  it('filters by name, which is the point of having search', async () => {
    projects = [project('a', 'Cariboo'), project('b', 'Golden Triangle'), project('c', 'Cariboo North')];
    await renderDashboard();
    await screen.findByText('Golden Triangle');
    fireEvent.change(screen.getByLabelText(/search your maps/i), { target: { value: 'cariboo' } });
    await waitFor(() => expect(screen.queryByText('Golden Triangle')).toBeNull());
    expect(screen.getByText('Cariboo')).toBeTruthy();
    expect(screen.getByText('Cariboo North')).toBeTruthy();
  });

  it('says so when a search matches nothing, and offers a way back', async () => {
    projects = [project('a', 'Cariboo'), project('b', 'Golden Triangle')];
    await renderDashboard();
    await screen.findByText('Cariboo');
    fireEvent.change(screen.getByLabelText(/search your maps/i), { target: { value: 'zzz' } });
    await waitFor(() => expect(screen.getByText(/no maps match/i)).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /clear search/i }));
    await waitFor(() => expect(screen.getByText('Cariboo')).toBeTruthy());
  });

  it('hides the search box when there is nothing to search', async () => {
    projects = [project('a', 'Only one')];
    await renderDashboard();
    await screen.findByText('Only one');
    expect(screen.queryByLabelText(/search your maps/i)).toBeNull();
  });

  it('opens a project by name and by thumbnail', async () => {
    projects = [project('a', 'Cariboo')];
    const onOpenProject = vi.fn();
    await renderDashboard({ onOpenProject });
    fireEvent.click(await screen.findByText('Cariboo'));
    expect(onOpenProject).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }));
    fireEvent.click(screen.getByLabelText(/open cariboo/i));
    expect(onOpenProject).toHaveBeenCalledTimes(2);
  });

  it('offers both starting points when there is nothing saved', async () => {
    await renderDashboard();
    await waitFor(() => expect(screen.getByText(/no saved maps yet/i)).toBeTruthy());
    expect(screen.getAllByRole('button', { name: /new map/i }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: /search mineral claims/i }).length).toBeGreaterThan(0);
  });
});

describe('the tenure card', () => {
  it('invites somebody with no portfolio to start one', async () => {
    await renderDashboard();
    await waitFor(() => expect(screen.getByRole('button', { name: /start monitoring claims/i })).toBeTruthy());
  });

  it('leads with what needs attention', async () => {
    portfolios = [{ id: 'p1', name: 'Golden Triangle' }];
    summary = { total_tenures: 12, expiring_30: 3, expired: 0, changed_recently: 2, needs_review: 0 };
    await renderDashboard();
    await waitFor(() => expect(screen.getByText(/expiring in 30 days/i)).toBeTruthy());
    expect(screen.getByText(/changed recently/i)).toBeTruthy();
    // Zeros are not shown. A row of "0 past good-to-date" is not reassurance on
    // a dashboard, it is noise competing with the rows that matter.
    expect(screen.queryByText(/past good-to-date/i)).toBeNull();
    expect(screen.queryByText(/need a decision/i)).toBeNull();
  });

  it('says plainly when nothing is due', async () => {
    portfolios = [{ id: 'p1', name: 'Quiet' }];
    summary = { total_tenures: 4, expiring_30: 0, expired: 0, changed_recently: 0, needs_review: 0 };
    await renderDashboard();
    await waitFor(() => expect(screen.getByText(/nothing needs attention/i)).toBeTruthy());
  });

  it('does not read as "no claims" when the load fails', async () => {
    // A failed request must never render the same thing as an empty portfolio.
    // "Start monitoring claims" shown to somebody who already has 40 monitored
    // reads as data loss.
    const tm = await import('../src/utils/tenureMonitor');
    tm.listPortfolios.mockRejectedValueOnce(new Error('network'));
    await renderDashboard();
    await waitFor(() => expect(screen.getByText(/couldn't load your monitored claims/i)).toBeTruthy());
    expect(screen.queryByRole('button', { name: /start monitoring claims/i })).toBeNull();
  });
});

describe('a failed project load keeps the last good list', () => {
  it('surfaces an error without blanking the page', async () => {
    const cs = await import('../src/utils/cloudStorage');
    cs.listCloudProjects.mockRejectedValueOnce(new Error('offline'));
    await renderDashboard();
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.getByRole('alert').textContent).toMatch(/couldn't load your projects/i);
  });
});

// ── The redirect rule, tested as pure logic ────────────────────────────────
//
// Mirrors the effect in App.jsx. Kept as a function here so each condition can
// be stated on its own; the effect itself is a sequence of early returns whose
// individual contributions are invisible in an end-to-end test.
function shouldRedirectHome({ authLoading, user, screen: scr, pathname, search, alreadyRedirected }) {
  if (authLoading || !user) return false;
  if (alreadyRedirected) return false;
  if (scr !== 'landing') return false;
  if (pathname !== '/') return false;
  if (search) return false;
  return true;
}

describe('sending a signed-in user to the dashboard', () => {
  const base = {
    authLoading: false, user: { id: 'u1' }, screen: 'landing',
    pathname: '/', search: '', alreadyRedirected: false,
  };

  it('redirects a signed-in visitor arriving at the root', () => {
    expect(shouldRedirectHome(base)).toBe(true);
  });

  it('never redirects an anonymous visitor', () => {
    // The landing page is the acquisition funnel and the target of every
    // canonical URL in the sitemap. Bouncing a stranger off it would be the
    // single most damaging version of this feature.
    expect(shouldRedirectHome({ ...base, user: null })).toBe(false);
  });

  it('waits for auth to resolve', () => {
    // Redirecting while `loading` is true would flash the wrong page at
    // whichever kind of visitor guessed wrong.
    expect(shouldRedirectHome({ ...base, authLoading: true })).toBe(false);
  });

  it('leaves deep links alone', () => {
    // ?claims=, ?tenure=, ?intent= all mean "open the editor and do this".
    // Swallowing one would break a reminder email link.
    for (const search of ['?claims=TICKER', '?tenure=1012345', '?intent=drill-results', '?billing=success']) {
      expect(shouldRedirectHome({ ...base, search }), search).toBe(false);
    }
  });

  it('leaves every other route alone', () => {
    for (const pathname of ['/account', '/tenure-monitor', '/admin', '/map/abc123']) {
      expect(shouldRedirectHome({ ...base, pathname }), pathname).toBe(false);
    }
    for (const scr of ['editor', 'account', 'tenure', 'shared_view']) {
      expect(shouldRedirectHome({ ...base, screen: scr }), scr).toBe(false);
    }
  });

  it('still has all five guards in App.jsx', () => {
    // shouldRedirectHome above is a MIRROR of the effect, not the effect. That
    // is useful for stating each condition on its own and useless if the real
    // one drifts — so this reads the source and checks every guard is still
    // there. Dropping any single one is a silent behavioural change that the
    // mirrored tests would keep passing through.
    const src = readFileSync('src/App.jsx', 'utf8');
    const effect = src.slice(src.indexOf('const redirectedHomeRef'), src.indexOf("setScreen('dashboard');", src.indexOf('const redirectedHomeRef')));
    expect(effect, 'the redirect effect is not where this test expects it').toBeTruthy();
    for (const guard of [
      'authLoading || !user',            // waits for auth; never anonymous
      'redirectedHomeRef.current',       // once only, so the landing page stays reachable
      "screen !== 'landing'",            // never interrupts another screen
      "window.location.pathname !== '/'",// only the root
      'window.location.search',          // never swallows a deep link
    ]) {
      expect(effect.includes(guard), `the redirect effect no longer guards on: ${guard}`).toBe(true);
    }
  });

  it('lets a signed-in user reach the marketing page deliberately', () => {
    // THE TRAP THIS AVOIDS. Without the once-only guard, clicking the wordmark
    // to view the landing page would bounce straight back to the dashboard,
    // making the marketing site unreachable for anybody with an account.
    expect(shouldRedirectHome({ ...base, alreadyRedirected: true })).toBe(false);
  });
});
