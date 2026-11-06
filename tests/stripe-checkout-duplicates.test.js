// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// A customer must never be able to pay for two subscriptions
// (docs/state-machines.md, BILL-2b).
const db = vi.hoisted(() => ({ plan: null }));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({
  auth: { getUser: async () => ({ data: { user: { id: 'u1', email: 'u1@example.test' } }, error: null }) },
  rpc: async () => ({ data: false, error: null }),
  from: () => {
    const api = { select: () => api, eq: () => api, maybeSingle: async () => ({ data: db.plan, error: null }), upsert: async () => ({ error: null }) };
    return api;
  },
}) }));

let stripe, calls;
beforeEach(() => {
  vi.resetModules();
  vi.stubEnv('SUPABASE_URL', 'https://test.supabase.co');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service');
  vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test');
  vi.stubEnv('STRIPE_PRICE_MONTHLY_ID', 'price_m');
  vi.stubEnv('STRIPE_PRICE_YEARLY_ID', 'price_y');
  db.plan = { stripe_customer_id: 'cus_1', plan: 'free', source: 'stripe', status: 'canceled', stripe_subscription_id: 'sub_old' };
  stripe = { subscriptions: [], openSessions: [] };
  calls = [];
  vi.stubGlobal('fetch', vi.fn(async (url, init) => {
    const path = String(url).replace('https://api.stripe.com/v1', '');
    calls.push(`${init.method} ${path.split('?')[0]}`);
    let body = {};
    if (path.startsWith('/subscriptions')) body = { data: stripe.subscriptions };
    else if (path.startsWith('/checkout/sessions?')) body = { data: stripe.openSessions };
    else if (path.endsWith('/expire')) body = { id: path.split('/')[3], status: 'expired' };
    else if (path === '/checkout/sessions') body = { id: 'cs_new', url: 'https://checkout.stripe.test/cs_new' };
    return { ok: true, status: 200, json: async () => body };
  }));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

let ip = 0;
async function checkout(interval = 'month') {
  const { default: handler } = await import('../api/stripe-checkout.js');
  const res = { headers: {}, setHeader() {}, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; }, end() { return this; } };
  await handler({ method: 'POST', body: { interval }, url: '/api/stripe-checkout', headers: { authorization: 'Bearer t', 'x-forwarded-for': `10.7.0.${++ip}` } }, res);
  return res;
}

describe('checkout never sells a second subscription', () => {
  it('refuses when Stripe still has a live subscription our row calls canceled (unpaid)', async () => {
    stripe.subscriptions = [{ id: 'sub_old', status: 'unpaid' }];
    const res = await checkout();
    expect(res.statusCode).toBe(409);
    expect(res.body.code).toBe('ALREADY_SUBSCRIBED');
    expect(calls).not.toContain('POST /checkout/sessions');
  });

  it('expires an open session from another tab before creating the new one', async () => {
    stripe.subscriptions = [{ id: 'sub_old', status: 'canceled' }];
    stripe.openSessions = [{ id: 'cs_monthly_tab', mode: 'subscription' }];
    const res = await checkout('year');
    expect(res.statusCode).toBe(200);
    expect(calls).toContain('POST /checkout/sessions/cs_monthly_tab/expire');
    expect(calls.indexOf('POST /checkout/sessions/cs_monthly_tab/expire')).toBeLessThan(calls.lastIndexOf('POST /checkout/sessions'));
  });

  it('lets a customer whose subscriptions all ended subscribe again', async () => {
    stripe.subscriptions = [{ id: 'sub_old', status: 'canceled' }, { id: 'sub_x', status: 'incomplete_expired' }];
    const res = await checkout();
    expect(res.statusCode).toBe(200);
    expect(res.body.url).toMatch(/cs_new/);
  });
});
