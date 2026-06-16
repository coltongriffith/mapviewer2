import React, { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';
import { LAND_DOTS } from '../utils/worldDots';

const ADMIN_EMAIL = import.meta.env.VITE_ADMIN_EMAIL;

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

function RangeToggle({ value, onChange, options }) {
  return (
    <div className="adm-range-toggle">
      {options.map((o) => (
        <button key={o} className={`adm-range-btn${value === o ? ' active' : ''}`} onClick={() => onChange(o)}>
          {o}d
        </button>
      ))}
    </div>
  );
}

function Empty({ message }) {
  return <p className="adm-empty">{message}</p>;
}

function FormatBadge({ format }) {
  const colors = { png: '#0ea5e9', svg: '#8b5cf6', pdf: '#f59e0b' };
  const bg = colors[format?.toLowerCase()] || '#64748b';
  return <span className="adm-format-badge" style={{ background: bg + '20', color: bg }}>{format?.toUpperCase()}</span>;
}

// ── Charts ──────────────────────────────────────────────────────────────────────
function AreaChart({ data }) {
  const [hover, setHover] = useState(null); // index
  if (!data || data.length === 0) {
    return <Empty message="No visit data yet — sessions appear here once users land on the app." />;
  }
  const pts = [...data]; // oldest → newest
  const n = pts.length;
  const W = 720, H = 180, P = 8;
  const vals = pts.map((p) => Number(p.sessions) || 0);
  const max = Math.max(...vals, 1);
  const stepX = n > 1 ? (W - 2 * P) / (n - 1) : 0;
  const xAt = (i) => (n > 1 ? P + i * stepX : W / 2);
  const yAt = (v) => H - P - (v / max) * (H - 2 * P - 14);
  const line = pts.map((p, i) => `${xAt(i).toFixed(1)},${yAt(Number(p.sessions) || 0).toFixed(1)}`);
  const linePath = 'M' + line.join(' L');
  const areaPath = `M${xAt(0).toFixed(1)},${H - P} L` + line.join(' L') + ` L${xAt(n - 1).toFixed(1)},${H - P} Z`;
  const lastIdx = n - 1;
  const labelIdx = n > 2 ? [0, Math.floor(lastIdx / 2), lastIdx] : pts.map((_, i) => i);

  function handleMove(e) {
    const rect = e.currentTarget.getBoundingClientRect();
    const rel = (e.clientX - rect.left) / rect.width;
    setHover(Math.max(0, Math.min(n - 1, Math.round(rel * (n - 1)))));
  }
  const hp = hover != null ? pts[hover] : null;
  const hoverLeftPct = hover != null && n > 1 ? (hover / (n - 1)) * 100 : 50;

  return (
    <div className="adm-area-wrap" onMouseMove={handleMove} onMouseLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} className="adm-area-svg" preserveAspectRatio="none">
        <defs>
          <linearGradient id="admArea" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.28" />
            <stop offset="100%" stopColor="#3b82f6" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0.5, 1].map((f) => (
          <line key={f} x1={P} x2={W - P} y1={yAt(max * f)} y2={yAt(max * f)} className="adm-area-grid" />
        ))}
        <path d={areaPath} fill="url(#admArea)" />
        <path d={linePath} className="adm-area-line" />
        {hp && (
          <line x1={xAt(hover)} x2={xAt(hover)} y1={P} y2={H - P} className="adm-area-guide" />
        )}
        <circle cx={xAt(lastIdx)} cy={yAt(vals[lastIdx])} r={3} className="adm-area-dot" />
        {hp && (
          <circle cx={xAt(hover)} cy={yAt(vals[hover])} r={4} className="adm-area-dot-hover" />
        )}
      </svg>
      {hp && (
        <div className="adm-area-tip" style={{ left: `${hoverLeftPct}%` }}>
          <div className="adm-area-tip-date">{hp.visit_date}</div>
          <div className="adm-area-tip-row"><span className="adm-area-tip-dot" />{fmtNum(hp.sessions)} sessions</div>
          <div className="adm-area-tip-row adm-muted">{fmtNum(hp.logged_in_sessions ?? 0)} logged in</div>
        </div>
      )}
      <div className="adm-area-axis">
        {labelIdx.map((i) => <span key={i}>{pts[i].visit_date?.slice(5)}</span>)}
      </div>
    </div>
  );
}

function Donut({ segments, centerLabel }) {
  const total = segments.reduce((s, x) => s + Number(x.value || 0), 0);
  if (!total) return <Empty message="No data yet." />;
  const R = 42, C = 2 * Math.PI * R;
  let acc = 0;
  return (
    <div className="adm-donut-wrap">
      <svg viewBox="0 0 100 100" className="adm-donut">
        <circle cx="50" cy="50" r={R} fill="none" stroke="#f1f5f9" strokeWidth="14" />
        {segments.map((s, i) => {
          const frac = Number(s.value || 0) / total;
          const dash = frac * C;
          const el = (
            <circle key={i} cx="50" cy="50" r={R} fill="none" stroke={s.color} strokeWidth="14"
              strokeDasharray={`${dash} ${C - dash}`} strokeDashoffset={-acc * C}
              transform="rotate(-90 50 50)" />
          );
          acc += frac;
          return el;
        })}
        <text x="50" y="47" textAnchor="middle" className="adm-donut-num">{fmtNum(total)}</text>
        <text x="50" y="60" textAnchor="middle" className="adm-donut-lbl">{centerLabel}</text>
      </svg>
      <div className="adm-donut-legend">
        {segments.map((s, i) => (
          <div key={i} className="adm-donut-leg-row">
            <span className="adm-donut-dot" style={{ background: s.color }} />
            <span className="adm-donut-leg-label">{s.label}</span>
            <span className="adm-donut-leg-val">{pct(s.value, total)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function HBars({ rows, color = '#3b82f6', emptyMsg }) {
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

function Funnel({ steps }) {
  const top = steps[0]?.value || 1;
  return (
    <div className="adm-funnel">
      {steps.map((s, i) => {
        const conv = i > 0 ? pct(s.value, steps[i - 1].value) : null;
        return (
          <div key={i} className="adm-funnel-step">
            <div className="adm-funnel-meta">
              <span className="adm-funnel-label">{s.label}</span>
              <span className="adm-funnel-val">{fmtNum(s.value)}</span>
            </div>
            <div className="adm-funnel-track">
              <div className="adm-funnel-bar" style={{ width: `${Math.max(3, pct(s.value, top))}%`, background: s.color }} />
            </div>
            {conv != null && (
              <div className="adm-funnel-conv">
                <span className="adm-funnel-arrow">↳</span> {conv}% convert from {steps[i - 1].label.toLowerCase()}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// Orthographic (3D sphere) projection of a lon/lat point. Returns null when the
// point is on the far side of the globe (not visible from the current rotation).
const GLOBE_TILT = 16; // degrees — slight downward tilt for a nicer view of land
function projectOrtho(lon, lat, rotationDeg, R) {
  const lambda = (lon * Math.PI) / 180;
  const phi = (lat * Math.PI) / 180;
  const lambda0 = (rotationDeg * Math.PI) / 180;
  const phi0 = (GLOBE_TILT * Math.PI) / 180;
  const cosc = Math.sin(phi0) * Math.sin(phi) + Math.cos(phi0) * Math.cos(phi) * Math.cos(lambda - lambda0);
  if (cosc < -0.03) return null; // back of the sphere
  const x = R * Math.cos(phi) * Math.sin(lambda - lambda0);
  const y = R * (Math.cos(phi0) * Math.sin(phi) - Math.sin(phi0) * Math.cos(phi) * Math.cos(lambda - lambda0));
  return { x, y, depth: Math.max(0, cosc) };
}

// Recover raw lon/lat from the precomputed equirectangular LAND_DOTS (x = lon+180, y = 90-lat).
const LAND_LONLAT = LAND_DOTS.map(([x, y]) => [x - 180, 90 - y]);

function WorldMap({ locations }) {
  const R = 100;
  const [rotation, setRotation] = useState(-20);
  const pausedRef = useRef(false);
  const draggingRef = useRef(false);
  const lastXRef = useRef(0);
  const resumeTimerRef = useRef(null);

  useEffect(() => {
    let raf;
    const tick = () => {
      if (!pausedRef.current) setRotation((r) => r + 0.1);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const pings = useMemo(
    () => (locations || []).filter((l) => l.lat != null && l.lng != null),
    [locations]
  );
  // Collapse to unique cities for the legend
  const byCity = useMemo(() => {
    const seen = new Set();
    const out = [];
    for (const l of pings) {
      const key = `${l.city || ''}|${l.country || ''}`;
      if (!seen.has(key)) { seen.add(key); out.push(l); }
    }
    return out;
  }, [pings]);

  const land = useMemo(() => {
    const out = [];
    for (const [lon, lat] of LAND_LONLAT) {
      const p = projectOrtho(lon, lat, rotation, R);
      if (p) out.push(p);
    }
    return out;
  }, [rotation]);

  const pingPoints = useMemo(() => {
    const out = [];
    for (const l of pings) {
      const p = projectOrtho(l.lng, l.lat, rotation, R);
      if (p) out.push({ ...p, city: l.city, country: l.country });
    }
    return out;
  }, [pings, rotation]);

  function pauseThenResume() {
    if (resumeTimerRef.current) clearTimeout(resumeTimerRef.current);
    resumeTimerRef.current = setTimeout(() => { pausedRef.current = false; }, 1800);
  }
  function onPointerDown(e) {
    draggingRef.current = true;
    pausedRef.current = true;
    lastXRef.current = e.clientX;
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }
  function onPointerMove(e) {
    if (!draggingRef.current) return;
    const dx = e.clientX - lastXRef.current;
    lastXRef.current = e.clientX;
    setRotation((r) => r + dx * 0.5);
  }
  function onPointerUp() {
    draggingRef.current = false;
    pauseThenResume();
  }

  return (
    <div>
      <div
        className="adm-globe-wrap"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
      >
        <svg viewBox={`${-R - 12} ${-R - 12} ${2 * R + 24} ${2 * R + 24}`} className="adm-globe-svg">
          <defs>
            <radialGradient id="admGlobeShade" cx="35%" cy="30%" r="75%">
              <stop offset="0%" stopColor="#27406b" />
              <stop offset="100%" stopColor="#0a0f1c" />
            </radialGradient>
          </defs>
          <circle cx="0" cy="0" r={R} fill="url(#admGlobeShade)" className="adm-globe-sphere" />
          {land.map((p, i) => (
            <circle key={i} cx={p.x} cy={p.y} r="1.1" className="adm-globe-land" style={{ opacity: Math.max(0.25, p.depth) }} />
          ))}
          {pingPoints.map((p, i) => (
            <g key={i} style={{ opacity: Math.max(0.35, p.depth) }}>
              <circle cx={p.x} cy={p.y} r="2.6" className="adm-globe-ping-halo" />
              <circle cx={p.x} cy={p.y} r="1.8" className="adm-globe-ping" />
            </g>
          ))}
          <circle cx="0" cy="0" r={R} fill="none" className="adm-globe-rim" />
        </svg>
        {pings.length === 0 && <div className="adm-globe-empty">No live visitors right now</div>}
      </div>
      {byCity.length > 0 && (
        <div className="adm-worldmap-legend">
          {byCity.slice(0, 10).map((l, i) => (
            <span key={i} className="adm-worldmap-loc">
              <span className="adm-donut-dot" />
              {[l.city, l.country].filter(Boolean).join(', ') || 'Unknown'}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
const RPC_CALLS = [
  ['users', 'admin_get_users'],
  ['exportStats', 'admin_get_export_stats'],
  ['leads', 'admin_get_leads'],
  ['recentExports', 'admin_get_recent_exports'],
  ['dailyVisitors', 'admin_get_daily_visitors'],
  ['referrerStats', 'admin_get_referrer_stats'],
  ['deviceStats', 'admin_get_device_stats'],
  ['exportsByUser', 'admin_get_exports_by_user'],
  ['kpiTrends', 'admin_get_kpi_trends'],
  ['funnel', 'admin_get_funnel'],
  ['campaignStats', 'admin_get_campaign_stats'],
  ['searchStats', 'admin_get_search_stats'],
  ['topSharedMaps', 'admin_get_top_shared_maps'],
  ['landingClicks', 'admin_get_landing_clicks'],
];

const TABS = [
  ['overview', 'Overview'],
  ['growth', 'Acquisition'],
  ['product', 'Product'],
  ['revenue', 'Monetization'],
  ['users', 'Users'],
];

export default function AdminPage({ onExit }) {
  const { user, loading: authLoading, signIn, signOut } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [loggingIn, setLoggingIn] = useState(false);

  const [d, setD] = useState({});
  const [liveVisitors, setLiveVisitors] = useState(null);
  const [liveLocations, setLiveLocations] = useState([]);
  const [dataLoading, setDataLoading] = useState(false);
  const [dataError, setDataError] = useState('');
  const [editingUser, setEditingUser] = useState(null);
  const [tab, setTab] = useState('overview');
  const [range, setRange] = useState(30);

  const isAdmin = !!ADMIN_EMAIL && user?.email === ADMIN_EMAIL;

  useEffect(() => {
    if (!isAdmin || !supabase) return;
    setDataLoading(true);
    setDataError('');
    Promise.allSettled(RPC_CALLS.map(([, fn]) => supabase.rpc(fn))).then((results) => {
      const next = {};
      let firstError = '';
      results.forEach((res, i) => {
        const [key] = RPC_CALLS[i];
        if (res.status === 'fulfilled' && !res.value.error) {
          next[key] = res.value.data || [];
        } else {
          next[key] = [];
          const msg = res.status === 'fulfilled' ? res.value.error?.message : res.reason?.message;
          // Surface only the critical (users) failure — newer RPCs may not be installed yet
          if (key === 'users' && msg && !firstError) firstError = msg;
        }
      });
      setD(next);
      setDataError(firstError);
      setDataLoading(false);
    });
  }, [isAdmin]);

  useEffect(() => {
    if (!isAdmin || !supabase) return;
    const fetchLive = async () => {
      const { data } = await supabase.rpc('admin_get_live_visitors').catch(() => ({ data: null }));
      setLiveVisitors(data?.[0]?.count ?? 0);
      const loc = await supabase.rpc('admin_get_live_locations').catch(() => ({ data: null }));
      setLiveLocations(loc?.data || []);
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

  // Pagination hooks (must run unconditionally, before any early return)
  const exportsByUserPag = usePagination(d.exportsByUser, 10);
  const recentExportsPag = usePagination(d.recentExports, 10);
  const usersPag = usePagination(d.users, 10);
  const leadsPag = usePagination(d.leads, 10);
  const campaignPag = usePagination(d.campaignStats, 10);
  const searchPag = usePagination(d.searchStats, 12);

  // Derived values (hooks before early returns)
  const trendMap = useMemo(() => {
    const m = {};
    (d.kpiTrends || []).forEach((r) => { m[r.metric] = { cur: Number(r.current_30d), prior: Number(r.prior_30d) }; });
    return m;
  }, [d.kpiTrends]);

  const searchByProvince = useMemo(() => {
    const m = new Map();
    (d.searchStats || []).forEach((r) => m.set(r.province, (m.get(r.province) || 0) + Number(r.searches)));
    return [...m.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
  }, [d.searchStats]);

  const premiumUsers = useMemo(
    () => (d.exportsByUser || []).filter((r) => Number(r.premium_count) > 0)
      .sort((a, b) => Number(b.premium_count) - Number(a.premium_count)),
    [d.exportsByUser]
  );

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
        <h2>Access denied</h2>
        <p className="adm-muted">Signed in as <strong>{user.email}</strong></p>
        <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
          <button className="adm-btn adm-btn-ghost" onClick={() => signOut()}>Sign Out</button>
          <button className="adm-btn adm-btn-ghost" onClick={onExit}>← Back</button>
        </div>
      </div>
    </div>
  );

  // ── Derived headline numbers ───────────────────────────────────────────────
  const cur = (m) => trendMap[m]?.cur;
  const visitors30d = cur('visitors') ?? (d.dailyVisitors || []).reduce((s, r) => s + Number(r.sessions || 0), 0);
  const exports30d = cur('exports') ?? (d.exportStats || []).reduce((s, r) => s + Number(r.last_30_days || 0), 0);
  const exportBreakdown = (d.exportStats || []).map((r) => `${r.format?.toUpperCase()} ${r.last_30_days}`).join(' · ');

  // Date-range filtering for the traffic chart (daily visitors RPC returns up to 90 days)
  const rangeDaily = (d.dailyVisitors || []).slice(-range);
  const rangeTotals = (() => {
    const sessions = rangeDaily.reduce((s, r) => s + Number(r.sessions || 0), 0);
    const loggedIn = rangeDaily.reduce((s, r) => s + Number(r.logged_in_sessions || 0), 0);
    return { sessions, loggedIn, avg: rangeDaily.length ? Math.round(sessions / rangeDaily.length) : 0 };
  })();

  const f = (d.funnel || [])[0] || {};
  const funnelSteps = [
    { label: 'Visitors', value: Number(f.visitors) || visitors30d || 0, color: '#3b82f6' },
    { label: 'Signups', value: Number(f.signups) || cur('signups') || 0, color: '#6366f1' },
    { label: 'Activated (exported)', value: Number(f.exporters) || 0, color: '#8b5cf6' },
    { label: 'Paid intent (no-watermark)', value: Number(f.premium_exporters) || 0, color: '#10b981' },
  ];

  const formatColors = { png: '#0ea5e9', svg: '#8b5cf6', pdf: '#f59e0b' };
  const formatSegments = (d.exportStats || []).map((r) => ({
    label: r.format?.toUpperCase(), value: Number(r.total), color: formatColors[r.format?.toLowerCase()] || '#64748b',
  }));
  const deviceSegments = (d.deviceStats || []).map((r, i) => ({
    label: r.device || 'desktop', value: Number(r.sessions), color: ['#3b82f6', '#93c5fd', '#cbd5e1'][i] || '#e2e8f0',
  }));
  const referrerBars = (d.referrerStats || []).slice(0, 8).map((r) => ({ label: r.referrer || 'Direct / Unknown', value: Number(r.sessions) }));
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
        {dataError && <div className="adm-error-bar">⚠ {dataError}</div>}

        {/* KPI row — flow metrics with 30d-over-30d trend */}
        <div className="adm-kpi-row">
          <KPI label="Live now" value={liveVisitors != null ? String(liveVisitors) : null} detail="active · last 5 min" accent="#ef4444" />
          <KPI label="Visitors" value={dataLoading ? null : fmtNum(visitors30d)} trend={trendMap.visitors} detail="last 30 days" accent="#3b82f6" />
          <KPI label="Signups" value={dataLoading ? null : fmtNum(cur('signups') ?? 0)} trend={trendMap.signups} detail="last 30 days" accent="#6366f1" />
          <KPI label="Searches" value={dataLoading ? null : fmtNum(cur('searches') ?? 0)} trend={trendMap.searches} detail="registry + nearby" accent="#0ea5e9" />
          <KPI label="Exports" value={dataLoading ? null : fmtNum(exports30d)} trend={trendMap.exports} detail={exportBreakdown || 'last 30 days'} accent="#8b5cf6" />
          <KPI label="Paid intent" value={dataLoading ? null : fmtNum(cur('premium_exports') ?? 0)} trend={trendMap.premium_exports} detail="no-watermark exports" accent="#10b981" />
          <KPI label="Email leads" value={dataLoading ? null : fmtNum(cur('leads') ?? (d.leads || []).length)} trend={trendMap.leads} detail="last 30 days" accent="#f59e0b" />
        </div>

        {/* Tab nav */}
        <div className="adm-tabs">
          {TABS.map(([key, label]) => (
            <button key={key} className={`adm-tab${tab === key ? ' active' : ''}`} onClick={() => setTab(key)}>{label}</button>
          ))}
        </div>

        {/* ───────── OVERVIEW ───────── */}
        {tab === 'overview' && (
          <>
            <div className="adm-grid-2-1">
              <Card
                title="Daily sessions"
                eyebrow={`Traffic · last ${range} days`}
                action={<RangeToggle value={range} onChange={setRange} options={[7, 30, 90]} />}
              >
                <div className="adm-traffic-summary">
                  <div className="adm-traffic-stat"><strong>{fmtNum(rangeTotals.sessions)}</strong><span>sessions</span></div>
                  <div className="adm-traffic-stat"><strong>{fmtNum(rangeTotals.loggedIn)}</strong><span>logged in</span></div>
                  <div className="adm-traffic-stat"><strong>{fmtNum(rangeTotals.avg)}</strong><span>avg / day</span></div>
                </div>
                <AreaChart data={rangeDaily} />
              </Card>
              <Card title="Conversion funnel" eyebrow="Last 30 days">
                <Funnel steps={funnelSteps} />
              </Card>
            </div>
            <Card
              title="Live visitors"
              eyebrow="Active in the last 30 minutes"
              action={<span className="adm-delta up">● {liveVisitors ?? 0} now</span>}
              full
            >
              <WorldMap locations={liveLocations} />
            </Card>
            <div className="adm-grid-3">
              <Card title="Top sources" eyebrow="Where visitors come from">
                <HBars rows={referrerBars} emptyMsg="No referrer data yet." />
              </Card>
              <Card title="Devices">
                <Donut segments={deviceSegments} centerLabel="sessions" />
              </Card>
              <Card title="Searches by province" eyebrow="Product demand">
                <HBars rows={searchByProvince.slice(0, 8)} color="#0ea5e9" emptyMsg="No searches tracked yet." />
              </Card>
            </div>
          </>
        )}

        {/* ───────── ACQUISITION ───────── */}
        {tab === 'growth' && (
          <>
            <Card title="Campaigns" eyebrow="UTM-tagged traffic · last 90 days" count={d.campaignStats?.length} full>
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
              <Card title="All referrers" eyebrow="Last 90 days">
                <HBars rows={(d.referrerStats || []).slice(0, 12).map((r) => ({ label: r.referrer, value: Number(r.sessions) }))} emptyMsg="No referrer data yet." />
              </Card>
              <Card title="Landing-page clicks" eyebrow="What visitors click" count={landingBars.reduce((s, r) => s + r.value, 0) || null}>
                <HBars rows={landingBars} color="#6366f1" emptyMsg="No click data yet." />
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

        {/* ───────── PRODUCT ───────── */}
        {tab === 'product' && (
          <>
            <div className="adm-grid-2">
              <Card title="Searches by province" eyebrow="Registry + nearby demand">
                <HBars rows={searchByProvince} color="#0ea5e9" emptyMsg="No searches tracked yet." />
              </Card>
              <Card title="Export formats" eyebrow="All time">
                <Donut segments={formatSegments} centerLabel="exports" />
              </Card>
            </div>
            <Card title="Search breakdown" eyebrow="Province × type · last 90 days" count={d.searchStats?.length} full>
              {d.searchStats && d.searchStats.length > 0 ? (
                <>
                  <table className="adm-table">
                    <thead><tr><th>Province</th><th>Type</th><th>Searches</th><th>Avg results</th><th>Last</th></tr></thead>
                    <tbody>
                      {searchPag.slice.map((r, i) => (
                        <tr key={i}>
                          <td><span className="adm-tag adm-tag-blue">{r.province}</span></td>
                          <td className="adm-muted">{r.kind}</td>
                          <td><strong>{fmtNum(r.searches)}</strong></td>
                          <td>{r.avg_results ?? '—'}</td>
                          <td className="adm-muted" style={{ whiteSpace: 'nowrap' }}>{fmt(r.last_search)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <Pagination {...searchPag} />
                </>
              ) : <Empty message="No searches tracked yet — they populate as users search the claims registry or run a nearby-claims lookup." />}
            </Card>
            <Card title="Most-viewed shared maps" eyebrow="Virality" count={d.topSharedMaps?.length} full>
              {d.topSharedMaps && d.topSharedMaps.length > 0 ? (
                <table className="adm-table">
                  <thead><tr><th>Map</th><th>Views</th></tr></thead>
                  <tbody>
                    {d.topSharedMaps.slice(0, 12).map((r) => (
                      <tr key={r.id}>
                        <td className="adm-mono adm-truncate"><a href={`/?share=${r.id}`} target="_blank" rel="noopener noreferrer">{r.id?.slice(0, 8)}…</a></td>
                        <td><strong>{fmtNum(r.view_count)}</strong></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : <Empty message="No shared maps viewed yet." />}
            </Card>
          </>
        )}

        {/* ───────── MONETIZATION ───────── */}
        {tab === 'revenue' && (
          <>
            <div className="adm-grid-2-1">
              <Card title="Path to revenue" eyebrow="Visitor → signup → activated → paid intent">
                <Funnel steps={funnelSteps} />
                <p className="adm-note">
                  <strong>Paid intent</strong> = users who exported without a watermark. These are your warmest candidates when you launch paid plans —
                  watermark removal is the most natural upgrade trigger.
                </p>
              </Card>
              <Card title="Conversion rates" eyebrow="Last 30 days">
                <div className="adm-stat-list">
                  <div className="adm-stat-row"><span>Visitor → Signup</span><strong>{pct(funnelSteps[1].value, funnelSteps[0].value)}%</strong></div>
                  <div className="adm-stat-row"><span>Signup → Activated</span><strong>{pct(funnelSteps[2].value, funnelSteps[1].value)}%</strong></div>
                  <div className="adm-stat-row"><span>Activated → Paid intent</span><strong>{pct(funnelSteps[3].value, funnelSteps[2].value)}%</strong></div>
                  <div className="adm-stat-row adm-stat-total"><span>Visitor → Paid intent</span><strong>{pct(funnelSteps[3].value, funnelSteps[0].value)}%</strong></div>
                </div>
              </Card>
            </div>
            <Card title="Paid-intent users" eyebrow="Exported without watermark — your upgrade list" count={premiumUsers.length} full>
              {premiumUsers.length > 0 ? (
                <table className="adm-table">
                  <thead><tr><th>User</th><th>No-watermark</th><th>Total exports</th><th>Intent rate</th><th>Last export</th></tr></thead>
                  <tbody>
                    {premiumUsers.slice(0, 25).map((r, i) => (
                      <tr key={i}>
                        <td className="adm-mono">{r.user_email || <span className="adm-muted">Anonymous</span>}</td>
                        <td><strong>{fmtNum(r.premium_count)}</strong></td>
                        <td>{fmtNum(r.total_exports)}</td>
                        <td className="adm-muted">{pct(r.premium_count, r.total_exports)}%</td>
                        <td className="adm-muted">{fmt(r.last_export)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : <Empty message="No watermark-free exports yet." />}
            </Card>
            <div className="adm-grid-2">
              <Card title="Exports by user" eyebrow="Power users" count={d.exportsByUser?.length}>
                {d.exportsByUser && d.exportsByUser.length > 0 ? (
                  <>
                    <table className="adm-table">
                      <thead><tr><th>User</th><th>PNG</th><th>SVG</th><th>PDF</th><th>Total</th></tr></thead>
                      <tbody>
                        {exportsByUserPag.slice.map((r, i) => (
                          <tr key={i}>
                            <td className="adm-mono adm-truncate">{r.user_email || <span className="adm-muted">Anon</span>}</td>
                            <td>{r.png_count ?? 0}</td>
                            <td>{r.svg_count ?? 0}</td>
                            <td>{r.pdf_count ?? 0}</td>
                            <td><strong>{r.total_exports}</strong></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <Pagination {...exportsByUserPag} />
                  </>
                ) : <Empty message="No exports tracked yet." />}
              </Card>
              <Card title="Recent exports" eyebrow="Live feed" count={d.recentExports?.length}>
                {d.recentExports && d.recentExports.length > 0 ? (
                  <>
                    <table className="adm-table">
                      <thead><tr><th>Format</th><th>Project</th><th>When</th></tr></thead>
                      <tbody>
                        {recentExportsPag.slice.map((r, i) => (
                          <tr key={i}>
                            <td><FormatBadge format={r.format} />{r.no_watermark && <span className="adm-tag adm-tag-green" style={{ marginLeft: 6 }}>clean</span>}</td>
                            <td className="adm-muted adm-truncate">{r.project_name || '—'}</td>
                            <td className="adm-muted" style={{ whiteSpace: 'nowrap' }}>{fmtTime(r.created_at)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <Pagination {...recentExportsPag} />
                  </>
                ) : <Empty message="No exports yet." />}
              </Card>
            </div>
          </>
        )}

        {/* ───────── USERS ───────── */}
        {tab === 'users' && (
          <Card title="Registered users" count={d.users?.length} full>
            {d.users && d.users.length > 0 ? (
              <>
                <table className="adm-table">
                  <thead><tr><th>Email</th><th>Joined</th><th>Last login</th><th>Projects</th><th></th></tr></thead>
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
                            <button className="adm-btn adm-btn-ghost adm-btn-sm" onClick={() => setEditingUser(editingUser?.id === u.id ? null : u)}>
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
                                  <a href="https://supabase.com/dashboard" target="_blank" rel="noopener noreferrer">Supabase Dashboard → Authentication → Users</a>
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
          </Card>
        )}
      </main>
    </div>
  );
}
