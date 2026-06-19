import { supabase } from '../lib/supabase';
import { getSessionId } from './session';

// Lightweight, fire-and-forget product analytics. Never throws, never blocks UI.

/**
 * Track a claims search — the core product action. Powers the "Product" tab
 * in the admin dashboard (which provinces/registries people actually use) and
 * is a strong marketing signal for where demand is.
 *
 * @param {object} p
 * @param {'registry'|'nearby'} p.kind   registry text search vs. map-area lookup
 * @param {string} p.province            province code (bc, on, sk, mb, nl, yt…)
 * @param {string} [p.mode]              search mode (company/number/map) — registry only
 * @param {string} [p.query]            raw query (only length is stored, never the text)
 * @param {number} [p.resultCount]       number of features returned
 */
export function trackSearch({ kind, province, mode, query, resultCount }) {
  if (!supabase) return;
  try {
    supabase.from('search_events').insert({
      session_id: getSessionId(),
      kind: kind || 'registry',
      province: province || null,
      mode: mode || null,
      query_len: query ? query.trim().length : null,
      result_count: resultCount == null ? null : Number(resultCount),
    }).then(() => {}, () => {});
  } catch {
    // never let analytics break a search
  }
}
