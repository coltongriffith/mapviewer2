import React, { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../hooks/useAuth.jsx';
import {
  listCloudProjects, loadCloudProject, saveCloudProject,
  renameCloudProject, deleteCloudProject,
} from '../utils/cloudStorage';
import { listPortfolios, portfolioSummary, lastSync } from '../utils/tenureMonitor';
import { remainingTenureSlots } from '../utils/entitlements';
import { formatSyncTimestamp } from '../utils/tenureDates';

// The signed-in home.
//
// WHAT THIS REPLACES. /account was the only place a signed-in user could see
// their work, and it was ordered as a settings page: billing, then brand
// defaults, then — third — the projects they actually came for. Signing in and
// visiting the site put you on the marketing page, which is the right answer
// for a stranger and the wrong one for a customer who has twelve maps saved.
//
// So this page leads with work in progress and says what needs attention.
// Settings, billing, trash and shared links stay on /account, where somebody
// goes deliberately rather than daily.
//
// The one rule it follows throughout: never make the user hunt. A project list
// is only useful if you can find a project in it, which is why search and sort
// are here at any size rather than appearing once the list gets long.

function fmtRelative(iso) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diff / 86400000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  if (days < 30) return `${Math.floor(days / 7)} week${days < 14 ? '' : 's'} ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

const SORTS = [
  { id: 'recent', label: 'Last edited' },
  { id: 'name', label: 'Name' },
];

function ProjectTile({ entry, onOpen, onRename, onDelete, onDuplicate }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(entry.name);
  const [confirmDelete, setConfirmDelete] = useState(false);

  return (
    <div className="dash-tile">
      <button
        className="dash-tile-thumb"
        type="button"
        aria-label={`Open ${entry.name || 'project'}`}
        onClick={() => !editing && onOpen(entry)}
      >
        {entry.thumbnail
          ? <img src={entry.thumbnail} alt="" loading="lazy" />
          : <span className="dash-tile-placeholder">{entry.name?.slice(0, 2).toUpperCase() || '?'}</span>}
      </button>
      <div className="dash-tile-body">
        {editing ? (
          <input
            autoFocus
            className="dash-tile-name-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => {
              setEditing(false);
              if (name.trim() && name.trim() !== entry.name) onRename(entry.id, name.trim());
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.target.blur();
              if (e.key === 'Escape') { setName(entry.name); setEditing(false); }
            }}
          />
        ) : (
          <button className="dash-tile-name" type="button" onClick={() => onOpen(entry)}>
            {entry.name}
          </button>
        )}
        <span className="dash-tile-date">{fmtRelative(entry.updatedAt)}</span>
      </div>
      <div className="dash-tile-actions">
        {confirmDelete ? (
          <>
            <span className="dash-confirm">Delete?</span>
            <button className="dash-icon-btn danger" type="button" onClick={() => { onDelete(entry.id); setConfirmDelete(false); }}>Yes</button>
            <button className="dash-icon-btn" type="button" onClick={() => setConfirmDelete(false)}>No</button>
          </>
        ) : (
          <>
            <button className="dash-icon-btn" type="button" title="Rename" aria-label={`Rename ${entry.name}`} onClick={() => setEditing(true)}>✎</button>
            <button className="dash-icon-btn" type="button" title="Duplicate" aria-label={`Duplicate ${entry.name}`} onClick={() => onDuplicate(entry)}>⧉</button>
            <button className="dash-icon-btn danger" type="button" title="Delete" aria-label={`Delete ${entry.name}`} onClick={() => setConfirmDelete(true)}>✕</button>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * What the monitored claims need, if anything.
 *
 * Deliberately shows a state rather than a marketing pitch when there is no
 * portfolio yet: somebody with no claims saved needs to know the feature
 * exists and what it costs them to try, not a second landing page.
 */
function TenureCard({ onOpen }) {
  const { entitlements } = useAuth();
  const [state, setState] = useState({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const portfolios = await listPortfolios();
        if (cancelled) return;
        if (!portfolios.length) { setState({ status: 'empty' }); return; }
        // The first portfolio is the one the monitor opens by default, so it is
        // the one this card should describe. Summing across groups would give a
        // number that matches no screen the user can navigate to.
        const [summary, sync] = await Promise.all([
          portfolioSummary(portfolios[0].id),
          lastSync().catch(() => null),
        ]);
        if (cancelled) return;
        setState({ status: 'ready', portfolio: portfolios[0], summary: summary || {}, sync, count: portfolios.length });
      } catch {
        // A failed load must not blank the card into something that looks like
        // "you have no claims" — that reads as data loss.
        if (!cancelled) setState({ status: 'error' });
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (state.status === 'loading') {
    return <section className="dash-panel"><h2>Tenure Monitor</h2><p className="dash-muted">Loading…</p></section>;
  }

  if (state.status === 'error') {
    return (
      <section className="dash-panel">
        <h2>Tenure Monitor</h2>
        <p className="dash-muted">Couldn&apos;t load your monitored claims just now.</p>
        <button className="btn" type="button" onClick={onOpen}>Open Tenure Monitor</button>
      </section>
    );
  }

  if (state.status === 'empty') {
    const free = remainingTenureSlots(entitlements, 0);
    return (
      <section className="dash-panel">
        <h2>Tenure Monitor</h2>
        <p className="dash-panel-lead">
          Watch B.C. mineral claims and get reminded before each good-to-date — yours or
          anybody&apos;s.
        </p>
        <p className="dash-muted">
          {Number.isFinite(free) ? `Your plan monitors up to ${free} claims.` : 'Monitor claims on your plan.'}
        </p>
        <button className="btn primary" type="button" onClick={onOpen}>Start monitoring claims</button>
      </section>
    );
  }

  const s = state.summary;
  // Only surface a number when it is non-zero. A row of zeros is not
  // reassurance on a dashboard, it is noise competing with the row that matters.
  const attention = [
    { n: s.expiring_30, label: 'expiring in 30 days', tone: 'urgent', filter: '30' },
    { n: s.expired, label: 'past good-to-date', tone: 'expired', filter: 'expired' },
    { n: s.changed_recently, label: 'changed recently', tone: 'changed', filter: 'changed' },
    { n: s.needs_review, label: 'need a decision', tone: 'review', filter: 'review' },
  ].filter((x) => Number(x.n) > 0);

  return (
    <section className="dash-panel">
      <div className="dash-panel-head">
        <h2>Tenure Monitor</h2>
        <button className="dash-link" type="button" onClick={onOpen}>Open →</button>
      </div>
      <p className="dash-panel-lead">
        <strong>{Number(s.total_tenures) || 0}</strong>
        {' '}monitored {Number(s.total_tenures) === 1 ? 'claim' : 'claims'}
        {state.count > 1 && <span className="dash-muted"> in {state.portfolio.name}</span>}
      </p>

      {attention.length === 0 ? (
        <p className="dash-muted">Nothing needs attention in the next 30 days.</p>
      ) : (
        <ul className="dash-attention">
          {attention.map((a) => (
            <li key={a.label}>
              <button className={`dash-attention-btn dash-attention--${a.tone}`} type="button" onClick={() => onOpen(a.filter)}>
                <span className="dash-attention-n">{a.n}</span>
                <span>{a.label}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {state.sync?.completed_at && (
        <p className="dash-sync">
          Government data last synchronized {formatSyncTimestamp(state.sync.completed_at)}.
          {' '}Verify anything that matters in MTO.
        </p>
      )}
    </section>
  );
}

export default function DashboardPage({
  onOpenProject, onNewProject, onOpenEditor, onOpenTenureMonitor,
  onOpenAccount, onOpenBrandKits, onSearchClaims, onExit,
}) {
  const { user, signOut } = useAuth();
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('recent');

  useEffect(() => {
    if (!user) return undefined;
    let cancelled = false;
    setLoading(true);
    listCloudProjects()
      .then((p) => { if (!cancelled) { setProjects(p); setError(null); } })
      // A failed refresh keeps the last good list rather than blanking it.
      .catch(() => { if (!cancelled) setError("Couldn't load your projects — check your connection and reload."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [user]);

  const refresh = () => listCloudProjects().then(setProjects).catch(() => {
    setError("Couldn't refresh your projects — the last loaded list is shown.");
  });

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q ? projects.filter((p) => (p.name || '').toLowerCase().includes(q)) : [...projects];
    if (sort === 'name') list.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    else list.sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));
    return list;
  }, [projects, query, sort]);

  const duplicate = async (entry) => {
    try {
      const full = await loadCloudProject(entry.id);
      await saveCloudProject({ id: null, name: `${entry.name} Copy`, payload: full.payload });
      refresh();
    } catch (e) {
      setError(`Duplicating the project failed: ${String(e?.message || e).slice(0, 140)}`);
    }
  };

  const firstName = (user?.email || '').split('@')[0];

  return (
    <div className="dash-shell">
      <header className="dash-header">
        <div className="dash-header-left">
          <button className="dash-wordmark" type="button" onClick={onExit} title="Exploration Maps home">
            Exploration Maps
          </button>
        </div>
        <nav className="dash-header-nav" aria-label="Account">
          <button className="dash-link" type="button" onClick={onOpenTenureMonitor}>Tenure Monitor</button>
          <button className="dash-link" type="button" onClick={onOpenBrandKits}>Brand kits</button>
          <button className="dash-link" type="button" onClick={onOpenAccount}>Settings &amp; billing</button>
          <button className="dash-link muted" type="button" onClick={signOut}>Sign out</button>
        </nav>
      </header>

      <main className="dash-main">
        <div className="dash-hero">
          <div>
            <h1 className="dash-title">
              {firstName ? `Welcome back, ${firstName}` : 'Your workspace'}
            </h1>
            <p className="dash-subtitle">Pick up a map, or start something new.</p>
          </div>
          <div className="dash-hero-actions">
            <button className="btn primary" type="button" onClick={onNewProject}>+ New map</button>
            <button className="btn" type="button" onClick={onSearchClaims}>Search mineral claims</button>
          </div>
        </div>

        {error && (
          <div className="claims-error" role="alert" style={{ margin: '0 0 16px' }}>
            ⚠ {error}
            <button type="button" className="secondary-btn" style={{ marginLeft: 10 }} onClick={() => setError(null)}>Dismiss</button>
          </div>
        )}

        <div className="dash-columns">
          <section className="dash-projects">
            <div className="dash-panel-head">
              <h2>Your maps {projects.length > 0 && <span className="dash-count">{projects.length}</span>}</h2>
              {projects.length > 1 && (
                <div className="dash-project-tools">
                  <label className="dash-sr-only" htmlFor="dash-search">Search your maps</label>
                  <input
                    id="dash-search"
                    className="dash-search"
                    type="search"
                    placeholder="Search maps…"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                  <label className="dash-sr-only" htmlFor="dash-sort">Sort maps</label>
                  <select id="dash-sort" className="dash-sort" value={sort} onChange={(e) => setSort(e.target.value)}>
                    {SORTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                  </select>
                </div>
              )}
            </div>

            {loading ? (
              <p className="dash-muted">Loading your maps…</p>
            ) : projects.length === 0 ? (
              <div className="dash-empty">
                <p><strong>No saved maps yet.</strong></p>
                <p className="dash-muted">
                  Start from your own file, or pull claim boundaries straight from a public registry.
                </p>
                <div className="dash-hero-actions">
                  <button className="btn primary" type="button" onClick={onNewProject}>+ New map</button>
                  <button className="btn" type="button" onClick={onSearchClaims}>Search mineral claims</button>
                </div>
              </div>
            ) : visible.length === 0 ? (
              <p className="dash-muted">
                No maps match “{query}”.{' '}
                <button className="dash-link" type="button" onClick={() => setQuery('')}>Clear search</button>
              </p>
            ) : (
              <div className="dash-grid">
                {visible.map((entry) => (
                  <ProjectTile
                    key={entry.id}
                    entry={entry}
                    onOpen={onOpenProject}
                    onRename={(id, name) => renameCloudProject(id, name).then(refresh).catch(() => setError('Renaming failed.'))}
                    onDelete={(id) => deleteCloudProject(id).then(refresh).catch(() => setError('Deleting failed.'))}
                    onDuplicate={duplicate}
                  />
                ))}
              </div>
            )}
          </section>

          <aside className="dash-side">
            <TenureCard onOpen={onOpenTenureMonitor} />

            <section className="dash-panel">
              <h2>Jump back in</h2>
              <ul className="dash-quick">
                <li><button className="dash-quick-btn" type="button" onClick={onOpenEditor}>Open the editor</button></li>
                <li><button className="dash-quick-btn" type="button" onClick={onOpenBrandKits}>Brand kits</button></li>
                <li><button className="dash-quick-btn" type="button" onClick={onOpenAccount}>Deleted maps &amp; shared links</button></li>
                <li><a className="dash-quick-btn" href="/blog/">Guides</a></li>
              </ul>
            </section>
          </aside>
        </div>
      </main>
    </div>
  );
}
