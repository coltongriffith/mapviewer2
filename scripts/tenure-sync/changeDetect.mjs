// Detect material changes between the tenure we stored and the one the
// province just sent.
//
// PURE. No network, no database.
//
// TWO RULES SHAPE EVERYTHING HERE:
//
// 1. A change event is a claim about somebody's mineral rights, and it may end
//    up in their inbox. Noise is not harmless — a user who receives three
//    "area changed" emails caused by floating-point drift stops reading the
//    one that says their good-to-date moved. So every comparison has an
//    explicit tolerance, and anything below it is not a change.
//
// 2. Absence of evidence is not evidence. A field that arrives null when we
//    previously had a value is treated as SOURCE_DATA_DISCREPANCY — "the
//    province stopped telling us this" — never as "the value became empty".
//    Only a real, populated, different value is reported as a change.

import { geometryHash } from './normalize.mjs';

export const EVENT = {
  GOOD_TO_DATE_CHANGED: 'GOOD_TO_DATE_CHANGED',
  OWNER_ADDED: 'OWNER_ADDED',
  OWNER_REMOVED: 'OWNER_REMOVED',
  OWNERSHIP_PERCENTAGE_CHANGED: 'OWNERSHIP_PERCENTAGE_CHANGED',
  STATUS_CHANGED: 'STATUS_CHANGED',
  CLAIM_NAME_CHANGED: 'CLAIM_NAME_CHANGED',
  AREA_CHANGED: 'AREA_CHANGED',
  GEOMETRY_CHANGED: 'GEOMETRY_CHANGED',
  TENURE_TERMINATED: 'TENURE_TERMINATED',
  TENURE_NO_LONGER_OBSERVED: 'TENURE_NO_LONGER_OBSERVED',
  TENURE_REAPPEARED: 'TENURE_REAPPEARED',
  SOURCE_DATA_DISCREPANCY: 'SOURCE_DATA_DISCREPANCY',
};

export const SEVERITY = { INFO: 'info', NOTABLE: 'notable', CRITICAL: 'critical' };

/**
 * Area changes below this are treated as source rounding, not as a real
 * boundary change. Provincial area figures are recomputed on the province's
 * side and wobble in the last decimal without anything happening on the ground.
 */
export const AREA_TOLERANCE_RATIO = 0.005; // 0.5%

/** Statuses that mean the title is no longer held. Matched case-insensitively. */
const TERMINAL_STATUS = /(cancel|terminat|forfeit|expire|lapsed|surrender|closed)/i;

/**
 * Compare a stored tenure against a freshly normalized one.
 *
 * @param {object|null} previous  the row we already had (null for a new tenure)
 * @param {object} current        a normalized tenure from normalize.mjs
 * @param {object} [opts]
 * @param {object[]} [opts.previousOwners] stored owner rows
 * @param {object[]} [opts.currentOwners]  freshly normalized owner rows
 * @returns {Array<{event_type, previous_value, current_value, severity, metadata?}>}
 */
export function detectChanges(previous, current, opts = {}) {
  // A tenure we have never seen is not a "change" — it is simply new. Emitting
  // a dozen events for every record on the first ever import would bury the
  // real signal on day two.
  if (!previous) return [];

  const events = [];
  const prevOwners = opts.previousOwners || [];
  const currOwners = opts.currentOwners || [];

  // ── The deadline. This is the one that matters most: it reschedules alerts.
  if (changed(previous.good_to_date, current.good_to_date)) {
    if (current.good_to_date == null) {
      events.push(discrepancy('good_to_date', previous.good_to_date, null));
    } else {
      // Earlier is worse: less time than the user was told they had.
      const movedEarlier = previous.good_to_date != null
        && current.good_to_date < previous.good_to_date;
      events.push({
        event_type: EVENT.GOOD_TO_DATE_CHANGED,
        previous_value: previous.good_to_date,
        current_value: current.good_to_date,
        severity: movedEarlier ? SEVERITY.CRITICAL : SEVERITY.NOTABLE,
        metadata: { moved_earlier: movedEarlier },
      });
    }
  }

  // ── Status, including the terminal transition.
  if (changed(previous.status, current.status)) {
    if (current.status == null) {
      events.push(discrepancy('status', previous.status, null));
    } else {
      const nowTerminal = TERMINAL_STATUS.test(current.status);
      const wasTerminal = previous.status != null && TERMINAL_STATUS.test(previous.status);
      events.push({
        event_type: EVENT.STATUS_CHANGED,
        previous_value: previous.status,
        current_value: current.status,
        severity: nowTerminal ? SEVERITY.CRITICAL : SEVERITY.NOTABLE,
      });
      if (nowTerminal && !wasTerminal) {
        events.push({
          event_type: EVENT.TENURE_TERMINATED,
          previous_value: previous.status,
          current_value: current.status,
          severity: SEVERITY.CRITICAL,
        });
      }
    }
  }

  // A termination date appearing is itself the terminal signal, even when the
  // status string has not caught up.
  if (previous.termination_date == null && current.termination_date != null) {
    events.push({
      event_type: EVENT.TENURE_TERMINATED,
      previous_value: null,
      current_value: current.termination_date,
      severity: SEVERITY.CRITICAL,
      metadata: { detected_via: 'termination_date' },
    });
  }

  // ── Claim name.
  if (changed(previous.tenure_name, current.tenure_name)) {
    if (current.tenure_name == null) {
      events.push(discrepancy('tenure_name', previous.tenure_name, null));
    } else {
      events.push({
        event_type: EVENT.CLAIM_NAME_CHANGED,
        previous_value: previous.tenure_name,
        current_value: current.tenure_name,
        severity: SEVERITY.INFO,
      });
    }
  }

  // ── Area, with a tolerance so provincial rounding is not reported.
  const prevArea = numOrNull(previous.area_hectares);
  const currArea = numOrNull(current.area_hectares);
  if (prevArea != null && currArea != null && prevArea > 0) {
    const delta = Math.abs(currArea - prevArea) / prevArea;
    if (delta > AREA_TOLERANCE_RATIO) {
      events.push({
        event_type: EVENT.AREA_CHANGED,
        previous_value: String(prevArea),
        current_value: String(currArea),
        severity: SEVERITY.NOTABLE,
        metadata: { change_ratio: Number(delta.toFixed(4)) },
      });
    }
  } else if (prevArea != null && currArea == null) {
    events.push(discrepancy('area_hectares', String(prevArea), null));
  }

  // ── Geometry, by fingerprint. Compared against the stored hash when the
  // caller has one, so we do not have to re-serialize the old polygon.
  const prevHash = previous.geometry_hash || geometryHash(previous.geometry);
  const currHash = geometryHash(current.geometry);
  if (prevHash && currHash && prevHash !== currHash) {
    events.push({
      event_type: EVENT.GEOMETRY_CHANGED,
      previous_value: prevHash,
      current_value: currHash,
      severity: SEVERITY.NOTABLE,
      // A boundary change is only meaningful to a user alongside the area
      // figure, so carry both and let the UI phrase it.
      metadata: { previous_area: prevArea, current_area: currArea },
    });
  }

  // ── Ownership.
  events.push(...detectOwnerChanges(prevOwners, currOwners));

  return events;
}

/**
 * Owner set differences, keyed on the normalized name.
 *
 * An owner "change" is genuinely two events — a removal and an addition — and
 * they are reported as such rather than as one synthesized "transferred"
 * event, because the province does not tell us that a transfer happened; it
 * tells us who is on the title today.
 */
export function detectOwnerChanges(previousOwners = [], currentOwners = []) {
  const events = [];
  const prevByKey = new Map(previousOwners.map((o) => [o.normalized_owner_name, o]));
  const currByKey = new Map(currentOwners.map((o) => [o.normalized_owner_name, o]));

  // An empty current set almost always means the source stopped publishing the
  // owner field, not that the claim became ownerless. Report the discrepancy
  // and stop — emitting OWNER_REMOVED for every owner here would tell every
  // affected customer their claims changed hands.
  if (previousOwners.length > 0 && currentOwners.length === 0) {
    return [discrepancy('owner_name', previousOwners.map((o) => o.owner_name).join('; '), null)];
  }

  for (const [key, owner] of currByKey) {
    if (!prevByKey.has(key)) {
      events.push({
        event_type: EVENT.OWNER_ADDED,
        previous_value: null,
        current_value: owner.owner_name,
        severity: SEVERITY.CRITICAL,
      });
    }
  }
  for (const [key, owner] of prevByKey) {
    if (!currByKey.has(key)) {
      events.push({
        event_type: EVENT.OWNER_REMOVED,
        previous_value: owner.owner_name,
        current_value: null,
        severity: SEVERITY.CRITICAL,
      });
    }
  }

  for (const [key, curr] of currByKey) {
    const prev = prevByKey.get(key);
    if (!prev) continue;
    const a = numOrNull(prev.ownership_percentage);
    const b = numOrNull(curr.ownership_percentage);
    if (a != null && b != null && Math.abs(a - b) > 0.01) {
      events.push({
        event_type: EVENT.OWNERSHIP_PERCENTAGE_CHANGED,
        previous_value: `${curr.owner_name}: ${a}`,
        current_value: `${curr.owner_name}: ${b}`,
        severity: SEVERITY.NOTABLE,
      });
    }
  }

  return events;
}

/**
 * Should a snapshot be written for this set of events?
 *
 * Snapshots record history, not cron cadence — writing one per tenure per
 * nightly run would put ~18M rows a year in the table and make the history
 * view useless. Any material event is worth a snapshot; nothing else is.
 */
export function shouldSnapshot(events) {
  return Array.isArray(events) && events.length > 0;
}

/**
 * The event for a tenure that has been absent from N consecutive CLEAN runs.
 *
 * Called ONLY by the reconciler, ONLY after a run that passed every guardrail,
 * and ONLY at the threshold — a title missing from one run is far more likely
 * to be a paging hiccup than a lapsed claim. The wording is fixed and
 * deliberately non-committal: we say it was not in the dataset, not that it
 * expired, because we do not know that and the user must go to MTO to find out.
 */
export function notObservedEvent(consecutiveMisses) {
  return {
    event_type: EVENT.TENURE_NO_LONGER_OBSERVED,
    previous_value: null,
    current_value: `absent from ${consecutiveMisses} consecutive successful imports`,
    severity: SEVERITY.CRITICAL,
    metadata: { consecutive_misses: consecutiveMisses },
  };
}

/** A previously-missing tenure showing up again — usually proof the absence was ours. */
export function reappearedEvent(previousMisses) {
  return {
    event_type: EVENT.TENURE_REAPPEARED,
    previous_value: `absent from ${previousMisses} consecutive successful imports`,
    current_value: 'present in the latest successful import',
    severity: SEVERITY.NOTABLE,
    metadata: { previous_misses: previousMisses },
  };
}

// ── helpers ────────────────────────────────────────────────────────────────

function changed(a, b) {
  const x = a == null ? null : String(a);
  const y = b == null ? null : String(b);
  return x !== y;
}

function numOrNull(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function discrepancy(field, previousValue, currentValue) {
  return {
    event_type: EVENT.SOURCE_DATA_DISCREPANCY,
    previous_value: previousValue,
    current_value: currentValue,
    severity: SEVERITY.NOTABLE,
    metadata: {
      field,
      note: 'The B.C. source stopped publishing a value we previously held. '
        + 'This is reported as a data discrepancy, not as a change to the title.',
    },
  };
}
