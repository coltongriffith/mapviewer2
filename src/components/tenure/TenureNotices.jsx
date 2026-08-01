import React from 'react';
import {
  TENURE_VERIFICATION_NOTICE, TENURE_VERIFICATION_SHORT, BC_DATA_ATTRIBUTION,
  MTO_URL, mtoVerifyUrl, mtoVerifyHint, FIELD_NOT_PUBLISHED,
} from '../../utils/tenureDisclaimer';
import { formatSyncTimestamp } from '../../utils/tenureDates';

// The honesty furniture: how fresh the data is, where the real registry is,
// and what a value means when the province did not publish it.
//
// These are separate small components rather than copy pasted into each screen
// so the wording cannot drift. A disclaimer that is phrased three different
// ways in three places is one nobody reads.

/**
 * The standing verification notice.
 *
 * Deliberately styled as information, not as an error. It has to be visible on
 * every material view without making a working product feel broken — a red
 * warning banner on every screen gets tuned out within a day, and then it is
 * not protecting anyone.
 */
export function VerificationNotice({ compact = false, className = '' }) {
  return (
    <p className={`tm-notice ${compact ? 'tm-notice--compact' : ''} ${className}`.trim()}>
      <span aria-hidden="true" className="tm-notice-icon">ⓘ</span>
      <span>
        {compact ? TENURE_VERIFICATION_SHORT : TENURE_VERIFICATION_NOTICE}
        {' '}
        <a href={MTO_URL} target="_blank" rel="noopener noreferrer">
          Open Mineral Titles Online
        </a>
      </span>
    </p>
  );
}

/**
 * When the B.C. data was last successfully synchronized.
 *
 * Shows the real timestamp of the last SUCCEEDED import, never "just now" and
 * never a relative phrase that could flatter stale data. If the last sync is
 * old, the user should be able to see that it is old.
 */
export function LastSyncLine({ sync, className = '' }) {
  if (!sync?.completed_at) {
    return (
      <p className={`tm-sync tm-sync--none ${className}`.trim()}>
        <span aria-hidden="true">⚠</span> B.C. tenure data has not been synchronized yet.
        Figures shown here may be incomplete — verify in MTO.
      </p>
    );
  }

  const ageHours = (Date.now() - new Date(sync.completed_at).getTime()) / 3_600_000;
  // Two days without a successful sync is worth flagging: the nightly job runs
  // every day, so this means something has been failing.
  const stale = ageHours > 48;

  return (
    <p className={`tm-sync ${stale ? 'tm-sync--stale' : ''} ${className}`.trim()}>
      {stale && <span aria-hidden="true">⚠ </span>}
      B.C. government data last synchronized{' '}
      <strong>{formatSyncTimestamp(sync.completed_at)}</strong>
      {stale && ' — that is longer ago than usual. Verify anything time-sensitive in MTO.'}
    </p>
  );
}

/** An administrator-posted government-data incident banner. */
export function SystemNoticeBanner({ notice }) {
  if (!notice) return null;
  return (
    <div className={`tm-system-notice tm-system-notice--${notice.severity || 'info'}`} role="status">
      <span aria-hidden="true">⚠</span>
      <span>{notice.message}</span>
    </div>
  );
}

/** "Verify in MTO" — the same affordance, worded the same way, everywhere. */
export function VerifyInMtoLink({ tenureNumber, className = '', children }) {
  return (
    <a
      className={`tm-verify-link ${className}`.trim()}
      href={mtoVerifyUrl(tenureNumber)}
      target="_blank"
      rel="noopener noreferrer"
      title={mtoVerifyHint(tenureNumber)}
    >
      {children || 'Verify in MTO'}
      <span className="tm-sr-only">{` — ${mtoVerifyHint(tenureNumber)} Opens in a new tab.`}</span>
    </a>
  );
}

/**
 * Render a value the province may not have published.
 *
 * The difference between a blank cell and "Not published in the B.C. source"
 * is the difference between a user assuming we lost the data and a user
 * knowing the registry never gave it to us.
 */
export function SourceValue({ value, suffix = '' }) {
  if (value == null || value === '') {
    return <span className="tm-unpublished">{FIELD_NOT_PUBLISHED}</span>;
  }
  return <>{value}{suffix}</>;
}

/** The OGL-BC attribution, required by the licence. */
export function DataAttribution() {
  return <p className="tm-attribution">{BC_DATA_ATTRIBUTION}</p>;
}
