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

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const EVENT_ALLOWLIST = new Set([
  'editor_opened',
  'first_layer_added',
  'export_completed',
  'export_gate_shown',
  'export_gate_signup_started',
  'share_created',
  'share_viewed',
  'share_forked',
  'signup_completed',
  'claim_intent',
  'mobile_editor_banner_shown',
  'onboarding_step',
  'onboarding_dismissed',
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
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);

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

async function resolveUserId(req, sb) {
  const auth = req.headers?.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token || token.length > 4096) return null;
  try {
    const { data, error } = await sb.auth.getUser(token);
    if (error) return null;
    return data?.user?.id || null;
  } catch {
    return null;
  }
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

  // Without the service key we accept and drop — analytics never breaks the UI.
  if (!SUPABASE_URL || !SERVICE_KEY) return res.status(204).end();
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
      const userId = await resolveUserId(req, sb);
      const { error } = await sb.from('product_events').insert({ session_id: sessionId, user_id: userId, event, props });
      if (error) throw error;
      return res.status(204).end();
    }

    if (kind === 'search') {
      const { error } = await sb.from('search_events').insert({
        session_id: sessionId,
        kind: str(body.search_kind, 32) || 'registry',
        province: str(body.province, 32),
        mode: str(body.mode, 32),
        query_len: num(body.query_len),
        result_count: num(body.result_count),
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

    return res.status(400).json({ error: 'unknown kind' });
  } catch (e) {
    if (process.env.NODE_ENV !== 'production') console.warn('[track] insert failed:', e?.message);
    // Sanitized: no upstream/database detail leaves the server.
    return res.status(502).json({ error: 'ingest failed' });
  }
}
