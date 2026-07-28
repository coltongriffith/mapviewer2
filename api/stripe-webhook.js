// Stripe webhook — the single writer that syncs subscription state into
// public.user_plans, and one-off Invoicing state into public.custom_invoices.
// Configure in the Stripe dashboard:
//   endpoint: https://www.explorationmaps.com/api/stripe-webhook
//   events:   checkout.session.completed,
//             customer.subscription.updated, customer.subscription.deleted,
//             invoice.paid, invoice.payment_failed, invoice.voided,
//             invoice.marked_uncollectible, credit_note.created,
//             charge.refunded
//
// INVARIANT: rows with source='grandfathered' are NEVER downgraded here.
// Grandfathered accounts keep full Pro access no matter what Stripe says —
// every downgrade path below is scoped to source='stripe' rows only.
//
// Invoicing events only ever touch custom_invoices, never user_plans: a
// standalone invoice (created by hand in the Dashboard for bespoke work) is
// identified by having no `subscription` — invoice events that DO carry a
// subscription id are subscription-renewal invoices, already covered by the
// customer.subscription.* handling above, and are ignored here.

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

// Standalone (Dashboard-created) invoice → public.custom_invoices. Never
// runs for subscription invoices (those carry an `invoice.subscription`).
async function syncCustomInvoice(sb, invoice, status) {
  if (!invoice?.id || invoice.subscription) return;
  let userId = invoice.metadata?.supabase_user_id || null;
  if (!userId && invoice.customer) {
    const { data } = await sb.from('user_plans')
      .select('user_id').eq('stripe_customer_id', invoice.customer).maybeSingle();
    userId = data?.user_id || null;
  }
  await sb.from('custom_invoices').upsert({
    stripe_invoice_id: invoice.id,
    user_id: userId,
    stripe_customer_id: invoice.customer || null,
    status,
    amount_due: invoice.amount_due ?? 0,
    amount_paid: invoice.amount_paid ?? 0,
    currency: invoice.currency || 'usd',
    description: invoice.description || null,
    number: invoice.number || null,
    hosted_invoice_url: invoice.hosted_invoice_url || null,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'stripe_invoice_id' });
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
    } else if (event.type === 'invoice.paid') {
      await syncCustomInvoice(sb, event.data?.object, 'paid');
    } else if (event.type === 'invoice.payment_failed') {
      await syncCustomInvoice(sb, event.data?.object, 'payment_failed');
    } else if (event.type === 'invoice.voided') {
      await syncCustomInvoice(sb, event.data?.object, 'void');
    } else if (event.type === 'invoice.marked_uncollectible') {
      await syncCustomInvoice(sb, event.data?.object, 'uncollectible');
    } else if (event.type === 'credit_note.created') {
      // Credit notes reference the invoice they were issued against; only
      // updates a row we already track (no-op if it's a subscription invoice).
      const note = event.data?.object || {};
      if (note.invoice) {
        await sb.from('custom_invoices')
          .update({ status: 'credited', updated_at: new Date().toISOString() })
          .eq('stripe_invoice_id', note.invoice);
      }
    } else if (event.type === 'charge.refunded') {
      const charge = event.data?.object || {};
      if (charge.invoice) {
        await sb.from('custom_invoices')
          .update({ status: 'refunded', updated_at: new Date().toISOString() })
          .eq('stripe_invoice_id', charge.invoice);
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
