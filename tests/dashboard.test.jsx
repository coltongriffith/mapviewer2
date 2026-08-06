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

  it('opens the monitor on the filter the row names', async () => {
    // The row says "3 expiring in 30 days". Opening the monitor unfiltered
    // shows all twelve, and the user has to work out which three were meant —
    // which is the whole job the row just did for them.
    portfolios = [{ id: 'p1', name: 'Golden Triangle' }];
    summary = { total_tenures: 12, expiring_30: 3, expired: 2, changed_recently: 0, needs_review: 0 };
    const onOpenTenureMonitor = vi.fn();
    await renderDashboard({ onOpenTenureMonitor });
    await waitFor(() => expect(screen.getByText(/expiring in 30 days/i)).toBeTruthy());

    fireEvent.click(screen.getByText(/expiring in 30 days/i).closest('button'));
    expect(onOpenTenureMonitor).toHaveBeenCalledWith('30');

    fireEvent.click(screen.getByText(/past good-to-date/i).closest('button'));
    expect(onOpenTenureMonitor).toHaveBeenCalledWith('expired');
  });

  it('passes the filter through App to the monitor', () => {
    // The card sending a filter is useless if the handler drops it. This was
    // exactly the bug: onOpenTenureMonitor={() => setScreen('tenure')} took no
    // argument, so every attention row opened the monitor showing everything.
    const src = readFileSync('src/App.jsx', 'utf8');
    expect(src, 'the dashboard handler discards the filter argument')
      .toContain('onOpenTenureMonitor={(filter = null) => { setTenureInitialFilter(filter); setScreen(\'tenure\'); }}');
    expect(src, 'the monitor is not given the filter')
      .toContain('initialFilter={tenureInitialFilter}');
    // Other entry points must clear it, or a filter set once would silently
    // narrow a later visit the user did not ask to be narrowed.
    expect(src).toContain('setTenureInitialFilter(null)');
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
function shouldRedirectHome({
  authLoading, user, screen: scr, pathname, search, wantsLanding, redirectedForUser,
}) {
  if (authLoading || !user) return false;
  if (wantsLanding) return false;
  if (redirectedForUser === user.id) return false;
  if (scr !== 'landing') return false;
  if (pathname !== '/') return false;
  if (search) return false;
  return true;
}

describe('sending a signed-in user to the dashboard', () => {
  const base = {
    authLoading: false, user: { id: 'u1' }, screen: 'landing',
    pathname: '/', search: '', wantsLanding: false, redirectedForUser: null,
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

  it('still has every guard in App.jsx', () => {
    // shouldRedirectHome above is a MIRROR of the effect, not the effect. That
    // is useful for stating each condition on its own and useless if the real
    // one drifts — so this reads the source and checks every guard is still
    // there. Dropping any single one is a silent behavioural change that the
    // mirrored tests would keep passing through.
    const src = readFileSync('src/App.jsx', 'utf8');
    // Anchored on the redirect effect's own first line, not on the ref
    // declarations. A wider slice swept in goToLanding()'s assignment, so
    // deleting the wantsLanding GUARD still found the string and the test
    // passed against the bug it exists to catch.
    const from = src.indexOf('if (authLoading || !user) return;');
    expect(from, 'the redirect effect is not where this test expects it').toBeGreaterThan(-1);
    const effect = src.slice(from, src.indexOf("setScreen('dashboard');", from));
    expect(effect, 'the redirect effect is not where this test expects it').toBeTruthy();
    for (const guard of [
      'authLoading || !user',                    // waits for auth; never anonymous
      'wantsLandingRef.current',                 // a deliberate visit to / stays there
      'redirectedForUserRef.current === user.id',// once per sign-in, not per page load
      "screen !== 'landing'",                    // never interrupts another screen
      "window.location.pathname !== '/'",        // only the root
      'window.location.search',                  // never swallows a deep link
    ]) {
      expect(effect.includes(guard), `the redirect effect no longer guards on: ${guard}`).toBe(true);
    }
    // Sign-out has to clear the state or "once per sign-in" degrades back into
    // "once per page load" the moment somebody switches accounts.
    expect(src, 'sign-out no longer clears the redirect state')
      .toContain('redirectedForUserRef.current = null;');
    // And every route to the marketing page must go through the helper that
    // records the intent — a raw setScreen('landing') would bounce straight back.
    const rawLandingCalls = (src.match(/setScreen\('landing'\)/g) || []).length;
    expect(rawLandingCalls, 'a navigation to the landing page bypasses goToLanding()').toBe(1);
  });

  it('lets a signed-in user reach the marketing page deliberately', () => {
    // Clicking the wordmark sets wantsLanding, so the effect leaves them there
    // instead of bouncing them back and making the marketing site unreachable
    // for anybody with an account.
    expect(shouldRedirectHome({ ...base, wantsLanding: true })).toBe(false);
  });

  it('honours that from any entry route, not just from the landing page', () => {
    // THE BUG THIS REPLACED. A single "have we redirected yet" boolean was only
    // ever set by the redirect itself, so a user who entered through
    // /dashboard — a bookmark, which is how a returning customer arrives —
    // had never set it. Their first click on the wordmark saw a false flag and
    // bounced them straight back. wantsLanding is set by the navigation rather
    // than by the redirect, so it is true regardless of where they came from.
    expect(shouldRedirectHome({ ...base, wantsLanding: true, redirectedForUser: null })).toBe(false);
  });

  it('redirects once per SIGN-IN, not once per page load', () => {
    // Keyed by user id and cleared on sign-out. A boolean meant a second
    // sign-in in the same tab silently stopped redirecting, so the feature
    // quietly stopped working for anybody who switched accounts.
    expect(shouldRedirectHome({ ...base, redirectedForUser: 'u1' })).toBe(false);
    // A different account in the same tab is a new sign-in and gets its own.
    expect(shouldRedirectHome({ ...base, redirectedForUser: 'someone-else' })).toBe(true);
    // And after sign-out the state is cleared, so signing back in works.
    expect(shouldRedirectHome({ ...base, redirectedForUser: null })).toBe(true);
  });
});
