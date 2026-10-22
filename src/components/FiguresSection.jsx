import React, { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../hooks/useAuth.jsx';
import Dialog from './Dialog';
import { lazyGuarded } from '../utils/preloadGuard';
import { SORTS, filterAndSort, fmtRelative } from '../utils/dashboardList.js';
import {
  listMyFigures, renameFigure, deleteFigure, duplicateFigure, editableProperties, moveFigure,
  figureUrl, newFigureUrl,
} from '../utils/figures.js';

const NameDialog = lazyGuarded(() => import('./NameDialog'));

// The dashboard's 3D figures: the user's personal figures from /3d, beside
// their 2D maps, with the same tiles, search and sort. Opening one goes to
// the 3D maker (/3d?project=<id>), a separate page. Company figures are
// listed on their property's page, as company maps are.

const go = (url) => { window.location.assign(url); };

function FigureTile({ figure, canMove, onRename, onDuplicate, onMove, onDelete, busy }) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const open = () => go(figureUrl(figure.id));
  return (
    <div className="dash-tile" data-figure={figure.id}>
      <button className="dash-tile-thumb" type="button" aria-label={`Open 3D figure ${figure.name}`} onClick={open}>
        {figure.thumbnail
          ? <img src={figure.thumbnail} alt="" loading="lazy" />
          : <span className="dash-tile-placeholder">{figure.name?.slice(0, 2).toUpperCase() || '3D'}</span>}
      </button>
      <div className="dash-tile-body">
        <button className="dash-tile-name" type="button" onClick={open}>{figure.name}</button>
        <span className="dash-tile-date">{fmtRelative(figure.updatedAt)}</span>
      </div>
      <div className="dash-tile-actions">
        {confirmDelete ? (
          <>
            <span className="dash-confirm">Delete?</span>
            <button className="dash-icon-btn danger" type="button" aria-label={`Yes, delete ${figure.name}`} onClick={() => { setConfirmDelete(false); onDelete(figure); }}>Yes</button>
            <button className="dash-icon-btn" type="button" onClick={() => setConfirmDelete(false)}>No</button>
          </>
        ) : (
          <>
            <button className="dash-icon-btn" type="button" title="Rename" aria-label={`Rename ${figure.name}`} disabled={busy} onClick={() => onRename(figure)}>✎</button>
            <button className="dash-icon-btn" type="button" title="Duplicate" aria-label={`Duplicate ${figure.name}`} disabled={busy} onClick={() => onDuplicate(figure)}>⧉</button>
            {canMove && <button className="dash-icon-btn" type="button" title="Move to a property" aria-label={`Move ${figure.name} to a property`} disabled={busy} onClick={() => onMove(figure)}>⇥</button>}
            <button className="dash-icon-btn danger" type="button" title="Delete" aria-label={`Delete ${figure.name}`} disabled={busy} onClick={() => setConfirmDelete(true)}>✕</button>
          </>
        )}
      </div>
    </div>
  );
}

/** Pick one of the company properties the user edits for. */
function MoveDialog({ figure, properties, onMove, onClose }) {
  const [choice, setChoice] = useState(properties[0]?.id || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const groups = useMemo(() => {
    const m = new Map();
    for (const p of properties) { if (!m.has(p.orgName)) m.set(p.orgName, []); m.get(p.orgName).push(p); }
    return [...m];
  }, [properties]);
  return (
    <Dialog onClose={onClose} title={`Move “${figure.name}” to a property`} titleId="fig-move-title" panelClassName="modal-panel auth-modal name-dialog">
      <form className="auth-form" onSubmit={async (e) => {
        e.preventDefault();
        const property = properties.find((p) => p.id === choice);
        if (!property) return;
        setBusy(true); setError(null);
        try { await onMove(property); } catch (err) { setError(err.message); setBusy(false); }
      }}>
        <p className="dash-muted" style={{ margin: 0 }}>
          Everyone in the company workspace can then see it, and editors can change it. An admin can move it back.
        </p>
        <label className="auth-label" htmlFor="fig-move-select">
          Property
          <select id="fig-move-select" className="auth-input" value={choice} onChange={(e) => setChoice(e.target.value)}>
            {groups.map(([org, list]) => (
              <optgroup key={org} label={org}>
                {list.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </optgroup>
            ))}
          </select>
        </label>
        {error && <p className="auth-error" role="alert">{error}</p>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="ui-btn" type="button" onClick={onClose}>Cancel</button>
          <button className="ui-btn ui-btn--primary" type="submit" disabled={busy || !choice}>{busy ? 'Moving…' : 'Move'}</button>
        </div>
      </form>
      <button className="modal-close-btn" type="button" onClick={onClose} aria-label="Close">×</button>
    </Dialog>
  );
}

export default function FiguresSection({ onError = () => {} }) {
  const { user } = useAuth();
  const [figures, setFigures] = useState(null); // null while loading
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('recent');
  const [renaming, setRenaming] = useState(null);
  const [moving, setMoving] = useState(null);
  const [properties, setProperties] = useState([]);
  const [busy, setBusy] = useState(null); // the figure id being changed
  const [note, setNote] = useState(null);

  const load = useCallback(() => listMyFigures().then((list) => { setFigures(list); setFailed(false); }), []);
  useEffect(() => {
    if (!user) return undefined;
    let cancelled = false;
    listMyFigures()
      .then((list) => { if (!cancelled) { setFigures(list); setFailed(false); } })
      // A failed load is said as such, never shown as "no figures".
      .catch(() => { if (!cancelled) { setFailed(true); setFigures((f) => f || []); } });
    editableProperties().then((p) => { if (!cancelled) setProperties(p); });
    return () => { cancelled = true; };
  }, [user]);

  const visible = useMemo(() => filterAndSort(figures || [], query, sort), [figures, query, sort]);

  const act = async (figure, fn, done) => {
    setBusy(figure.id); setNote(null);
    try { const r = await fn(); if (done) setNote(done(r)); await load().catch(() => {}); } catch (e) { onError(e.message); } finally { setBusy(null); }
  };

  return (
    <section className="dash-projects" aria-labelledby="dash-3d-h" style={{ marginTop: 28 }}>
      <div className="dash-panel-head">
        <h2 id="dash-3d-h">Your 3D figures {figures?.length > 0 && <span className="dash-count">{figures.length}</span>}</h2>
        <div className="dash-project-tools">
          {figures?.length > 1 && (
            <>
              <label className="dash-sr-only" htmlFor="dash-3d-search">Search your 3D figures</label>
              <input id="dash-3d-search" className="dash-search" type="search" placeholder="Search 3D figures…" value={query} onChange={(e) => setQuery(e.target.value)} />
              <label className="dash-sr-only" htmlFor="dash-3d-sort">Sort 3D figures</label>
              <select id="dash-3d-sort" className="dash-sort" value={sort} onChange={(e) => setSort(e.target.value)}>
                {SORTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
            </>
          )}
          {figures?.length > 0 && <a className="btn" href={newFigureUrl()} style={{ textDecoration: 'none', width: 'auto' }}>+ New 3D figure</a>}
        </div>
      </div>

      {note && <p className="ws-ok" role="status" style={{ marginBottom: 12 }}>{note}</p>}

      {figures === null ? (
        <p className="dash-muted">Loading your 3D figures…</p>
      ) : failed && figures.length === 0 ? (
        <p className="dash-muted">
          Couldn&apos;t load your 3D figures just now.{' '}
          <button className="dash-link" type="button" onClick={() => load().catch(() => setFailed(true))}>Try again</button>
        </p>
      ) : figures.length === 0 ? (
        <div className="dash-empty">
          <p><strong>No 3D figures yet.</strong></p>
          <p className="dash-muted">Turn drill collars, surveys and assays into a branded 3D figure, then save it to your account.</p>
          <div className="dash-hero-actions">
            <a className="btn primary" href={newFigureUrl()} style={{ textDecoration: 'none', width: 'auto' }}>+ New 3D figure</a>
          </div>
        </div>
      ) : visible.length === 0 ? (
        <p className="dash-muted">
          No 3D figures match “{query}”.{' '}
          <button className="dash-link" type="button" onClick={() => setQuery('')}>Clear search</button>
        </p>
      ) : (
        <div className="dash-grid">
          {visible.map((f) => (
            <FigureTile
              key={f.id}
              figure={f}
              busy={busy === f.id}
              canMove={properties.length > 0}
              onRename={setRenaming}
              onDuplicate={(fig) => act(fig, () => duplicateFigure(fig.id, (figures || []).map((x) => x.name)), (copy) => `Made “${copy.name}”.`)}
              onMove={setMoving}
              onDelete={(fig) => act(fig, () => deleteFigure(fig.id), () => `Deleted “${fig.name}”.`)}
            />
          ))}
        </div>
      )}

      {renaming && (
        <Suspense fallback={null}>
          <NameDialog
            title="Rename 3D figure"
            label="Figure name"
            initialValue={renaming.name}
            confirmLabel="Rename"
            onClose={() => setRenaming(null)}
            onSubmit={(name) => {
              const fig = renaming;
              setRenaming(null);
              if (name !== fig.name) act(fig, () => renameFigure(fig.id, name));
            }}
          />
        </Suspense>
      )}
      {moving && (
        <MoveDialog
          figure={moving}
          properties={properties}
          onClose={() => setMoving(null)}
          onMove={async (property) => {
            await moveFigure(moving.id, property);
            setMoving(null);
            setNote(`Moved “${moving.name}” to ${property.name} (${property.orgName}).`);
            await load().catch(() => {});
          }}
        />
      )}
    </section>
  );
}
