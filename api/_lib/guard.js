// Shared request-hardening helpers for the public API endpoints.

const ALLOWED_ORIGINS = new Set([
  'https://explorationmaps.com',
  'https://www.explorationmaps.com',
  'http://localhost:5173',
  'http://localhost:4173',
  'http://127.0.0.1:5173',
]);

/**
 * Restrict CORS to the real deployment + local dev instead of `*`.
 * Same-origin production requests carry no Origin header and need none.
 * Returns true when the request may proceed (it always may — CORS is a
 * browser-side gate; we just stop advertising cross-origin availability).
 */
export function applyCors(req, res) {
  const origin = req.headers?.origin;
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
}

/** Method gate with proper OPTIONS handling. Returns true when handled. */
export function handleMethods(req, res, allowed = ['GET']) {
  const allowHeader = [...allowed, 'OPTIONS'].join(', ');
  if (req.method === 'OPTIONS') {
    res.setHeader('Allow', allowHeader);
    res.setHeader('Access-Control-Allow-Methods', allowHeader);
    res.setHeader('Access-Control-Allow-Headers', 'content-type');
    res.status(204).end();
    return true;
  }
  if (!allowed.includes(req.method)) {
    res.setHeader('Allow', allowHeader);
    res.status(405).json({ error: 'method not allowed' });
    return true;
  }
  return false;
}

/** Total query-string budget so no parameter smuggles unbounded input. */
export function queryTooLong(req, max = 2048) {
  try {
    const qs = req.url?.split('?')[1] || '';
    return qs.length > max;
  } catch {
    return false;
  }
}

const MAX_TERM_LENGTH = 120;

/** Company/claim-number search term validation. → {ok, term?|error?} */
export function validateTerm(raw) {
  if (!raw || typeof raw !== 'string') return { ok: false, error: 'q param required (min 2 chars)' };
  const term = raw.trim();
  if (term.length < 2) return { ok: false, error: 'q param required (min 2 chars)' };
  if (term.length > MAX_TERM_LENGTH) return { ok: false, error: `Search term too long (max ${MAX_TERM_LENGTH} characters).` };
  return { ok: true, term };
}

const MAX_BBOX_DEG_AREA = 50; // ≈ a 700 km × 550 km window at BC latitudes

/** bbox validation: shape, bounds, ordering, and area cap. */
export function validateBbox(raw) {
  const parts = String(raw).split(',').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
    return { ok: false, error: 'bbox must be minLng,minLat,maxLng,maxLat' };
  }
  const [minLng, minLat, maxLng, maxLat] = parts;
  if (minLng < -180 || maxLng > 180 || minLat < -90 || maxLat > 90) {
    return { ok: false, error: 'bbox coordinates out of range' };
  }
  if (minLng >= maxLng || minLat >= maxLat) {
    return { ok: false, error: 'bbox min values must be smaller than max values' };
  }
  const area = (maxLng - minLng) * (maxLat - minLat);
  if (area > MAX_BBOX_DEG_AREA) {
    return { ok: false, error: 'bbox area too large — zoom in or reduce the search radius' };
  }
  return { ok: true, bbox: parts };
}

// Best-effort per-instance rate limiting (same approach as /api/track).
const buckets = new Map();
export function rateLimited(req, { max = 30, windowMs = 60_000, bucket = 'claims' } = {}) {
  const ip = (req.headers?.['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  const key = `${bucket}:${ip}`;
  const now = Date.now();
  let b = buckets.get(key);
  if (!b || now > b.resetAt) {
    b = { count: 0, resetAt: now + windowMs };
    buckets.set(key, b);
  }
  b.count += 1;
  if (buckets.size > 5000) {
    for (const [k, v] of buckets) { if (now > v.resetAt) buckets.delete(k); }
  }
  return b.count > max;
}

/**
 * Diagnostic modes (schema=raw / schema=1) expose upstream layer metadata and
 * timing — reconnaissance surface. In production they require the server-side
 * ADMIN_API_SECRET via the x-admin-secret header; outside production they
 * stay open for local debugging.
 */
export function diagnosticsAllowed(req) {
  if (process.env.NODE_ENV !== 'production') return true;
  const secret = process.env.ADMIN_API_SECRET;
  return Boolean(secret) && req.headers?.['x-admin-secret'] === secret;
}

/**
 * Error sanitizer: upstream registry bodies/messages never reach production
 * clients; full detail is logged server-side outside production.
 */
export function publicErrorMessage(e, fallback) {
  const msg = String(e?.message || e || '');
  if (process.env.NODE_ENV !== 'production') {
    return msg || fallback;
  }
  // Allow through our own user-facing phrasings; block raw upstream bodies.
  if (/registry|temporarily unavailable|try again|not available|not supported|not set up/i.test(msg) && msg.length < 200) {
    return msg;
  }
  return fallback;
}
