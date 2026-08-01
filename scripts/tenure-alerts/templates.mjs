// Alert emails.
//
// PURE — every template takes data and returns { subject, html, text }.
// Testable, and previewable without sending anything.
//
// WHAT EVERY EMAIL MUST CARRY, and why:
//
//   the tenure number      so it can be looked up in MTO without opening the app
//   the claim name         so it is recognisable at a glance
//   the registered owner   so a consultant watching several companies can tell
//                          whose claim this is
//   the good-to-date       the fact the reminder is about
//   days remaining         so nobody has to do date arithmetic in their head
//   the last sync time     so the recipient knows how current this is
//   three links            review, open the map, verify officially
//   the disclaimer         so a reminder is never mistaken for a legal notice
//
// Plain text is generated alongside the HTML, not as an afterthought: mining
// people read mail on phones, in the field, on clients that block HTML.

import {
  daysRemaining, formatGovernmentDate, formatSyncTimestamp, urgencyBand,
} from '../../src/utils/tenureDates.js';
import {
  TENURE_ALERT_DISCLAIMER, TENURE_NOT_OBSERVED_NOTICE, MTO_URL, BC_DATA_ATTRIBUTION,
} from '../../src/utils/tenureDisclaimer.js';

const SITE = process.env.SITE_URL || 'https://www.explorationmaps.com';

export function monitorUrl() { return `${SITE}/tenure-monitor`; }
export function editorUrl(tenureNumber) {
  return `${SITE}/?tenure=${encodeURIComponent(tenureNumber)}`;
}

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const WRAP = (inner) => `
<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#1e293b;line-height:1.6">
${inner}
</div>`;

const BUTTON = (href, label, primary = false) => `
<a href="${esc(href)}" style="display:inline-block;margin:0 8px 8px 0;padding:10px 16px;border-radius:8px;
text-decoration:none;font-weight:600;font-size:14px;${primary
    ? 'background:#2563eb;color:#ffffff;'
    : 'background:#f1f5f9;color:#1e293b;border:1px solid #cbd5e1;'}">${esc(label)}</a>`;

const FOOTER = (lastSyncedAt) => `
<hr style="border:none;border-top:1px solid #e2e8f0;margin:22px 0 14px"/>
<p style="font-size:12px;color:#64748b;margin:0 0 8px">
  B.C. government data last synchronized:
  <strong>${esc(lastSyncedAt ? formatSyncTimestamp(lastSyncedAt) : 'not yet synchronized')}</strong>.
</p>
<p style="font-size:12px;color:#64748b;margin:0 0 8px">${esc(TENURE_ALERT_DISCLAIMER)}</p>
<p style="font-size:11px;color:#94a3b8;margin:0">
  ${esc(BC_DATA_ATTRIBUTION)}<br/>
  You are receiving this because this address is a reminder recipient for a Tenure Monitor
  portfolio. Manage recipients at <a href="${esc(monitorUrl())}" style="color:#64748b">${esc(monitorUrl())}</a>.
</p>`;

/**
 * The expiry reminder.
 *
 * Subject follows the spec's shape — "Crystal Lake North reaches its
 * good-to-date in 30 days" — because it has to be legible and actionable in a
 * phone notification, before the mail is even opened.
 */
export function expiryEmail({ tenure, owners, portfolioName, membership, lastSyncedAt, now = new Date() }) {
  const days = daysRemaining(tenure.good_to_date, now);
  const band = urgencyBand(days, tenure.status);
  const name = tenure.tenure_name || `Tenure ${tenure.tenure_number}`;
  const ownerLine = owners?.length
    ? owners.map((o) => o.owner_name).join('; ')
    : 'Not published in the B.C. source';

  const when = days === 0 ? 'today'
    : days === 1 ? 'tomorrow'
      : `in ${days} days`;
  const subject = `${name} reaches its good-to-date ${when}`;

  const decision = membership?.maintenance_decision && membership.maintenance_decision !== 'UNDECIDED'
    ? DECISION_LABELS[membership.maintenance_decision] || membership.maintenance_decision
    : 'No decision recorded yet';

  const html = WRAP(`
  <p style="font-size:13px;color:#64748b;margin:0 0 4px">${esc(portfolioName || 'Tenure Monitor')}</p>
  <h1 style="font-size:20px;color:#0f172a;margin:0 0 4px">${esc(name)}</h1>
  <p style="margin:0 0 18px;color:#475569">Tenure ${esc(tenure.tenure_number)}</p>

  <div style="background:#f8fafc;border:1px solid #e2e8f0;border-left:4px solid ${band.color};
              border-radius:8px;padding:14px 16px;margin:0 0 18px">
    <div style="font-size:18px;font-weight:700;color:${band.color}">
      ${esc(band.icon)} ${days === 0 ? 'Good-to-date is today' : days === 1 ? '1 day remaining' : `${days} days remaining`}
    </div>
    <div style="font-size:14px;color:#334155;margin-top:4px">
      Good-to-date: <strong>${esc(formatGovernmentDate(tenure.good_to_date))}</strong>
    </div>
  </div>

  <table style="font-size:14px;border-collapse:collapse;margin:0 0 18px">
    <tr><td style="padding:3px 14px 3px 0;color:#64748b">Registered owner</td><td>${esc(ownerLine)}</td></tr>
    ${tenure.area_hectares != null ? `<tr><td style="padding:3px 14px 3px 0;color:#64748b">Area</td><td>${esc(Number(tenure.area_hectares).toLocaleString())} ha</td></tr>` : ''}
    ${tenure.status ? `<tr><td style="padding:3px 14px 3px 0;color:#64748b">Status</td><td>${esc(tenure.status)}</td></tr>` : ''}
    ${membership?.internal_project_name ? `<tr><td style="padding:3px 14px 3px 0;color:#64748b">Project</td><td>${esc(membership.internal_project_name)}</td></tr>` : ''}
    <tr><td style="padding:3px 14px 3px 0;color:#64748b">Your decision</td><td>${esc(decision)}</td></tr>
  </table>

  <p style="font-size:13px;color:#475569;margin:0 0 14px">
    The good-to-date is the date by which this claim must be maintained to stay in good
    standing. Exploration Maps does not file assessment work, pay cash in lieu, or make any
    change to your title — this is a reminder so you can act in time.
  </p>

  ${BUTTON(monitorUrl(), 'Review claim', true)}
  ${BUTTON(editorUrl(tenure.tenure_number), 'Open map')}
  ${BUTTON(MTO_URL, 'Verify official record')}

  ${FOOTER(lastSyncedAt)}`);

  const text = [
    `${portfolioName || 'Tenure Monitor'}`,
    '',
    `${name} — tenure ${tenure.tenure_number}`,
    `${days === 0 ? 'Good-to-date is TODAY' : `${days} days remaining`}`,
    `Good-to-date: ${formatGovernmentDate(tenure.good_to_date)}`,
    `Registered owner: ${ownerLine}`,
    `Your decision: ${decision}`,
    '',
    'The good-to-date is the date by which this claim must be maintained to stay in',
    'good standing. Exploration Maps does not file work, pay cash in lieu, or change',
    'your title — this is a reminder so you can act in time.',
    '',
    `Review claim:  ${monitorUrl()}`,
    `Open map:      ${editorUrl(tenure.tenure_number)}`,
    `Verify in MTO: ${MTO_URL}`,
    '',
    `B.C. data last synchronized: ${lastSyncedAt ? formatSyncTimestamp(lastSyncedAt) : 'not yet synchronized'}`,
    TENURE_ALERT_DISCLAIMER,
  ].join('\n');

  return { subject, html, text };
}

const DECISION_LABELS = {
  UNDECIDED: 'Undecided',
  REVIEW: 'Review required',
  INTEND_TO_MAINTAIN: 'Intend to maintain',
  INTEND_TO_ALLOW_LAPSE: 'Intend to allow lapse',
  MAINTENANCE_COMPLETED: 'Maintenance completed',
  NEEDS_VERIFICATION: 'Needs official verification',
};

const CHANGE_HEADLINES = {
  GOOD_TO_DATE_CHANGED: 'good-to-date changed',
  OWNER_ADDED: 'a registered owner was added',
  OWNER_REMOVED: 'a registered owner was removed',
  OWNERSHIP_PERCENTAGE_CHANGED: 'ownership percentages changed',
  STATUS_CHANGED: 'status changed',
  CLAIM_NAME_CHANGED: 'claim name changed',
  AREA_CHANGED: 'area changed',
  GEOMETRY_CHANGED: 'boundary changed',
  TENURE_TERMINATED: 'was reported as terminated',
  TENURE_REAPPEARED: 'is back in the government dataset',
  SOURCE_DATA_DISCREPANCY: 'has a gap in the government data',
};

/** A detected change to a monitored title. */
export function changeEmail({ tenure, change, portfolioName, lastSyncedAt }) {
  const name = tenure.tenure_name || `Tenure ${tenure.tenure_number}`;
  const headline = CHANGE_HEADLINES[change.event_type] || 'changed';
  const subject = `${name}: ${headline}`;

  const from = change.previous_value || 'not recorded';
  const to = change.current_value || 'not recorded';

  const html = WRAP(`
  <p style="font-size:13px;color:#64748b;margin:0 0 4px">${esc(portfolioName || 'Tenure Monitor')}</p>
  <h1 style="font-size:20px;color:#0f172a;margin:0 0 4px">${esc(name)}</h1>
  <p style="margin:0 0 18px;color:#475569">Tenure ${esc(tenure.tenure_number)}</p>

  <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:14px 16px;margin:0 0 18px">
    <div style="font-size:15px;font-weight:700;color:#92400e">
      The government record for this claim ${esc(headline)}.
    </div>
    <div style="font-size:14px;color:#334155;margin-top:6px">
      ${esc(from)} &rarr; <strong>${esc(to)}</strong>
    </div>
  </div>

  <p style="font-size:13px;color:#475569;margin:0 0 14px">
    Exploration Maps detected this by comparing the latest B.C. tenure dataset with what it
    held before. Confirm it in the official registry before acting — the government record
    is the one that governs.
  </p>

  ${BUTTON(monitorUrl(), 'Review claim', true)}
  ${BUTTON(editorUrl(tenure.tenure_number), 'Open map')}
  ${BUTTON(MTO_URL, 'Verify official record')}

  ${FOOTER(lastSyncedAt)}`);

  const text = [
    `${name} — tenure ${tenure.tenure_number}`,
    `The government record for this claim ${headline}.`,
    `${from} -> ${to}`,
    '',
    'Confirm this in MTO before acting — the government record governs.',
    '',
    `Review claim:  ${monitorUrl()}`,
    `Verify in MTO: ${MTO_URL}`,
    '',
    TENURE_ALERT_DISCLAIMER,
  ].join('\n');

  return { subject, html, text };
}

/**
 * A monitored title that has stopped appearing in the dataset.
 *
 * The most carefully worded email in the product. A missing record is NOT
 * evidence that a claim lapsed — it can be a failed import, an endpoint
 * change, a delayed publication, or a data-quality problem at the province.
 * Telling somebody their claim is gone when it is not could send them to
 * restake ground they already hold, so this says exactly what we know and
 * nothing more.
 */
export function notObservedEmail({ tenure, portfolioName, lastSyncedAt }) {
  const name = tenure.tenure_name || `Tenure ${tenure.tenure_number}`;
  const subject = `${name}: not found in the latest B.C. dataset — please verify`;

  const html = WRAP(`
  <p style="font-size:13px;color:#64748b;margin:0 0 4px">${esc(portfolioName || 'Tenure Monitor')}</p>
  <h1 style="font-size:20px;color:#0f172a;margin:0 0 4px">${esc(name)}</h1>
  <p style="margin:0 0 18px;color:#475569">Tenure ${esc(tenure.tenure_number)}</p>

  <div style="background:#f1f5f9;border:1px solid #cbd5e1;border-radius:8px;padding:14px 16px;margin:0 0 18px">
    <div style="font-size:15px;font-weight:700;color:#334155">${esc(TENURE_NOT_OBSERVED_NOTICE)}</div>
  </div>

  <p style="font-size:13px;color:#475569;margin:0 0 14px">
    This is <strong>not</strong> confirmation that the title has lapsed, been terminated, or
    become available. A record can drop out of the published dataset for several reasons,
    including a delayed or partial publication at the province. Exploration Maps waited until
    the claim was absent from two consecutive successful imports before telling you.
  </p>
  <p style="font-size:13px;color:#475569;margin:0 0 18px">
    Check the tenure in Mineral Titles Online to find out what actually happened.
  </p>

  ${BUTTON(MTO_URL, 'Verify in MTO', true)}
  ${BUTTON(monitorUrl(), 'Review claim')}

  ${FOOTER(lastSyncedAt)}`);

  const text = [
    `${name} — tenure ${tenure.tenure_number}`,
    TENURE_NOT_OBSERVED_NOTICE,
    '',
    'This is NOT confirmation that the title has lapsed, been terminated, or become',
    'available. A record can drop out of the published dataset for several reasons.',
    'Check the tenure in Mineral Titles Online to find out what actually happened.',
    '',
    `Verify in MTO: ${MTO_URL}`,
    `Review claim:  ${monitorUrl()}`,
    '',
    TENURE_ALERT_DISCLAIMER,
  ].join('\n');

  return { subject, html, text };
}

/** Route an alert row to its template. */
export function renderAlert(alert, context) {
  if (alert.alert_type === 'EXPIRY') return expiryEmail(context);
  if (alert.alert_type === 'NOT_OBSERVED') return notObservedEmail(context);
  return changeEmail(context);
}
