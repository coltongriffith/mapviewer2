import React, { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';
const SummaryTab = React.lazy(() => import('./admin/SummaryTab'));
const FeedbackTab = React.lazy(() => import('./admin/FeedbackTab'));
const UsersTab = React.lazy(() => import('./admin/UsersTab'));
const RevenueTab = React.lazy(() => import('./admin/RevenueTab'));
const TenureTab = React.lazy(() => import('./admin/TenureTab'));
import {
  useRpc, useDashboardWindow, useSummary, useUsersOverview, useUserDetail, useFeedback, useRevenue, useTenureOps,
} from './admin/useDashboardData';
import { pacificDate, addCalendarDays } from './admin/dateWindow';

// ── Formatting helpers ─────────────────────────────────────────────────────────
function fmtTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('en-CA', { month: 'short', day: 'numeric' }) + ' ' +
    d.toLocaleTimeString('en-CA', { hour: '2-digit', minute: '2-digit' });
}

function Empty({ message }) {
  return <p className="adm-empty">{message}</p>;
}

const EVENT_KIND_META = {
  page_view: { icon: '◦', label: 'Page view' },
  search: { icon: '🔍', label: 'Search' },
  export: { icon: '⬇', label: 'Export' },
  lead: { icon: '✉', label: 'Lead' },
  click: { icon: '⊙', label: 'Click' },
  // product_events — what the visitor did in the editor. The timeline RPC
  // omitted this table entirely until migration 20260824000001, so sessions
  // read as emptier than they were and the Timeline buttons on the feeds
  // below (built from product_events) opened a view without the event clicked.
  product: { icon: '▸', label: 'Action' },
};

function SessionTimelineModal({ sessionId, events, error, onClose }) {
  const dialog = useRef(null);
  useEffect(() => {
    const node = dialog.current;
    node.showModal();
    return () => node.close();
  }, []);
  return (
    <dialog ref={dialog} className="adm-modal-dialog" onCancel={onClose} aria-labelledby="session-timeline-heading">
      <div className="adm-modal">
        <div className="adm-modal-head">
          <h3 id="session-timeline-heading">Session timeline</h3>
          <button className="adm-btn adm-btn-ghost adm-btn-sm" onClick={onClose} aria-label="Close session timeline">✕</button>
        </div>
        <p className="adm-muted adm-modal-sid">{sessionId}</p>
        {error ? (
          <Empty message={`Could not load this timeline — ${error}`} />
        ) : events == null ? (
          <div className="adm-skeleton-block" />
        ) : events.length === 0 ? (
          <Empty message="No tracked events for this session." />
        ) : (
          <ul className="adm-timeline">
            {events.map((ev, i) => {
              const meta = EVENT_KIND_META[ev.kind] || { icon: '•', label: ev.kind };
              return (
                <li key={i} className={`adm-timeline-item adm-timeline-${ev.kind}`}>
                  <span className="adm-timeline-icon">{meta.icon}</span>
                  <span className="adm-timeline-time">{fmtTime(ev.event_time)}</span>
                  <span className="adm-timeline-detail"><strong>{meta.label}</strong> — {ev.detail}</span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </dialog>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
const TABS = [
  ['overview', 'Overview'], ['users', 'Users'], ['feedback', 'Feedback'],
  ['revenue', 'Revenue'], ['tenure', 'Tenure'],
];

export default function AdminPage({ onExit }) {
  const { user, loading: authLoading, signIn, signOut } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [loggingIn, setLoggingIn] = useState(false);

  const [tab, setTab] = useState('overview');
  const [range, setRange] = useState(30);
  const [openSessionId, setOpenSessionId] = useState(null);
  const [focusedUser, setFocusedUser] = useState(null);
  const access = useRpc('admin_get_access', {}, !!user);
  const isAdmin = access.data === true;
  const dashWindow = useDashboardWindow(range);
  const summary = useSummary(dashWindow, isAdmin && tab === 'overview');
  const usersOverview = useUsersOverview(isAdmin && tab === 'users');
  const [feedbackFilter, setFeedbackFilter] = useState('new');
  const feedback = useFeedback(isAdmin && tab === 'feedback', feedbackFilter);
  const revenue = useRevenue(isAdmin && tab === 'revenue');
  const tenureOps = useTenureOps(isAdmin && tab === 'tenure');
  const userDetail = useUserDetail();
  const active = { overview: summary, users: usersOverview, revenue, tenure: tenureOps, feedback }[tab];
  const timeline = useRpc('admin_get_session_timeline', { p_session_id: openSessionId }, isAdmin && !!openSessionId);
  const openSession = id => setOpenSessionId(id);
  const openUser = id => { userDetail.load(id); setFocusedUser(id); setTab('users'); };
  const openFeedback = () => { setFeedbackFilter('new'); setTab('feedback'); };

  async function handleLogin(e) {
    e.preventDefault();
    setLoginError('');
    setLoggingIn(true);
    try { await signIn(email, password); }
    catch (err) { setLoginError(err.message || 'Login failed'); }
    finally { setLoggingIn(false); }
  }

  if (!supabase) return (
    <div className="adm-shell">
      <div className="adm-login-card">
        <div className="adm-login-logo">🗺️</div>
        <h2>Supabase not configured</h2>
        <p className="adm-muted">Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.</p>
        <button className="adm-btn adm-btn-ghost" onClick={onExit}>← Back</button>
      </div>
    </div>
  );
  if (authLoading || (user && access.loading)) return (
    <div className="adm-shell"><div className="adm-login-card"><div className="adm-spinner" /></div></div>
  );
  if (!user) return (
    <div className="adm-shell">
      <div className="adm-login-card">
        <div className="adm-login-logo">🗺️</div>
        <h2>Admin</h2>
        <p className="adm-muted">Exploration Maps dashboard</p>
        <form onSubmit={handleLogin} className="adm-login-form">
          <input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
          <input type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          {loginError && <p className="adm-error">{loginError}</p>}
          <button type="submit" className="adm-btn adm-btn-primary" disabled={loggingIn}>{loggingIn ? 'Signing in…' : 'Sign In'}</button>
        </form>
        <button className="adm-back-link" onClick={onExit}>← Back to app</button>
      </div>
    </div>
  );
  if (!isAdmin) return (
    <div className="adm-shell">
      <div className="adm-login-card">
        <h2>{access.error === 'forbidden' ? 'Access denied' : 'Could not verify admin access'}</h2>
        {access.error && <p className="adm-error" role="alert">{access.error}</p>}
        <button className="adm-btn adm-btn-ghost" onClick={access.reload}>Retry access check</button>
        <p className="adm-muted">Signed in as <strong>{user.email}</strong></p>
        <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
          <button className="adm-btn adm-btn-ghost" onClick={() => signOut()}>Sign Out</button>
          <button className="adm-btn adm-btn-ghost" onClick={onExit}>← Back</button>
        </div>
      </div>
    </div>
  );

  // ── Dashboard ──────────────────────────────────────────────────────────────
  return (
    <div className="adm-shell">
      <header className="adm-header">
        <div className="adm-header-left">
          <span className="adm-logo">🗺️</span>
          <span className="adm-header-title">Exploration Maps</span>
          <span className="adm-tag">Admin</span>
        </div>
        <div className="adm-header-right">
          <span className="adm-header-email">{user.email}</span>
          <button className="adm-btn adm-btn-ghost adm-btn-sm" onClick={() => signOut()}>Sign out</button>
          <button className="adm-btn adm-btn-ghost adm-btn-sm" onClick={onExit}>← App</button>
        </div>
      </header>

      <main className="adm-body">
        <div className="adm-tabs">
          {TABS.map(([key, label]) => (
            <button key={key} className={`adm-tab${tab === key ? ' active' : ''}`} aria-current={tab === key ? 'page' : undefined} onClick={() => setTab(key)}>{label}</button>
          ))}
        </div>
        <div className="adm-report-toolbar">
          <div>
            {tab === 'overview' ? <>
              <div className="admx-range" aria-label="Days in report">
                {[7, 30, 90].map(r => <button key={r} className={`admx-range-btn${range === r ? ' active' : ''}`} aria-pressed={range === r} onClick={() => setRange(r)}>{r}d</button>)}
              </div>
              <span className="adm-muted">{pacificDate(new Date(dashWindow.p_start))} – {addCalendarDays(pacificDate(new Date(dashWindow.p_end)), -1)} · includes today · Pacific time</span>
            </> : <span className="adm-muted">{tab === 'feedback' ? 'User reports · newest first' : 'Current snapshot · each report labels its own lookback'}</span>}
          </div>
          <div className="adm-report-status" aria-live="polite">
            {active.loading ? 'Loading report…' : active.updatedAt ? `Updated ${new Date(active.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'Report unavailable'}
            <button className="adm-btn adm-btn-ghost adm-btn-sm" onClick={active.reload} disabled={active.loading}>Refresh</button>
          </div>
        </div>
        {active.error ? <div className="adm-error-bar" role="alert">Could not load this report: {active.error}. Use Refresh to retry.</div>
          : active.loading ? <div className="adm-skeleton adm-skeleton-block" role="status" aria-label="Loading report" />
          : <React.Suspense fallback={<div className="adm-skeleton adm-skeleton-block" role="status" aria-label="Opening report" />}>
        {tab === 'overview' && summary.data && (
          <SummaryTab data={summary.data} onOpenSession={openSession} onOpenUser={openUser} onOpenFeedback={openFeedback} />
        )}
        {tab === 'users' && (
          <UsersTab
            data={usersOverview.data}
            loading={usersOverview.loading}
            detail={userDetail}
            initialUserId={focusedUser}
            onLoadDetail={userDetail.load}
            onOpenSession={openSession}
          />
        )}
        {tab === 'feedback' && (
          <FeedbackTab data={feedback.data} loading={feedback.loading} error={feedback.error}
            filter={feedbackFilter} onFilter={setFeedbackFilter} onReload={feedback.reload} />
        )}
        {tab === 'tenure' && (
          <TenureTab data={tenureOps.data} loading={tenureOps.loading} onReload={tenureOps.reload} />
        )}
        {tab === 'revenue' && (
          <RevenueTab data={revenue.data} loading={revenue.loading} />
        )}
        </React.Suspense>}
      </main>
      {openSessionId && (
        <SessionTimelineModal
          sessionId={openSessionId}
          events={timeline.loading ? null : timeline.data}
          error={timeline.error}
          onClose={() => setOpenSessionId(null)}
        />
      )}
    </div>
  );
}
