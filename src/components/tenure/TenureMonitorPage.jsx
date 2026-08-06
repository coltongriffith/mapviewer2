import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../hooks/useAuth';
import {
  listPortfolios, createPortfolio, listPortfolioTenures, portfolioSummary,
  addTenures, removeTenure, updateMembership, lastSync, activeSystemNotice,
  portfolioChangeFeed, fetchTenureGeometry, searchTenures,
} from '../../utils/tenureMonitor';
import { remainingTenureSlots, canCreatePortfolio } from '../../utils/entitlements';
import { buildScheduleCsv } from '../../utils/tenureCsv';
import { daysRemaining, urgencyBand } from '../../utils/tenureDates';
import { trackEvent } from '../../utils/track';
import PortfolioSummary, { UrgencyLegend } from './PortfolioSummary';
import TenureTable from './TenureTable';
import TenureMap, { COLOUR_BY } from './TenureMap';
import TenureDetailPanel from './TenureDetailPanel';
import AddTenuresModal from './AddTenuresModal';
import AlertSettings from './AlertSettings';
import PortfolioActivity from './PortfolioActivity';
import {
  VerificationNotice, LastSyncLine, SystemNoticeBanner, DataAttribution,
} from './TenureNotices';

// Tenure Monitor — the operational view of a B.C. claim portfolio.
//
// Structured around the four questions someone opening this screen has, in
// order: what needs attention, what changed, what should I do next, and how
// current is this. The summary strip answers the first two, the decision
// controls the third, and the sync line — which is on every view, not tucked
// into a settings page — answers the fourth.

const EMPTY_SUMMARY = { total_tenures: 0, total_hectares: 0 };

// The window `changed_recently` is counted over in tenure_portfolio_summary
// (migration 20260801000003: `ce.detected_at > now() - interval '30 days'`).
//
// The filter has to use the SAME window or the pill lies. The change FEED is
// fetched at 90 days because the table's "last change" column and the map's
// change colouring are both more useful with the longer history — so the
// filter narrows here rather than the feed narrowing for everyone. Before
// this, "2 changed recently" could open a list of five: two from the last
// month and three from the two before it.
const CHANGED_RECENTLY_DAYS = 30;

function changedWithinWindow(change, now) {
  if (!change?.detected_at) return false;
  const at = new Date(change.detected_at).getTime();
  if (Number.isNaN(at)) return false;
  return now.getTime() - at <= CHANGED_RECENTLY_DAYS * 86_400_000;
}

function matchesFilter(row, filter, now) {
  if (!filter) return true;
  const t = row.tenure;
  const days = daysRemaining(t.good_to_date, now);
  switch (filter) {
    case '30': return days != null && days >= 0 && days <= 30;
    case '90': return days != null && days >= 0 && days <= 90;
    case '365': return days != null && days >= 0 && days <= 365;
    case 'expired': return days != null && days < 0;
    case 'review': return ['UNDECIDED', 'REVIEW', 'NEEDS_VERIFICATION'].includes(row.maintenanceDecision);
    case 'nodate': return days == null;
    case 'missing': return (t.missing_run_count || 0) >= 2;
    default: return true;
  }
}

export default function TenureMonitorPage({ onExit, onOpenTenuresInEditor, onUpgrade, onSignIn, initialFilter = null }) {
  const { user, entitlements, tier } = useAuth();

  const [portfolios, setPortfolios] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState(EMPTY_SUMMARY);
  const [changes, setChanges] = useState([]);
  const [sync, setSync] = useState(null);
  const [systemNotice, setSystemNotice] = useState(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [view, setView] = useState('table');           // 'table' | 'map'
  const [colourBy, setColourBy] = useState('urgency');
  // Seeded from the caller so arriving from the dashboard's "3 expiring in 30
  // days" shows those three rather than everything. Only the INITIAL value —
  // once here, the filter belongs to this screen and the pills drive it.
  const [filter, setFilter] = useState(initialFilter);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const [showAlerts, setShowAlerts] = useState(false);
  const [flash, setFlash] = useState(null);

  const now = useMemo(() => new Date(), []);
  const active = portfolios.find((p) => p.id === activeId) || null;

  // The sync line and any incident banner are public — they load even before a
  // portfolio does, because "how fresh is this?" should never be gated.
  useEffect(() => {
    lastSync().then(setSync).catch(() => {});
    activeSystemNotice().then(setSystemNotice).catch(() => {});
  }, []);

  useEffect(() => {
    if (!user) { setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    listPortfolios()
      .then(async (list) => {
        if (cancelled) return;
        setPortfolios(list);
        setActiveId((cur) => cur || list[0]?.id || null);
      })
      .catch((e) => { if (!cancelled) setError(String(e.message || e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [user]);

  const refresh = useCallback(async (portfolioId) => {
    if (!portfolioId) { setRows([]); setSummary(EMPTY_SUMMARY); return; }
    setLoading(true);
    try {
      // Independent requests: one failing must not blank the others, matching
      // how AccountPage already handles partial load failures.
      const [t, s, c] = await Promise.allSettled([
        listPortfolioTenures(portfolioId),
        portfolioSummary(portfolioId),
        portfolioChangeFeed(portfolioId).catch(() => []),
      ]);
      if (t.status === 'fulfilled') setRows(t.value);
      if (s.status === 'fulfilled') setSummary(s.value);
      if (c.status === 'fulfilled') setChanges(c.value || []);
      if (t.status === 'rejected') {
        setError('Could not load this portfolio — the last loaded list is shown.');
      } else {
        setError(null);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(activeId); }, [activeId, refresh]);

  // Most recent change per tenure, for the table's "last change" column and
  // the map's change colouring.
  const changesByTenure = useMemo(() => {
    const map = new Map();
    for (const c of changes) {
      if (!map.has(c.tenure_id)) map.set(c.tenure_id, c);
    }
    return map;
  }, [changes]);

  const visibleRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (filter === 'changed') {
        // changesByTenure holds the MOST RECENT change per tenure (the feed is
        // ordered detected_at desc), so if that one is outside the window none
        // of them are.
        if (!changedWithinWindow(changesByTenure.get(r.tenure.id), now)) return false;
      } else if (!matchesFilter(r, filter, now)) {
        return false;
      }
      if (!q) return true;
      const t = r.tenure;
      return [
        t.tenure_number, t.tenure_name, r.internalProjectName,
        ...(r.owners || []).map((o) => o.owner_name),
      ].filter(Boolean).some((v) => String(v).toLowerCase().includes(q));
    });
  }, [rows, filter, search, now, changesByTenure]);

  const bandCounts = useMemo(() => {
    const counts = {};
    for (const r of visibleRows) {
      const band = urgencyBand(daysRemaining(r.tenure.good_to_date, now), r.tenure.status);
      counts[band.id] = (counts[band.id] || 0) + 1;
    }
    return counts;
  }, [visibleRows, now]);

  const monitoredIds = useMemo(() => new Set(rows.map((r) => r.tenure.id)), [rows]);
  const slotsLeft = remainingTenureSlots(entitlements, rows.length);

  // ── Actions ──────────────────────────────────────────────────────────────

  async function handleCreatePortfolio() {
    // Check the limit BEFORE prompting, so a user at their plan's cap is not
    // asked to name something that is about to be refused. The server stays
    // the authority — the PORTFOLIO_LIMIT branch below is still what enforces
    // it — this only avoids making somebody type first and be told after.
    if (!canCreatePortfolio(entitlements, portfolios.length)) {
      setError('Your plan monitors one group of claims. Upgrade to keep separate groups '
        + 'with their own reminders.');
      onUpgrade?.('tenure_portfolios');
      return;
    }
    const name = window.prompt('Name this group of claims', 'My B.C. claims');
    if (!name) return;
    try {
      const id = await createPortfolio(name);
      const list = await listPortfolios();
      setPortfolios(list);
      setActiveId(id);
    } catch (e) {
      if (e.code === 'PORTFOLIO_LIMIT' && onUpgrade) {
        setError(e.message);
        onUpgrade('tenure_portfolios');
      } else {
        setError(String(e.message || e));
      }
    }
  }

  async function handleAdd(tenureIds) {
    try {
      const result = await addTenures(activeId, tenureIds);
      setShowAdd(false);
      await refresh(activeId);
      // Report the partial outcome honestly rather than showing a success
      // toast for a batch that was trimmed. The two reasons a title can be
      // skipped are kept apart: only one of them is a plan limit, and offering
      // an upgrade for the other would be a paywall raised on a false pretext.
      if (result?.skipped_over_limit > 0) {
        setFlash({
          tone: 'warn',
          text: `Added ${result.added}. ${result.skipped_over_limit} could not be added — `
            + `your plan monitors ${result.max_monitored_tenures} claims.`,
          action: onUpgrade ? { label: 'See plans', run: () => onUpgrade('tenure_limit') } : null,
        });
        trackEvent('tenure_upgrade_viewed', { reason: 'tenure_limit' });
      } else if (result?.skipped_unknown > 0) {
        setFlash({
          tone: 'warn',
          text: `Added ${result.added}. ${result.skipped_unknown} could not be found in the `
            + 'latest B.C. dataset and were not added. Verify them in Mineral Titles Online.',
        });
      } else {
        setFlash({ tone: 'ok', text: `Now monitoring ${result?.added || 0} more claims.` });
      }
    } catch (e) {
      setError(String(e.message || e));
    }
  }

  async function handleRemove(row) {
    if (!window.confirm(
      `Stop monitoring tenure ${row.tenure.tenure_number}?\n\n`
      + 'Its scheduled reminders will be cancelled. Your notes and decision history '
      + 'are kept, so re-adding it later restores them.',
    )) return;
    try {
      await removeTenure(activeId, row.tenure.id);
      if (selected?.tenure.id === row.tenure.id) setSelected(null);
      await refresh(activeId);
    } catch (e) {
      setError(String(e.message || e));
    }
  }

  async function handleSaveMembership(patch) {
    if (!selected) return;
    setSaving(true);
    try {
      await updateMembership(selected.membershipId, patch);
      await refresh(activeId);
      setSelected((s) => (s ? { ...s, ...patch } : s));
      setFlash({ tone: 'ok', text: 'Saved.' });
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setSaving(false);
    }
  }

  async function handleDecisionChange(row, value) {
    try {
      await updateMembership(row.membershipId, { maintenanceDecision: value });
      await refresh(activeId);
    } catch (e) {
      setError(String(e.message || e));
    }
  }

  function handleExportCsv() {
    trackEvent('tenure_export_attempted', { rows: visibleRows.length });
    const csv = buildScheduleCsv(visibleRows, {
      portfolioName: active?.name,
      lastSyncedAt: sync?.completed_at,
      now,
    });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(active?.name || 'tenure-schedule').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function openInEditor(subset) {
    const list = subset || visibleRows;
    if (!list.length) return;
    trackEvent('tenure_opened_in_editor', { count: list.length });
    const geojson = await fetchTenureGeometry(list.map((r) => r.tenure.id));
    onOpenTenuresInEditor?.(geojson, {
      name: active?.name || 'Monitored claims',
      syncedAt: sync?.completed_at || null,
      tenureNumbers: list.map((r) => r.tenure.tenure_number),
    });
  }

  /** Claims inside the current map view — the "search this extent" path. */
  async function searchExtent() {
    const bounds = window.prompt(
      'Paste a bounding box as minLng,minLat,maxLng,maxLat, or cancel.',
      '-123.5,52.8,-121.0,54.2',
    );
    if (!bounds) return;
    try {
      const body = await searchTenures('extent', bounds);
      setFlash({
        tone: 'ok',
        text: `${(body.results || []).length} tenures in that extent. Use "Add claims" → `
          + 'Tenure number to add the ones you want.',
      });
    } catch (e) {
      setError(String(e.message || e));
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────

  if (!user) {
    return (
      <div className="tm-shell">
        <div className="tm-signin-gate">
          <h1>Tenure Monitor</h1>
          <p>
            Monitor your B.C. mineral tenure portfolio, catch approaching deadlines,
            identify title changes, and open every claim directly in Exploration Maps.
          </p>
          <p className="tm-muted">
            Sign in to save a portfolio and receive reminders before your claims reach
            their good-to-date.
          </p>
          <LastSyncLine sync={sync} />
          <div className="tm-gate-actions">
            {/* The gate asks for a sign-in, so it has to offer one. Sending a
                visitor back to the landing page to find it separately is how a
                deep link into /tenure-monitor becomes a dead end. */}
            {onSignIn && (
              <button className="btn primary" type="button" onClick={onSignIn}>
                Sign in / Create account
              </button>
            )}
            <button className="secondary-btn" type="button" onClick={onExit}>
              ← Back to Exploration Maps
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="tm-shell">
      <header className="tm-header">
        <div className="tm-header-left">
          <span className="tm-logo" aria-hidden="true">⛏</span>
          <span className="tm-header-title">Tenure Monitor</span>
          <span className="tm-header-jurisdiction">British Columbia</span>
        </div>
        <div className="tm-header-right">
          {/* Groups of claims. The picker appears as soon as there is a second
              one; "New group" is here rather than only on the empty state,
              which is where it used to live — once a first portfolio existed
              the onboarding branch stopped rendering and there was no way to
              make a second one from anywhere in the UI, on any plan, even
              though the quota and the RPC both allowed it. */}
          {portfolios.length > 1 && (
            <>
              <label className="tm-sr-only" htmlFor="tm-portfolio-picker">Claim group</label>
              <select
                id="tm-portfolio-picker"
                className="tm-select"
                value={activeId || ''}
                onChange={(e) => { setActiveId(e.target.value); setSelected(null); }}
              >
                {portfolios.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </>
          )}
          {active && (
            <button
              className="secondary-btn"
              type="button"
              onClick={handleCreatePortfolio}
              title={canCreatePortfolio(entitlements, portfolios.length)
                ? 'Start another group of claims — separate reminders and its own map.'
                : 'Your plan monitors one group of claims.'}
            >
              New group
            </button>
          )}
          {active && (
            <button className="secondary-btn" type="button" onClick={() => setShowAlerts(true)}>
              Reminders
            </button>
          )}
          <button className="tm-back-link" type="button" onClick={onExit}>
            ← Exploration Maps
          </button>
        </div>
      </header>

      <SystemNoticeBanner notice={systemNotice} />

      <main className="tm-main">
        {error && <div className="tm-error-bar" role="alert">{error}</div>}
        {flash && (
          <div className={`tm-flash tm-flash--${flash.tone}`} role="status">
            <span>{flash.text}</span>
            {flash.action && (
              <button type="button" className="tm-link-btn" onClick={flash.action.run}>
                {flash.action.label}
              </button>
            )}
            <button type="button" className="tm-flash-close" onClick={() => setFlash(null)} aria-label="Dismiss">✕</button>
          </div>
        )}

        {!active ? (
          <section className="tm-onboard">
            <h1>Never lose track of a mineral claim deadline.</h1>
            <p>
              Add your B.C. tenures once. Exploration Maps watches the government record,
              tells you before each claim reaches its good-to-date, and flags ownership or
              status changes when it sees them.
            </p>
            <ul className="tm-onboard-list">
              <li>Find claims by tenure number, registered owner, client number or a CSV.</li>
              <li>See days remaining, area and status for the whole portfolio at a glance.</li>
              <li>Get reminders at {(entitlements.alert_offsets_days || []).join(', ')} days.</li>
              <li>Keep separate groups for separate projects, each with its own reminders.</li>
              <li>Turn a live group into a presentation-ready project map.</li>
            </ul>
            <button className="btn primary" type="button" onClick={handleCreatePortfolio}>
              Create a claim group
            </button>
            <LastSyncLine sync={sync} />
            <VerificationNotice />
          </section>
        ) : (
          <>
            <PortfolioSummary
              summary={summary}
              portfolioName={active.name}
              activeFilter={filter}
              onFilter={setFilter}
            />
            <LastSyncLine sync={sync} />

            {active.alerts_paused && (
              <p className="tm-warning" role="status">
                Reminders for this portfolio are paused
                {active.paused_reason ? ` — ${active.paused_reason}` : ''}.
              </p>
            )}

            <div className="tm-toolbar">
              <div className="tm-toolbar-group">
                <button className="btn primary" type="button" onClick={() => setShowAdd(true)}>
                  Add claims
                </button>
                <button className="secondary-btn" type="button" onClick={searchExtent}>
                  Search a map extent
                </button>
              </div>

              <div className="tm-toolbar-group">
                <label className="tm-sr-only" htmlFor="tm-filter-text">Filter claims</label>
                <input
                  id="tm-filter-text"
                  className="tm-input tm-input--search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Filter by tenure, claim, owner or project"
                />
                {(filter || search) && (
                  <button className="tm-link-btn" type="button" onClick={() => { setFilter(null); setSearch(''); }}>
                    Clear filters
                  </button>
                )}
              </div>

              <div className="tm-toolbar-group">
                <div className="tm-view-toggle" role="group" aria-label="View">
                  <button
                    type="button"
                    className={view === 'table' ? 'is-active' : ''}
                    aria-pressed={view === 'table'}
                    onClick={() => setView('table')}
                  >
                    Table
                  </button>
                  <button
                    type="button"
                    className={view === 'map' ? 'is-active' : ''}
                    aria-pressed={view === 'map'}
                    onClick={() => setView('map')}
                  >
                    Map
                  </button>
                  <button
                    type="button"
                    className={view === 'activity' ? 'is-active' : ''}
                    aria-pressed={view === 'activity'}
                    onClick={() => setView('activity')}
                  >
                    Activity
                    {summary.changed_recently > 0 && (
                      <span className="tm-view-badge">{summary.changed_recently}</span>
                    )}
                  </button>
                </div>
                <button className="secondary-btn" type="button" onClick={handleExportCsv} disabled={!visibleRows.length}>
                  Export CSV
                </button>
                <button className="secondary-btn" type="button" onClick={() => openInEditor()} disabled={!visibleRows.length}>
                  Open in Exploration Maps
                </button>
              </div>
            </div>

            <p className="tm-cta-line">
              Turn this live claim portfolio into a presentation-ready project map —
              styling, annotations, branding and exports all live in the Exploration Maps
              editor.
            </p>

            {view === 'map' && (
              <>
                <div className="tm-toolbar-group">
                  <label className="tm-label tm-label--inline" htmlFor="tm-colour-by">Colour by</label>
                  <select
                    id="tm-colour-by"
                    className="tm-select"
                    value={colourBy}
                    onChange={(e) => setColourBy(e.target.value)}
                  >
                    {COLOUR_BY.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                  </select>
                </div>
                <TenureMap
                  rows={visibleRows}
                  now={now}
                  colourBy={colourBy}
                  selectedTenureId={selected?.tenure.id}
                  onSelect={setSelected}
                  changesByTenure={changesByTenure}
                />
                {colourBy === 'urgency' && <UrgencyLegend counts={bandCounts} />}
              </>
            )}

            {view === 'activity' ? (
              <PortfolioActivity
                portfolioId={activeId}
                rows={rows}
                onSelectTenure={(row) => { if (row) { setSelected(row); setView('table'); } }}
              />
            ) : (
            <div className="tm-content">
              <div className="tm-content-main">
                {loading && !rows.length ? (
                  <p className="tm-muted">Loading your portfolio…</p>
                ) : rows.length === 0 ? (
                  <p className="tm-empty">
                    This portfolio has no claims yet. Use <strong>Add claims</strong> to find
                    them by tenure number, registered owner, client number, or by uploading a
                    claim schedule.
                  </p>
                ) : (
                  <TenureTable
                    rows={visibleRows}
                    now={now}
                    changesByTenure={changesByTenure}
                    selectedTenureId={selected?.tenure.id}
                    onSelect={setSelected}
                    onRemove={handleRemove}
                    onOpenInEditor={(row) => openInEditor([row])}
                    onDecisionChange={handleDecisionChange}
                  />
                )}
              </div>

              {selected && (
                <TenureDetailPanel
                  row={selected}
                  now={now}
                  changes={changes.filter((c) => c.tenure_id === selected.tenure.id)}
                  saving={saving}
                  onClose={() => setSelected(null)}
                  onSave={handleSaveMembership}
                  onRemove={handleRemove}
                  onOpenInEditor={(row) => openInEditor([row])}
                />
              )}
            </div>
            )}

            <VerificationNotice />
            <DataAttribution />
          </>
        )}
      </main>

      {showAdd && active && (
        <AddTenuresModal
          onClose={() => setShowAdd(false)}
          onAdd={handleAdd}
          alreadyMonitored={monitoredIds}
          remainingSlots={slotsLeft}
          planLabel={tier === 'pro' ? 'Pro' : 'the free plan'}
          onUpgrade={onUpgrade ? () => onUpgrade('tenure_limit') : null}
        />
      )}

      {showAlerts && active && (
        <AlertSettings
          portfolio={active}
          entitlements={entitlements}
          onClose={() => { setShowAlerts(false); refresh(activeId); }}
          onUpgrade={onUpgrade ? () => onUpgrade('tenure_alerts') : null}
        />
      )}
    </div>
  );
}
