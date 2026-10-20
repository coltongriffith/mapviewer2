import React, { useCallback, useEffect, useState } from 'react';
import BrandMark from '../BrandMark';
import { useAuth } from '../../hooks/useAuth.jsx';
import {
  listMyWorkspaces, getActivity, pickActive, setActiveWorkspaceId, getActiveWorkspaceId,
  PROPERTY_STATUSES, ROLE_LABELS, formatWhen, parseCommodities,
} from '../../utils/workspace';
import { PROPERTY_JURISDICTIONS, jurisdictionLabel } from '../../utils/jurisdictions';
import '../../styles/workspace.css';

/** The user's workspaces and the active one; `reload` refetches. */
export function useWorkspaces() {
  const { user } = useAuth();
  const [state, setState] = useState({ loading: true, list: [], error: null });
  const [activeId, setActiveId] = useState(getActiveWorkspaceId);
  const reload = useCallback(async () => {
    try {
      const list = await listMyWorkspaces({ fresh: true });
      setState({ loading: false, list, error: null });
      return list;
    } catch (e) {
      setState((s) => ({ ...s, loading: false, error: e.message }));
      return null;
    }
  }, []);
  useEffect(() => { if (user) reload(); }, [user, reload]);
  useEffect(() => {
    const on = (e) => setActiveId(e.detail?.id ?? getActiveWorkspaceId());
    window.addEventListener('em:workspace', on);
    return () => window.removeEventListener('em:workspace', on);
  }, []);
  const active = pickActive(state.list, activeId);
  const choose = (id) => { setActiveWorkspaceId(id); setActiveId(id); };
  return { ...state, active, activeId, choose, reload };
}

export function RoleBadge({ role }) {
  if (!role) return null;
  return <span className={`ws-badge${role === 'viewer' ? ' ws-badge--viewer' : ''}`}>{role === 'viewer' ? 'View only' : ROLE_LABELS[role]}</span>;
}

export function StatusBadge({ status }) {
  const label = PROPERTY_STATUSES.find((s) => s.value === status)?.label || status;
  return <span className={`ws-badge ws-badge--${status}`}>{label}</span>;
}

/** Personal / company switcher. `onChange(id)` gets an org id or 'personal'. */
export function WorkspaceSwitcher({ workspaces, value, onChange, includeNew = true, label = 'Workspace' }) {
  return (
    <label className="ws-switcher">
      <span className="dash-sr-only">{label}</span>
      <select aria-label={label} value={value || 'personal'} onChange={(e) => onChange(e.target.value)}>
        <option value="personal">Personal</option>
        {workspaces.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
        {includeNew && <option value="new">+ New company workspace…</option>}
      </select>
    </label>
  );
}

export function WorkspaceHeader({ onExit, onOpenDashboard, children }) {
  const { user, signOut } = useAuth();
  return (
    <header className="dash-header">
      <div className="dash-header-left">
        <button className="dash-wordmark" type="button" onClick={onExit} title="Exploration Maps home">
          <BrandMark size={26} />
          <span className="em-wordmark">Exploration&nbsp;<b>Maps</b></span>
        </button>
      </div>
      <nav className="dash-header-nav" aria-label="Workspace">
        {children}
        <button className="dash-link" type="button" onClick={onOpenDashboard}>Dashboard</button>
        {user && <button className="dash-link muted" type="button" onClick={signOut}>Sign out</button>}
        <span className="dash-avatar" aria-hidden="true">{(user?.email || '?').slice(0, 2).toUpperCase()}</span>
      </nav>
    </header>
  );
}

export function ErrorNote({ error, onDismiss }) {
  if (!error) return null;
  return (
    <div className="ws-error" role="alert">
      {error}
      {onDismiss && <button type="button" className="dash-link" style={{ marginLeft: 10 }} onClick={onDismiss}>Dismiss</button>}
    </div>
  );
}

const EMPTY_PROPERTY = { name: '', jurisdiction: 'bc', commodities: '', status: 'active', description: '' };

export function PropertyForm({ initial, onSubmit, onCancel, submitLabel = 'Save' }) {
  const [f, setF] = useState(() => ({
    ...EMPTY_PROPERTY,
    ...(initial || {}),
    commodities: Array.isArray(initial?.commodities) ? initial.commodities.join(', ') : (initial?.commodities || ''),
    description: initial?.description || '',
    jurisdiction: initial ? (initial.jurisdiction || '') : 'bc',
  }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const submit = async (e) => {
    e.preventDefault();
    if (!f.name.trim()) { setError('Give the property a name.'); return; }
    setBusy(true); setError(null);
    try {
      await onSubmit({ ...f, commodities: parseCommodities(f.commodities) });
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  return (
    <form className="ws-form" onSubmit={submit} aria-label={initial ? 'Edit property' : 'New property'}>
      <ErrorNote error={error} />
      <div className="ws-form-grid">
        <label className="ws-field">Name
          <input value={f.name} onChange={set('name')} maxLength={200} required autoComplete="off" />
        </label>
        <label className="ws-field">Jurisdiction
          <select value={f.jurisdiction} onChange={set('jurisdiction')}>
            <option value="">Not set</option>
            {PROPERTY_JURISDICTIONS.map((j) => <option key={j.value} value={j.value}>{j.label}</option>)}
          </select>
        </label>
        <label className="ws-field">Commodities
          <input value={f.commodities} onChange={set('commodities')} placeholder="Cu, Au, Mo" autoComplete="off" />
        </label>
        <label className="ws-field">Status
          <select value={f.status} onChange={set('status')}>
            {PROPERTY_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </label>
      </div>
      <label className="ws-field">Description
        <textarea value={f.description} onChange={set('description')} maxLength={5000} />
      </label>
      <div className="ws-actions">
        {onCancel && <button type="button" className="btn" onClick={onCancel}>Cancel</button>}
        <button type="submit" className="btn primary" disabled={busy}>{busy ? 'Saving…' : submitLabel}</button>
      </div>
    </form>
  );
}

export function propertySummary(p) {
  return [jurisdictionLabel(p.jurisdiction), (p.commodities || []).join(' · ')].filter(Boolean).join(' — ');
}

/** Activity for a workspace, optionally one property, with a property filter. */
export function ActivityFeed({ orgId, propertyId = null, properties = null, pageSize = 30 }) {
  const [filter, setFilter] = useState(propertyId || '');
  const [items, setItems] = useState([]);
  const [state, setState] = useState('loading');
  const [more, setMore] = useState(false);
  const load = useCallback(async (before = null) => {
    setState('loading');
    try {
      const rows = await getActivity(orgId, { propertyId: filter || null, limit: pageSize, before });
      setItems((prev) => (before ? [...prev, ...rows] : rows));
      setMore(rows.length === pageSize);
      setState('ready');
    } catch (e) {
      setState(e.message);
    }
  }, [orgId, filter, pageSize]);
  useEffect(() => { load(); }, [load]);
  return (
    <div>
      {properties && (
        <div className="dash-panel-head">
          <label className="ws-field" style={{ width: 'min(320px, 100%)' }}>Show
            <select value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter activity by property">
              <option value="">Everything in the workspace</option>
              {properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
        </div>
      )}
      {state !== 'loading' && state !== 'ready' && <ErrorNote error={state} />}
      {items.length === 0 && state === 'ready' && <p className="dash-muted">Nothing has happened here yet.</p>}
      <ul className="ws-activity" aria-label="Activity">
        {items.map((a) => (
          <li key={a.id}>
            <span>{a.summary}
              <br /><small>{a.actor_email || 'Someone'}{a.property_name && !propertyId ? ` · ${a.property_name}` : ''}</small>
            </span>
            <time dateTime={a.created_at}>{formatWhen(a.created_at)}</time>
          </li>
        ))}
      </ul>
      {state === 'loading' && <p className="dash-muted">Loading…</p>}
      {more && state === 'ready' && (
        <button type="button" className="dash-link" onClick={() => load(items[items.length - 1]?.created_at)}>Show older</button>
      )}
    </div>
  );
}

export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}
