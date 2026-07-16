// Create a Stripe Checkout session for the Pro subscription.
// POST { interval: 'month' | 'year' } with a Supabase bearer token.
// Returns { url } — the client redirects there; Stripe hosts the payment
// page, so no card data ever touches this app.

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
  if (rateLimited(req, { max: 10, windowMs: 60_000, bucket: 'stripe-checkout' })) {
    return res.status(429).json({ error: 'rate limited — slow down and try again' });
  }
  if (!stripeConfigured() || !SUPABASE_URL || !SERVICE_KEY) {
    return res.status(503).json({ error: 'Billing is not configured yet.' });
  }

  const priceId = (req.body?.interval === 'year')
    ? process.env.STRIPE_PRICE_YEARLY_ID
    : process.env.STRIPE_PRICE_MONTHLY_ID;
  if (!priceId) return res.status(503).json({ error: 'Billing is not configured yet.' });

  const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const user = await resolveUser(req, sb);
  if (!user) return res.status(401).json({ error: 'Sign in to upgrade.' });

  try {
    // Reuse the user's Stripe customer if they have one; create + persist
    // otherwise so future portal/checkout calls hit the same customer.
    const { data: planRow } = await sb
      .from('user_plans').select('stripe_customer_id, plan, source').eq('user_id', user.id).maybeSingle();

    let customerId = planRow?.stripe_customer_id || null;
    if (!customerId) {
      const customer = await stripeRequest('/customers', {
        email: user.email,
        metadata: { supabase_user_id: user.id },
      });
      customerId = customer.id;
      await sb.from('user_plans').upsert(
        { user_id: user.id, stripe_customer_id: customerId, updated_at: new Date().toISOString() },
        { onConflict: 'user_id' },
      );
    }

    const session = await stripeRequest('/checkout/sessions', {
      mode: 'subscription',
      customer: customerId,
      client_reference_id: user.id,
      line_items: [{ price: priceId, quantity: 1 }],
      subscription_data: { metadata: { supabase_user_id: user.id } },
      allow_promotion_codes: 'true',
      success_url: `${SITE_URL}/?billing=success`,
      cancel_url: `${SITE_URL}/?billing=cancelled`,
    });
    return res.status(200).json({ url: session.url });
  } catch (e) {
    if (process.env.NODE_ENV !== 'production') console.warn('[stripe-checkout]', e?.message);
    return res.status(502).json({ error: 'Could not start checkout. Please try again.' });
  }
}
