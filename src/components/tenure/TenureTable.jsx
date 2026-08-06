import React, { useMemo, useState } from 'react';
import {
  daysRemaining, urgencyBand, formatDaysRemaining, formatGovernmentDate,
} from '../../utils/tenureDates';
import { decisionLabel, MAINTENANCE_DECISIONS } from '../../utils/tenureCsv';
import { VerifyInMtoLink, SourceValue } from './TenureNotices';
import { kindBadge } from '../../utils/tenureKind';

// The claim schedule.
//
// This table is not a secondary view of the map — it is the primary one, and
// it is the accessible alternative to the map for anyone who cannot use a
// pointer or perceive the colour bands. So it is a real <table> with real
// <th scope>, every control is a real button, sorting is announced through
// aria-sort, and nothing about a claim's urgency is communicated by colour
// alone: every row carries the band's icon and its text label.

const COLUMNS = [
  { key: 'tenure_number', label: 'Tenure', sortable: true },
  { key: 'tenure_name', label: 'Claim', sortable: true },
  { key: 'owner', label: 'Registered owner', sortable: true },
  { key: 'project', label: 'Project', sortable: true },
  { key: 'area_hectares', label: 'Area (ha)', sortable: true, numeric: true },
  { key: 'good_to_date', label: 'Good-to-date', sortable: true },
  { key: 'days', label: 'Days remaining', sortable: true, numeric: true },
  { key: 'decision', label: 'Decision', sortable: true },
  { key: 'change', label: 'Last change', sortable: false },
  { key: 'actions', label: 'Actions', sortable: false },
];

function sortValue(row, key, now) {
  const t = row.tenure;
  switch (key) {
    case 'tenure_number': return t.tenure_number || '';
    case 'tenure_name': return (t.tenure_name || '').toLowerCase();
    case 'owner': return (row.owners?.[0]?.owner_name || '').toLowerCase();
    case 'project': return (row.internalProjectName || '').toLowerCase();
    case 'area_hectares': return Number(t.area_hectares) || 0;
    case 'good_to_date': return t.good_to_date || '9999-12-31';
    case 'days': {
      const d = daysRemaining(t.good_to_date, now);
      // Titles with no published date sort last in ascending order rather than
      // masquerading as the most urgent thing in the portfolio.
      return d == null ? Number.POSITIVE_INFINITY : d;
    }
    case 'decision': return decisionLabel(row.maintenanceDecision);
    default: return '';
  }
}

export default function TenureTable({
  rows,
  now = new Date(),
  changesByTenure = new Map(),
  selectedTenureId,
  onSelect,
  onRemove,
  onOpenInEditor,
  onDecisionChange,
}) {
  const [sort, setSort] = useState({ key: 'days', dir: 'asc' });

  const sorted = useMemo(() => {
    const copy = [...rows];
    copy.sort((a, b) => {
      const av = sortValue(a, sort.key, now);
      const bv = sortValue(b, sort.key, now);
      if (av < bv) return sort.dir === 'asc' ? -1 : 1;
      if (av > bv) return sort.dir === 'asc' ? 1 : -1;
      // Stable tiebreak so the order does not shuffle between renders.
      return String(a.tenure.tenure_number).localeCompare(String(b.tenure.tenure_number));
    });
    return copy;
  }, [rows, sort, now]);

  const toggleSort = (key) => {
    setSort((s) => (s.key === key
      ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' }
      : { key, dir: key === 'days' || key === 'good_to_date' ? 'asc' : 'asc' }));
  };

  const ariaSort = (key) => {
    if (sort.key !== key) return 'none';
    return sort.dir === 'asc' ? 'ascending' : 'descending';
  };

  if (!rows.length) {
    return (
      <p className="tm-empty">
        No claims match the current filters.
      </p>
    );
  }

  return (
    <div className="tm-table-wrap">
      <table className="tm-table">
        <caption className="tm-sr-only">
          Monitored B.C. mineral tenures. Days remaining is calculated in Pacific time
          from the good-to-date published by the province.
        </caption>
        <thead>
          <tr>
            {COLUMNS.map((col) => (
              <th
                key={col.key}
                scope="col"
                aria-sort={col.sortable ? ariaSort(col.key) : undefined}
                className={col.numeric ? 'tm-num' : undefined}
              >
                {col.sortable ? (
                  <button
                    type="button"
                    className="tm-sort-btn"
                    onClick={() => toggleSort(col.key)}
                  >
                    {col.label}
                    <span aria-hidden="true" className="tm-sort-caret">
                      {sort.key === col.key ? (sort.dir === 'asc' ? '▲' : '▼') : '↕'}
                    </span>
                  </button>
                ) : col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => {
            const t = row.tenure;
            const days = daysRemaining(t.good_to_date, now);
            const band = urgencyBand(days, t.status);
            const change = changesByTenure.get(t.id);
            const notObserved = (t.missing_run_count || 0) >= 2;
            const badge = kindBadge(t);

            return (
              <tr
                key={row.membershipId}
                className={`tm-row tm-row--${band.id} ${selectedTenureId === t.id ? 'is-selected' : ''}`.trim()}
                aria-selected={selectedTenureId === t.id || undefined}
              >
                <th scope="row" className="tm-cell-number">
                  <button
                    type="button"
                    className="tm-link-btn"
                    onClick={() => onSelect?.(row)}
                  >
                    {t.tenure_number}
                  </button>
                  {notObserved && (
                    <span className="tm-flag tm-flag--missing" title="Not present in the latest successful dataset. Verify in MTO.">
                      not in latest dataset
                    </span>
                  )}
                  {/* Only the exceptional kinds are flagged. A badge on every
                      granted claim would teach people to stop reading badges,
                      which is the opposite of what this one is for. */}
                  {badge && (
                    <span className={`tm-flag tm-flag--${badge.id}`} title={badge.title}>
                      {badge.label.toLowerCase()}
                    </span>
                  )}
                </th>
                <td>{t.tenure_name || <span className="tm-unpublished">Unnamed</span>}</td>
                <td className="tm-cell-owner">
                  {row.owners?.length
                    ? row.owners.map((o) => o.owner_name).join('; ')
                    : <SourceValue value={null} />}
                </td>
                <td>{row.internalProjectName || <span className="tm-muted">—</span>}</td>
                <td className="tm-num">
                  {t.area_hectares == null
                    ? <SourceValue value={null} />
                    : Number(t.area_hectares).toLocaleString(undefined, { maximumFractionDigits: 1 })}
                </td>
                <td>{formatGovernmentDate(t.good_to_date)}</td>
                <td className="tm-num">
                  {/* Colour is decoration here. The icon and the words carry
                      the meaning, so the urgency survives greyscale printing
                      and colour-blind viewing alike. */}
                  <span className="tm-days" style={{ color: band.color }}>
                    <span aria-hidden="true">{band.icon}</span>{' '}
                    {formatDaysRemaining(days)}
                  </span>
                  <span className="tm-sr-only">{` (${band.label})`}</span>
                </td>
                <td>
                  {onDecisionChange ? (
                    <>
                      <label className="tm-sr-only" htmlFor={`decision-${row.membershipId}`}>
                        {`Maintenance decision for tenure ${t.tenure_number}`}
                      </label>
                      <select
                        id={`decision-${row.membershipId}`}
                        className="tm-select tm-select--compact"
                        value={row.maintenanceDecision || 'UNDECIDED'}
                        onChange={(e) => onDecisionChange(row, e.target.value)}
                      >
                        {MAINTENANCE_DECISIONS.map((d) => (
                          <option key={d.value} value={d.value}>{d.label}</option>
                        ))}
                      </select>
                    </>
                  ) : decisionLabel(row.maintenanceDecision)}
                </td>
                <td className="tm-cell-change">
                  {change ? (
                    <span className={`tm-change tm-change--${change.severity}`}>
                      {changeLabel(change)}
                    </span>
                  ) : <span className="tm-muted">—</span>}
                </td>
                <td className="tm-cell-actions">
                  <VerifyInMtoLink tenureNumber={t.tenure_number} className="tm-action" />
                  {onOpenInEditor && (
                    <button type="button" className="tm-action" onClick={() => onOpenInEditor(row)}>
                      Open map
                      <span className="tm-sr-only">{` — open tenure ${t.tenure_number} in the Exploration Maps editor`}</span>
                    </button>
                  )}
                  {onRemove && (
                    <button
                      type="button"
                      className="tm-action tm-action--danger"
                      onClick={() => onRemove(row)}
                    >
                      Stop monitoring
                      <span className="tm-sr-only">{` tenure ${t.tenure_number}`}</span>
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const CHANGE_LABELS = {
  GOOD_TO_DATE_CHANGED: 'Good-to-date changed',
  OWNER_ADDED: 'Owner added',
  OWNER_REMOVED: 'Owner removed',
  OWNERSHIP_PERCENTAGE_CHANGED: 'Ownership % changed',
  STATUS_CHANGED: 'Status changed',
  CLAIM_NAME_CHANGED: 'Claim name changed',
  AREA_CHANGED: 'Area changed',
  GEOMETRY_CHANGED: 'Boundary changed',
  TENURE_TERMINATED: 'Terminated',
  TENURE_NO_LONGER_OBSERVED: 'Not in latest dataset',
  TENURE_REAPPEARED: 'Back in the dataset',
  SOURCE_DATA_DISCREPANCY: 'Source data gap',
};

export function changeLabel(change) {
  return CHANGE_LABELS[change?.event_type] || 'Changed';
}
