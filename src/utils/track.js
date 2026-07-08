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
/**
 * Track a funnel/product event — fire-and-forget, never throws.
 * Powers the activation funnel in the admin dashboard:
 *   editor_opened → first_layer_added (activation) → export_completed,
 * plus the sharing loop: share_created → share_viewed → share_forked →
 * signup_completed.
 *
 * @param {string} event   snake_case event name
 * @param {object} [props] small JSON-serializable context (no PII, no raw queries)
 * @param {string} [userId] auth user id when signed in
 */
export function trackEvent(event, props = {}, userId = null) {
  if (!supabase || !event) return;
  try {
    supabase.from('product_events').insert({
      session_id: getSessionId(),
      user_id: userId || null,
      event,
      props: props && Object.keys(props).length ? props : null,
    }).then(() => {}, () => {});
  } catch {
    // never let analytics break the product
  }
}

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
