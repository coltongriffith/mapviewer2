// @vitest-environment node
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import crypto from 'node:crypto';

// Execute the real signed-event handler against an in-memory database boundary.
// Reads honor selected columns and writes honor account/source filters, so a
// missing plan projection or an unscoped cancellation changes the final rows.
const db = vi.hoisted(() => ({ plans: new Map(), events: new Set(), lookupError: false }));
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
      if (table === 'stripe_events') {
        if (action === 'insert') {
          if (db.events.has(values.event_id)) return resolve({ error: { code: '23505' } });
          db.events.add(values.event_id);
        } else if (action === 'delete') db.events.delete(filters.find(([key]) => key === 'event_id')[1]);
        return resolve({ data: null, error: null });
      }
      if (table !== 'user_plans') throw new Error(`Unexpected table: ${table}`);
      const rows = [...db.plans.values()].filter(row => filters.every(([key, value]) => row[key] === value));
      if (action === 'select') {
        if (db.lookupError) { db.lookupError = false; return resolve({ data: null, error: { message: 'Plan lookup unavailable' } }); }
        const row = rows[0];
        return resolve({ data: row ? Object.fromEntries(columns.map(key => [key, row[key]])) : null, error: null });
      }
      if (action === 'upsert') db.plans.set(values.user_id, { ...db.plans.get(values.user_id), ...values });
      else if (action === 'update') for (const row of rows) Object.assign(row, values);
      return resolve({ data: null, error: null });
    },
  };
  return chain;
} }) }));

const secret = 'whsec_company_test';
const since = '2026-07-01T00:00:00.000Z';
let sequence;
beforeEach(() => {
  db.plans.clear(); db.events.clear(); db.lookupError = false; sequence = 0;
  db.plans.set('other-user', { user_id: 'other-user', plan: 'free', source: 'signup', stripe_customer_id: 'cus_other' });
  vi.resetModules();
  vi.stubEnv('SUPABASE_URL', 'https://test.supabase.co');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-test-key');
  vi.stubEnv('STRIPE_WEBHOOK_SECRET', secret);
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });
const assign = (source, plan = 'company') => db.plans.set('company-user', {
  user_id: 'company-user', plan, source, pro_since: since,
  status: 'active', stripe_customer_id: 'cus_company', stripe_subscription_id: 'sub_company',
});
const currentPlan = () => db.plans.get('company-user');
const checkout = () => ({ type: 'checkout.session.completed', data: { object: {
  mode: 'subscription', client_reference_id: 'company-user', customer: 'cus_company', subscription: 'sub_company',
} } });
const subscription = (status = 'active', { deleted = false, metadata = true } = {}) => ({
  type: deleted ? 'customer.subscription.deleted' : 'customer.subscription.updated',
  data: { object: {
    id: 'sub_company', customer: 'cus_company', status, current_period_end: 1794000000,
    metadata: metadata ? { supabase_user_id: 'company-user' } : {},
    items: { data: [{ price: { recurring: { interval: 'year' } } }] },
  } },
});
async function deliver(event, id = `evt_company_${++sequence}`) {
  const handler = (await import('../api/stripe-webhook.js')).default;
  const body = JSON.stringify({ id, created: 1790000000 + sequence, ...event });
  const at = Math.floor(Date.now() / 1000);
  const signature = crypto.createHmac('sha256', secret).update(`${at}.${body}`).digest('hex');
  const res = { setHeader() {}, status(value) { this.statusCode = value; return this; }, json(value) { this.body = value; return this; } };
  await handler({ method: 'POST', body, headers: { 'stripe-signature': `t=${at},v1=${signature}` } }, res);
  return res;
}

it.each(['admin', 'grandfathered'])('preserves an explicitly assigned %s Company plan through checkout and renewals', async source => {
  assign(source);
  expect((await deliver(checkout())).statusCode).toBe(200);
  expect(currentPlan()).toMatchObject({ plan: 'company', source, pro_since: since,
    stripe_customer_id: 'cus_company', stripe_subscription_id: 'sub_company' });
  for (const status of ['active', 'trialing', 'past_due']) {
    expect((await deliver(subscription(status))).statusCode).toBe(200);
    expect(currentPlan()).toMatchObject({ plan: 'company', source, status, pro_since: since, billing_interval: 'year',
      current_period_end: new Date(1794000000 * 1000).toISOString() });
  }
});

it.each(['admin', 'grandfathered'])('retains %s Company access with customer matching, cancellation and out-of-order delivery', async source => {
  assign(source);
  // Cancellation arrives first, followed by older paid updates and checkout.
  const canceled = subscription('canceled', { deleted: true, metadata: false });
  expect((await deliver({ ...canceled, created: 1790000030 })).statusCode).toBe(200);
  expect(currentPlan()).toMatchObject({ plan: 'company', source });
  expect((await deliver({ ...subscription('active', { metadata: false }), created: 1790000020 })).statusCode).toBe(200);
  expect(currentPlan()).toMatchObject({ plan: 'company', source });
  expect((await deliver({ ...checkout(), created: 1790000010 }, 'evt_checkout')).statusCode).toBe(200);
  expect(currentPlan()).toMatchObject({ plan: 'company', source });
  const beforeDuplicate = { ...currentPlan() };
  expect((await deliver(checkout(), 'evt_checkout')).body.duplicate).toBe(true);
  expect(currentPlan()).toEqual(beforeDuplicate);
  expect((await deliver(subscription('unpaid'))).statusCode).toBe(200);
  expect(currentPlan()).toMatchObject({ plan: 'company', source });
  expect(db.plans.get('other-user')).toEqual({ user_id: 'other-user', plan: 'free', source: 'signup', stripe_customer_id: 'cus_other' });
});

it.each(['signup', 'stripe'])('keeps ordinary %s accounts on the normal paid/cancellation path', async source => {
  assign(source, 'free');
  expect((await deliver(subscription('active'))).statusCode).toBe(200);
  expect(currentPlan()).toMatchObject({ plan: 'pro', source: 'stripe' });
  expect((await deliver(checkout())).statusCode).toBe(200);
  expect(currentPlan()).toMatchObject({ plan: 'pro', source: 'stripe' });
  expect((await deliver(subscription('past_due'))).statusCode).toBe(200);
  expect(currentPlan()).toMatchObject({ plan: 'pro', source: 'stripe', status: 'past_due' });
  expect((await deliver(subscription('canceled', { deleted: true }))).statusCode).toBe(200);
  expect(currentPlan()).toMatchObject({ plan: 'free', source: 'stripe', status: 'canceled' });
});

it.each(['admin', 'grandfathered'])('does not turn a protected %s Pro account into Company', async source => {
  assign(source, 'pro');
  const event = subscription('active');
  event.data.object.metadata.plan = 'company'; // Only the existing database assignment is authoritative.
  expect((await deliver(event)).statusCode).toBe(200);
  expect((await deliver(checkout())).statusCode).toBe(200);
  expect((await deliver(subscription('canceled', { deleted: true }))).statusCode).toBe(200);
  expect(currentPlan()).toMatchObject({ plan: 'pro', source, pro_since: since });
});

it('does not make an unprotected Company row immune to ordinary Stripe cancellation', async () => {
  assign('stripe');
  expect((await deliver(subscription('active'))).statusCode).toBe(200);
  expect(currentPlan()).toMatchObject({ plan: 'pro', source: 'stripe' });
  expect((await deliver(subscription('canceled', { deleted: true }))).statusCode).toBe(200);
  expect(currentPlan()).toMatchObject({ plan: 'free', source: 'stripe' });
});

it.each(['checkout', 'subscription'])('retries a failed protected-plan lookup for %s without changing its entitlement', async kind => {
  assign('admin'); db.lookupError = true;
  const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
  const event = kind === 'checkout' ? checkout() : subscription();
  expect((await deliver(event, 'evt_retry')).statusCode).toBe(500);
  expect(currentPlan()).toMatchObject({ plan: 'company', source: 'admin' });
  expect(db.events.has('evt_retry')).toBe(false);
  expect(errorLog).toHaveBeenCalled();
  expect((await deliver(event, 'evt_retry')).statusCode).toBe(200);
  expect(currentPlan()).toMatchObject({ plan: 'company', source: 'admin' });
});
