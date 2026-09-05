import React, { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';
const OverviewTab = React.lazy(() => import('./admin/OverviewTab'));
const HealthTab = React.lazy(() => import('./admin/HealthTab'));
const UsersTab = React.lazy(() => import('./admin/UsersTab'));
const ProductTab = React.lazy(() => import('./admin/ProductTab'));
const RevenueTab = React.lazy(() => import('./admin/RevenueTab'));
const TenureTab = React.lazy(() => import('./admin/TenureTab'));
import {
  useRpc, useGrowth, useDashboardWindow, useOverview, useEngagement, useUsersOverview, useUserDetail, useErrorSummary, useRevenue, useTenureOps,
} from './admin/useDashboardData';
import { pacificDate, addCalendarDays, dayWindow } from './admin/dateWindow';

/**
 * Dashboard series colours.
 *
 * The admin surface had drifted onto a nine-hue framework palette, which made
 * it read as a different product from the map editor. These are the brand's
 * neutrals plus the three semantic colours, ordered so neighbouring series stay
 * apart at bar width, with Claim Copper spent once — on the live pulse — since
 * copper is emphasis, never a series ramp.
 */
const SERIES = {
  primary: '#142126',  // Mineral Slate
  slate:   '#435459',
  mid:     '#5f6e72',
  faint:   '#7c898c',
  pale:    '#c6cecf',
  info:    '#176b87',
  success: '#287454',
  warning: '#9a6715',
  accent:  '#c65322',  // Claim Copper
};

const WorldMap = React.lazy(() => import('./admin/WorldMap'));
const GrowthTab = React.lazy(() => import('./admin/GrowthTab'));

// ── Formatting helpers ─────────────────────────────────────────────────────────
function fmt(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' });
}
function fmtTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('en-CA', { month: 'short', day: 'numeric' }) + ' ' +
    d.toLocaleTimeString('en-CA', { hour: '2-digit', minute: '2-digit' });
}
function fmtNum(n) {
  if (n == null) return '—';
  return Number(n).toLocaleString();
}
function pct(part, whole) {
  if (!whole) return 0;
  return Math.round((Number(part) / Number(whole)) * 100);
}

// ── Pagination ──────────────────────────────────────────────────────────────────
function usePagination(data, pageSize = 10) {
  const [page, setPage] = React.useState(0);
  const total = data?.length || 0;
  const pageCount = Math.ceil(total / pageSize);
  const slice = (data || []).slice(page * pageSize, (page + 1) * pageSize);
  React.useEffect(() => { setPage(0); }, [data]);
  return { slice, page, pageCount, setPage, total };
}
function Pagination({ page, pageCount, setPage, total }) {
  if (pageCount <= 1) return null;
  return (
    <div className="adm-pagination">
      <span className="adm-pagination-info">{total} total</span>
      <button className="adm-btn adm-btn-ghost adm-btn-sm" disabled={page === 0} onClick={() => setPage(p => p - 1)}>← Prev</button>
      <span className="adm-pagination-pages">{page + 1} / {pageCount}</span>
      <button className="adm-btn adm-btn-ghost adm-btn-sm" disabled={page >= pageCount - 1} onClick={() => setPage(p => p + 1)}>Next →</button>
    </div>
  );
}

// ── Primitives ──────────────────────────────────────────────────────────────────
function Delta({ trend }) {
  if (!trend) return null;
  const { cur, prior } = trend;
  if (prior === 0 && cur === 0) return null;
  if (prior === 0) return <span className="adm-delta up">▲ New</span>;
  const change = Math.round(((cur - prior) / prior) * 100);
  if (change === 0) return <span className="adm-delta flat">0%</span>;
  const up = change > 0;
  return <span className={`adm-delta ${up ? 'up' : 'down'}`}>{up ? '▲' : '▼'} {Math.abs(change)}%</span>;
}

function KPI({ label, value, trend, detail, accent }) {
  return (
    <div className="adm-kpi" style={accent ? { '--kpi-accent': accent } : {}}>
      <div className="adm-kpi-top">
        <span className="adm-kpi-label">{label}</span>
        {trend && <Delta trend={trend} />}
      </div>
      <div className="adm-kpi-value">{value ?? <span className="adm-skeleton">···</span>}</div>
      {detail && <div className="adm-kpi-detail">{detail}</div>}
    </div>
  );
}

function Card({ title, count, eyebrow, children, full, action }) {
  return (
    <div className={`adm-card${full ? ' adm-card-full' : ''}`}>
      {(title || eyebrow || action) && (
        <div className="adm-card-head">
          <div>
            {eyebrow && <p className="adm-card-eyebrow">{eyebrow}</p>}
            {title && <h2 className="adm-card-title">{title}</h2>}
          </div>
          <div className="adm-card-head-right">
            {action}
            {count != null && <span className="adm-pill">{count}</span>}
          </div>
        </div>
      )}
      {children}
    </div>
  );
}

function Empty({ message }) {
  return <p className="adm-empty">{message}</p>;
}

// ── Charts ──────────────────────────────────────────────────────────────────────
function HBars({ rows, color = SERIES.slate, emptyMsg }) {
  if (!rows || rows.length === 0) return <Empty message={emptyMsg || 'No data yet.'} />;
  const max = Math.max(...rows.map((r) => Number(r.value) || 0), 1);
  const total = rows.reduce((s, r) => s + (Number(r.value) || 0), 0);
  return (
    <div className="adm-hbars">
      {rows.map((r, i) => (
        <div key={i} className="adm-hbar-row">
          <div className="adm-hbar-label" title={r.label}>{r.label}</div>
          <div className="adm-hbar-track">
            <div className="adm-hbar-fill" style={{ width: `${Math.max(2, pct(r.value, max))}%`, background: r.color || color }} />
          </div>
          <div className="adm-hbar-num">{fmtNum(r.value)}</div>
          <div className="adm-hbar-pct">{pct(r.value, total)}%</div>
        </div>
      ))}
    </div>
  );
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

function fmtDuration(seconds) {
  if (seconds == null) return '—';
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s ? `${m}m ${s}s` : `${m}m`;
}

// Engagement is an observed action pattern, not a bot or human classifier.
function sessionEngaged(s) {
  return Number(s.page_view_count) > 1 || Number(s.search_count) > 0 || Number(s.export_count) > 0 || !!s.lead_email;
}

function DayDetail({ day, summary, sessions, loading, error, onClose, onOpenSession }) {
  const dayLabel = new Date(`${day}T00:00:00.000Z`).toLocaleDateString('en-CA', {
    timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  });
  const real = sessions.filter(sessionEngaged).length;
  return (
    <Card title={`Day detail — ${dayLabel}`} eyebrow="Pacific calendar day · known admins excluded" action={<button className="adm-btn adm-btn-ghost adm-btn-sm" onClick={onClose}>Close day</button>} full>
      {error ? <p role="alert" className="adm-error-bar">Could not load this day: {error}</p> : loading ? (
        <div className="adm-skeleton-block" />
      ) : (
        <>
          <div className="adm-day-summary-row">
            <KPI label="Page views" value={fmtNum(summary?.page_views ?? 0)} accent={SERIES.primary} />
            <KPI label="Sessions" value={fmtNum(summary?.sessions ?? 0)} detail={`${real} engaged in the listed sessions`} accent={SERIES.slate} />
            <KPI label="Signups" value={fmtNum(summary?.signups ?? 0)} accent={SERIES.info} />
            <KPI label="Searches" value={fmtNum(summary?.searches ?? 0)} accent={SERIES.mid} />
            <KPI label="Exports" value={fmtNum(summary?.exports ?? 0)} accent={SERIES.success} />
            <KPI label="Leads" value={fmtNum(summary?.leads ?? 0)} accent={SERIES.warning} />
          </div>
          <p className="admx-since-note">Most recent 250 sessions. Activity span is the time between recorded events, not time spent on the page. Engagement does not establish whether a session is human.</p>
          {sessions.length === 0 ? (
            <Empty message="No visitor sessions recorded for this day." />
          ) : (
            <div className="adm-table-scroll"><table className="adm-table">
              <thead>
                <tr>
                  <th>First seen</th>
                  <th>Activity span</th>
                  <th>Location</th>
                  <th>Source</th>
                  <th>Device</th>
                  <th>Pages</th>
                  <th>Searches</th>
                  <th>Exports</th>
                  <th>Lead</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((s) => {
                  const durationSec = s.first_seen && s.last_seen
                    ? Math.max(0, Math.round((new Date(s.last_seen) - new Date(s.first_seen)) / 1000))
                    : null;
                  return (
                    <tr key={s.session_id}>
                      <td>{fmtTime(s.first_seen)}</td>
                      <td>{fmtDuration(durationSec)}</td>
                      <td>{[s.city, s.country].filter(Boolean).join(', ') || '—'}</td>
                      <td>{s.utm_source || s.referrer || 'Direct'}</td>
                      <td>{s.device || '—'}</td>
                      <td>{s.page_view_count ?? 0}</td>
                      <td>{s.search_count ?? 0}</td>
                      <td>{s.export_count ?? 0}</td>
                      <td>{s.lead_email || '—'}</td>
                      <td>
                        <span className={`adm-real-badge ${sessionEngaged(s) ? 'real' : 'maybe'}`}>
                          {sessionEngaged(s) ? 'Engaged' : 'Limited activity'}
                        </span>
                        <button className="adm-btn adm-btn-ghost adm-btn-sm" onClick={() => onOpenSession(s.session_id)}>
                          Timeline
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table></div>
          )}
        </>
      )}
    </Card>
  );
}

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
  ['overview', 'Growth'], ['users', 'Users'], ['activity', 'Activity'],
  ['product', 'Product'], ['growth', 'Acquisition'], ['revenue', 'Revenue'],
  ['tenure', 'Tenure'], ['health', 'Health'],
];
const RANGE_TABS = new Set(['overview', 'activity', 'product', 'growth']);

export default function AdminPage({ onExit }) {
  const { user, loading: authLoading, signIn, signOut } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [loggingIn, setLoggingIn] = useState(false);

  const [tab, setTab] = useState('overview');
  const [range, setRange] = useState(30);
  const [selectedDay, setSelectedDay] = useState('');
  const [openSessionId, setOpenSessionId] = useState(null);
  const [focusedUser, setFocusedUser] = useState(null);
  const [visible, setVisible] = useState(() => !document.hidden);
  const access = useRpc('admin_get_access', {}, !!user);
  const isAdmin = access.data === true;
  const dashWindow = useDashboardWindow(range);
  const pickedWindow = selectedDay ? dayWindow(selectedDay) : dashWindow;
  const queryWindow = useMemo(() => ({ p_start: pickedWindow.p_start, p_end: pickedWindow.p_end }), [pickedWindow.p_start, pickedWindow.p_end]);
  const growth = useGrowth(dashWindow, isAdmin && tab === 'overview');
  const overview = useOverview(dashWindow, isAdmin && tab === 'activity');
  const engagement = useEngagement(dashWindow, isAdmin && tab === 'product');
  const usersOverview = useUsersOverview(isAdmin && tab === 'users');
  const errorSummary = useErrorSummary(isAdmin && tab === 'health');
  const revenue = useRevenue(isAdmin && tab === 'revenue');
  const tenureOps = useTenureOps(isAdmin && tab === 'tenure');
  const userDetail = useUserDetail();
  const acquisitionEnabled = isAdmin && tab === 'growth';
  // Only the five reports actually displayed on Acquisition are requested.
  const leads = useRpc('admin_get_leads', queryWindow, acquisitionEnabled);
  const campaigns = useRpc('admin_get_campaign_stats', queryWindow, acquisitionEnabled);
  const referrers = useRpc('admin_get_referrer_stats', queryWindow, acquisitionEnabled);
  const searchDropoff = useRpc('admin_get_search_dropoff', queryWindow, acquisitionEnabled);
  const landingClicks = useRpc('admin_get_landing_clicks', queryWindow, acquisitionEnabled);
  const acquisition = [leads, campaigns, referrers, searchDropoff, landingClicks];
  const d = { leads: leads.data, campaignStats: campaigns.data, referrerStats: referrers.data,
    searchDropoff: searchDropoff.data, landingClicks: landingClicks.data };
  const active = tab === 'growth' ? {
    loading: acquisition.some(r => r.loading),
    error: acquisition.find(r => r.error)?.error,
    updatedAt: acquisition.every(r => r.updatedAt) ? Math.min(...acquisition.map(r => r.updatedAt)) : null,
    reload: () => acquisition.forEach(r => r.reload()),
  } : { overview: growth, activity: overview, users: usersOverview, product: engagement,
    revenue, tenure: tenureOps, health: errorSummary }[tab];
  const displayedWindow = tab === 'growth' ? queryWindow : dashWindow;
  const dayReport = useRpc('admin_get_day_activity', queryWindow, isAdmin && !!selectedDay);
  const timeline = useRpc('admin_get_session_timeline', { p_session_id: openSessionId }, isAdmin && !!openSessionId);
  const openSession = id => setOpenSessionId(id);
  const openUser = id => { userDetail.load(id); setFocusedUser(id); setTab('users'); setSelectedDay(''); };
  const live = useRpc('admin_get_live_locations', {}, acquisitionEnabled && visible);
  useEffect(() => {
    const update = () => setVisible(!document.hidden);
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);
  useEffect(() => {
    if (!acquisitionEnabled || !visible) return;
    const timer = setInterval(live.reload, 30000);
    return () => clearInterval(timer);
  }, [acquisitionEnabled, visible, live.reload]);

  async function handleLogin(e) {
    e.preventDefault();
    setLoginError('');
    setLoggingIn(true);
    try { await signIn(email, password); }
    catch (err) { setLoginError(err.message || 'Login failed'); }
    finally { setLoggingIn(false); }
  }

  // Pagination hooks (must run unconditionally, before any early return)
  const leadsPag = usePagination(d.leads, 10);
  const campaignPag = usePagination(d.campaignStats, 10);
  const searchPag = usePagination(d.searchDropoff, 12);

  // ── Pre-auth screens ──────────────────────────────────────────────────────
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

  const landingBars = (d.landingClicks || []).map((r) => ({ label: r.element || '(no label)', value: Number(r.count) }));

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
        {/* Tab nav */}
        <div className="adm-tabs">
          {TABS.map(([key, label]) => (
            <button key={key} className={`adm-tab${tab === key ? ' active' : ''}`} aria-current={tab === key ? 'page' : undefined} onClick={() => { setTab(key); setSelectedDay(''); }}>{label}</button>
          ))}
        </div>
        <div className="adm-report-toolbar">
          <div>
            {RANGE_TABS.has(tab) ? <>
              <div className="admx-range" aria-label="Complete days in report">
                {[7, 30, 90].map(r => <button key={r} className={`admx-range-btn${range === r ? ' active' : ''}`} aria-pressed={range === r} onClick={() => { setRange(r); setSelectedDay(''); }}>{r}d</button>)}
              </div>
              <span className="adm-muted">{pacificDate(new Date(displayedWindow.p_start))} – {addCalendarDays(pacificDate(new Date(displayedWindow.p_end)), -1)} · {tab === 'growth' && selectedDay === pacificDate() ? 'Pacific day in progress' : 'complete Pacific days'}</span>
            </> : <span className="adm-muted">{tab === 'health' ? 'Last 24 hours' : 'Current snapshot · each report labels its own lookback'}</span>}
          </div>
          {tab === 'growth' && <label>Inspect a day <input type="date" value={selectedDay} max={pacificDate()} onChange={e => setSelectedDay(e.target.value)} /></label>}
          <div className="adm-report-status" aria-live="polite">
            {active.loading ? 'Loading report…' : active.updatedAt ? `Updated ${new Date(active.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'Report unavailable'}
            <button className="adm-btn adm-btn-ghost adm-btn-sm" onClick={active.reload} disabled={active.loading}>Refresh</button>
          </div>
        </div>
        {selectedDay && <DayDetail day={selectedDay} summary={dayReport.data?.summary} sessions={dayReport.data?.sessions || []}
          loading={dayReport.loading} error={dayReport.error} onClose={() => setSelectedDay('')} onOpenSession={openSession} />}
        {active.error ? <div className="adm-error-bar" role="alert">Could not load this report: {active.error}. Use Refresh to retry.</div>
          : active.loading ? <div className="adm-skeleton adm-skeleton-block" role="status" aria-label="Loading report" />
          : <React.Suspense fallback={<div className="adm-skeleton adm-skeleton-block" role="status" aria-label="Opening report" />}>
        {tab === 'overview' && growth.data && <GrowthTab data={growth.data} onOpenUser={openUser} />}

        {/* ───────── OVERVIEW (v2) ───────── */}
        {tab === 'activity' && (
          <OverviewTab
            data={overview.data}
            loading={overview.loading}
            range={range}
            onRange={setRange}
            onPickDay={setSelectedDay}
            onOpenSession={openSession}
            onOpenUser={openUser}
          />
        )}

        {/* ───────── USERS (v2) ───────── */}
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

        {/* ───────── PRODUCT (v2) ───────── */}
        {tab === 'product' && (
          <ProductTab data={engagement.data} loading={engagement.loading} range={range} />
        )}

        {tab === 'health' && (
          <HealthTab data={errorSummary.data} loading={errorSummary.loading} error={errorSummary.error} />
        )}

        {/* ───────── ACQUISITION ───────── */}
        {tab === 'growth' && (
          <>
            <Card
              title="Recent active tabs"
              eyebrow="Located sessions · last 30 minutes · drag the globe to explore"
              full
            >
              {live.error ? <p role="status">Live locations unavailable: {live.error}</p> : <WorldMap locations={live.data || []} />}
            </Card>
            <Card title="Campaigns" eyebrow="UTM-tagged traffic · selected window" count={d.campaignStats?.length} full>
              {d.campaignStats && d.campaignStats.length > 0 ? (
                <>
                  <table className="adm-table">
                    <thead><tr><th>Source</th><th>Medium</th><th>Campaign</th><th>Sessions</th><th>Signups</th><th>Conv.</th></tr></thead>
                    <tbody>
                      {campaignPag.slice.map((r, i) => (
                        <tr key={i}>
                          <td className="adm-mono">{r.source}</td>
                          <td className="adm-muted">{r.medium}</td>
                          <td>{r.campaign}</td>
                          <td>{fmtNum(r.sessions)}</td>
                          <td>{fmtNum(r.signups)}</td>
                          <td className="adm-muted">{pct(r.signups, r.sessions)}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <Pagination {...campaignPag} />
                </>
              ) : <Empty message="No UTM-tagged traffic yet. Tag marketing links with ?utm_source=…&utm_campaign=… to attribute campaigns here." />}
            </Card>
            <div className="adm-grid-2">
              {/* Searches that found nothing.
                  admin_get_search_stats averages result_count, and an average
                  hides exactly the failure that matters: on 2026-08-07, 63
                  healthy B.C. company searches drowned 3 B.C. number searches
                  that were returning zero because the filter could not reach
                  the field the placeholder told users to type. A rate cannot
                  hide it, and `abandoned` — a zero-result search that was the
                  last thing a session ever did — names the cost. */}
              <Card
                title="Searches that found nothing"
                eyebrow="Zero-result rate by province and mode · worst first"
                count={(d.searchDropoff || []).reduce((n, r) => n + Number(r.abandoned || 0), 0) || null}
                full
              >
                {(d.searchDropoff || []).length === 0 ? (
                  <Empty message="No searches in this window." />
                ) : (
                  <div className="adm-table-wrap">
                    <table className="adm-table">
                      <thead>
                        <tr>
                          <th scope="col">Province</th>
                          <th scope="col">Mode</th>
                          <th scope="col" className="adm-num">Searches</th>
                          <th scope="col" className="adm-num">Found nothing</th>
                          <th scope="col" className="adm-num">Errors</th>
                          {/* Searches predating the outcome column (2026-08-05).
                              Shown rather than folded into either bucket: pooling
                              the two eras is what made Manitoba read as a 100%
                              failure when it was refusing an unsupported mode. */}
                          <th scope="col" className="adm-num">Unclassified</th>
                          <th scope="col" className="adm-num">Sessions</th>
                          <th scope="col" className="adm-num">Left after</th>
                          <th scope="col">Last</th>
                        </tr>
                      </thead>
                      <tbody>
                        {searchPag.slice.map((r) => {
                          const rate = Number(r.zero_rate) || 0;
                          // Only flag a rate that is BOTH high and backed by
                          // enough searches to mean something — two misses out
                          // of two is noise, not a signal.
                          // Rate is over CLASSIFIED searches only, so judge the
                          // sample on those too — a row that is all unclassified
                          // has no rate to be alarmed about.
                          const classified = Number(r.searches) - Number(r.unclassified || 0);
                          const alarming = rate >= 60 && classified >= 3;
                          return (
                            <tr key={`${r.province}-${r.mode}`} className={alarming ? 'adm-row-alert' : undefined}>
                              <th scope="row">{r.province}</th>
                              <td>{r.mode}</td>
                              <td className="adm-num">{r.searches}</td>
                              <td className="adm-num">
                                {r.zero_results}
                                {r.zero_rate === null
                                  ? <span className="adm-muted"> (—)</span>
                                  : <span className={alarming ? 'adm-rate-bad' : 'adm-muted'}> ({rate}%)</span>}
                              </td>
                              <td className="adm-num">{Number(r.errors) > 0 ? r.errors : <span className="adm-muted">—</span>}</td>
                              <td className="adm-num">{Number(r.unclassified) > 0
                                ? <span className="adm-muted">{r.unclassified}</span>
                                : <span className="adm-muted">—</span>}</td>
                              <td className="adm-num">{r.sessions}</td>
                              <td className="adm-num">
                                {Number(r.abandoned) > 0
                                  ? <strong className="adm-rate-bad">{r.abandoned}</strong>
                                  : <span className="adm-muted">—</span>}
                              </td>
                              <td className="adm-muted">{fmt(r.last_search)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    <Pagination {...searchPag} />
                  </div>
                )}
                <p className="adm-muted" style={{ marginTop: 10, fontSize: 12 }}>
                  <strong>Left after</strong> counts sessions whose last recorded action was a
                  search that found nothing. A high rate with people leaving is usually a broken
                  search rather than empty ground — open the session timeline to see the sequence.
                </p>
              </Card>

              <Card title="All referrers" eyebrow="Selected window">
                <HBars rows={(d.referrerStats || []).slice(0, 12).map((r) => ({ label: r.referrer, value: Number(r.sessions) }))} emptyMsg="No referrer data yet." />
              </Card>
              <Card title="Landing-page clicks" eyebrow="What visitors click" count={landingBars.reduce((s, r) => s + r.value, 0) || null}>
                <HBars rows={landingBars} color={SERIES.info} emptyMsg="No click data yet." />
              </Card>
            </div>
            <Card title="Email leads" eyebrow="Captured in export modal" count={d.leads?.length} full>
              {d.leads && d.leads.length > 0 ? (
                <>
                  <table className="adm-table">
                    <thead><tr><th>Email</th><th>Project</th><th>Captured</th></tr></thead>
                    <tbody>
                      {leadsPag.slice.map((l, i) => (
                        <tr key={i}>
                          <td className="adm-mono">{l.email}</td>
                          <td className="adm-muted">{l.project_title || '—'}</td>
                          <td className="adm-muted" style={{ whiteSpace: 'nowrap' }}>{fmtTime(l.captured_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <Pagination {...leadsPag} />
                </>
              ) : <Empty message="No leads yet — they appear when users enter their email in the export modal." />}
            </Card>
          </>
        )}

        {/* ───────── REVENUE ───────── */}
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
