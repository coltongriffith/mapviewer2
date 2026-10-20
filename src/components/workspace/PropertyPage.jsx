import React, { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../../hooks/useAuth.jsx';
import {
  getPropertyBySlug, updateProperty, listPropertyMaps, listPropertyFigures, listPersonalFigures,
  getPropertyClaims, listMyPortfolios, moveToProperty, moveToPersonal, moveFigureToProperty,
  moveFigureToPersonal, permissions, setActiveWorkspaceId, formatWhen,
} from '../../utils/workspace';
import { listCloudProjects } from '../../utils/cloudStorage';
import { createPortfolio } from '../../utils/tenureMonitor';
import { jurisdictionLabel } from '../../utils/jurisdictions';
import {
  useWorkspaces, WorkspaceHeader, RoleBadge, StatusBadge, ErrorNote, PropertyForm, ActivityFeed,
} from './shared';

// /workspace/p/<slug>: one exploration project and everything it owns.
// Viewers get the same page with every editing control left out; the
// database refuses their writes regardless.

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'maps', label: 'Maps' },
  { id: 'figures', label: '3D figures' },
  { id: 'claims', label: 'Claims' },
  { id: 'activity', label: 'Activity' },
];

function ItemTile({ item, onOpen, children }) {
  return (
    <div className="dash-tile">
      <button className="dash-tile-thumb" type="button" aria-label={`Open ${item.name}`} onClick={onOpen}>
        {item.thumbnail ? <img src={item.thumbnail} alt="" loading="lazy" /> : <span className="dash-tile-placeholder">{item.name?.slice(0, 2).toUpperCase()}</span>}
      </button>
      <div className="dash-tile-body">
        <button className="dash-tile-name" type="button" onClick={onOpen}>{item.name}</button>
        <span className="dash-tile-date">{formatWhen(item.updatedAt)}</span>
      </div>
      {children && <div className="dash-tile-actions">{children}</div>}
    </div>
  );
}

/** "Move one of my things here": a select of candidates and a button. */
function MoveHere({ label, load, onMove }) {
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState(null);
  const [choice, setChoice] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  useEffect(() => {
    if (!open) return;
    load().then((o) => { setOptions(o); setChoice(o[0]?.id || ''); }).catch((e) => setError(e.message));
  }, [open, load]);
  if (!open) return <button type="button" className="btn" onClick={() => setOpen(true)}>{label}</button>;
  return (
    <form className="ws-row" onSubmit={async (e) => {
      e.preventDefault();
      if (!choice) return;
      setBusy(true); setError(null);
      try { await onMove(choice); setOpen(false); } catch (err) { setError(err.message); } finally { setBusy(false); }
    }}>
      <ErrorNote error={error} />
      {options === null ? <span className="dash-muted">Loading…</span> : options.length === 0 ? (
        <span className="dash-muted">Nothing of yours to move here.</span>
      ) : (
        <select aria-label={label} value={choice} onChange={(e) => setChoice(e.target.value)}>
          {options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
      )}
      {options?.length > 0 && <button type="submit" className="btn primary" disabled={busy}>{busy ? 'Moving…' : 'Move here'}</button>}
      <button type="button" className="btn" onClick={() => setOpen(false)}>Cancel</button>
    </form>
  );
}

function MapsTab({ property, perms, onOpenMap, onNewMap }) {
  const [maps, setMaps] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => listPropertyMaps(property.id).then(setMaps).catch((e) => setError(e.message)), [property.id]);
  useEffect(() => { load(); }, [load]);
  const personalMaps = useCallback(() => listCloudProjects(), []);
  return (
    <section aria-label="Maps">
      <ErrorNote error={error} onDismiss={() => setError(null)} />
      {perms.edit && (
        <div className="ws-row" style={{ marginBottom: 14 }}>
          <button type="button" className="btn primary" disabled={busy} onClick={async () => {
            setBusy(true); setError(null);
            try { await onNewMap(property); } catch (e) { setError(e.message); setBusy(false); }
          }}>{busy ? 'Creating…' : '+ New map in this property'}</button>
          <MoveHere label="Move one of my maps here" load={personalMaps}
            onMove={async (id) => { await moveToProperty('map', id, property.id); await load(); }} />
        </div>
      )}
      {maps === null ? <p className="dash-muted">Loading maps…</p> : maps.length === 0 ? (
        <p className="dash-muted">No maps in this property yet.</p>
      ) : (
        <div className="dash-grid">
          {maps.map((m) => (
            <ItemTile key={m.id} item={m} onOpen={() => onOpenMap(m)}>
              {perms.moveOut && (
                <button type="button" className="dash-icon-btn" title="Move to my personal maps"
                  onClick={async () => { try { await moveToPersonal('map', m.id); await load(); } catch (e) { setError(e.message); } }}>
                  Move to personal
                </button>
              )}
            </ItemTile>
          ))}
        </div>
      )}
    </section>
  );
}

function FiguresTab({ property, perms, userId }) {
  const [figures, setFigures] = useState(null);
  const [error, setError] = useState(null);
  const load = useCallback(() => listPropertyFigures(property.id).then(setFigures).catch((e) => setError(e.message)), [property.id]);
  useEffect(() => { load(); }, [load]);
  const personal = useCallback(() => listPersonalFigures(userId), [userId]);
  const open = (f) => { window.location.href = `/3d?project=${encodeURIComponent(f.id)}`; };
  return (
    <section aria-label="3D figures">
      <ErrorNote error={error} onDismiss={() => setError(null)} />
      {perms.edit && (
        <div className="ws-row" style={{ marginBottom: 14 }}>
          <a className="btn primary" href="/3d" style={{ width: 'auto', padding: '0 14px', height: 'var(--ctl-h)', textDecoration: 'none' }}>+ New 3D figure</a>
          <MoveHere label="Move one of my 3D figures here" load={personal}
            onMove={async (id) => { await moveFigureToProperty(id, property); await load(); }} />
        </div>
      )}
      {perms.edit && <p className="dash-muted" style={{ marginBottom: 12 }}>In the 3D maker, use Save as new and choose this property to add a figure here.</p>}
      {figures === null ? <p className="dash-muted">Loading 3D figures…</p> : figures.length === 0 ? (
        <p className="dash-muted">No 3D figures in this property yet.</p>
      ) : (
        <div className="dash-grid">
          {figures.map((f) => (
            <ItemTile key={f.id} item={f} onOpen={() => open(f)}>
              {perms.moveOut && (
                <button type="button" className="dash-icon-btn" title="Move to my personal 3D maps"
                  onClick={async () => { try { await moveFigureToPersonal(f.id, userId); await load(); } catch (e) { setError(e.message); } }}>
                  Move to personal
                </button>
              )}
            </ItemTile>
          ))}
        </div>
      )}
    </section>
  );
}

function ClaimsTab({ property, perms, userId, onOpenTenureMonitor }) {
  const [portfolios, setPortfolios] = useState(null);
  const [error, setError] = useState(null);
  const [name, setName] = useState('');
  const load = useCallback(() => getPropertyClaims(property.id).then(setPortfolios).catch((e) => setError(e.message)), [property.id]);
  useEffect(() => { load(); }, [load]);
  const unlinked = useCallback(async () => (await listMyPortfolios(userId)).filter((p) => !p.property_id), [userId]);
  return (
    <section aria-label="Claims">
      <ErrorNote error={error} onDismiss={() => setError(null)} />
      <p className="dash-muted" style={{ marginBottom: 12 }}>
        Claims are watched in Tenure Monitor portfolios. A linked portfolio stays with the person who created it
        (their plan, their alert emails); everyone in the workspace can see its claims here.
      </p>
      {perms.edit && (
        <div className="ws-row" style={{ marginBottom: 14 }}>
          <MoveHere label="Link one of my portfolios" load={unlinked}
            onMove={async (id) => { await moveToProperty('portfolio', id, property.id); await load(); }} />
          <form className="ws-row" onSubmit={async (e) => {
            e.preventDefault();
            setError(null);
            try {
              const id = await createPortfolio(name.trim() || `${property.name} claims`);
              await moveToProperty('portfolio', id, property.id);
              setName('');
              await load();
            } catch (err) { setError(err.message); }
          }}>
            <label className="ws-field"><span className="dash-sr-only">New portfolio name</span>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder={`${property.name} claims`} aria-label="New portfolio name" />
            </label>
            <button type="submit" className="btn">Create a portfolio</button>
          </form>
        </div>
      )}
      {portfolios === null ? <p className="dash-muted">Loading claims…</p> : portfolios.length === 0 ? (
        <p className="dash-muted">No claim portfolio is linked to this property yet.</p>
      ) : portfolios.map((p) => (
        <div key={p.id} className="dash-panel" style={{ marginBottom: 14 }}>
          <div className="dash-panel-head">
            <h3 style={{ margin: 0, fontSize: 15 }}>{p.name} <span className="dash-count">{p.tenure_count}</span></h3>
            <div className="ws-row">
              {p.is_mine && <button type="button" className="dash-link" onClick={onOpenTenureMonitor}>Open in Tenure Monitor</button>}
              {perms.moveOut && (
                <button type="button" className="dash-link" onClick={async () => {
                  try { await moveToPersonal('portfolio', p.id); await load(); } catch (e) { setError(e.message); }
                }}>Unlink</button>
              )}
            </div>
          </div>
          <p className="dash-muted" style={{ marginBottom: 8 }}>
            Watched by {p.is_mine ? 'you' : p.owner_email}{p.next_good_to_date ? ` · next good-to-date ${p.next_good_to_date}` : ''}
          </p>
          {p.tenures.length > 0 && (
            <div className="ws-table-wrap">
              <table className="ws-table">
                <thead><tr><th>Tenure</th><th>Name</th><th>Status</th><th>Good to</th><th>Hectares</th><th>Decision</th></tr></thead>
                <tbody>
                  {p.tenures.map((t) => (
                    <tr key={t.tenure_number}>
                      <td>{t.tenure_number}</td><td>{t.tenure_name}</td><td>{t.status}</td>
                      <td>{t.good_to_date || '—'}</td><td>{t.area_hectares ?? '—'}</td>
                      <td>{String(t.maintenance_decision || '').replace(/_/g, ' ').toLowerCase()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ))}
    </section>
  );
}

export default function PropertyPage({ slug, onExit, onOpenDashboard, onOpenWorkspace, onOpenMap, onNewMap, onOpenTenureMonitor }) {
  const { user } = useAuth();
  const ws = useWorkspaces();
  const [property, setProperty] = useState(undefined);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState(() => {
    const t = new URLSearchParams(window.location.search).get('tab');
    return TABS.some((x) => x.id === t) ? t : 'overview';
  });
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setProperty(undefined);
    getPropertyBySlug(slug)
      .then((p) => { if (!cancelled) { setProperty(p); if (p) setActiveWorkspaceId(p.org_id); } })
      .catch((e) => { if (!cancelled) { setError(e.message); setProperty(null); } });
    return () => { cancelled = true; };
  }, [slug]);

  const org = property ? ws.list.find((w) => w.id === property.org_id) : null;
  const perms = permissions(org?.role);

  return (
    <div className="dash-shell ws-page">
      <WorkspaceHeader onExit={onExit} onOpenDashboard={onOpenDashboard}>
        <button className="dash-link" type="button" onClick={onOpenWorkspace}>{org ? org.name : 'Workspace'}</button>
      </WorkspaceHeader>
      <main className="dash-main">
        <ErrorNote error={error} onDismiss={() => setError(null)} />
        {property === undefined || (property && ws.loading) ? <p className="dash-muted">Loading the property…</p> : !property ? (
          <div className="dash-empty">
            <p><strong>Property not found.</strong></p>
            <p className="dash-muted">It may have been deleted, or you are not a member of its workspace.</p>
            <button type="button" className="btn" onClick={onOpenWorkspace}>Back to the workspace</button>
          </div>
        ) : (
          <>
            <div className="dash-hero">
              <div>
                <p className="dash-subtitle"><button type="button" className="dash-link" onClick={onOpenWorkspace}>{org?.name || 'Workspace'}</button> / Property</p>
                <h1 className="dash-title">{property.name} <StatusBadge status={property.status} /> <RoleBadge role={org?.role} /></h1>
              </div>
            </div>
            {!perms.edit && <p className="ws-notice">View only. You can open every map, figure and claim here, but not change them.</p>}
            <div className="ws-tabs" role="tablist" aria-label="Property sections">
              {TABS.map((t) => (
                <button key={t.id} type="button" role="tab" className="ws-tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}>{t.label}</button>
              ))}
            </div>
            <div role="tabpanel" aria-label={TABS.find((t) => t.id === tab)?.label}>
              {tab === 'overview' && (editing ? (
                <div className="dash-panel">
                  <PropertyForm initial={property} onCancel={() => setEditing(false)}
                    onSubmit={async (f) => { const p = await updateProperty(property.id, f); if (p) setProperty(p); setEditing(false); }} />
                </div>
              ) : (
                <section className="dash-panel">
                  <dl className="ws-dl">
                    <dt>Jurisdiction</dt><dd>{jurisdictionLabel(property.jurisdiction) || 'Not set'}</dd>
                    <dt>Commodities</dt><dd>{(property.commodities || []).join(', ') || '—'}</dd>
                    <dt>Status</dt><dd><StatusBadge status={property.status} /></dd>
                    <dt>Description</dt><dd>{property.description || '—'}</dd>
                    {property.crs && <><dt>CRS</dt><dd>{property.crs}</dd></>}
                    <dt>Last changed</dt><dd>{formatWhen(property.updated_at)}</dd>
                  </dl>
                  {perms.edit && <div className="ws-actions" style={{ marginTop: 12 }}><button type="button" className="btn" onClick={() => setEditing(true)}>Edit details</button></div>}
                </section>
              ))}
              {tab === 'maps' && <MapsTab property={property} perms={perms} onOpenMap={onOpenMap} onNewMap={onNewMap} />}
              {tab === 'figures' && <FiguresTab property={property} perms={perms} userId={user?.id} />}
              {tab === 'claims' && <ClaimsTab property={property} perms={perms} userId={user?.id} onOpenTenureMonitor={onOpenTenureMonitor} />}
              {tab === 'activity' && <section className="dash-panel"><ActivityFeed orgId={property.org_id} propertyId={property.id} /></section>}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
