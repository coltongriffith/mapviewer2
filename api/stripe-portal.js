// Open the Stripe customer portal (manage/cancel subscription, update card,
// see invoices). POST with a Supabase bearer token → { url }.

import { createClient } from '@supabase/supabase-js';
import { applyCors, handleMethods, rateLimited } from './_lib/guard.js';
import { stripeRequest, stripeConfigured } from './_lib/stripe.js';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SITE_URL = process.env.SITE_URL || 'https://www.explorationmaps.com';

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
  if (handleMethods(req, res, ['POST'])) return;
  if (rateLimited(req, { max: 10, windowMs: 60_000, bucket: 'stripe-portal' })) {
    return res.status(429).json({ error: 'rate limited — slow down and try again' });
  }
  if (!stripeConfigured() || !SUPABASE_URL || !SERVICE_KEY) {
    return res.status(503).json({ error: 'Billing is not configured yet.' });
  }

  const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const user = await resolveUser(req, sb);
  if (!user) return res.status(401).json({ error: 'Sign in first.' });

  try {
    const { data: planRow } = await sb
      .from('user_plans').select('stripe_customer_id').eq('user_id', user.id).maybeSingle();
    if (!planRow?.stripe_customer_id) {
      return res.status(400).json({ error: 'No billing account yet — upgrade first.' });
    }
    const session = await stripeRequest('/billing_portal/sessions', {
      customer: planRow.stripe_customer_id,
      return_url: `${SITE_URL}/?billing=portal-return`,
    });
    return res.status(200).json({ url: session.url });
  } catch (e) {
    if (process.env.NODE_ENV !== 'production') console.warn('[stripe-portal]', e?.message);
    return res.status(502).json({ error: 'Could not open the billing portal. Please try again.' });
  }
}
