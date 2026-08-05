// Resolve the B.C. layer's actual field names at run time.
//
// PURE (given a sample feature's properties).
//
// WHY NOT JUST HARD-CODE THE NAMES
//   Because api/claims.js already learned this lesson for five other
//   jurisdictions: government services rename, renumber and reshape their
//   layers without notice, and a hard-coded field name fails as a silent null
//   rather than as an error. Here a silent null would mean a claim with no
//   good-to-date — a monitored deadline that never fires. So each field is
//   resolved from a candidate list against the live layer, required fields
//   that cannot be resolved abort the run, and the resolved set is fingerprinted
//   into every import_run row so drift is visible in the admin tools.
//
// FIELD NAMES, AND HOW MUCH WE ACTUALLY KNOW
//   The first candidate in each list below is the name confirmed present on
//   pub:WHSE_MINERAL_TENURE.MTA_ACQUIRED_TENURE_SVW by this repository's
//   existing integrations — scripts/pseo/config.mjs (verified by a --discover
//   run), api/bc-claims.js, and src/utils/claimInfo.js.
//
//   The later candidates are informed guesses kept so the importer survives a
//   rename. Several fields — government client number, ownership percentage,
//   owner count, termination date, work/transfer event counts — are NOT
//   confirmed to exist on this layer at all. They are optional here, nullable
//   in the schema, and rendered as "Not published in the B.C. source" in the
//   UI. Run `node scripts/tenure-sync/run.mjs --discover` and record the real
//   answer in docs/tenure-monitor.md before any feature is built on them.

export class SchemaError extends Error {
  constructor(message, missing = []) {
    super(message);
    this.name = 'SchemaError';
    this.missing = missing;
  }
}

/**
 * Candidate names per logical field, best-known first.
 * `required: true` means the run aborts if none of the candidates resolve.
 */
export const FIELD_CANDIDATES = {
  // ── Required ─────────────────────────────────────────────────────────────
  sourceRecordId: {
    required: true,
    candidates: ['TENURE_NUMBER_ID', 'TENURE_ID', 'OBJECTID', 'FID'],
  },
  tenureNumber: {
    required: true,
    candidates: ['TENURE_NUMBER_ID', 'TAG_NUMBER', 'TENURE_NUMBER', 'TITLE_NUMBER'],
  },
  goodToDate: {
    required: true,
    // The monitored deadline. Losing this field is not a degraded feature, it
    // is the product ceasing to work, so it is required.
    candidates: ['GOOD_TO_DATE', 'GOOD_TO_DT', 'EXPIRY_DATE', 'GOODSTANDI'],
  },
  ownerName: {
    required: true,
    candidates: ['OWNER_NAME', 'TENURE_HOLDER_NAME', 'HOLDER', 'CLIENT_NAME', 'OWNER'],
  },

  // ── Optional, confirmed present ──────────────────────────────────────────
  tenureName: { required: false, candidates: ['CLAIM_NAME', 'TENURE_NAME', 'TITLE_NAME'] },
  tenureType: {
    required: false,
    candidates: ['TENURE_TYPE_DESCRIPTION', 'TITLE_TYPE_DESCRIPTION', 'TENURE_TYPE', 'TITLE_TYPE'],
  },
  tenureSubtype: {
    required: false,
    candidates: ['TENURE_SUBTYPE_DESCRIPTION', 'TENURE_SUB_TYPE_DESCRIPTION', 'TENURE_SUBTYPE'],
  },
  issueDate: { required: false, candidates: ['ISSUE_DATE', 'ISSUED_DATE', 'RECORD_DATE'] },
  areaHectares: { required: false, candidates: ['AREA_IN_HECTARES', 'AREA_HA', 'AREA_HECTARES'] },
  mapUnit: { required: false, candidates: ['MAP_UNIT_NO', 'MAP_NUMBER', 'MAP_SHEET'] },

  // ── Optional ─────────────────────────────────────────────────────────────
  // Verified against the live layer by the 2026-08-05 --discover run, which is
  // recorded in docs/tenure-monitor.md. Four of these were listed as "not
  // confirmed to exist" and are in fact published — under names my candidate
  // lists did not contain. The layer names them the way MTO does, not the way
  // the rest of DataBC does, which is exactly the guess a candidate list is
  // supposed to survive and mine did not.
  status: {
    required: false,
    // GENUINELY absent: the layer publishes no status column at all. Active vs
    // terminated has to be read from TERMINATION_DATE / TERMINATION_TYPE_
    // DESCRIPTION instead. Downstream this degrades correctly — reconcileRows
    // guards on `tenure.status &&` before judging good standing, so a null
    // status reads as MATCHED rather than as "not in good standing".
    candidates: ['TENURE_STATUS', 'STATUS', 'TENURE_STATUS_DESCRIPTION', 'TITLE_STATUS'],
  },
  terminationDate: {
    required: false,
    candidates: ['TERMINATION_DATE', 'TERMINATED_DATE', 'CANCEL_DATE', 'CANCELLED_DATE'],
  },
  clientNumber: {
    required: false,
    // CLIENT_NUMBER_ID is what the layer actually publishes (verified
    // 2026-08-05). Without it, client-number search had nothing to match on
    // and the docs said so — a shipped feature that was quietly inert.
    candidates: ['CLIENT_NUMBER_ID', 'CLIENT_NUMBER', 'OWNER_CLIENT_NUMBER', 'GOVERNMENT_CLIENT_NUMBER', 'CLIENT_NO'],
  },
  ownershipPercentage: {
    required: false,
    candidates: ['OWNERSHIP_PERCENTAGE', 'PERCENT_OWNERSHIP', 'OWNER_PERCENT', 'PCT_OWNERSHIP'],
  },
  ownerCount: {
    required: false,
    candidates: ['NUMBER_OF_OWNERS', 'OWNER_COUNT', 'NUM_OWNERS'],
  },
  workEventCount: {
    required: false,
    candidates: ['STATEMENT_OF_WORK_EVENT_COUNT', 'NUMBER_OF_WORK_EVENTS', 'WORK_EVENT_COUNT', 'NUM_WORK_EVENTS'],
  },
  transferEventCount: {
    required: false,
    candidates: ['OWNERSHIP_TRANSFER_EVENT_COUNT', 'NUMBER_OF_TRANSFER_EVENTS', 'TRANSFER_EVENT_COUNT', 'NUM_TRANSFER_EVENTS'],
  },
  sourceUpdatedAt: {
    required: false,
    candidates: ['UPDATE_TIMESTAMP', 'UPDATE_DATE', 'LAST_UPDATE', 'MODIFIED_DATE', 'SE_ANNO_CAD_DATA_UPDATE_DATE'],
  },
};

/**
 * Resolve the field map from a sample feature.
 *
 * @param {object} sampleProperties  properties of any one feature from the layer
 * @returns {{fields: object, available: string[], missingOptional: string[], fingerprint: string}}
 * @throws {SchemaError} when a required field cannot be resolved
 */
export function resolveFields(sampleProperties) {
  const props = sampleProperties && typeof sampleProperties === 'object' ? sampleProperties : null;
  if (!props) {
    throw new SchemaError('The B.C. layer returned no sample feature to resolve fields against.');
  }

  const available = Object.keys(props);
  // Case-insensitive lookup: WFS has been observed returning the same layer
  // with different casing across service versions.
  const byLower = new Map(available.map((k) => [k.toLowerCase(), k]));

  const fields = {};
  const missingRequired = [];
  const missingOptional = [];

  for (const [logical, spec] of Object.entries(FIELD_CANDIDATES)) {
    const hit = spec.candidates.find((c) => byLower.has(c.toLowerCase()));
    if (hit) {
      fields[logical] = byLower.get(hit.toLowerCase());
    } else {
      fields[logical] = null;
      (spec.required ? missingRequired : missingOptional).push(logical);
    }
  }

  if (missingRequired.length) {
    throw new SchemaError(
      `The B.C. tenure layer no longer publishes required field(s): ${missingRequired.join(', ')}. `
      + 'The import was stopped so it could not overwrite trusted records with incomplete data. '
      + `Fields currently on the layer: ${available.join(', ')}`,
      missingRequired,
    );
  }

  // The province publishes one combined owner field today. This flag is what
  // normalize.mjs reads to decide whether it may describe ownership as
  // separately published or must say it derived the split itself.
  fields.ownersAreDiscrete = false;

  return {
    fields,
    available,
    missingOptional,
    fingerprint: schemaFingerprint(available),
  };
}

/**
 * Stable fingerprint of the layer's field list.
 *
 * Any field appearing or disappearing changes it, which is how the guardrails
 * notice a schema migration that did not happen to break a field we use. Not a
 * cryptographic hash — it only ever answers "is this the same shape as last
 * time" — and implemented inline so this module stays dependency-free.
 */
export function schemaFingerprint(fieldNames) {
  const s = [...fieldNames].map(String).sort().join('|');
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/**
 * Human-readable report for --discover and for docs/tenure-monitor.md.
 * This is what an operator pastes into the docs after verifying the live layer.
 */
export function describeResolution(resolution, sampleProperties = {}) {
  const lines = [];
  lines.push(`Schema fingerprint: ${resolution.fingerprint}`);
  lines.push(`Fields on the layer (${resolution.available.length}):`);
  for (const k of [...resolution.available].sort()) {
    lines.push(`  ${k} = ${JSON.stringify(sampleProperties[k])}`);
  }
  lines.push('');
  lines.push('Resolved mapping:');
  for (const [logical, spec] of Object.entries(FIELD_CANDIDATES)) {
    const actual = resolution.fields[logical];
    const mark = actual ? '✓' : (spec.required ? '✗ REQUIRED' : '— not published');
    lines.push(`  ${logical.padEnd(22)} ${mark}${actual ? ` → ${actual}` : ''}`);
  }
  if (resolution.missingOptional.length) {
    lines.push('');
    lines.push(
      'Not published by this layer — these render as "Not published in the B.C. source":',
    );
    lines.push(`  ${resolution.missingOptional.join(', ')}`);
  }
  return lines.join('\n');
}
