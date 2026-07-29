// First-party error sink (audit P1-12).
//
// Before this, a failure in billing, export, import, sharing or the registry
// surfaced only in the user's console — we found out when a customer told us.
// The client posts here; rows land in public.error_events and are grouped by
// fingerprint so one broken deploy reads as one entry rather than thousands.
//
// Deliberately permissive about failing: telemetry must never break the app,
// so every error path answers 204 and drops the report.

import { createClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';
import { applyCors, handleMethods, rateLimited } from './_lib/guard.js';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const MAX_MESSAGE = 500;
const MAX_STACK = 4000;

// Strip anything that looks like a secret or personal identifier before the
// report is stored. Stack traces and messages routinely contain URLs with
// tokens in the query string.
function redact(text) {
  if (!text) return null;
  return String(text)
    .replace(/(access_token|refresh_token|api[-_]?key|apikey|password|secret|authorization|bearer)=[^&\s"']+/gi, '$1=[redacted]')
    .replace(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, '[jwt]')
    .replace(/\b(sk|pk|rk|whsec)_[A-Za-z0-9]{10,}/g, '[key]')
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '[email]');
}

// Group identical faults: same kind + normalized message + top stack frame.
// Numbers, hashes and urls are stripped so "chunk-a1b2.js" and "chunk-c3d4.js"
// do not look like different bugs.
function fingerprint({ kind, message, stack, path }) {
  const norm = (s) => String(s || '')
    .replace(/https?:\/\/[^\s)]+/g, '')
    .replace(/[0-9a-f]{8,}/gi, '')
    .replace(/\d+/g, '')
    .slice(0, 200);
  const topFrame = String(stack || '').split('\n').find((l) => /at |@/.test(l)) || '';
  return crypto.createHash('sha256')
    .update([kind, norm(message), norm(topFrame), norm(path)].join('|'))
    .digest('hex')
    .slice(0, 32);
}

export default async function handler(req, res) {
  applyCors(req, res);
  res.setHeader('Cache-Control', 'no-store');
  if (handleMethods(req, res, ['POST'])) return;

  // A page in a crash loop must not become a self-inflicted DoS.
  if (rateLimited(req, { max: 20, windowMs: 60_000, bucket: 'client-error' })) {
    return res.status(204).end();
  }
  if (!SUPABASE_URL || !SERVICE_KEY) return res.status(204).end();

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const kind = ['error', 'unhandledrejection', 'react', 'api'].includes(body.kind) ? body.kind : 'error';
    const message = redact(body.message)?.slice(0, MAX_MESSAGE);
    if (!message) return res.status(204).end();

    const stack = redact(body.stack)?.slice(0, MAX_STACK) || null;
    const path = String(body.path || '').slice(0, 300) || null;
    const release = String(body.release || '').slice(0, 60) || null;
    const sessionId = String(body.sessionId || '').slice(0, 100) || null;

    // Identity comes from a verified token, never from the request body.
    const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
    let userId = null;
    const auth = req.headers?.authorization || '';
    if (auth.startsWith('Bearer ')) {
      const { data } = await sb.auth.getUser(auth.slice(7)).catch(() => ({ data: null }));
      userId = data?.user?.id || null;
    }

    const fp = fingerprint({ kind, message, stack, path });

    // Collapse repeats within a 10-minute window instead of writing a row per
    // occurrence — a render loop can emit thousands per minute.
    const since = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const { data: existing } = await sb.from('error_events')
      .select('id, seen_count')
      .eq('fingerprint', fp)
      .gte('occurred_at', since)
      .order('occurred_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existing) {
      await sb.from('error_events')
        .update({ seen_count: (existing.seen_count || 1) + 1 })
        .eq('id', existing.id);
    } else {
      await sb.from('error_events').insert({
        source: 'client',
        kind,
        message,
        stack,
        path,
        release,
        session_id: sessionId,
        user_id: userId,
        user_agent: String(req.headers?.['user-agent'] || '').slice(0, 300),
        context: body.context && typeof body.context === 'object' ? body.context : null,
        fingerprint: fp,
      });
    }
    return res.status(204).end();
  } catch {
    // Never surface telemetry failures to the app.
    return res.status(204).end();
  }
}
