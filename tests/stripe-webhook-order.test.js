// @vitest-environment node
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import crypto from 'node:crypto';

// Regression tests for the subscription state machine under Stripe's real
// delivery guarantees: events arrive out of order, are retried for days, and a
// handler can die between claiming an event and applying it. See
// docs/state-machines.md (Billing, BILL-1..3).

const db = vi.hoisted(() => ({ plans: new Map(), events: new Map() }));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ from(table) {
  let action, values, columns, filters = [];
  const chain = {
    select: value => { action = 'select'; columns = value.split(',').map(s => s.trim()); return chain; },
    insert: value => { action = 'insert'; values = value; return chain; },
    upsert: value => { action = 'upsert'; values = value; return chain; },
    update: value => { action = 'update'; values = value; return chain; },
    delete: () => { action = 'delete'; return chain; },
    eq: (key, value) => { filters.push([key, value]); return chain; },
    maybeSingle: () => chain,
    then(resolve) {
      const store = table === 'stripe_events' ? db.events : db.plans;
      const key = table === 'stripe_events' ? 'event_id' : 'user_id';
      const rows = [...store.values()].filter(row => filters.every(([k, v]) => row[k] === v));
      if (action === 'insert') {
        if (store.has(values[key])) return resolve({ data: null, error: { code: '23505' } });
        store.set(values[key], { ...values });
      } else if (action === 'select') {
        const row = rows[0];
        return resolve({ data: row ? Object.fromEntries(columns.map(c => [c, row[c]])) : null, error: null });
      } else if (action === 'upsert') store.set(values[key], { ...store.get(values[key]), ...values });
      else if (action === 'update') for (const row of rows) Object.assign(row, values);
      else if (action === 'delete') for (const row of rows) store.delete(row[key]);
      return resolve({ data: null, error: null });
    },
  };
  return chain;
} }) }));

// Stripe's live subscriptions, as GET /v1/subscriptions/:id would return them.
let live;
const secret = 'whsec_order_test';
let sequence;
beforeEach(() => {
  db.plans.clear(); db.events.clear(); sequence = 0;
  live = new Map();
  db.plans.set('u1', { user_id: 'u1', plan: 'free', status: 'active', source: 'signup', stripe_customer_id: 'cus_1' });
  vi.resetModules();
  vi.stubEnv('SUPABASE_URL', 'https://test.supabase.co');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-test-key');
  vi.stubEnv('STRIPE_WEBHOOK_SECRET', secret);
  vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_order');
  vi.stubGlobal('fetch', vi.fn(async (url) => {
    const id = decodeURIComponent(String(url).split('/subscriptions/')[1] || '');
    const sub = live.get(id);
    return { ok: Boolean(sub), status: sub ? 200 : 404, json: async () => sub || { error: { message: 'No such subscription' } } };
  }));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const sub = (id, status, extra = {}) => ({
  id, customer: 'cus_1', status, metadata: { supabase_user_id: 'u1' },
  items: { data: [{ current_period_end: 1795000000, price: { recurring: { interval: 'month' } } }] },
  ...extra,
});
const updated = (s) => ({ type: 'customer.subscription.updated', data: { object: s } });
const deleted = (s) => ({ type: 'customer.subscription.deleted', data: { object: s } });
const checkout = (subscription) => ({ type: 'checkout.session.completed', data: { object: {
  mode: 'subscription', client_reference_id: 'u1', customer: 'cus_1', subscription,
} } });

async function deliver(event, id = `evt_${++sequence}`) {
  const handler = (await import('../api/stripe-webhook.js')).default;
  const body = JSON.stringify({ id, created: 1790000000 + sequence, ...event });
  const at = Math.floor(Date.now() / 1000);
  const signature = crypto.createHmac('sha256', secret).update(`${at}.${body}`).digest('hex');
  const res = { setHeader() {}, status(v) { this.statusCode = v; return this; }, json(v) { this.body = v; return this; } };
  await handler({ method: 'POST', body, headers: { 'stripe-signature': `t=${at},v1=${signature}` } }, res);
  return res;
}
const plan = () => db.plans.get('u1');

describe('out-of-order and retried subscription events (BILL-1)', () => {
  it('a retried "active" update landing after the cancellation does not restore Pro', async () => {
    live.set('sub_a', sub('sub_a', 'active'));
    await deliver(checkout('sub_a'));
    expect(plan()).toMatchObject({ plan: 'pro', source: 'stripe' });

    // The update (active) failed with a 500; meanwhile the customer cancelled.
    live.set('sub_a', sub('sub_a', 'canceled'));
    await deliver(deleted(sub('sub_a', 'canceled')));
    expect(plan()).toMatchObject({ plan: 'free', status: 'canceled' });

    // Stripe's retry carries the OLD active snapshot.
    const res = await deliver(updated(sub('sub_a', 'active')));
    expect(res.statusCode).toBe(200);
    expect(plan()).toMatchObject({ plan: 'free', status: 'canceled' });
  });

  it('a retried checkout for an already-cancelled subscription does not grant Pro', async () => {
    live.set('sub_a', sub('sub_a', 'canceled'));
    const res = await deliver(checkout('sub_a'));
    expect(res.statusCode).toBe(200);
    expect(plan()).toMatchObject({ plan: 'free' });
  });

  it('reads the Basil period end from the subscription items', async () => {
    live.set('sub_a', sub('sub_a', 'active'));
    await deliver(updated(sub('sub_a', 'active')));
    expect(plan().current_period_end).toBe(new Date(1795000000 * 1000).toISOString());
  });
});

describe('ending an old subscription keeps the current one (BILL-2)', () => {
  it('deleting subscription A does not downgrade a customer now paying for B', async () => {
    live.set('sub_a', sub('sub_a', 'active'));
    live.set('sub_b', sub('sub_b', 'active'));
    await deliver(checkout('sub_a'));
    await deliver(updated(sub('sub_b', 'active')));
    expect(plan()).toMatchObject({ plan: 'pro', stripe_subscription_id: 'sub_b' });

    live.set('sub_a', sub('sub_a', 'canceled'));
    await deliver(deleted(sub('sub_a', 'canceled')));
    expect(plan()).toMatchObject({ plan: 'pro', status: 'active', stripe_subscription_id: 'sub_b' });
  });

  it('deleting the current subscription still downgrades', async () => {
    live.set('sub_b', sub('sub_b', 'active'));
    await deliver(updated(sub('sub_b', 'active')));
    live.set('sub_b', sub('sub_b', 'canceled'));
    await deliver(deleted(sub('sub_b', 'canceled')));
    expect(plan()).toMatchObject({ plan: 'free', status: 'canceled' });
  });
});

describe('event ledger completes only after the work lands (BILL-3)', () => {
  it('a claim left behind by a crashed delivery is reprocessed, not acked as a duplicate', async () => {
    live.set('sub_a', sub('sub_a', 'active'));
    // A previous delivery claimed the event, then the function was killed.
    db.events.set('evt_crash', { event_id: 'evt_crash', outcome: 'failed', detail: 'processing' });
    const res = await deliver(checkout('sub_a'), 'evt_crash');
    expect(res.statusCode).toBe(200);
    expect(res.body.duplicate).toBeUndefined();
    expect(plan()).toMatchObject({ plan: 'pro' });
    expect(db.events.get('evt_crash').outcome).toBe('ok');
  });

  it('a completed event is still acked as a duplicate without side effects', async () => {
    live.set('sub_a', sub('sub_a', 'active'));
    db.events.set('evt_done', { event_id: 'evt_done', outcome: 'ok' });
    const res = await deliver(checkout('sub_a'), 'evt_done');
    expect(res.body.duplicate).toBe(true);
    expect(plan()).toMatchObject({ plan: 'free' });
  });

  it('a Stripe read failure returns 500 and leaves the event retryable', async () => {
    // sub_missing is not in `live`, so the live read 404s.
    const res = await deliver(updated(sub('sub_missing', 'active')), 'evt_fail');
    expect(res.statusCode).toBe(500);
    expect(db.events.has('evt_fail')).toBe(false);
    expect(plan()).toMatchObject({ plan: 'free' });
  });
});
