// Tenure Monitor search — reads the Exploration Maps mirror of the B.C.
// mineral tenure registry.
//
// WHY THIS DOES NOT PROXY THE PROVINCE
//   api/bc-claims.js and api/claims.js already proxy DataBC live, and they
//   stay exactly as they are — the map editor's claim search is a different
//   job with different tradeoffs. Tenure Monitor reads the mirror instead
//   because it needs things a live proxy cannot give it: owner search across
//   the whole province in one query, a client-number index, a stable
//   `tenure_id` to hang a portfolio membership off, and an honest
//   "last synced" timestamp attached to every answer. A monitoring product
//   that silently changed its numbers between page loads would be worse than
//   one that says how old its data is.
//
// ANONYMOUS-SAFE
//   No authentication required, because the acquisition funnel needs a visitor
//   to be able to look up a tenure number before they have an account, and
//   because this is public government data either way. Rate-limited by IP with
//   the shared limiter, and every response carries the sync timestamp and the
//   OGL-BC attribution.
//
// Reads with the anon key under the public-read RLS policy on `tenures` /
// `tenure_owners` — the service role is deliberately not used here, so a bug
// in this file cannot reach a customer's private portfolio data.

import { createClient } from '@supabase/supabase-js';
import {
  applyCors, handleMethods, queryTooLong, validateTerm, validateBbox,
  rateLimited, rateLimitedShared, publicErrorMessage,
} from './_lib/guard.js';

const MAX_RESULTS = 200;
const MAX_TENURE_NUMBERS = 100;

// Columns every search returns. `geometry` is included only where the caller
// actually needs to draw something — it is by far the largest column and a
// 200-row owner search does not need 200 polygons to render a confirmation
// list.
const SUMMARY_COLUMNS = 'id, tenure_number, tenure_name, tenure_type, tenure_subtype, '
  + 'status, issue_date, good_to_date, area_hectares, map_unit, missing_run_count';

function client() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

export default async function handler(req, res) {
  applyCors(req, res);
  res.setHeader('Cache-Control', 'no-store');
  if (handleMethods(req, res, ['GET'])) return;
  if (queryTooLong(req)) return res.status(414).json({ error: 'query string too long' });

  // Per-instance limiter first (synchronous, no round trip), then the shared
  // one. Same layering as the claims endpoints.
  if (rateLimited(req, { max: 60, windowMs: 60_000, bucket: 'tenure-search' })) {
    return res.status(429).json({ error: 'rate limited — slow down and try again' });
  }

  const sb = client();
  if (!sb) {
    return res.status(503).json({
      error: 'Tenure search is not configured on this deployment.',
    });
  }

  if (await rateLimitedShared(sb, req, {
    max: 120, windowSeconds: 60, bucket: 'tenure-search',
  })) {
    return res.status(429).json({ error: 'rate limited — slow down and try again' });
  }

  const { mode = 'number', q, bbox, limit } = req.query;
  const cap = Math.min(Math.max(Number(limit) || MAX_RESULTS, 1), MAX_RESULTS);

  try {
    let result;
    switch (mode) {
      case 'number':      result = await searchByNumber(sb, q, cap); break;
      case 'numbers':     result = await searchByNumbers(sb, q); break;
      case 'owner':       result = await searchByOwner(sb, q, cap); break;
      case 'client':      result = await searchByClientNumber(sb, q, cap); break;
      case 'extent':      result = await searchByExtent(sb, bbox, cap); break;
      case 'geometry':    result = await fetchGeometry(sb, q); break;
      default:
        return res.status(400).json({ error: 'mode must be one of: number, numbers, owner, client, extent, geometry' });
    }
    if (result.error) return res.status(result.status || 400).json({ error: result.error });

    const sync = await lastSync(sb);
    return res.status(200).json({
      ...result,
      meta: {
        // Every answer states how old it is. A monitoring product that hides
        // this is asking the user to assume it is live, which it is not.
        lastSyncedAt: sync?.completed_at || null,
        source: 'BC Mineral Titles (DataBC WFS), mirrored by Exploration Maps',
        attribution: 'Contains information licensed under the Open Government Licence – British Columbia.',
        verifyAt: 'https://www.mtonline.gov.bc.ca/mtov/home.do',
      },
    });
  } catch (e) {
    if (process.env.NODE_ENV !== 'production') console.warn('[tenure-search]', e);
    return res.status(502).json({
      error: publicErrorMessage(e, 'Tenure search is temporarily unavailable. Try again shortly.'),
    });
  }
}

// ── Modes ──────────────────────────────────────────────────────────────────

async function searchByNumber(sb, q, cap) {
  const checked = validateTerm(q);
  if (!checked.ok) return { error: checked.error };
  const term = checked.term;

  // Exact first: someone typing a full tenure number wants that title, not 40
  // titles whose numbers happen to start with the same digits.
  const exact = await sb.from('tenures').select(SUMMARY_COLUMNS)
    .eq('jurisdiction', 'BC').eq('tenure_number', term).limit(cap);
  if (exact.error) throw new Error(exact.error.message);
  if (exact.data?.length) {
    return { mode: 'number', match: 'exact', results: await withOwners(sb, exact.data) };
  }

  // Prefix fallback, with the wildcards escaped so a user pasting '%' does not
  // turn their search into a full-table scan.
  const safe = term.replace(/[%_\\]/g, '\\$&');
  const prefix = await sb.from('tenures').select(SUMMARY_COLUMNS)
    .eq('jurisdiction', 'BC').like('tenure_number', `${safe}%`)
    .order('tenure_number').limit(cap);
  if (prefix.error) throw new Error(prefix.error.message);
  return { mode: 'number', match: 'prefix', results: await withOwners(sb, prefix.data || []) };
}

/** Paste-a-list search: "1044501, 1044502 1044503". */
async function searchByNumbers(sb, q) {
  if (!q || typeof q !== 'string') return { error: 'q is required' };
  const numbers = [...new Set(
    q.split(/[\s,;\n]+/).map((s) => s.trim()).filter(Boolean),
  )];
  if (!numbers.length) return { error: 'no tenure numbers found in the input' };
  if (numbers.length > MAX_TENURE_NUMBERS) {
    return { error: `Too many tenure numbers at once (max ${MAX_TENURE_NUMBERS}).` };
  }

  const { data, error } = await sb.from('tenures').select(SUMMARY_COLUMNS)
    .eq('jurisdiction', 'BC').in('tenure_number', numbers);
  if (error) throw new Error(error.message);

  // Report what was NOT found, by name. Silently returning 7 rows for a list
  // of 10 leaves the user believing three claims are being monitored when
  // they are not.
  const found = new Set((data || []).map((r) => r.tenure_number));
  return {
    mode: 'numbers',
    requested: numbers.length,
    results: await withOwners(sb, data || []),
    notFound: numbers.filter((n) => !found.has(n)),
  };
}

async function searchByOwner(sb, q, cap) {
  const checked = validateTerm(q);
  if (!checked.ok) return { error: checked.error };
  // The stored key is already suffix- and punctuation-folded, so the query
  // must be folded the same way or "Goliath Resources Ltd." matches nothing.
  const normalized = normalizeOwnerQuery(checked.term);
  if (!normalized) {
    return { error: 'That name has nothing to search on once company suffixes are removed.' };
  }
  const safe = normalized.replace(/[%_\\]/g, '\\$&');

  const { data, error } = await sb
    .from('tenure_owners')
    .select(`owner_name, normalized_owner_name, government_client_number, ownership_percentage,
             ownership_representation, tenures!inner(${SUMMARY_COLUMNS})`)
    .ilike('normalized_owner_name', `%${safe}%`)
    .limit(cap);
  if (error) throw new Error(error.message);

  // Candidates, explicitly. The client groups these by match confidence and
  // makes the user confirm — an owner-name search must never silently adopt
  // every loosely related title into somebody's portfolio.
  return {
    mode: 'owner',
    query: checked.term,
    normalizedQuery: normalized,
    candidates: (data || []).map((row) => ({
      ...row.tenures,
      owner_name: row.owner_name,
      government_client_number: row.government_client_number,
      ownership_percentage: row.ownership_percentage,
      ownership_representation: row.ownership_representation,
    })),
    requiresConfirmation: true,
  };
}

async function searchByClientNumber(sb, q, cap) {
  const checked = validateTerm(q);
  if (!checked.ok) return { error: checked.error };

  const { data, error } = await sb
    .from('tenure_owners')
    .select(`owner_name, government_client_number, tenures!inner(${SUMMARY_COLUMNS})`)
    .eq('government_client_number', checked.term)
    .limit(cap);
  if (error) throw new Error(error.message);

  const rows = data || [];
  if (!rows.length) {
    // Distinguish "no such client" from "we do not have this field at all".
    // Client number is not confirmed to be published on the B.C. layer, and a
    // bare "no results" would let a user conclude a real client number is
    // unknown to the province.
    const probe = await sb.from('tenure_owners').select('id')
      .not('government_client_number', 'is', null).limit(1);
    if (!probe.error && (probe.data || []).length === 0) {
      return {
        mode: 'client',
        results: [],
        fieldUnavailable: true,
        note: 'The B.C. tenure layer does not currently publish a government client '
          + 'number, so client-number search has nothing to match against. Search by '
          + 'tenure number or registered owner name instead.',
      };
    }
  }

  return {
    mode: 'client',
    results: rows.map((row) => ({ ...row.tenures, owner_name: row.owner_name })),
  };
}

async function searchByExtent(sb, bbox, cap) {
  const checked = validateBbox(bbox);
  if (!checked.ok) return { error: checked.error };
  const [minLng, minLat, maxLng, maxLat] = checked.bbox;

  const { data, error } = await sb.rpc('tenures_in_bbox', {
    min_lng: minLng, min_lat: minLat, max_lng: maxLng, max_lat: maxLat, p_limit: cap,
  });
  if (error) throw new Error(error.message);
  return { mode: 'extent', results: await withOwners(sb, data || []) };
}

/**
 * Geometry for a specific set of tenure ids — used when opening claims in the
 * map editor. Separate from the search modes because it is the only one that
 * returns polygons, and the payload is an order of magnitude larger.
 */
async function fetchGeometry(sb, q) {
  if (!q || typeof q !== 'string') return { error: 'q must be a comma-separated list of tenure ids' };
  const ids = [...new Set(q.split(',').map((s) => s.trim()).filter(Boolean))];
  if (!ids.length) return { error: 'no tenure ids supplied' };
  if (ids.length > 500) return { error: 'too many tenures in one request (max 500)' };
  if (!ids.every(isUuid)) return { error: 'tenure ids must be uuids' };

  const { data, error } = await sb.from('tenures')
    .select(`${SUMMARY_COLUMNS}, geometry`)
    .in('id', ids);
  if (error) throw new Error(error.message);

  return {
    mode: 'geometry',
    featureCollection: {
      type: 'FeatureCollection',
      features: (data || []).filter((r) => r.geometry).map((r) => ({
        type: 'Feature',
        // The property names the existing map layer already renders
        // (src/utils/claimInfo.js), so a monitored portfolio styles and
        // labels itself in the editor exactly like a registry search result.
        properties: {
          TENURE_NUMBER_ID: r.tenure_number,
          TAG_NUMBER: r.tenure_number,
          CLAIM_NAME: r.tenure_name,
          TENURE_TYPE_DESCRIPTION: r.tenure_type,
          TENURE_SUBTYPE_DESCRIPTION: r.tenure_subtype,
          TENURE_STATUS: r.status,
          ISSUE_DATE: r.issue_date,
          GOOD_TO_DATE: r.good_to_date,
          AREA_IN_HECTARES: r.area_hectares,
          EM_TENURE_ID: r.id,
        },
        geometry: r.geometry,
      })),
    },
  };
}

// ── helpers ────────────────────────────────────────────────────────────────

/** Attach owners in one extra query rather than N. */
async function withOwners(sb, rows) {
  if (!rows.length) return rows;
  const ids = rows.map((r) => r.id);
  const { data, error } = await sb
    .from('tenure_owners')
    .select('tenure_id, owner_name, ownership_percentage, government_client_number, ownership_representation, is_primary_owner')
    .in('tenure_id', ids);
  if (error) throw new Error(error.message);

  const byTenure = new Map();
  for (const o of data || []) {
    if (!byTenure.has(o.tenure_id)) byTenure.set(o.tenure_id, []);
    byTenure.get(o.tenure_id).push(o);
  }
  return rows.map((r) => ({ ...r, owners: byTenure.get(r.id) || [] }));
}

async function lastSync(sb) {
  const { data, error } = await sb.rpc('tenure_last_sync');
  if (error) return null;
  return Array.isArray(data) ? data[0] : data;
}

/**
 * Fold a search term the same way the stored owner key was folded.
 *
 * Intentionally a small duplicate of src/utils/tenureOwners.js#normalizeOwnerName
 * rather than an import: api/ is a separate serverless bundle with no build
 * step over src/, and the two are pinned together by
 * tests/tenure-search.test.js, which asserts they agree.
 */
export function normalizeOwnerQuery(raw) {
  const suffixes = /(?:^|[\s,.])(?:limited partnership|incorporated|corporation|company|limited|holdings|holding|llc|llp|plc|ltee|inc|ltd|corp|co|lp)\.?(?=$|[\s,.])/gi;
  let s = String(raw ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  s = s.replace(/&/g, ' and ');
  s = s.replace(suffixes, ' ').replace(suffixes, ' ');
  s = s.replace(/[^a-z0-9\s]/g, ' ');
  return s.replace(/\s+/g, ' ').trim();
}

function isUuid(s) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}
