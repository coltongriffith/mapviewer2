import React, { useMemo, useState } from 'react';
import { searchTenures } from '../../utils/tenureMonitor';
import { groupOwnerCandidates, ownerMatchPrompt } from '../../utils/tenureOwners';
import {
  parseTenureCsv, reconcileRows, reconciliationSummary, ROW_STATUS, ROW_STATUS_LABELS,
} from '../../utils/tenureCsv';
import { formatGovernmentDate, daysRemaining, formatDaysRemaining, urgencyBand } from '../../utils/tenureDates';
import { trackEvent } from '../../utils/track';
import { VerificationNotice } from './TenureNotices';
import { kindBadge } from '../../utils/tenureKind';

// Building a portfolio.
//
// Five ways in — tenure number, a pasted list, owner name, client number, and
// a CSV — plus map-extent search from the portfolio view. They exist because
// people hold their claim records in different shapes, and a product that only
// accepts one shape makes them do data entry before it can help them.
//
// THE RULE THAT GOVERNS ALL OF THEM: the user confirms what enters the
// portfolio. Owner-name matching produces candidates ranked by confidence, not
// a set of claims; CSV import produces a reconciliation report, not a silent
// bulk add. Adding somebody else's title to a monitored portfolio would put a
// deadline they do not own on their dashboard, and drop the one they do.

const MODES = [
  { id: 'number', label: 'Tenure number', hint: 'One tenure number.' },
  { id: 'numbers', label: 'Several numbers', hint: 'Paste a list — commas, spaces or one per line.' },
  // Said plainly, because people assume a portfolio means ownership: you can
  // watch any registered title, including ground held by somebody else.
  { id: 'owner', label: 'Registered owner', hint: 'Company or individual name on the title. You can watch any B.C. title, including ground you do not hold.' },
  { id: 'client', label: 'Client number', hint: 'B.C. government client number.' },
  { id: 'csv', label: 'Upload CSV', hint: 'A claim schedule exported from anywhere.' },
];

function ResultRow({ tenure, checked, onToggle, extra }) {
  const days = daysRemaining(tenure.good_to_date);
  const band = urgencyBand(days, tenure.status);
  const badge = kindBadge(tenure);
  const id = `pick-${tenure.id}`;
  return (
    <li className="tm-pick-row">
      <input id={id} type="checkbox" checked={checked} onChange={onToggle} />
      <label htmlFor={id}>
        <span className="tm-pick-number">
          {tenure.tenure_number}
          {badge && (
            <span className={`tm-flag tm-flag--${badge.id}`} title={badge.title}>
              {badge.label.toLowerCase()}
            </span>
          )}
        </span>
        <span className="tm-pick-name">{tenure.tenure_name || 'Unnamed claim'}</span>
        <span className="tm-pick-meta">
          {extra || tenure.owner_name || (tenure.owners || []).map((o) => o.owner_name).join('; ') || 'Owner not published'}
        </span>
        <span className="tm-pick-meta">
          {tenure.area_hectares != null && `${Number(tenure.area_hectares).toLocaleString(undefined, { maximumFractionDigits: 1 })} ha · `}
          {formatGovernmentDate(tenure.good_to_date)}
          {' · '}
          <span style={{ color: band.color }}>
            <span aria-hidden="true">{band.icon}</span> {formatDaysRemaining(days)}
          </span>
          {tenure.status && ` · ${tenure.status}`}
        </span>
      </label>
    </li>
  );
}

export default function AddTenuresModal({
  onClose, onAdd, alreadyMonitored = new Set(), remainingSlots = Infinity, planLabel = 'your plan',
  onUpgrade,
}) {
  const [mode, setMode] = useState('number');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);       // search response
  const [csvReport, setCsvReport] = useState(null); // reconciliation
  const [selected, setSelected] = useState(new Set());
  const [adding, setAdding] = useState(false);

  const reset = () => { setResult(null); setCsvReport(null); setSelected(new Set()); setError(null); };

  const toggle = (id) => setSelected((s) => {
    const next = new Set(s);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  async function runSearch(e) {
    e?.preventDefault();
    if (!query.trim()) return;
    setLoading(true);
    reset();
    trackEvent('tenure_search_started', { mode });
    try {
      const body = await searchTenures(mode, query.trim());
      setResult(body);
      const found = (body.results || body.candidates || []).length;
      trackEvent('tenure_search_completed', { mode, results: found });
      // Exact matches are safe to pre-select; candidates never are.
      if (mode === 'number' && body.match === 'exact') {
        setSelected(new Set((body.results || []).map((r) => r.id)));
      } else if (mode === 'numbers') {
        setSelected(new Set((body.results || []).map((r) => r.id)));
      }
    } catch (err) {
      setError(String(err.message || err));
    } finally {
      setLoading(false);
    }
  }

  async function handleCsv(file) {
    if (!file) return;
    setLoading(true);
    reset();
    try {
      const parsed = await parseTenureCsv(file);
      if (parsed.error) { setError(parsed.error); return; }
      if (!parsed.rows.length) { setError('That file has no data rows.'); return; }

      // Look each row up. Tenure number is authoritative when present; a row
      // with only a name falls back to an owner search, whose hits are treated
      // as candidates rather than matches.
      const matchesByRow = new Map();
      for (const row of parsed.rows) {
        try {
          if (row.tenureNumber) {
            const body = await searchTenures('number', row.tenureNumber);
            matchesByRow.set(row.line, body.match === 'exact' ? (body.results || []) : []);
          } else if (row.ownerName) {
            const body = await searchTenures('owner', row.ownerName, { limit: 25 });
            matchesByRow.set(row.line, body.candidates || []);
          } else {
            matchesByRow.set(row.line, []);
          }
        } catch {
          // One failed lookup must not sink the whole import; the row lands in
          // "not found" and the user can see exactly which one.
          matchesByRow.set(row.line, []);
        }
      }

      const report = reconcileRows(parsed.rows, matchesByRow, alreadyMonitored);
      setCsvReport({ ...report, parsed });
      setSelected(new Set(report.autoAddIds));
      trackEvent('tenure_search_completed', { mode: 'csv', results: report.counts[ROW_STATUS.MATCHED] });
    } catch (err) {
      setError(String(err.message || err));
    } finally {
      setLoading(false);
    }
  }

  const ownerGroups = useMemo(() => {
    if (mode !== 'owner' || !result?.candidates) return null;
    return groupOwnerCandidates(result.query, result.candidates);
  }, [mode, result]);

  const overLimit = selected.size > remainingSlots;

  // Every tenure currently on screen, so the footer can total what is selected
  // and the group headers can offer select-all. Owner search is the bulk path —
  // a company with forty claims should not have to tick forty boxes — but the
  // rule that the user confirms what enters the portfolio is unchanged: this is
  // one deliberate click on one named group, not an automatic add.
  const visibleTenures = useMemo(() => {
    const all = [
      ...(result?.results || []),
      ...(result?.candidates || []),
      ...(csvReport?.entries || []).flatMap((e) => (e.tenure ? [e.tenure] : e.candidates || [])),
    ];
    return new Map(all.map((t) => [t.id, t]));
  }, [result, csvReport]);

  const selectedHectares = [...selected]
    .reduce((sum, id) => sum + (Number(visibleTenures.get(id)?.area_hectares) || 0), 0);

  const selectGroup = (group, on) => setSelected((s) => {
    const next = new Set(s);
    for (const c of group) { if (on) next.add(c.id); else next.delete(c.id); }
    return next;
  });

  async function commit() {
    if (!selected.size) return;
    setAdding(true);
    try {
      await onAdd([...selected]);
    } finally {
      setAdding(false);
    }
  }

  return (
    <div className="export-hd-overlay" role="dialog" aria-modal="true" aria-label="Add claims to monitor">
      <div className="tm-add-modal">
        <button className="export-hd-close" onClick={onClose} aria-label="Close">✕</button>
        <h2 className="export-hd-title">Add claims to monitor</h2>

        <div className="tm-mode-row" role="tablist" aria-label="How to find claims">
          {MODES.map((m) => (
            <button
              key={m.id}
              role="tab"
              type="button"
              aria-selected={mode === m.id}
              className={`tm-mode-btn ${mode === m.id ? 'is-active' : ''}`.trim()}
              onClick={() => { setMode(m.id); reset(); setQuery(''); }}
            >
              {m.label}
            </button>
          ))}
        </div>

        <p className="tm-mode-hint">{MODES.find((m) => m.id === mode)?.hint}</p>

        {mode === 'csv' ? (
          <div className="tm-csv-drop">
            <label className="tm-label" htmlFor="tm-csv-file">Claim schedule (.csv)</label>
            <input
              id="tm-csv-file"
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => handleCsv(e.target.files?.[0])}
            />
            <p className="tm-field-hint">
              Recognised columns: <code>tenure_number</code>, <code>claim_name</code>,{' '}
              <code>owner_name</code>, <code>project_name</code>, <code>internal_notes</code>.
              Any combination works — a tenure number gives the most reliable match.
              Every row is reported back to you; nothing is discarded quietly.
            </p>
          </div>
        ) : (
          <form className="tm-search-form" onSubmit={runSearch}>
            <label className="tm-sr-only" htmlFor="tm-search-input">
              {MODES.find((m) => m.id === mode)?.label}
            </label>
            {mode === 'numbers' ? (
              <textarea
                id="tm-search-input"
                className="tm-textarea"
                rows={3}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="1044501, 1044502&#10;1044503"
              />
            ) : (
              <input
                id="tm-search-input"
                className="tm-input"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={mode === 'owner' ? 'e.g. Goliath Resources' : 'e.g. 1044501'}
              />
            )}
            <button className="btn primary" type="submit" disabled={loading || !query.trim()}>
              {loading ? 'Searching…' : 'Search'}
            </button>
          </form>
        )}

        {error && <p className="tm-error" role="alert">{error}</p>}

        {/* ── Owner search: candidates, grouped, nothing pre-selected ─────── */}
        {ownerGroups && (
          <div className="tm-results">
            <p className="tm-results-head">{ownerMatchPrompt(ownerGroups.total, [result.query])}</p>
            {ownerGroups.total === 0 && (
              <p className="tm-muted">
                No B.C. titles are registered to a name matching “{result.query}” in the latest
                dataset. Company names are often recorded in clipped legal form — try the
                distinctive part of the name on its own.
              </p>
            )}
            {[
              ['Exact name match', ownerGroups.exact],
              ['Possible match — check before adding', ownerGroups.possible],
              ['Weak match — probably a different company', ownerGroups.weak],
            ].map(([heading, group]) => group.length > 0 && (
              <section key={heading} className="tm-result-group">
                <h3 className="tm-result-group-title">
                  {heading} ({group.length})
                  {' '}
                  <button
                    type="button"
                    className="tm-link-btn"
                    onClick={() => selectGroup(group, !group.every((c) => selected.has(c.id)))}
                  >
                    {group.every((c) => selected.has(c.id)) ? 'Clear' : 'Select all'}
                    <span className="tm-sr-only">{` — ${heading.toLowerCase()}`}</span>
                  </button>
                </h3>
                <ul className="tm-pick-list">
                  {group.map((c) => (
                    <ResultRow
                      key={`${c.id}-${c.owner_name}`}
                      tenure={c}
                      extra={c.owner_name}
                      checked={selected.has(c.id)}
                      onToggle={() => toggle(c.id)}
                    />
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}

        {/* ── Number / list / client search ───────────────────────────────── */}
        {result && !ownerGroups && (
          <div className="tm-results">
            {result.fieldUnavailable && (
              <p className="tm-notice tm-notice--compact">{result.note}</p>
            )}
            {(result.results || []).length === 0 && !result.fieldUnavailable && (
              <p className="tm-muted">
                Nothing matched in the latest B.C. dataset. If you expected a result, verify
                the number in MTO — the title may have been terminated, or our copy of the
                registry may not have caught up.
              </p>
            )}
            {result.notFound?.length > 0 && (
              <p className="tm-warning">
                Not found: {result.notFound.join(', ')}. These are reported so you know they
                are <em>not</em> being monitored — check them in MTO.
              </p>
            )}
            <ul className="tm-pick-list">
              {(result.results || []).map((r) => (
                <ResultRow
                  key={r.id}
                  tenure={r}
                  checked={selected.has(r.id)}
                  onToggle={() => toggle(r.id)}
                />
              ))}
            </ul>
          </div>
        )}

        {/* ── CSV reconciliation report ───────────────────────────────────── */}
        {csvReport && (
          <div className="tm-results">
            <p className="tm-results-head">
              {csvReport.parsed.rows.length} rows read — {reconciliationSummary(csvReport.counts)}.
            </p>
            {csvReport.parsed.truncated && (
              <p className="tm-warning">Only the first 2,000 rows were read.</p>
            )}
            <table className="tm-recon-table">
              <caption className="tm-sr-only">CSV import reconciliation, row by row</caption>
              <thead>
                <tr>
                  <th scope="col">Line</th>
                  <th scope="col">From your file</th>
                  <th scope="col">Outcome</th>
                  <th scope="col">Monitor</th>
                </tr>
              </thead>
              <tbody>
                {csvReport.entries.map((entry) => (
                  <tr key={entry.row.line} className={`tm-recon-row tm-recon--${entry.status}`}>
                    <td>{entry.row.line}</td>
                    <td>
                      {entry.row.tenureNumber || entry.row.claimName || entry.row.ownerName}
                      {entry.row.projectName && <span className="tm-muted"> · {entry.row.projectName}</span>}
                    </td>
                    <td>
                      <strong>{ROW_STATUS_LABELS[entry.status]}</strong>
                      {entry.detail && <span className="tm-recon-detail">{entry.detail}</span>}
                    </td>
                    <td>
                      {entry.status === ROW_STATUS.MULTIPLE ? (
                        <select
                          className="tm-select tm-select--compact"
                          value={[...selected].find((id) => entry.candidates.some((c) => c.id === id)) || ''}
                          onChange={(e) => setSelected((s) => {
                            const next = new Set(s);
                            for (const c of entry.candidates) next.delete(c.id);
                            if (e.target.value) next.add(e.target.value);
                            return next;
                          })}
                        >
                          <option value="">Skip — I'll decide later</option>
                          {entry.candidates.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.tenure_number} — {c.tenure_name || 'Unnamed'}
                            </option>
                          ))}
                        </select>
                      ) : entry.tenure ? (
                        <label className="tm-checkbox tm-checkbox--inline">
                          <input
                            type="checkbox"
                            checked={selected.has(entry.tenure.id)}
                            disabled={entry.status === ROW_STATUS.ALREADY_MONITORED}
                            onChange={() => toggle(entry.tenure.id)}
                          />
                          <span className="tm-sr-only">
                            {`Monitor tenure ${entry.tenure.tenure_number}`}
                          </span>
                        </label>
                      ) : <span className="tm-muted">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* ── Commit ──────────────────────────────────────────────────────── */}
        {(result || csvReport) && (
          <footer className="tm-add-foot">
            <div className="tm-add-count">
              <strong>{selected.size}</strong> selected
              {/* Hectares alongside the count, because "37 claims" and
                  "37 claims, 18,400 ha" are different decisions. */}
              {selectedHectares > 0 && (
                <span className="tm-muted">
                  {' · '}
                  {selectedHectares.toLocaleString(undefined, { maximumFractionDigits: 0 })} ha
                </span>
              )}
              {Number.isFinite(remainingSlots) && (
                <span className={overLimit ? 'tm-over-limit' : 'tm-muted'}>
                  {' · '}{remainingSlots} {remainingSlots === 1 ? 'slot' : 'slots'} left on {planLabel}
                </span>
              )}
            </div>
            {overLimit && (
              <p className="tm-warning">
                You have selected more claims than your plan monitors. The first{' '}
                {remainingSlots} will be added and the rest reported back — upgrade to
                monitor them all.
                {onUpgrade && (
                  <> <button type="button" className="tm-link-btn" onClick={onUpgrade}>See plans</button></>
                )}
              </p>
            )}
            <div className="tm-add-actions">
              <button type="button" className="secondary-btn" onClick={onClose}>Cancel</button>
              <button
                type="button"
                className="btn primary"
                disabled={!selected.size || adding}
                onClick={commit}
              >
                {adding ? 'Adding…' : `Monitor ${selected.size} ${selected.size === 1 ? 'claim' : 'claims'}`}
              </button>
            </div>
          </footer>
        )}

        <VerificationNotice compact />
      </div>
    </div>
  );
}
