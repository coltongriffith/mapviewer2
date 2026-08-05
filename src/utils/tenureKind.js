// What KIND of thing a tenure record is, and whether that changes what we may
// say about it.
//
// WHY THIS EXISTS
//
// The B.C. layer publishes applications alongside granted titles in the same
// feature class. As of the 2026-08 full sync the mirror holds 2,549 of them —
// 1,725 mineral, 783 placer, 41 coal — against 39,767 granted claims, leases
// and licences. They arrive with the same columns, including a GOOD_TO_DATE,
// and until this module existed nothing downstream told them apart: a pending
// application appeared in a portfolio, in the table, on the map, and in a
// reminder email looking exactly like ground somebody holds.
//
// That is the kind of error this feature cannot afford. A reminder saying
// "Ashnola5 reaches its good-to-date in 30 days" reads as a maintenance
// deadline on a claim you own. On an application it is not that: the date is
// the province's, attached to a submission that has not been granted, and
// treating it as a maintenance deadline invites somebody to spend money
// defending ground they do not yet hold.
//
// WHAT WE READ, AND WHAT WE REFUSE TO INFER
//
// The discriminator is TENURE_SUB_TYPE_DESCRIPTION, stored as `tenure_subtype`.
// It is the province's own value and it is unambiguous: APPLICATION versus
// CLAIM / LEASE / LICENSE.
//
// TITLE_TYPE_DESCRIPTION is NOT a discriminator and must never be used as one —
// "Mineral Cell Title Submission" appears on 25,401 granted CLAIMs and on
// 1,725 APPLICATIONs alike. The word "Submission" in a granted claim's title
// type is a description of how it was staked, not of its current standing.
//
// We report the subtype and stop. The province publishes no application
// status, no stage, no decision date and no consultation state on this layer,
// so this module does not offer any — no "under review", no "expected
// decision", no progress bar. Inferring a stage from an issue date would be
// inventing a government fact, and the one thing Tenure Monitor may never do
// is put words in the registry's mouth.

import { FIELD_NOT_PUBLISHED } from './tenureDisclaimer';

export const TENURE_KIND = {
  APPLICATION: 'application',
  GRANTED: 'granted',
  UNKNOWN: 'unknown',
};

/**
 * Classify a tenure record.
 *
 * Unknown is its own answer rather than being folded into "granted". A subtype
 * we do not recognise might be a new application category the province added,
 * and defaulting an unrecognised record to "granted" would reintroduce exactly
 * the confusion this module exists to remove.
 *
 * @param {object|null} tenure a row from `tenures`
 * @returns {'application'|'granted'|'unknown'}
 */
export function tenureKind(tenure) {
  const subtype = String(tenure?.tenure_subtype || '').trim().toUpperCase();
  if (!subtype) return TENURE_KIND.UNKNOWN;
  if (subtype === 'APPLICATION') return TENURE_KIND.APPLICATION;
  if (subtype === 'CLAIM' || subtype === 'LEASE' || subtype === 'LICENSE' || subtype === 'LICENCE') {
    return TENURE_KIND.GRANTED;
  }
  return TENURE_KIND.UNKNOWN;
}

/** True for records the province publishes as an application, not a title. */
export function isApplication(tenure) {
  return tenureKind(tenure) === TENURE_KIND.APPLICATION;
}

/**
 * A short badge for the record kind, or null when there is nothing to flag.
 *
 * Granted titles get no badge. Labelling the normal case adds a chip to every
 * row and teaches people to stop reading chips, which would defeat the one
 * that matters.
 */
export function kindBadge(tenure) {
  const kind = tenureKind(tenure);
  if (kind === TENURE_KIND.APPLICATION) {
    return { id: 'application', label: 'Application', title: APPLICATION_NOTICE };
  }
  if (kind === TENURE_KIND.UNKNOWN) {
    return {
      id: 'unknown',
      label: 'Unrecognised type',
      title: 'The B.C. source published a tenure type Exploration Maps does not '
        + 'recognise. Check this record in MTO.',
    };
  }
  return null;
}

/**
 * The whole of what we are willing to say about an application.
 *
 * Deliberately short, and deliberately ends by pointing at MTO. Everything a
 * user might want beyond this — where the application sits, whether it will be
 * granted, when — is not in the data we hold.
 */
export const APPLICATION_NOTICE =
  'The province publishes this record as an application, not a granted title. '
  + 'Its status and outcome are not published in this dataset — check it in MTO.';

/**
 * How to describe an application's good-to-date.
 *
 * A granted claim's good-to-date is a maintenance deadline. On an application
 * the same column is a date the province has attached to a submission, and we
 * do not know what it obliges. So the deadline language is withheld rather
 * than reworded into something that sounds authoritative.
 */
export const APPLICATION_DATE_NOTICE =
  'Dates shown for an application come from the same government columns as a '
  + 'granted title, but an application is not held ground and this date is not '
  + 'a confirmed maintenance deadline. Confirm in MTO before acting on it.';

/**
 * Human label for the record kind, for a detail row or a CSV column.
 * @returns {string}
 */
export function kindLabel(tenure) {
  const kind = tenureKind(tenure);
  if (kind === TENURE_KIND.APPLICATION) return 'Application';
  if (kind === TENURE_KIND.GRANTED) {
    // Say which instrument, from the province's own words, rather than
    // flattening a lease and a claim into one label.
    const subtype = String(tenure?.tenure_subtype || '').trim().toLowerCase();
    if (subtype === 'lease') return 'Granted — lease';
    if (subtype === 'license' || subtype === 'licence') return 'Granted — licence';
    return 'Granted — claim';
  }
  return tenure?.tenure_subtype || FIELD_NOT_PUBLISHED;
}

// Placeholder good-to-dates are a date concern rather than a kind concern, so
// they live in tenureDates.js with the rest of the date knowledge — but they
// are worth knowing about here, because all three rows carrying one in the
// current mirror are applications.
