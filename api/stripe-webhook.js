// Stripe webhook — the single writer that syncs subscription state into
// public.user_plans. Configure in the Stripe dashboard:
//   endpoint: https://www.explorationmaps.com/api/stripe-webhook
//   events:   checkout.session.completed,
//             customer.subscription.updated, customer.subscription.deleted
//
// INVARIANT: rows with source='grandfathered' are NEVER downgraded here.
// Grandfathered accounts keep full Pro access no matter what Stripe says —
// every downgrade path below is scoped to source='stripe' rows only.

import { createClient } from '@supabase/supabase-js';
import { verifyStripeSignature } from './_lib/stripe.js';

// Signature verification needs the exact raw bytes Stripe sent — disable the
// framework body parser and buffer the stream ourselves.
export const config = { api: { bodyParser: false } };

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function rawBody(req) {
  if (typeof req.body === 'string') return req.body;           // parser disabled but populated
  if (Buffer.isBuffer(req.body)) return req.body.toString('utf8');
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

// Stripe subscription status → our plan/status columns.
// past_due keeps Pro access (payment grace period, matches Stripe defaults);
// terminal states downgrade — but only ever for source='stripe' rows.
function mapSubscription(sub) {
  const status = sub?.status || 'canceled';
  if (status === 'active' || status === 'trialing') return { plan: 'pro', status };
  if (status === 'past_due') return { plan: 'pro', status: 'past_due' };
  return { plan: 'free', status: 'canceled' };
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method not allowed' });
  }
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret || !SUPABASE_URL || !SERVICE_KEY) {
    return res.status(503).json({ error: 'not configured' });
  }

  let body;
  try {
    body = await rawBody(req);
  } catch {
    return res.status(400).json({ error: 'unreadable body' });
  }
  if (!body || body.length > 512 * 1024) return res.status(400).json({ error: 'bad body' });

  if (!verifyStripeSignature(body, req.headers['stripe-signature'], secret)) {
    return res.status(400).json({ error: 'invalid signature' });
  }

  let event;
  try {
    event = JSON.parse(body);
  } catch {
    return res.status(400).json({ error: 'bad json' });
  }

  const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  try {
    if (event.type === 'checkout.session.completed') {
      const session = event.data?.object || {};
      const userId = session.client_reference_id || null;
      if (userId && session.mode === 'subscription') {
        // Upgrade is always safe to apply regardless of source.
        await sb.from('user_plans').upsert({
          user_id: userId,
          plan: 'pro',
          status: 'active',
          source: 'stripe',
          stripe_customer_id: session.customer || null,
          stripe_subscription_id: session.subscription || null,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id' });
      }
    } else if (event.type === 'customer.subscription.updated'
      || event.type === 'customer.subscription.deleted') {
      const sub = event.data?.object || {};
      const mapped = event.type === 'customer.subscription.deleted'
        ? { plan: 'free', status: 'canceled' }
        : mapSubscription(sub);
      const periodEnd = sub.current_period_end
        ? new Date(sub.current_period_end * 1000).toISOString()
        : null;

      const userId = sub.metadata?.supabase_user_id || null;
      const match = userId
        ? { column: 'user_id', value: userId }
        : { column: 'stripe_customer_id', value: sub.customer };
      if (!match.value) return res.status(200).json({ received: true, skipped: 'no user match' });

      if (mapped.plan === 'pro') {
        await sb.from('user_plans')
          .update({
            plan: 'pro',
            status: mapped.status,
            source: 'stripe',
            stripe_subscription_id: sub.id || null,
            current_period_end: periodEnd,
            updated_at: new Date().toISOString(),
          })
          .eq(match.column, match.value);
      } else {
        // Downgrade path — NEVER touches grandfathered (or admin-granted)
        // rows. Only subscriptions we created may be revoked.
        await sb.from('user_plans')
          .update({
            plan: 'free',
            status: 'canceled',
            current_period_end: periodEnd,
            updated_at: new Date().toISOString(),
          })
          .eq(match.column, match.value)
          .eq('source', 'stripe');
      }
    }
    // Unhandled event types are acknowledged so Stripe stops retrying them.
    return res.status(200).json({ received: true });
  } catch (e) {
    if (process.env.NODE_ENV !== 'production') console.warn('[stripe-webhook]', e?.message);
    // 500 → Stripe retries with backoff, which is what we want on a DB blip.
    return res.status(500).json({ error: 'processing failed' });
  }
}
