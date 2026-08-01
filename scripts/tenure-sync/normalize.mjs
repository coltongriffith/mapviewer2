// Raw B.C. WFS feature → normalized tenure + owner rows.
//
// PURE. No network, no database, no clock beyond an injectable `observedAt`.
// This is the module the unit tests hold to account, because everything
// downstream — deadlines, alerts, change detection — is only as correct as
// what this function decides a government record says.
//
// The governing principle: REJECT, DON'T GUESS. A feature without a stable
// source id or without usable geometry is counted as rejected and reported in
// the import run, never quietly written with an invented value. Rejected
// records are visible in the admin tools and they feed the guardrail that
// aborts a run when the source starts returning junk.

import { toIsoDate } from '../../src/utils/tenureDates.js';
import {
  normalizeOwnerName, splitOwnerField, OWNERSHIP_REPRESENTATION,
} from '../../src/utils/tenureOwners.js';

/** Coordinate precision kept in the stored GeoJSON. ~0.1 m; trims jsonb size. */
export const COORD_PRECISION = 6;

export const REJECT_REASONS = {
  NO_SOURCE_ID: 'missing source record id',
  NO_TENURE_NUMBER: 'missing tenure number',
  BAD_GEOMETRY: 'invalid or unusable geometry',
  BAD_SHAPE: 'feature was not an object with properties',
};

/**
 * Normalize one WFS feature.
 *
 * @param {object} feature            GeoJSON Feature from the WFS response
 * @param {object} fields             resolved field map from resolveFields.mjs
 * @param {object} [opts]
 * @param {string} [opts.observedAt]  ISO timestamp for this run
 * @param {string} [opts.jurisdiction]
 * @param {string} [opts.source]
 * @returns {{ok: true, tenure: object, owners: object[]} | {ok: false, reason: string, sourceRecordId: string|null}}
 */
export function normalizeFeature(feature, fields, opts = {}) {
  const observedAt = opts.observedAt || new Date().toISOString();
  const jurisdiction = opts.jurisdiction || 'BC';
  const source = opts.source || 'bc-wfs-mta-acquired-tenure-svw';

  const props = feature?.properties;
  if (!props || typeof props !== 'object') {
    return { ok: false, reason: REJECT_REASONS.BAD_SHAPE, sourceRecordId: null };
  }

  const sourceRecordId = str(pick(props, fields.sourceRecordId));
  if (!sourceRecordId) {
    return { ok: false, reason: REJECT_REASONS.NO_SOURCE_ID, sourceRecordId: null };
  }

  // The tenure number is what a user types, what an email quotes, and what
  // they search MTO for. A record we cannot label is not monitorable, so it is
  // rejected rather than stored as an anonymous polygon.
  const tenureNumber = str(pick(props, fields.tenureNumber)) || sourceRecordId;
  if (!tenureNumber) {
    return { ok: false, reason: REJECT_REASONS.NO_TENURE_NUMBER, sourceRecordId };
  }

  const geometry = normalizeGeometry(feature?.geometry);
  if (!geometry) {
    return { ok: false, reason: REJECT_REASONS.BAD_GEOMETRY, sourceRecordId };
  }

  const tenure = {
    jurisdiction,
    source,
    source_record_id: sourceRecordId,
    tenure_number: tenureNumber,
    tenure_name: str(pick(props, fields.tenureName)),
    tenure_type: str(pick(props, fields.tenureType)),
    tenure_subtype: str(pick(props, fields.tenureSubtype)),
    status: str(pick(props, fields.status)),
    issue_date: toIsoDate(pick(props, fields.issueDate)),
    good_to_date: toIsoDate(pick(props, fields.goodToDate)),
    termination_date: toIsoDate(pick(props, fields.terminationDate)),
    area_hectares: num(pick(props, fields.areaHectares)),
    map_unit: str(pick(props, fields.mapUnit)),
    owner_count: int(pick(props, fields.ownerCount)),
    work_event_count: int(pick(props, fields.workEventCount)),
    transfer_event_count: int(pick(props, fields.transferEventCount)),
    geometry,
    source_updated_at: toTimestamp(pick(props, fields.sourceUpdatedAt)),
    last_observed_at: observedAt,
    last_synced_at: observedAt,
    // Kept verbatim. When the province adds a field we have not modelled, the
    // data is already here and a later migration can backfill from it.
    raw_source_data: props,
  };

  return { ok: true, tenure, owners: normalizeOwners(props, fields, observedAt) };
}

/**
 * Owner rows for one tenure.
 *
 * The current B.C. layer publishes a single flat OWNER_NAME, so in practice
 * this returns one row tagged 'single_field' — which is precisely what the UI
 * needs in order to say "the source publishes one combined owner field"
 * instead of implying we have verified a sole owner. If the layer is ever
 * discovered to expose discrete owner records, resolveFields will populate
 * `fields.owners` and these rows upgrade to 'multi_field' with no migration.
 */
export function normalizeOwners(props, fields, observedAt) {
  const raw = str(pick(props, fields.ownerName));
  if (!raw) return [];

  const names = splitOwnerField(raw);
  // Note this stays SINGLE_FIELD even when the split produced several names:
  // we derived those names from one combined string, we did not receive them
  // as separate government records, and the UI must not present a derived
  // split as though the province published discrete co-owners.
  const representation = fields.ownersAreDiscrete
    ? OWNERSHIP_REPRESENTATION.MULTI_FIELD
    : OWNERSHIP_REPRESENTATION.SINGLE_FIELD;

  const clientNumber = str(pick(props, fields.clientNumber));
  const percentage = num(pick(props, fields.ownershipPercentage));

  const seen = new Set();
  const rows = [];
  names.forEach((name, i) => {
    const normalized = normalizeOwnerName(name);
    // A name that normalizes to nothing (punctuation only, or a bare legal
    // suffix) still deserves a row, keyed on its raw form, so the title is not
    // silently shown as unowned.
    const key = normalized || name.trim().toLowerCase();
    if (!key || seen.has(key)) return;
    seen.add(key);
    rows.push({
      owner_name: name.trim(),
      normalized_owner_name: key,
      // A client number or percentage read from a single flat field cannot be
      // attributed to one of several co-owners. Attach it only when there is
      // exactly one owner; otherwise leave it null rather than assign it to
      // whichever name happened to sort first.
      government_client_number: names.length === 1 ? clientNumber : null,
      ownership_percentage: names.length === 1 ? percentage : null,
      is_primary_owner: i === 0,
      ownership_representation: representation,
      first_observed_at: observedAt,
      last_observed_at: observedAt,
    });
  });
  return rows;
}

// ── Geometry ───────────────────────────────────────────────────────────────

/**
 * Validate and shrink a GeoJSON geometry.
 *
 * Accepts Polygon and MultiPolygon only — a mineral tenure is an area, and a
 * point or line here means the source sent us something we do not understand.
 * Returns null for anything unusable, which becomes a rejected record.
 */
export function normalizeGeometry(geom) {
  if (!geom || typeof geom !== 'object') return null;
  const type = geom.type;
  if (type !== 'Polygon' && type !== 'MultiPolygon') return null;
  const coords = roundCoords(geom.coordinates);
  if (!coords) return null;

  // A ring needs at least 4 positions (3 corners + the closing point) to
  // enclose any area at all.
  const rings = type === 'Polygon' ? coords : coords.flat();
  if (!Array.isArray(rings) || rings.length === 0) return null;
  for (const ring of rings) {
    if (!Array.isArray(ring) || ring.length < 4) return null;
  }
  return { type, coordinates: coords };
}

function roundCoords(node) {
  if (!Array.isArray(node)) return null;
  if (typeof node[0] === 'number') {
    const lng = node[0];
    const lat = node[1];
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
    // WGS84 sanity. Anything outside this is a projection failure upstream,
    // not a claim in an unusual place.
    if (lng < -180 || lng > 180 || lat < -90 || lat > 90) return null;
    return [round(lng), round(lat)];
  }
  const out = [];
  for (const child of node) {
    const r = roundCoords(child);
    if (r === null) return null;
    out.push(r);
  }
  return out;
}

function round(n) {
  const f = 10 ** COORD_PRECISION;
  return Math.round(n * f) / f;
}

/**
 * Stable, order-preserving fingerprint of a geometry.
 *
 * FNV-1a, deliberately not a cryptographic hash: this only ever answers "did
 * the polygon change since last time", and it must run identically in the
 * browser, in Vitest, and in the Node job without pulling in node:crypto.
 */
export function geometryHash(geometry) {
  if (!geometry) return null;
  const s = JSON.stringify(geometry);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    // 32-bit FNV prime multiply, done with shifts to stay inside int32.
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

// ── Coercion helpers ───────────────────────────────────────────────────────

/** Read the first present value for a resolved field name (or list of them). */
function pick(props, fieldName) {
  if (!fieldName) return null;
  if (Array.isArray(fieldName)) {
    for (const f of fieldName) {
      const v = props[f];
      if (v != null && v !== '') return v;
    }
    return null;
  }
  const v = props[fieldName];
  return v == null || v === '' ? null : v;
}

function str(v) {
  if (v == null) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

function num(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function int(v) {
  const n = num(v);
  return n == null ? null : Math.trunc(n);
}

/** Timestamps stay timestamps (unlike the deadline dates, which stay dates). */
function toTimestamp(v) {
  if (v == null || v === '') return null;
  const d = v instanceof Date ? v : new Date(typeof v === 'number' ? v : String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
