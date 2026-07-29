#!/usr/bin/env node
//
// Go-live preflight for Stripe billing.
//
// Run this on YOUR machine (it needs outbound access to api.stripe.com and
// your live secret key, neither of which a CI or sandbox environment has).
//
//   STRIPE_SECRET_KEY=sk_live_... node scripts/stripe-golive.mjs
//   STRIPE_SECRET_KEY=sk_live_... node scripts/stripe-golive.mjs --fix
//
// Without --fix it only reports. With --fix it will add missing webhook
// events to the endpoint. It never creates prices, never deletes anything,
// and never prints your secret key.
//
// What it checks, in the order things actually break:
//   1. the key works, and which account + mode it belongs to
//   2. the configured price IDs exist ON THAT ACCOUNT, are active, recurring,
//      and priced as the app advertises
//   3. a webhook endpoint points at production and subscribes to every event
//      api/stripe-webhook.js actually handles
//   4. the customer portal is configured
//
// The mismatch this exists to catch: a secret key from one account/mode with
// price IDs from another. Stripe answers "No such price", the app surfaces a
// generic "Could not start checkout", and nothing says why.

const KEY = process.env.STRIPE_SECRET_KEY;
const FIX = process.argv.includes('--fix');
const API = 'https://api.stripe.com/v1';
const API_VERSION = '2024-06-20'; // must match api/_lib/stripe.js

// Every event api/stripe-webhook.js branches on.
const REQUIRED_EVENTS = [
  'checkout.session.completed',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'invoice.finalized',
  'invoice.sent',
  'invoice.paid',
  'invoice.payment_succeeded',
  'invoice.payment_failed',
  'invoice.updated',
  'invoice.overdue',
  'invoice.voided',
  'invoice.marked_uncollectible',
  'credit_note.created',
  'charge.refunded',
];

const EXPECTED = {
  monthly: { env: 'STRIPE_PRICE_MONTHLY_ID', amount: 2900, interval: 'month' },
  yearly: { env: 'STRIPE_PRICE_YEARLY_ID', amount: 29000, interval: 'year' },
};

const ok = (m) => console.log(`  [32m✓[0m ${m}`);
const bad = (m) => console.log(`  [31m✗[0m ${m}`);
const warn = (m) => console.log(`  [33m![0m ${m}`);
const head = (m) => console.log(`\n${m}`);

let failures = 0;
const fail = (m) => { bad(m); failures += 1; };

async function stripe(path, { method = 'GET', form } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${KEY}`,
      'Stripe-Version': API_VERSION,
      ...(form ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
    },
    body: form,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(json?.error?.message || `HTTP ${res.status}`);
    err.code = json?.error?.code;
    throw err;
  }
  return json;
}

if (!KEY) {
  console.error('STRIPE_SECRET_KEY is not set.\n');
  console.error('  STRIPE_SECRET_KEY=sk_live_... node scripts/stripe-golive.mjs');
  process.exit(2);
}

const MODE = KEY.startsWith('sk_live_') ? 'live' : KEY.startsWith('sk_test_') ? 'test' : 'unknown';

// ── 1. Account ──────────────────────────────────────────────────────────────
head(`Account (${MODE} mode)`);
let account;
try {
  account = await stripe('/account');
  ok(`${account.settings?.dashboard?.display_name || account.id} — ${account.id}`);
} catch (e) {
  fail(`key rejected: ${e.message}`);
  console.log('\nNothing else can be checked without a working key.');
  process.exit(1);
}
if (MODE === 'unknown') warn('key prefix is neither sk_live_ nor sk_test_');

// ── 2. Prices ───────────────────────────────────────────────────────────────
head('Prices');
for (const [label, spec] of Object.entries(EXPECTED)) {
  const id = process.env[spec.env];
  if (!id) { fail(`${spec.env} is not set in this shell`); continue; }
  try {
    const price = await stripe(`/prices/${id}`);
    const parts = [];
    if (!price.active) parts.push('INACTIVE');
    if (price.recurring?.interval !== spec.interval) parts.push(`interval=${price.recurring?.interval} (expected ${spec.interval})`);
    if (price.unit_amount !== spec.amount) parts.push(`amount=${price.unit_amount} (app advertises ${spec.amount})`);
    if (parts.length) fail(`${label}: ${id} — ${parts.join(', ')}`);
    else ok(`${label}: ${id} — $${(price.unit_amount / 100).toFixed(2)}/${spec.interval}, active`);
  } catch (e) {
    // This is THE failure mode: key and price belong to different accounts
    // or different modes.
    fail(`${label}: ${id} not found on ${account.id} in ${MODE} mode — ${e.message}`);
    warn('  the secret key and this price ID are from different accounts or modes');
  }
}

// ── 3. Webhook endpoints ────────────────────────────────────────────────────
head('Webhook');
const endpoints = await stripe('/webhook_endpoints?limit=100');
const ours = (endpoints.data || []).filter((e) => /\/api\/stripe-webhook$/.test(e.url || ''));

if (ours.length === 0) {
  fail('no endpoint points at /api/stripe-webhook on this account/mode');
  warn('  create one at: <your site>/api/stripe-webhook');
} else {
  for (const ep of ours) {
    console.log(`  ${ep.url}  (${ep.id}, ${ep.status})`);
    if (ep.status !== 'enabled') fail(`  endpoint is ${ep.status}`);

    const enabled = new Set(ep.enabled_events || []);
    const wildcard = enabled.has('*');
    const missing = wildcard ? [] : REQUIRED_EVENTS.filter((e) => !enabled.has(e));

    if (missing.length === 0) {
      ok('  subscribes to every event the webhook handles');
    } else if (!FIX) {
      fail(`  missing ${missing.length} event(s): ${missing.join(', ')}`);
      warn('  re-run with --fix to add them');
    } else {
      const merged = [...new Set([...(ep.enabled_events || []), ...REQUIRED_EVENTS])];
      const form = new URLSearchParams();
      merged.forEach((e, i) => form.append(`enabled_events[${i}]`, e));
      try {
        await stripe(`/webhook_endpoints/${ep.id}`, { method: 'POST', form });
        ok(`  added ${missing.length} missing event(s)`);
      } catch (e) {
        fail(`  could not update endpoint: ${e.message}`);
      }
    }
  }
}

// ── 4. Customer portal ──────────────────────────────────────────────────────
head('Customer portal');
try {
  const configs = await stripe('/billing_portal/configurations?limit=10');
  const active = (configs.data || []).filter((c) => c.active);
  if (active.length === 0) {
    fail('no active portal configuration — cancellation and card updates will fail');
    warn('  Dashboard → Settings → Billing → Customer portal');
  } else {
    const c = active[0];
    ok(`configured (${c.id})`);
    if (!c.features?.subscription_cancel?.enabled) {
      fail('  cancellation is NOT enabled — the published refund policy promises self-serve cancel');
    } else {
      ok('  cancellation enabled');
    }
    if (!c.features?.payment_method_update?.enabled) {
      warn('  payment-method update is disabled');
    }
  }
} catch (e) {
  warn(`could not read portal configuration: ${e.message}`);
}

// ── Summary ─────────────────────────────────────────────────────────────────
console.log('');
if (failures === 0) {
  console.log('[32mReady.[0m Set the same four values in Vercel (Production) and redeploy:');
  console.log('  STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_PRICE_MONTHLY_ID, STRIPE_PRICE_YEARLY_ID');
  console.log('\nThen: new account → upgrade → confirm user_plans flips to pro/active/stripe.');
} else {
  console.log(`[31m${failures} problem(s) found.[0m Fix these before taking a payment.`);
  process.exit(1);
}
