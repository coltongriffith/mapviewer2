// Verify a completed Checkout Session server-side.
//
// The client used to treat the bare `?billing=success` query parameter as
// proof of Pro: anyone could type it to see the congratulations banner, and a
// real customer whose webhook failed saw "Welcome to Pro" while their
// entitlement was still free. This endpoint asks Stripe what actually
// happened, so the UI can show confirmed / still-processing / failed honestly.
//
// GET /api/stripe-session?session_id=cs_... with a Supabase bearer token.
// → { status: 'paid' | 'processing' | 'unpaid', plan: 'pro' | 'free' }

import { createClient } from '@supabase/supabase-js';
import { applyCors, handleMethods, rateLimited } from './_lib/guard.js';
import { stripeRequest, stripeConfigured } from './_lib/stripe.js';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

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

export default async function handler(req, res) {
  applyCors(req, res);
  res.setHeader('Cache-Control', 'no-store');
  if (handleMethods(req, res, ['GET'])) return;
  if (rateLimited(req, { max: 30, windowMs: 60_000, bucket: 'stripe-session' })) {
    return res.status(429).json({ error: 'rate limited — slow down and try again' });
  }
  if (!stripeConfigured() || !SUPABASE_URL || !SERVICE_KEY) {
    return res.status(503).json({ error: 'Billing is not configured yet.' });
  }

  const sessionId = String(req.query?.session_id || '');
  // Stripe Checkout Session ids are cs_ / cs_test_ prefixed and opaque.
  if (!/^cs_[A-Za-z0-9_]{10,200}$/.test(sessionId)) {
    return res.status(400).json({ error: 'invalid session_id' });
  }

  const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const user = await resolveUser(req, sb);
  if (!user) return res.status(401).json({ error: 'Sign in first.' });

  try {
    const session = await stripeRequest(`/checkout/sessions/${sessionId}`, null, { method: 'GET' });
    // The session must belong to THIS user — otherwise a leaked/guessed id
    // could confirm someone else's purchase.
    if (session.client_reference_id && session.client_reference_id !== user.id) {
      return res.status(403).json({ error: 'This checkout session belongs to another account.' });
    }

    const paid = session.payment_status === 'paid' || session.payment_status === 'no_payment_required';

    // Cross-check the authoritative entitlement the webhook writes.
    const { data: planRow } = await sb
      .from('user_plans').select('plan').eq('user_id', user.id).maybeSingle();
    const plan = planRow?.plan === 'pro' ? 'pro' : 'free';

    // paid + plan not yet pro → the webhook hasn't landed. Tell the truth
    // ("processing") rather than claiming the upgrade is complete.
    return res.status(200).json({
      status: paid ? (plan === 'pro' ? 'paid' : 'processing') : 'unpaid',
      plan,
    });
  } catch (e) {
    console.error(JSON.stringify({
      at: 'stripe-session', outcome: 'failed',
      user_id: user.id, message: String(e?.message || e).slice(0, 200),
    }));
    return res.status(502).json({ error: 'Could not verify the checkout session.' });
  }
}
