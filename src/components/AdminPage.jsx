import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';

const ADMIN_EMAIL = import.meta.env.VITE_ADMIN_EMAIL;

function StatCard({ label, value, sub }) {
  return (
    <div className="admin-stat-card">
      <div className="admin-stat-value">{value ?? '—'}</div>
      <div className="admin-stat-label">{label}</div>
      {sub && <div className="admin-stat-sub">{sub}</div>}
    </div>
  );
}

function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-CA', { year: 'numeric', month: 'short', day: 'numeric' });
}

function formatDateTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-CA', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export default function AdminPage({ onExit }) {
  const { user, loading: authLoading, signIn, signOut } = useAuth();

  // Login form state
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [loggingIn, setLoggingIn] = useState(false);

  // Dashboard data
  const [users, setUsers] = useState(null);
  const [exportStats, setExportStats] = useState(null);
  const [leads, setLeads] = useState(null);
  const [recentExports, setRecentExports] = useState(null);
  const [dataLoading, setDataLoading] = useState(false);
  const [dataError, setDataError] = useState('');

  // User edit modal
  const [editingUser, setEditingUser] = useState(null);

  const isAdmin = !!ADMIN_EMAIL && user?.email === ADMIN_EMAIL;

  // Load dashboard data when admin is confirmed
  useEffect(() => {
    if (!isAdmin || !supabase) return;
    setDataLoading(true);
    setDataError('');

    Promise.all([
      supabase.rpc('admin_get_users'),
      supabase.rpc('admin_get_export_stats'),
      supabase.rpc('admin_get_leads'),
      supabase.rpc('admin_get_recent_exports'),
    ]).then(([u, e, l, re]) => {
      if (u.error) { setDataError(u.error.message); return; }
      setUsers(u.data || []);
      setExportStats(e.data || []);
      setLeads(l.data || []);
      setRecentExports(re.data || []);
      setDataLoading(false);
    });
  }, [isAdmin]);

  // ── Login form ────────────────────────────────────────────────────────────
  async function handleLogin(e) {
    e.preventDefault();
    setLoginError('');
    setLoggingIn(true);
    try {
      await signIn(email, password);
      // After signIn, user state updates via onAuthStateChange.
      // If the email doesn't match ADMIN_EMAIL we'll show the "not admin" message.
    } catch (err) {
      setLoginError(err.message || 'Login failed');
    } finally {
      setLoggingIn(false);
    }
  }

  // ── Not configured ────────────────────────────────────────────────────────
  if (!supabase) {
    return (
      <div className="admin-shell">
        <div className="admin-login-card">
          <h2>Admin Dashboard</h2>
          <p className="admin-error">Supabase is not configured. Add <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> to your environment.</p>
          <button className="btn" onClick={onExit}>← Back to App</button>
        </div>
      </div>
    );
  }

  // ── Loading auth ──────────────────────────────────────────────────────────
  if (authLoading) {
    return (
      <div className="admin-shell">
        <div className="admin-login-card"><p>Loading…</p></div>
      </div>
    );
  }

  // ── Not logged in ─────────────────────────────────────────────────────────
  if (!user) {
    return (
      <div className="admin-shell">
        <div className="admin-login-card">
          <div className="admin-login-logo">🗺️</div>
          <h2>Admin Login</h2>
          <p className="admin-login-hint">explorationmaps.com admin panel</p>
          <form onSubmit={handleLogin} className="admin-login-form">
            <input
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
            />
            <input
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            {loginError && <p className="admin-error">{loginError}</p>}
            <button type="submit" className="btn primary" disabled={loggingIn}>
              {loggingIn ? 'Signing in…' : 'Sign In'}
            </button>
          </form>
          <button className="admin-back-link" onClick={onExit}>← Back to App</button>
        </div>
      </div>
    );
  }

  // ── Logged in but not admin ───────────────────────────────────────────────
  if (!isAdmin) {
    return (
      <div className="admin-shell">
        <div className="admin-login-card">
          <h2>Access Denied</h2>
          <p>Signed in as <strong>{user.email}</strong> — this account doesn't have admin access.</p>
          <div style={{ display: 'flex', gap: 12, marginTop: 20 }}>
            <button className="btn" onClick={() => signOut()}>Sign Out</button>
            <button className="btn" onClick={onExit}>← Back to App</button>
          </div>
        </div>
      </div>
    );
  }

  // ── Admin dashboard ───────────────────────────────────────────────────────
  const totalExports = (exportStats || []).reduce((s, r) => s + Number(r.total || 0), 0);
  const exports30d = (exportStats || []).reduce((s, r) => s + Number(r.last_30_days || 0), 0);

  return (
    <div className="admin-shell admin-dashboard">
      {/* Header */}
      <div className="admin-header">
        <div className="admin-header-left">
          <span className="admin-wordmark">🗺️ Exploration Maps</span>
          <span className="admin-badge">Admin</span>
        </div>
        <div className="admin-header-right">
          <span className="admin-user-chip">{user.email}</span>
          <button className="secondary-btn" onClick={() => signOut()}>Sign Out</button>
          <button className="secondary-btn" onClick={onExit}>← App</button>
        </div>
      </div>

      <div className="admin-body">
        {dataLoading && <p className="admin-loading">Loading dashboard data…</p>}
        {dataError && <p className="admin-error">Error: {dataError}</p>}

        {/* Stat cards */}
        {!dataLoading && (
          <div className="admin-stats-row">
            <StatCard label="Total Users" value={users?.length} />
            <StatCard label="Total Exports" value={totalExports} />
            <StatCard
              label="Exports (30 days)"
              value={exports30d}
              sub={
                (exportStats || [])
                  .map((r) => `${r.format?.toUpperCase()}: ${r.last_30_days}`)
                  .join(' · ')
              }
            />
            <StatCard label="Email Leads" value={leads?.length} />
          </div>
        )}

        {/* Export breakdown */}
        {exportStats && exportStats.length > 0 && (
          <section className="admin-section">
            <h2 className="admin-section-title">Exports by Format</h2>
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Format</th>
                  <th>All Time</th>
                  <th>Last 30 Days</th>
                </tr>
              </thead>
              <tbody>
                {exportStats.map((r) => (
                  <tr key={r.format}>
                    <td><span className="admin-format-badge">{r.format?.toUpperCase()}</span></td>
                    <td>{r.total}</td>
                    <td>{r.last_30_days}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        {/* Recent exports */}
        {recentExports && recentExports.length > 0 && (
          <section className="admin-section">
            <h2 className="admin-section-title">Recent Exports <span className="admin-section-count">({recentExports.length})</span></h2>
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Format</th>
                  <th>Project</th>
                  <th>User</th>
                  <th>Watermark</th>
                  <th>When</th>
                </tr>
              </thead>
              <tbody>
                {recentExports.map((r, i) => (
                  <tr key={i}>
                    <td><span className="admin-format-badge">{r.format?.toUpperCase()}</span></td>
                    <td className="admin-cell-muted">{r.project_name || '—'}</td>
                    <td className="admin-cell-muted">{r.user_email || 'Anonymous'}</td>
                    <td>{r.no_watermark ? '✓ No watermark' : <span className="admin-cell-muted">Watermarked</span>}</td>
                    <td className="admin-cell-muted">{formatDateTime(r.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        {/* Users table */}
        {users && (
          <section className="admin-section">
            <h2 className="admin-section-title">Users <span className="admin-section-count">({users.length})</span></h2>
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Email</th>
                  <th>Joined</th>
                  <th>Last Login</th>
                  <th>Projects</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} className={editingUser?.id === u.id ? 'admin-row-active' : ''}>
                    <td>
                      <span className="admin-email">{u.email}</span>
                      {u.email === ADMIN_EMAIL && <span className="admin-badge admin-badge-sm">Admin</span>}
                    </td>
                    <td className="admin-cell-muted">{formatDate(u.created_at)}</td>
                    <td className="admin-cell-muted">{formatDate(u.last_sign_in_at)}</td>
                    <td>{u.project_count ?? 0}</td>
                    <td>
                      <button
                        className="secondary-btn admin-edit-btn"
                        onClick={() => setEditingUser(editingUser?.id === u.id ? null : u)}
                      >
                        {editingUser?.id === u.id ? 'Close' : 'Details'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        {/* User detail panel */}
        {editingUser && (
          <div className="admin-user-detail">
            <div className="admin-user-detail-header">
              <h3>{editingUser.email}</h3>
              <button className="secondary-btn" onClick={() => setEditingUser(null)}>✕</button>
            </div>
            <div className="admin-user-detail-body">
              <div className="admin-detail-row">
                <span className="admin-detail-label">User ID</span>
                <code className="admin-detail-value">{editingUser.id}</code>
              </div>
              <div className="admin-detail-row">
                <span className="admin-detail-label">Joined</span>
                <span className="admin-detail-value">{formatDateTime(editingUser.created_at)}</span>
              </div>
              <div className="admin-detail-row">
                <span className="admin-detail-label">Last Sign In</span>
                <span className="admin-detail-value">{formatDateTime(editingUser.last_sign_in_at)}</span>
              </div>
              <div className="admin-detail-row">
                <span className="admin-detail-label">Projects</span>
                <span className="admin-detail-value">{editingUser.project_count ?? 0}</span>
              </div>
              <p className="admin-detail-note">
                To reset this user's password or disable their account, use the{' '}
                <a href="https://supabase.com/dashboard" target="_blank" rel="noopener noreferrer">
                  Supabase Dashboard → Authentication → Users
                </a>.
              </p>
            </div>
          </div>
        )}

        {/* Leads table */}
        {leads && leads.length > 0 && (
          <section className="admin-section">
            <h2 className="admin-section-title">Email Leads <span className="admin-section-count">({leads.length})</span></h2>
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Email</th>
                  <th>Project</th>
                  <th>Captured</th>
                </tr>
              </thead>
              <tbody>
                {leads.map((l, i) => (
                  <tr key={i}>
                    <td className="admin-email">{l.email}</td>
                    <td className="admin-cell-muted">{l.project_title || '—'}</td>
                    <td className="admin-cell-muted">{formatDateTime(l.captured_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        {leads && leads.length === 0 && !dataLoading && (
          <section className="admin-section">
            <h2 className="admin-section-title">Email Leads</h2>
            <p className="admin-cell-muted">No leads captured yet. Leads appear when users enter their email in the export modal.</p>
          </section>
        )}
      </div>
    </div>
  );
}
