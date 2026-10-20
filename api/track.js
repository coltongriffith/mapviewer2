// Server-side analytics ingestion. Replaces direct anonymous Supabase table
// writes (live_pings, page_views, product_events, search_events,
// landing_clicks, leads) so RLS on those tables can be locked down.
//
// Design constraints:
//  * Fire-and-forget from the client — respond fast, never make the map UI
//    wait. Failures return small JSON errors but the client ignores them.
//  * Never trust client-supplied identity or location: user_id comes from a
//    verified Supabase access token (Authorization header) or is null; geo
//    comes from Vercel edge headers, never the request body.
//  * Writes use the service-role key (server-only env: SUPABASE_SERVICE_ROLE_KEY).
//    Without it the endpoint answers 204 and drops the event — analytics must
//    fail quietly, not break the product.
//  * Best-effort in-memory rate limiting (per serverless instance). Good
//    enough to blunt casual spam; not a hard global guarantee.

import { createClient } from '@supabase/supabase-js';
import { redact } from './_lib/redact.js';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const EVENT_ALLOWLIST = new Set([
  'editor_opened',
  'first_layer_added',
  'export_completed',
  'export_gate_shown',
  'export_gate_signup_started',
  'signup_link_sent',
  'signup_link_failed',
  'investor_layout_selected',
  'share_created',
  'share_viewed',
  'share_forked',
  'signup_completed',
  'claim_intent',
  'mobile_editor_banner_shown',
  'onboarding_step',
  'search_recovery_clicked',
  'content_cta_clicked',
  'first_map_checklist_shown',
  'mobile_continue_clicked',
  // Phone claims viewer: opened, and what the reader did there (props.action).
  'mobile_viewer_opened',
  'mobile_viewer_action',
  // The one free full-resolution export offered when a free PNG hits the cap.
  'fullres_offer_shown',
  'fullres_offer_sent',
  'fullres_export_completed',
  'onboarding_dismissed',
  // Dashboard v2 product events (see supabase migration 20260713000001 +
  // src/components/admin/metrics.js for the taxonomy these feed).
  'project_created',
  'project_saved',
  'project_opened',
  'layer_added',
  'element_added',
  'registry_claims_imported',
  'export_failed',
  // Tenure Monitor funnel. Server-side allowlisting means a client change
  // without this list is silently dropped — the two ship together.
  'tenure_search_started',
  'tenure_search_completed',
  'tenure_portfolio_created',
  'tenure_added',
  'tenure_alerts_configured',
  'tenure_opened_in_editor',
  'tenure_export_attempted',
  'tenure_upgrade_viewed',
  // Upgrade funnel + feature-trim events the client already sends. They were
  // missing here, so every one of them was answered 400 and never recorded.
  'pro_gate_shown',
  'upgrade_checkout_started',
  'upgrade_needs_signin',
  'upgrade_processing',
  'upgrade_verified_paid',
  'features_removed',
  'features_restored',
  // Sent once per tab by a browser the owner marked as internal. The
  // admin_session_ids() reporting helper excludes the whole tab.
  'internal_session',
]);

const MAX_BODY_BYTES = 8 * 1024;
const MAX_PROPS_BYTES = 2 * 1024;
const MAX_PROPS_DEPTH = 3;
const SESSION_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// requests allowed per rolling window, keyed by ip+kind
const RATE_LIMITS = {
  ping: { max: 8, windowMs: 60_000 },
  pageview: { max: 6, windowMs: 60_000 },
  click: { max: 40, windowMs: 60_000 },
  event: { max: 60, windowMs: 60_000 },
  search: { max: 40, windowMs: 60_000 },
  lead: { max: 5, windowMs: 600_000 },
  claim_request: { max: 5, windowMs: 600_000 },
  team_enquiry: { max: 3, windowMs: 600_000 },
};
const rateBuckets = new Map();

function rateLimited(ip, kind) {
  const cfg = RATE_LIMITS[kind];
  if (!cfg) return true;
  const key = `${ip}:${kind}`;
  const now = Date.now();
  let b = rateBuckets.get(key);
  if (!b || now > b.resetAt) {
    b = { count: 0, resetAt: now + cfg.windowMs };
    rateBuckets.set(key, b);
  }
  b.count += 1;
  // Opportunistic cleanup so a long-lived instance doesn't grow unbounded.
  if (rateBuckets.size > 5000) {
    for (const [k, v] of rateBuckets) { if (now > v.resetAt) rateBuckets.delete(k); }
  }
  return b.count > cfg.max;
}

function jsonDepth(value, depth = 0) {
  if (depth > MAX_PROPS_DEPTH) return depth;
  if (Array.isArray(value)) return value.reduce((m, v) => Math.max(m, jsonDepth(v, depth + 1)), depth + 1);
  if (value && typeof value === 'object') {
    return Object.values(value).reduce((m, v) => Math.max(m, jsonDepth(v, depth + 1)), depth + 1);
  }
  return depth;
}

const str = (v, max) => (typeof v === 'string' && v.length ? v.slice(0, max) : null);

// A registry search term, kept so a zero-result search can be explained rather
// than only counted (see migration 20260918120000). Trimmed, capped at the
// length api/_lib/guard.js accepts, and run through the same redact() the error
// sink uses — a term is typed into a search box, and search boxes collect
// pasted junk. Whitespace is collapsed so "acme  corp" and "acme corp" group as
// one term in the report instead of two.
const MAX_QUERY_TEXT = 120;
const searchTerm = (v) => {
  const cleaned = str(v, MAX_QUERY_TEXT * 2);
  if (cleaned === null) return null;
  const collapsed = cleaned.replace(/\s+/g, ' ').trim();
  return collapsed ? redact(collapsed).slice(0, MAX_QUERY_TEXT) : null;
};
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);

// Exploration Maps for Teams (/teams). The form's choices, checked here so a
// row only ever holds values the admin view knows how to show.
const TEAM_MATERIALS = new Set(['claims', 'project_maps', 'results', 'sections_3d', 'investor', 'presentation', 'fact_sheet', 'website', 'map_review']);
const TEAM_LEVELS = new Set(['managed_maps', 'maps_presentation', 'corporate', 'not_sure']);
const TEAM_MAX_FILES = 5;
const TEAM_MAX_FILE_BYTES = 50 * 1024 * 1024;
const TEAM_BUCKET = 'team-enquiries';

// Declared files become storage paths under the enquiry's own folder. Names are
// reduced to a safe slug; the original name is kept in the row for display.
export function teamFiles(list) {
  if (!Array.isArray(list)) return [];
  return list.slice(0, TEAM_MAX_FILES).flatMap((f, i) => {
    const name = str(f?.name, 200);
    const size = num(f?.size);
    if (!name || size === null || size <= 0 || size > TEAM_MAX_FILE_BYTES) return [];
    const dot = name.lastIndexOf('.');
    const ext = dot > 0 ? name.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 10) : '';
    const stem = (dot > 0 ? name.slice(0, dot) : name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'file';
    return [{ name, size, type: str(f?.type, 100) || null, file: `${i + 1}-${stem}${ext ? `.${ext}` : ''}` }];
  });
}

function geoFromHeaders(h) {
  const dec = (v) => { if (!v) return null; try { return decodeURIComponent(v); } catch { return v; } };
  return {
    lat: num(h['x-vercel-ip-latitude']),
    lng: num(h['x-vercel-ip-longitude']),
    city: dec(h['x-vercel-ip-city']),
    region: dec(h['x-vercel-ip-country-region']),
    country: h['x-vercel-ip-country'] || null,
  };
}

async function resolveUser(req, sb) {
  const auth = req.headers?.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token || token.length > 4096) return null;
  try {
    const { data, error } = await sb.auth.getUser(token);
    if (error) return null;
    return data?.user || null;
  } catch {
    return null;
  }
}

async function resolveUserId(req, sb) { return (await resolveUser(req, sb))?.id || null; }

// Crawlers, uptime checks and automated browsers (headless runs, agents that
// set navigator.webdriver) are not visitors. They are accepted and dropped so
// they never reach the dashboard. A confirmed signup is always recorded.
const AUTOMATED_UA = /bot\b|bot\/|crawl|spider|slurp|headless|lighthouse|pagespeed|gtmetrix|pingdom|uptime|python-|curl\/|wget|httpclient|okhttp|phantomjs|selenium|puppeteer|playwright|bingpreview|facebookexternalhit|embedly/i;

export function isAutomated(req, body) {
  if (body?.automated === true) return true;
  return AUTOMATED_UA.test(String(req.headers?.['user-agent'] || ''));
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') {
    res.setHeader('Allow', 'POST, OPTIONS');
    return res.status(204).end();
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS');
    return res.status(405).json({ error: 'method not allowed' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    if (body.length > MAX_BODY_BYTES) return res.status(413).json({ error: 'payload too large' });
    try { body = JSON.parse(body); } catch { return res.status(400).json({ error: 'invalid json' }); }
  }
  if (!body || typeof body !== 'object') return res.status(400).json({ error: 'body required' });
  try {
    if (JSON.stringify(body).length > MAX_BODY_BYTES) return res.status(413).json({ error: 'payload too large' });
  } catch { return res.status(400).json({ error: 'invalid body' }); }

  const kind = body.kind;
  if (!RATE_LIMITS[kind]) return res.status(400).json({ error: 'unknown kind' });

  const ip = (req.headers?.['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  if (rateLimited(ip, kind)) return res.status(429).json({ error: 'rate limited' });

  const sessionId = str(body.session_id, 64);
  if (!sessionId || !SESSION_ID_RE.test(sessionId)) return res.status(400).json({ error: 'invalid session_id' });

  if (body.event !== 'signup_completed' && isAutomated(req, body)) return res.status(204).end();

  // Without the service key we accept and drop — analytics never breaks the UI.
  if (!SUPABASE_URL || !SERVICE_KEY) {
    if (body.event === 'signup_completed' || kind === 'team_enquiry') return res.status(503).json({ error: 'tracking unavailable' });
    return res.status(204).end();
  }
  const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  try {
    if (kind === 'ping') {
      const geo = geoFromHeaders(req.headers || {});
      const { error } = await sb.from('live_pings').upsert(
        { session_id: sessionId, ...geo, created_at: new Date().toISOString() },
        { onConflict: 'session_id' },
      );
      if (error) throw error;
      return res.status(204).end();
    }

    if (kind === 'event') {
      const event = str(body.event, 64);
      if (!event || !EVENT_ALLOWLIST.has(event)) return res.status(400).json({ error: 'unknown event' });
      let props = null;
      if (body.props && typeof body.props === 'object') {
        const s = JSON.stringify(body.props);
        if (s.length > MAX_PROPS_BYTES) return res.status(413).json({ error: 'props too large' });
        if (jsonDepth(body.props) > MAX_PROPS_DEPTH) return res.status(400).json({ error: 'props too deep' });
        props = Object.keys(body.props).length ? body.props : null;
      }
      if (event === 'signup_completed') {
        const user = await resolveUser(req, sb);
        const confirmedAt = user?.email_confirmed_at || user?.confirmed_at;
        if (!user?.id || !confirmedAt || !Number.isFinite(Date.parse(confirmedAt))) {
          return res.status(401).json({ error: 'confirmed account required' });
        }
        // Preserve pre-existing random-id signup rows. New signup rows use the
        // account UUID as their event UUID, making concurrent tabs idempotent
        // through the existing primary key without deleting historical data.
        const existing = await sb.from('product_events').select('id')
          .eq('event', event).eq('user_id', user.id).limit(1);
        if (existing.error) throw existing.error;
        if (existing.data?.length) return res.status(204).end();
        const acquisition = user.user_metadata?.em_acquisition;
        const allowed = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'gclid', 'gbraid', 'wbraid', 'claim', 'referrer', 'landing_path', 'acquisition_session'];
        const firstTouch = {};
        // Metadata is untrusted analytics context, never an authorization claim.
        // For old accounts without signup-time metadata, don't attribute a new
        // sign-in campaign to their historical registration.
        if (acquisition && typeof acquisition === 'object') {
          for (const key of allowed) {
            const value = str(acquisition[key], 160);
            if (value) firstTouch[key] = value;
          }
        }
        const { error } = await sb.from('product_events').insert({
          id: user.id, user_id: user.id, session_id: sessionId, event,
          created_at: confirmedAt,
          props: { ...firstTouch, account_created_at: user.created_at },
        });
        if (error && error.code !== '23505') throw error;
        return res.status(204).end();
      }
      const userId = await resolveUserId(req, sb);
      const { error } = await sb.from('product_events').insert({ session_id: sessionId, user_id: userId, event, props });
      if (error) throw error;
      return res.status(204).end();
    }

    if (kind === 'search') {
      // Attribute the search to the signed-in user when a valid token is
      // present (search_events.user_id, added in migration 20260713000001) so
      // the dashboard can show which users search. Null for anonymous.
      const userId = await resolveUserId(req, sb);
      const { error } = await sb.from('search_events').insert({
        session_id: sessionId,
        user_id: userId,
        kind: str(body.search_kind, 32) || 'registry',
        province: str(body.province, 32),
        mode: str(body.mode, 32),
        query_len: num(body.query_len),
        // The term itself. query_len alone cannot say whether a miss was the
        // matcher's fault or the registry's — see the migration for the B.C.
        // searches that prompted this.
        query_text: searchTerm(body.query_text),
        result_count: num(body.result_count),
        // Allowlisted, like every other enum this endpoint accepts — the column
        // has a CHECK constraint and an unexpected value would fail the insert
        // and lose the event entirely.
        outcome: ['ok', 'empty', 'error'].includes(body.outcome) ? body.outcome : null,
      });
      if (error) throw error;
      return res.status(204).end();
    }

    if (kind === 'pageview') {
      const geo = geoFromHeaders(req.headers || {});
      const userId = await resolveUserId(req, sb);
      const base = {
        user_id: userId,
        session_id: sessionId,
        path: str(body.path, 300),
        referrer: str(body.referrer, 300),
        utm_source: str(body.utm_source, 200),
        utm_medium: str(body.utm_medium, 200),
        utm_campaign: str(body.utm_campaign, 200),
        device: body.device === 'mobile' ? 'mobile' : 'desktop',
      };
      const { error } = await sb.from('page_views').insert({ ...base, lat: geo.lat, lng: geo.lng, city: geo.city, country: geo.country });
      if (error) {
        // Older schema without geo columns — retry the base row.
        const { error: e2 } = await sb.from('page_views').insert(base);
        if (e2) throw e2;
      }
      return res.status(204).end();
    }

    if (kind === 'click') {
      const xPct = num(body.x_pct); const yPct = num(body.y_pct);
      if (xPct == null || yPct == null || xPct < 0 || xPct > 100 || yPct < 0 || yPct > 1000) {
        return res.status(400).json({ error: 'invalid coordinates' });
      }
      const { error } = await sb.from('landing_clicks').insert({
        session_id: sessionId,
        x_pct: xPct,
        y_pct: yPct,
        element: str(body.element, 120),
        viewport_w: num(body.viewport_w),
        page_h: num(body.page_h),
      });
      if (error) throw error;
      return res.status(204).end();
    }

    if (kind === 'lead') {
      const email = (str(body.email, 320) || '').trim().toLowerCase();
      if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'invalid email' });
      const { error } = await sb.from('leads').insert({
        session_id: sessionId,
        email,
        project_title: str(body.project_title, 200),
        captured_at: new Date().toISOString(),
      });
      if (error) throw error;
      return res.status(204).end();
    }

    if (kind === 'claim_request') {
      // "Tell us the project": a search that found nothing, sent to the owner
      // to look up by hand. Reported in the admin Feedback tab.
      const user = await resolveUser(req, sb);
      const email = (str(body.email, 320) || user?.email || '').trim().toLowerCase();
      if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'invalid email' });
      const queryText = (str(body.query_text, 200) || '').trim();
      if (!queryText) return res.status(400).json({ error: 'query required' });
      const province = (str(body.province, 16) || '').toLowerCase();
      if (!/^[a-z]{2}(-[a-z]{2})?$/.test(province)) return res.status(400).json({ error: 'invalid province' });
      const mode = str(body.mode, 32);
      const { error } = await sb.from('claim_search_requests').insert({
        email,
        query_text: queryText,
        province,
        mode: mode && /^[a-z_]+$/.test(mode) ? mode : null,
        note: (str(body.note, 1000) || '').trim() || null,
        session_id: sessionId,
        user_id: user?.id || null,
        user_agent: str(req.headers?.['user-agent'], 300),
      });
      // The same person asking for the same thing twice is one request.
      if (error && error.code !== '23505') throw error;
      return res.status(204).end();
    }

    if (kind === 'team_enquiry') {
      // A person is waiting on this one, so it answers with the enquiry id and
      // a signed upload URL per declared file instead of a silent 204.
      const email = (str(body.email, 320) || '').trim().toLowerCase();
      if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'invalid email' });
      const company = (str(body.company, 200) || '').trim();
      if (!company) return res.status(400).json({ error: 'company required' });
      const materials = Array.isArray(body.materials) ? [...new Set(body.materials.filter((m) => TEAM_MATERIALS.has(m)))] : [];
      const level = TEAM_LEVELS.has(body.service_level) ? body.service_level : null;
      const deadline = /^\d{4}-\d{2}-\d{2}$/.test(String(body.deadline || '')) ? body.deadline : null;
      const ref = str(body.ref, 40);
      const declared = teamFiles(body.files);
      const id = globalThis.crypto.randomUUID();
      const files = declared.map((f) => ({ name: f.name, size: f.size, type: f.type, path: `${id}/${f.file}` }));
      const { error } = await sb.from('team_enquiries').insert({
        id,
        name: (str(body.name, 200) || '').trim() || null,
        email,
        company,
        projects: (str(body.projects, 500) || '').trim() || null,
        materials,
        service_level: level,
        deadline,
        deadline_note: (str(body.deadline_note, 300) || '').trim() || null,
        message: (str(body.message, 3000) || '').trim() || null,
        files,
        ref: ref && /^[a-z0-9_-]+$/i.test(ref) ? ref : null,
        session_id: sessionId,
        user_agent: str(req.headers?.['user-agent'], 300),
      });
      if (error) throw error;
      const uploads = [];
      for (const f of files) {
        const { data, error: upErr } = await sb.storage.from(TEAM_BUCKET).createSignedUploadUrl(f.path);
        // The enquiry stands without its files; the form says which failed.
        uploads.push(upErr || !data?.signedUrl ? { name: f.name, url: null } : { name: f.name, url: data.signedUrl });
      }
      return res.status(200).json({ id, uploads });
    }

    return res.status(400).json({ error: 'unknown kind' });
  } catch (e) {
    if (process.env.NODE_ENV !== 'production') console.warn('[track] insert failed:', e?.message);
    // Sanitized: no upstream/database detail leaves the server.
    return res.status(502).json({ error: 'ingest failed' });
  }
}
