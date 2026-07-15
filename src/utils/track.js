import { supabase } from '../lib/supabase';
import { getSessionId } from './session';

// Lightweight, fire-and-forget product analytics. Never throws, never blocks UI.
//
// All ingestion goes through /api/track (server-side, service-role writes) so
// the analytics tables carry no anonymous INSERT policies. The server:
//  * enforces an event-name allowlist and payload size/depth limits,
//  * resolves user identity from the Supabase access token (the userId
//    argument below is legacy and intentionally ignored),
//  * derives geo from edge headers rather than trusting the client,
//  * rate-limits by IP.
// Failures are silent in production and logged in development.

async function post(payload) {
  try {
    let token = null;
    if (supabase) {
      try {
        const { data } = await supabase.auth.getSession();
        token = data?.session?.access_token || null;
      } catch { token = null; }
    }
    const res = await fetch('/api/track', {
      method: 'POST',
      keepalive: true,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ session_id: getSessionId(), ...payload }),
    });
    if (import.meta.env.DEV && !res.ok && res.status !== 204) {
      console.warn(`[track] ${payload.kind} rejected: ${res.status}`);
    }
  } catch (e) {
    if (import.meta.env.DEV) console.warn('[track] failed:', e?.message);
  }
}

/**
 * Track a funnel/product event — fire-and-forget, never throws.
 * Powers the activation funnel in the admin dashboard:
 *   editor_opened → first_layer_added (activation) → export_completed,
 * plus the sharing loop: share_created → share_viewed → share_forked →
 * signup_completed.
 *
 * @param {string} event   snake_case event name (must be on the server allowlist)
 * @param {object} [props] small JSON-serializable context (no PII, no raw queries)
 * @param {string} [_userId] legacy param — identity now comes from the auth token
 */
export function trackEvent(event, props = {}, _userId = null) {
  if (!event) return;
  post({ kind: 'event', event, props: props && Object.keys(props).length ? props : undefined });
}

// Per-tab-session dedupe: this module-scoped Set lives as long as the tab, so
// it matches the sessionStorage-based session id. Used for events that would
// otherwise fire at keystroke/autosave cadence (project_saved, element_added)
// where the metric is "this happened at least once this session", not a count.
const sentOnce = new Set();

/**
 * Fire an event at most once per (event, dedupeKey) per tab-session.
 * @param {string} event      snake_case event name (must be on the server allowlist)
 * @param {string} dedupeKey  stable key — e.g. a project id or an element type
 * @param {object} [props]    context sent only on the first fire
 */
export function trackEventOnce(event, dedupeKey, props = {}) {
  if (!event) return;
  const k = `${event}:${dedupeKey}`;
  if (sentOnce.has(k)) return;
  sentOnce.add(k);
  trackEvent(event, props);
}

/**
 * Track a claims search — the core product action. Powers the "Product" tab
 * in the admin dashboard (which provinces/registries people actually use).
 * Only the query LENGTH is stored, never the text.
 */
export function trackSearch({ kind, province, mode, query, resultCount }) {
  post({
    kind: 'search',
    search_kind: kind || 'registry',
    province: province || undefined,
    mode: mode || undefined,
    query_len: query ? query.trim().length : undefined,
    result_count: resultCount == null ? undefined : Number(resultCount),
  });
}

/** Once-per-session page view. Geo is attached server-side from edge headers. */
export function trackPageView({ path, referrer, utmSource, utmMedium, utmCampaign, device }) {
  post({
    kind: 'pageview',
    path,
    referrer: referrer || undefined,
    utm_source: utmSource || undefined,
    utm_medium: utmMedium || undefined,
    utm_campaign: utmCampaign || undefined,
    device,
  });
}

/** Live-presence heartbeat. Location is derived server-side; body is just the session. */
export function trackPing() {
  post({ kind: 'ping' });
}

/** Landing-page click heatmap sample. */
export function trackLandingClick({ xPct, yPct, element, viewportW, pageH }) {
  post({
    kind: 'click',
    x_pct: xPct,
    y_pct: yPct,
    element: element || undefined,
    viewport_w: viewportW,
    page_h: pageH,
  });
}

/** Lead capture (email from the export gate). Validated + rate-limited server-side. */
export function trackLead({ email, projectTitle }) {
  return post({ kind: 'lead', email, project_title: projectTitle || undefined });
}
