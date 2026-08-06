// CSV import and export for Tenure Monitor portfolios.
//
// Uses papaparse, already a dependency and already how the editor reads
// drill-collar CSVs (src/hooks/useFileParser.js).
//
// THE RULE FOR IMPORT: NOTHING IS SILENTLY DISCARDED.
//
// A user uploading a claim schedule is handing over their record of what they
// own. If four rows do not match and the product adds the other twenty-six
// without saying so, they will believe all thirty are being watched — and the
// four they lose are the ones nobody was reminded about. So every row lands in
// exactly one bucket, the buckets are shown before anything is added, and the
// ambiguous ones are resolved by the user rather than by a heuristic.

import Papa from 'papaparse';
import { daysRemaining, urgencyBand, formatGovernmentDate } from './tenureDates.js';
import { TENURE_VERIFICATION_SHORT, BC_DATA_ATTRIBUTION } from './tenureDisclaimer.js';

/** Where a row can end up. Every parsed row gets exactly one of these. */
export const ROW_STATUS = {
  MATCHED: 'matched',              // exactly one live tenure
  MULTIPLE: 'multiple',            // ambiguous — the user picks
  NOT_FOUND: 'not_found',          // no such tenure in the mirror
  INACTIVE: 'inactive',            // found, but not in good standing
  DUPLICATE: 'duplicate',          // same tenure twice in the file
  ALREADY_MONITORED: 'already',    // already in this portfolio
  INVALID: 'invalid',              // unusable row
};

export const ROW_STATUS_LABELS = {
  [ROW_STATUS.MATCHED]: 'Matched',
  [ROW_STATUS.MULTIPLE]: 'Several possible matches',
  [ROW_STATUS.NOT_FOUND]: 'Not found in the B.C. dataset',
  [ROW_STATUS.INACTIVE]: 'Found, but not in good standing',
  [ROW_STATUS.DUPLICATE]: 'Duplicate row',
  [ROW_STATUS.ALREADY_MONITORED]: 'Already monitored',
  [ROW_STATUS.INVALID]: 'Could not be read',
};

/** Header aliases. Case- and separator-insensitive. */
const COLUMN_ALIASES = {
  tenure_number: ['tenure_number', 'tenure', 'tenure no', 'tenure number', 'claim number',
    'claim_number', 'tag number', 'tag_number', 'title number', 'number', 'id'],
  claim_name: ['claim_name', 'claim name', 'name', 'tenure name', 'tenure_name'],
  owner_name: ['owner_name', 'owner', 'registered owner', 'holder', 'company'],
  project_name: ['project_name', 'project', 'internal project', 'property'],
  internal_notes: ['internal_notes', 'notes', 'note', 'comment', 'comments'],
};

const foldHeader = (h) => String(h || '').trim().toLowerCase().replace(/[_\s-]+/g, ' ');

/**
 * Map a file's headers onto our fields.
 * @returns {{mapping: object, unmapped: string[]}}
 */
export function mapColumns(headers) {
  const mapping = {};
  const used = new Set();
  for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
    const folded = aliases.map(foldHeader);
    const hit = headers.find((h) => !used.has(h) && folded.includes(foldHeader(h)));
    if (hit) { mapping[field] = hit; used.add(hit); }
  }
  return { mapping, unmapped: headers.filter((h) => !used.has(h)) };
}

/**
 * Parse a CSV file into rows.
 *
 * Resolves rather than rejects on a malformed file: the reconciliation report
 * is a better place to explain a problem than an error toast, because it can
 * show the user which line was wrong.
 *
 * @returns {Promise<{rows: object[], mapping: object, unmapped: string[], error: string|null}>}
 */
export function parseTenureCsv(file, { maxRows = 2000 } = {}) {
  return new Promise((resolve) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: 'greedy',
      complete: (result) => {
        const headers = result.meta?.fields || [];
        if (!headers.length) {
          resolve({ rows: [], mapping: {}, unmapped: [], error: 'That file has no header row.' });
          return;
        }
        const { mapping, unmapped } = mapColumns(headers);
        if (!mapping.tenure_number && !mapping.claim_name && !mapping.owner_name) {
          resolve({
            rows: [], mapping, unmapped,
            error: 'No recognisable column. Include at least one of: tenure_number, '
              + 'claim_name, owner_name.',
          });
          return;
        }
        const raw = (result.data || []).slice(0, maxRows);
        resolve({
          rows: raw.map((r, i) => ({
            line: i + 2,           // +2: 1-based, and the header is line 1
            tenureNumber: clean(r[mapping.tenure_number]),
            claimName: clean(r[mapping.claim_name]),
            ownerName: clean(r[mapping.owner_name]),
            projectName: clean(r[mapping.project_name]),
            internalNotes: clean(r[mapping.internal_notes]),
          })),
          mapping,
          unmapped,
          truncated: (result.data || []).length > maxRows,
          error: null,
        });
      },
      error: (err) => resolve({
        rows: [], mapping: {}, unmapped: [], error: `Could not read that file: ${err.message}`,
      }),
    });
  });
}

/**
 * Reconcile parsed rows against tenures found in the mirror.
 *
 * PURE — the caller does the lookups and hands the results in, which is what
 * makes this testable without a database.
 *
 * @param {object[]} rows            from parseTenureCsv
 * @param {Map<string, object[]>} matchesByRow  row.line → candidate tenures
 * @param {Set<string>} alreadyMonitored        tenure ids already in the portfolio
 * @returns {{entries: object[], counts: object, autoAddIds: string[]}}
 */
export function reconcileRows(rows, matchesByRow, alreadyMonitored = new Set()) {
  const entries = [];
  const seenTenureIds = new Set();
  const seenNumbers = new Set();

  for (const row of rows) {
    // A row with nothing to search on is invalid — say so, with its line
    // number, rather than dropping it.
    if (!row.tenureNumber && !row.claimName && !row.ownerName) {
      entries.push({ row, status: ROW_STATUS.INVALID, candidates: [], tenure: null,
        detail: 'No tenure number, claim name, or owner name on this line.' });
      continue;
    }

    if (row.tenureNumber && seenNumbers.has(row.tenureNumber)) {
      entries.push({ row, status: ROW_STATUS.DUPLICATE, candidates: [], tenure: null,
        detail: `Tenure ${row.tenureNumber} appears earlier in the file.` });
      continue;
    }
    if (row.tenureNumber) seenNumbers.add(row.tenureNumber);

    const candidates = matchesByRow.get(row.line) || [];

    if (candidates.length === 0) {
      entries.push({ row, status: ROW_STATUS.NOT_FOUND, candidates: [], tenure: null,
        detail: 'No B.C. tenure in the latest dataset matches this row. Check the number '
          + 'in MTO — it may have been terminated, or the dataset may not have caught up.' });
      continue;
    }

    if (candidates.length > 1) {
      entries.push({ row, status: ROW_STATUS.MULTIPLE, candidates, tenure: null,
        detail: `${candidates.length} tenures match this row. Choose the one you mean.` });
      continue;
    }

    const tenure = candidates[0];

    if (alreadyMonitored.has(tenure.id) || seenTenureIds.has(tenure.id)) {
      entries.push({ row, status: ROW_STATUS.ALREADY_MONITORED, candidates, tenure,
        detail: 'Already in this portfolio.' });
      continue;
    }
    seenTenureIds.add(tenure.id);

    // Inactive titles are matched and importable — a user may well want to
    // watch a claim they are trying to reacquire — but they are called out
    // rather than mixed in with claims in good standing.
    const inactive = tenure.status && !/^good/i.test(String(tenure.status));
    entries.push({
      row,
      status: inactive ? ROW_STATUS.INACTIVE : ROW_STATUS.MATCHED,
      candidates,
      tenure,
      detail: inactive
        ? `The B.C. dataset reports this title as "${tenure.status}". You can still monitor it.`
        : null,
    });
  }

  const counts = {};
  for (const s of Object.values(ROW_STATUS)) counts[s] = 0;
  for (const e of entries) counts[e.status] += 1;

  return {
    entries,
    counts,
    // Only unambiguous, in-good-standing, not-yet-monitored rows are
    // pre-selected. Everything else waits for a decision.
    autoAddIds: entries.filter((e) => e.status === ROW_STATUS.MATCHED).map((e) => e.tenure.id),
  };
}

/** One-line summary of a reconciliation, for the header of the report. */
export function reconciliationSummary(counts) {
  const parts = [];
  const push = (n, label) => { if (n) parts.push(`${n} ${label}`); };
  push(counts[ROW_STATUS.MATCHED], 'matched');
  push(counts[ROW_STATUS.INACTIVE], 'matched but not in good standing');
  push(counts[ROW_STATUS.MULTIPLE], 'ambiguous');
  push(counts[ROW_STATUS.ALREADY_MONITORED], 'already monitored');
  push(counts[ROW_STATUS.NOT_FOUND], 'not found');
  push(counts[ROW_STATUS.DUPLICATE], 'duplicate');
  push(counts[ROW_STATUS.INVALID], 'unreadable');
  return parts.length ? parts.join(', ') : 'nothing to import';
}

// ── Export ─────────────────────────────────────────────────────────────────

/**
 * Claim schedule as CSV.
 *
 * Days remaining and the urgency band are computed at export time in
 * America/Vancouver, so a schedule opened in Excel in another timezone still
 * shows B.C.'s numbers. The last-sync timestamp and the MTO notice are in the
 * file itself — a spreadsheet gets forwarded, printed and read months later,
 * long after whatever screen it came from is gone.
 */
export function buildScheduleCsv(rows, { portfolioName, lastSyncedAt, now = new Date() } = {}) {
  const records = rows.map((r) => {
    const t = r.tenure || r;
    const days = daysRemaining(t.good_to_date, now);
    return {
      'Tenure number': t.tenure_number || '',
      'Claim name': t.tenure_name || '',
      'Registered owner': (r.owners || []).map((o) => o.owner_name).join('; '),
      Project: r.internalProjectName || '',
      Type: [t.tenure_type, t.tenure_subtype].filter(Boolean).join(' — '),
      Status: t.status || 'Not published in the B.C. source',
      'Area (ha)': t.area_hectares ?? '',
      'Issue date': formatGovernmentDate(t.issue_date),
      'Good-to-date': formatGovernmentDate(t.good_to_date),
      'Days remaining': days == null ? 'Date unavailable' : days,
      Urgency: urgencyBand(days, t.status).label,
      'Maintenance decision': decisionLabel(r.maintenanceDecision),
      'Decision due': r.decisionDueDate || '',
      'Internal notes': r.internalNotes || '',
      'Reference note': r.maintenanceReference || '',
      'Monitoring enabled': r.monitoringEnabled === false ? 'No' : 'Yes',
    };
  });

  const body = Papa.unparse(records, { quotes: true });
  const stamp = lastSyncedAt ? new Date(lastSyncedAt).toISOString() : 'unknown';
  const header = [
    `# ${portfolioName || 'B.C. tenure portfolio'} — Exploration Maps Tenure Monitor`,
    `# Exported ${now.toISOString()}`,
    `# B.C. government data last synchronized: ${stamp}`,
    `# ${TENURE_VERIFICATION_SHORT}`,
    `# ${BC_DATA_ATTRIBUTION}`,
    '',
  ].join('\n');

  return header + body;
}

export const MAINTENANCE_DECISIONS = [
  { value: 'UNDECIDED', label: 'Undecided' },
  { value: 'REVIEW', label: 'Review required' },
  { value: 'INTEND_TO_MAINTAIN', label: 'Intend to maintain' },
  { value: 'INTEND_TO_ALLOW_LAPSE', label: 'Intend to allow lapse' },
  { value: 'MAINTENANCE_COMPLETED', label: 'Maintenance completed' },
  { value: 'NEEDS_VERIFICATION', label: 'Needs official verification' },
];

export function decisionLabel(value) {
  return MAINTENANCE_DECISIONS.find((d) => d.value === value)?.label || 'Undecided';
}

function clean(v) {
  if (v == null) return null;
  // Strip control characters from imported text before it is stored or
  // rendered anywhere. Matching control characters IS the point here, which is
  // the one case no-control-regex exists to permit.
  // eslint-disable-next-line no-control-regex
  const s = String(v).replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  return s === '' ? null : s.slice(0, 500);
}
