import React, { useEffect, useState, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';

const ADMIN_EMAIL = import.meta.env.VITE_ADMIN_EMAIL;

// ── Helpers ──────────────────────────────────────────────────────────────────

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

// ── Pagination ────────────────────────────────────────────────────────────────

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

// ── Sub-components ────────────────────────────────────────────────────────────

function KPI({ label, value, detail, accent }) {
  return (
    <div className="adm-kpi" style={accent ? { borderTop: `3px solid ${accent}` } : {}}>
      <div className="adm-kpi-value">{value ?? <span className="adm-skeleton">···</span>}</div>
      <div className="adm-kpi-label">{label}</div>
      {detail && <div className="adm-kpi-detail">{detail}</div>}
    </div>
  );
}

function SectionHeader({ title, count }) {
  return (
    <div className="adm-section-header">
      <h2 className="adm-section-title">{title}</h2>
      {count != null && <span className="adm-pill">{count}</span>}
    </div>
  );
}

function Empty({ message }) {
  return <p className="adm-empty">{message}</p>;
}

function BarChart({ data }) {
  if (!data || data.length === 0) return <Empty message="No visit data yet — sessions will appear here once users visit the app." />;

  const sorted = [...data].reverse(); // oldest → newest
  const max = Math.max(...sorted.map((r) => Number(r.sessions)), 1);
  const gridLines = [0.25, 0.5, 0.75, 1];

  // Show date label every N bars
  const labelEvery = sorted.length > 20 ? 7 : sorted.length > 10 ? 5 : 1;

  return (
    <div className="adm-chart-wrap">
      {/* Y-axis */}
      <div className="adm-y-axis">
        {[...gridLines].reverse().map((f) => (
          <div key={f} className="adm-y-label">{Math.round(max * f)}</div>
        ))}
        <div className="adm-y-label">0</div>
      </div>
      {/* Chart area */}
      <div className="adm-chart-area">
        {/* Grid lines */}
        {gridLines.map((f) => (
          <div key={f} className="adm-grid-line" style={{ bottom: `${f * 100}%` }} />
        ))}
        {/* Bars */}
        <div className="adm-bars">
          {sorted.map((r, i) => {
            const pct = Math.max(2, (Number(r.sessions) / max) * 100);
            const showLabel = i % labelEvery === 0 || i === sorted.length - 1;
            const label = r.visit_date?.slice(5); // MM-DD
            return (
              <div key={r.visit_date} className="adm-bar-col" title={`${r.visit_date}\n${r.sessions} sessions · ${r.logged_in_sessions ?? 0} logged in`}>
                <div className="adm-bar-fill" style={{ height: `${pct}%` }}>
                  <span className="adm-bar-tip">{r.sessions}</span>
                </div>
                {showLabel && <div className="adm-bar-label">{label}</div>}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function FormatBadge({ format }) {
  const colors = { png: '#0ea5e9', svg: '#8b5cf6', pdf: '#f59e0b' };
  const bg = colors[format?.toLowerCase()] || '#64748b';
  return (
    <span className="adm-format-badge" style={{ background: bg + '20', color: bg }}>
      {format?.toUpperCase()}
    </span>
  );
}

// ── Landing heatmap ───────────────────────────────────────────────────────────

// The iframe is rendered at exactly this width so click percentages are 1:1 accurate.
const IFRAME_REF_W = 1440;

function LandingHeatmap({ data }) {
  const wrapRef = useRef(null);
  const [scale, setScale] = useState(null);

  useEffect(() => {
    if (!wrapRef.current) return;
    const ro = new ResizeObserver(([e]) => {
      setScale(e.contentRect.width / IFRAME_REF_W);
    });
    ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, []);

  const maxCount = Math.max(...data.map(d => Number(d.count)), 1);

  return (
    <div ref={wrapRef} className="adm-heatmap-outer">
      {scale !== null && (
        <div
          className="adm-heatmap-canvas"
          style={{ height: Math.round(scale * 2339) }} // 2339 = landing page height at 1440px
        >
          <iframe
            src="/"
            title="Landing page"
            scrolling="no"
            tabIndex={-1}
            className="adm-heatmap-iframe"
            style={{ width: IFRAME_REF_W, transform: `scale(${scale})` }}
          />
          {data.map((pt, i) => {
            const x = Math.min(99, Math.max(1, Number(pt.x_pct)));
            const y = Math.min(99, Math.max(1, Number(pt.y_pct)));
            const weight = Number(pt.count) / maxCount;
            return (
              <div
                key={i}
                className="adm-heatmap-dot"
                title={`${pt.count} click${Number(pt.count) === 1 ? '' : 's'}`}
                style={{
                  left: `${x}%`,
                  top: `${y}%`,
                  opacity: Math.min(1, 0.4 + weight * 0.6),
                  transform: `translate(-50%,-50%) scale(${0.7 + weight * 1.3})`,
                }}
              />
            );
          })}
        </div>
      )}
      <p className="adm-heatmap-legend">
        Live preview · iframe rendered at {IFRAME_REF_W}px so dot positions are exact
      </p>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function AdminPage({ onExit }) {
  const { user, loading: authLoading, signIn, signOut } = useAuth();

  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [loggingIn, setLoggingIn]   = useState(false);

  const [users, setUsers]               = useState(null);
  const [exportStats, setExportStats]   = useState(null);
  const [leads, setLeads]               = useState(null);
  const [recentExports, setRecentExports] = useState(null);
  const [dailyVisitors, setDailyVisitors] = useState(null);
  const [referrerStats, setReferrerStats] = useState(null);
  const [deviceStats, setDeviceStats]   = useState(null);
  const [exportsByUser, setExportsByUser] = useState(null);
  const [liveVisitors, setLiveVisitors] = useState(null);
  const [heatmapData, setHeatmapData]   = useState(null);
  const [dataLoading, setDataLoading]   = useState(false);
  const [dataError, setDataError]       = useState('');
  const [editingUser, setEditingUser]   = useState(null);

  const isAdmin = !!ADMIN_EMAIL && user?.email === ADMIN_EMAIL;

  useEffect(() => {
    if (!isAdmin || !supabase) return;
    setDataLoading(true);
    Promise.all([
      supabase.rpc('admin_get_users'),
      supabase.rpc('admin_get_export_stats'),
      supabase.rpc('admin_get_leads'),
      supabase.rpc('admin_get_recent_exports'),
      supabase.rpc('admin_get_daily_visitors'),
      supabase.rpc('admin_get_referrer_stats'),
      supabase.rpc('admin_get_device_stats'),
      supabase.rpc('admin_get_exports_by_user'),
    ]).then(([u, e, l, re, dv, ref, dev, ebu]) => {
      if (u.error) { setDataError(u.error.message); setDataLoading(false); return; }
      setUsers(u.data || []);
      setExportStats(e.data || []);
      setLeads(l.data || []);
      setRecentExports(re.data || []);
      setDailyVisitors(dv.data || []);
      setReferrerStats(ref.data || []);
      setDeviceStats(dev.data || []);
      setExportsByUser(ebu.data || []);
      setDataLoading(false);
      // Fetch heatmap data separately so a missing RPC doesn't break the dashboard
      supabase.rpc('admin_get_landing_clicks').then(({ data }) => {
        setHeatmapData(data || []);
      }).catch(() => {});
    }).catch((err) => {
      setDataError(err.message || 'Failed to load dashboard data');
      setDataLoading(false);
    });
  }, [isAdmin]);

  useEffect(() => {
    if (!isAdmin || !supabase) return;
    const fetchLive = async () => {
      const { data } = await supabase.rpc('admin_get_live_visitors').catch(() => ({ data: null }));
      setLiveVisitors(data?.[0]?.count ?? 0);
    };
    fetchLive();
    const interval = setInterval(fetchLive, 30000);
    return () => clearInterval(interval);
  }, [isAdmin]);

  async function handleLogin(e) {
    e.preventDefault();
    setLoginError('');
    setLoggingIn(true);
    try { await signIn(email, password); }
    catch (err) { setLoginError(err.message || 'Login failed'); }
    finally { setLoggingIn(false); }
  }

  // Pagination (hooks must be called unconditionally before any early returns)
  const exportsByUserPag = usePagination(exportsByUser, 10);
  const recentExportsPag = usePagination(recentExports, 10);
  const usersPag         = usePagination(users, 10);
  const leadsPag         = usePagination(leads, 10);

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

  if (authLoading) return (
    <div className="adm-shell"><div className="adm-login-card"><div className="adm-spinner" /></div></div>
  );

  if (!user) return (
    <div className="adm-shell">
      <div className="adm-login-card">
        <div className="adm-login-logo">🗺️</div>
        <h2>Admin</h2>
        <p className="adm-muted">Exploration Maps dashboard</p>
        <form onSubmit={handleLogin} className="adm-login-form">
          <input type="email" placeholder="Email" value={email}
            onChange={(e) => setEmail(e.target.value)} required autoFocus />
          <input type="password" placeholder="Password" value={password}
            onChange={(e) => setPassword(e.target.value)} required />
          {loginError && <p className="adm-error">{loginError}</p>}
          <button type="submit" className="adm-btn adm-btn-primary" disabled={loggingIn}>
            {loggingIn ? 'Signing in…' : 'Sign In'}
          </button>
        </form>
        <button className="adm-back-link" onClick={onExit}>← Back to app</button>
      </div>
    </div>
  );

  if (!isAdmin) return (
    <div className="adm-shell">
      <div className="adm-login-card">
        <h2>Access denied</h2>
        <p className="adm-muted">Signed in as <strong>{user.email}</strong></p>
        <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
          <button className="adm-btn adm-btn-ghost" onClick={() => signOut()}>Sign Out</button>
          <button className="adm-btn adm-btn-ghost" onClick={onExit}>← Back</button>
        </div>
      </div>
    </div>
  );

  // ── Derived values ────────────────────────────────────────────────────────
  const totalExports  = (exportStats || []).reduce((s, r) => s + Number(r.total || 0), 0);
  const exports30d    = (exportStats || []).reduce((s, r) => s + Number(r.last_30_days || 0), 0);
  const visitors30d   = (dailyVisitors || []).reduce((s, r) => s + Number(r.sessions || 0), 0);
  const exportBreakdown = (exportStats || []).map((r) => `${r.format?.toUpperCase()} ${r.last_30_days}`).join(' · ');

  // ── Dashboard ─────────────────────────────────────────────────────────────
  return (
    <div className="adm-shell">
      {/* Header */}
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
        {dataError && <div className="adm-error-bar">⚠ {dataError}</div>}

        {/* KPI row */}
        <div className="adm-kpi-row">
          <KPI label="Live now" value={liveVisitors != null ? String(liveVisitors) : null} detail="active last 5 min" accent="#ef4444" />
          <KPI label="Visitors (30 days)" value={dataLoading ? null : fmtNum(visitors30d)} accent="#3b82f6" />
          <KPI label="Exports (30 days)" value={dataLoading ? null : fmtNum(exports30d)} detail={exportBreakdown || null} accent="#8b5cf6" />
          <KPI label="Total exports" value={dataLoading ? null : fmtNum(totalExports)} accent="#0ea5e9" />
          <KPI label="Registered users" value={dataLoading ? null : fmtNum(users?.length)} accent="#10b981" />
          <KPI label="Email leads" value={dataLoading ? null : fmtNum(leads?.length)} accent="#f59e0b" />
        </div>

        {/* Traffic */}
        <div className="adm-card">
          <SectionHeader title="Traffic" />
          <div className="adm-traffic-layout">
            {/* Chart */}
            <div className="adm-chart-col">
              <p className="adm-chart-eyebrow">Daily sessions — last 30 days</p>
              <BarChart data={dailyVisitors} />
            </div>
            {/* Sources + devices */}
            <div className="adm-sources-col">
              <p className="adm-chart-eyebrow">Top sources</p>
              {referrerStats && referrerStats.length > 0 ? (
                <div className="adm-source-list">
                  {(() => {
                    const total = referrerStats.reduce((s, r) => s + Number(r.sessions), 0);
                    return referrerStats.slice(0, 7).map((r) => {
                      const pct = Math.round((Number(r.sessions) / total) * 100);
                      return (
                        <div key={r.referrer || 'direct'} className="adm-source-row">
                          <div className="adm-source-name" title={r.referrer || 'Direct / Unknown'}>
                            {r.referrer || 'Direct / Unknown'}
                          </div>
                          <div className="adm-source-track">
                            <div className="adm-source-fill" style={{ width: `${pct}%` }} />
                          </div>
                          <div className="adm-source-num">{r.sessions}</div>
                        </div>
                      );
                    });
                  })()}
                </div>
              ) : <Empty message="No referrer data yet." />}

              <p className="adm-chart-eyebrow" style={{ marginTop: 24 }}>Devices</p>
              <div className="adm-device-row">
                {(deviceStats || []).map((r) => (
                  <div key={r.device} className="adm-device-chip">
                    <span className="adm-device-icon">{r.device === 'mobile' ? '📱' : '🖥️'}</span>
                    <div>
                      <div className="adm-device-name">{r.device || 'desktop'}</div>
                      <div className="adm-device-num">{fmtNum(r.sessions)} sessions</div>
                    </div>
                  </div>
                ))}
                {(!deviceStats || deviceStats.length === 0) && <Empty message="No data yet." />}
              </div>
            </div>
          </div>
        </div>

        {/* Two-column row: Exports by user + Recent exports */}
        <div className="adm-two-col">
          {/* Exports by user */}
          <div className="adm-card">
            <SectionHeader title="Exports by user" count={exportsByUser?.length} />
            {exportsByUser && exportsByUser.length > 0 ? (
              <>
                <table className="adm-table">
                  <thead>
                    <tr><th>User</th><th>PNG</th><th>SVG</th><th>PDF</th><th>Total</th><th>Last</th></tr>
                  </thead>
                  <tbody>
                    {exportsByUserPag.slice.map((r, i) => (
                      <tr key={i}>
                        <td className="adm-mono">{r.user_email || <span className="adm-muted">Anon</span>}</td>
                        <td>{r.png_count ?? 0}</td>
                        <td>{r.svg_count ?? 0}</td>
                        <td>{r.pdf_count ?? 0}</td>
                        <td><strong>{r.total_exports}</strong></td>
                        <td className="adm-muted">{fmt(r.last_export)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <Pagination {...exportsByUserPag} />
              </>
            ) : <Empty message="No exports tracked yet." />}
          </div>

          {/* Recent exports feed */}
          <div className="adm-card">
            <SectionHeader title="Recent exports" count={recentExports?.length} />
            {recentExports && recentExports.length > 0 ? (
              <>
                <table className="adm-table">
                  <thead>
                    <tr><th>Format</th><th>Project</th><th>User</th><th>When</th></tr>
                  </thead>
                  <tbody>
                    {recentExportsPag.slice.map((r, i) => (
                      <tr key={i}>
                        <td><FormatBadge format={r.format} /></td>
                        <td className="adm-muted adm-truncate">{r.project_name || '—'}</td>
                        <td className="adm-muted adm-truncate">{r.user_email || 'Anonymous'}</td>
                        <td className="adm-muted" style={{ whiteSpace: 'nowrap' }}>{fmtTime(r.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <Pagination {...recentExportsPag} />
              </>
            ) : <Empty message="No exports yet." />}
          </div>
        </div>

        {/* Users */}
        <div className="adm-card">
          <SectionHeader title="Users" count={users?.length} />
          {users && users.length > 0 ? (
            <>
              <table className="adm-table">
                <thead>
                  <tr><th>Email</th><th>Joined</th><th>Last login</th><th>Projects</th><th></th></tr>
                </thead>
                <tbody>
                  {usersPag.slice.map((u) => (
                    <React.Fragment key={u.id}>
                      <tr className={editingUser?.id === u.id ? 'adm-row-active' : ''}>
                        <td>
                          <span className="adm-mono">{u.email}</span>
                          {u.email === ADMIN_EMAIL && <span className="adm-tag adm-tag-blue" style={{ marginLeft: 8 }}>you</span>}
                        </td>
                        <td className="adm-muted">{fmt(u.created_at)}</td>
                        <td className="adm-muted">{fmt(u.last_sign_in_at)}</td>
                        <td>{u.project_count ?? 0}</td>
                        <td>
                          <button className="adm-btn adm-btn-ghost adm-btn-sm"
                            onClick={() => setEditingUser(editingUser?.id === u.id ? null : u)}>
                            {editingUser?.id === u.id ? 'Close' : 'Details'}
                          </button>
                        </td>
                      </tr>
                      {editingUser?.id === u.id && (
                        <tr className="adm-row-active">
                          <td colSpan={5} style={{ padding: '12px 16px 16px' }}>
                            <div className="adm-user-detail">
                              <div className="adm-detail-grid">
                                <span className="adm-detail-label">User ID</span>
                                <code className="adm-detail-val">{u.id}</code>
                                <span className="adm-detail-label">Joined</span>
                                <span className="adm-detail-val">{fmtTime(u.created_at)}</span>
                                <span className="adm-detail-label">Last login</span>
                                <span className="adm-detail-val">{fmtTime(u.last_sign_in_at)}</span>
                                <span className="adm-detail-label">Projects</span>
                                <span className="adm-detail-val">{u.project_count ?? 0}</span>
                              </div>
                              <p className="adm-detail-note">
                                To reset password or disable account →{' '}
                                <a href="https://supabase.com/dashboard" target="_blank" rel="noopener noreferrer">
                                  Supabase Dashboard → Authentication → Users
                                </a>
                              </p>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
              <Pagination {...usersPag} />
            </>
          ) : <Empty message="No users yet." />}
        </div>

        {/* Leads */}
        <div className="adm-card">
          <SectionHeader title="Email leads" count={leads?.length} />
          {leads && leads.length > 0 ? (
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
        </div>

      </main>

      {/* Landing page heatmap — full shell width so iframe renders large enough to read */}
      <div className="adm-heatmap-section">
        <div className="adm-section-header" style={{ padding: '0 24px 12px' }}>
          <h2 className="adm-section-title">Landing page clicks</h2>
          {heatmapData && <span className="adm-pill">{heatmapData.reduce((s, d) => s + Number(d.count), 0)} total</span>}
        </div>
        {heatmapData && heatmapData.length > 0 ? (
          <LandingHeatmap data={heatmapData} />
        ) : (
          <div style={{ padding: '0 24px 40px' }}>
            <Empty message="No click data yet — visit the landing page a few times to populate this." />
          </div>
        )}
      </div>
    </div>
  );
}
