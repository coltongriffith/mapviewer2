// In-app feedback and issue reports.
//
// The error sink (api/client-error.js) records what the code saw; this records
// what the user saw. Unlike telemetry it is NOT fire-and-forget: the user is
// waiting to hear whether their report went through, so validation failures
// answer 400 and a storage failure answers 500 rather than a silent 204.
//
// Rows land in public.feedback (migration 20260910000001), which emails the
// owner via a trigger and is triaged in Admin → Feedback.

import { createClient } from '@supabase/supabase-js';
import { applyCors, handleMethods, rateLimited, rateLimitedShared } from './_lib/guard.js';
import { redact } from './_lib/redact.js';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const KINDS = new Set(['bug', 'feedback', 'idea']);
const MIN_MESSAGE = 3;
const MAX_MESSAGE = 4000;
const MAX_EMAIL = 200;
const MAX_BODY_BYTES = 24 * 1024;
const MAX_CONTEXT_BYTES = 6 * 1024;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Diagnostics the client attaches (recent errors, viewport, crash message).
// Redacted like error reports, because the recent-error messages are the same
// strings the error sink receives, and bounded so a caller cannot use the
// field to store arbitrary blobs.
function boundedContext(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  try {
    const text = redact(JSON.stringify(value));
    if (text.length > MAX_CONTEXT_BYTES) return { truncated: true };
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  applyCors(req, res);
  res.setHeader('Cache-Control', 'no-store');
  if (handleMethods(req, res, ['POST'])) return;

  if (rateLimited(req, { max: 10, windowMs: 10 * 60_000, bucket: 'feedback' })) {
    return res.status(429).json({ error: 'Too many reports from this address. Please try again in a few minutes.' });
  }
  if (!SUPABASE_URL || !SERVICE_KEY) {
    return res.status(503).json({ error: 'Feedback is not configured on this deployment.' });
  }

  let body;
  try {
    const raw = req.body;
    if (typeof raw === 'string' && raw.length > MAX_BODY_BYTES) {
      return res.status(413).json({ error: 'Report too large.' });
    }
    body = typeof raw === 'string' ? JSON.parse(raw) : (raw || {});
    if (JSON.stringify(body).length > MAX_BODY_BYTES) {
      return res.status(413).json({ error: 'Report too large.' });
    }
  } catch {
    return res.status(400).json({ error: 'Invalid JSON body.' });
  }

  const kind = KINDS.has(body.kind) ? body.kind : 'feedback';
  const message = String(body.message || '').trim();
  if (message.length < MIN_MESSAGE) {
    return res.status(400).json({ error: 'Please tell us what happened (a few words is fine).' });
  }
  if (message.length > MAX_MESSAGE) {
    return res.status(400).json({ error: `Message is too long (max ${MAX_MESSAGE} characters).` });
  }
  const email = String(body.email || '').trim().slice(0, MAX_EMAIL) || null;
  if (email && !EMAIL_RE.test(email)) {
    return res.status(400).json({ error: 'That email address doesn’t look right.' });
  }

  const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  if (await rateLimitedShared(sb, req, { max: 20, windowSeconds: 3600, bucket: 'feedback' })) {
    return res.status(429).json({ error: 'Too many reports from this address. Please try again later.' });
  }

  // Identity comes from a verified token, never from the request body.
  let userId = null;
  const auth = req.headers?.authorization || '';
  if (auth.startsWith('Bearer ')) {
    const { data } = await sb.auth.getUser(auth.slice(7)).catch(() => ({ data: null }));
    userId = data?.user?.id || null;
  }

  const row = {
    kind,
    message,
    // A signed-in user is reachable via user_id; only keep a typed address
    // for signed-out reports so there is one source of truth for contact.
    email: userId ? null : email,
    path: String(body.path || '').slice(0, 300) || null,
    release: String(body.release || '').slice(0, 60) || null,
    session_id: String(body.sessionId || '').slice(0, 100) || null,
    user_id: userId,
    user_agent: String(req.headers?.['user-agent'] || '').slice(0, 300) || null,
    context: boundedContext(body.context),
  };

  const { data, error } = await sb.from('feedback').insert(row).select('id').single();
  if (error) {
    console.error(JSON.stringify({ level: 'error', scope: 'feedback', message: error.message, code: error.code }));
    return res.status(500).json({ error: 'Couldn’t save your report. Please try again, or email support@explorationmaps.com.' });
  }
  return res.status(200).json({ ok: true, id: data?.id || null });
}
