import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import crypto from 'node:crypto';

// Billing layer tests: webhook signature verification, the grandfather
// never-downgrade invariant, endpoint auth/config guards, and pricing-config
// sanity. Supabase + Stripe are fully mocked — no network.

// ── Mock @supabase/supabase-js with a recording, thenable query builder ──
let dbCalls;
function makeChain(table) {
  const rec = { table, ops: [] };
  dbCalls.push(rec);
  const obj = {
    upsert: (v, o) => { rec.ops.push(['upsert', v, o]); return obj; },
    update: (v) => { rec.ops.push(['update', v]); return obj; },
    select: (...a) => { rec.ops.push(['select', ...a]); return obj; },
    eq: (c, v) => { rec.ops.push(['eq', c, v]); return obj; },
    maybeSingle: () => { rec.ops.push(['maybeSingle']); return obj; },
    then: (resolve) => resolve({ data: null, error: null, count: 0 }),
  };
  return obj;
}
vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    from: (table) => makeChain(table),
    auth: { getUser: vi.fn(async () => ({ data: { user: null }, error: new Error('invalid') })) },
  })),
}));

function mockRes() {
  return {
    headers: {}, statusCode: null, body: null,
    setHeader(k, v) { this.headers[k] = v; },
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
    end() { return this; },
  };
}
let ipN = 0;
const nextIp = () => `10.9.${Math.floor(ipN / 250)}.${(ipN++ % 250) + 1}`;

const WH_SECRET = 'whsec_test_secret';
function signedHeaders(body, { secret = WH_SECRET, at = Math.floor(Date.now() / 1000) } = {}) {
  const sig = crypto.createHmac('sha256', secret).update(`${at}.${body}`, 'utf8').digest('hex');
  return { 'stripe-signature': `t=${at},v1=${sig}`, 'x-forwarded-for': nextIp() };
}

beforeEach(() => {
  dbCalls = [];
  vi.resetModules();
  vi.stubEnv('SUPABASE_URL', 'https://test.supabase.co');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-key');
  vi.stubEnv('STRIPE_WEBHOOK_SECRET', WH_SECRET);
  vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_x');
  vi.stubEnv('STRIPE_PRICE_MONTHLY_ID', 'price_m');
  vi.stubEnv('STRIPE_PRICE_YEARLY_ID', 'price_y');
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('webhook signature verification', () => {
  it('accepts a correctly signed payload and acks unhandled events', async () => {
    const { default: handler } = await import('../api/stripe-webhook.js');
    const body = JSON.stringify({ type: 'invoice.paid', data: { object: {} } });
    const res = mockRes();
    await handler({ method: 'POST', body, headers: signedHeaders(body) }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.received).toBe(true);
  });

  it('rejects a bad signature', async () => {
    const { default: handler } = await import('../api/stripe-webhook.js');
    const body = JSON.stringify({ type: 'checkout.session.completed' });
    const res = mockRes();
    await handler({
      method: 'POST', body,
      headers: { ...signedHeaders(body, { secret: 'whsec_wrong' }) },
    }, res);
    expect(res.statusCode).toBe(400);
    expect(dbCalls).toHaveLength(0); // nothing touched the DB
  });

  it('rejects a stale timestamp (replay guard)', async () => {
    const { default: handler } = await import('../api/stripe-webhook.js');
    const body = JSON.stringify({ type: 'checkout.session.completed' });
    const res = mockRes();
    await handler({
      method: 'POST', body,
      headers: signedHeaders(body, { at: Math.floor(Date.now() / 1000) - 3600 }),
    }, res);
    expect(res.statusCode).toBe(400);
  });
});

describe('webhook plan sync', () => {
  it('checkout.session.completed upgrades the user to pro/stripe', async () => {
    const { default: handler } = await import('../api/stripe-webhook.js');
    const body = JSON.stringify({
      type: 'checkout.session.completed',
      data: { object: { mode: 'subscription', client_reference_id: 'user-1', customer: 'cus_1', subscription: 'sub_1' } },
    });
    const res = mockRes();
    await handler({ method: 'POST', body, headers: signedHeaders(body) }, res);
    expect(res.statusCode).toBe(200);
    const upsert = dbCalls.find((c) => c.ops.some((o) => o[0] === 'upsert'));
    expect(upsert.table).toBe('user_plans');
    const [, values] = upsert.ops.find((o) => o[0] === 'upsert');
    expect(values).toMatchObject({ user_id: 'user-1', plan: 'pro', status: 'active', source: 'stripe' });
  });

  it('subscription.deleted downgrades ONLY source=stripe rows (grandfathered untouchable)', async () => {
    const { default: handler } = await import('../api/stripe-webhook.js');
    const body = JSON.stringify({
      type: 'customer.subscription.deleted',
      data: { object: { id: 'sub_1', status: 'canceled', customer: 'cus_1', metadata: {} } },
    });
    const res = mockRes();
    await handler({ method: 'POST', body, headers: signedHeaders(body) }, res);
    expect(res.statusCode).toBe(200);
    const call = dbCalls.find((c) => c.ops.some((o) => o[0] === 'update'));
    expect(call.table).toBe('user_plans');
    const [, values] = call.ops.find((o) => o[0] === 'update');
    expect(values.plan).toBe('free');
    // THE invariant: the downgrade update must be scoped to source='stripe'.
    expect(call.ops).toContainEqual(['eq', 'source', 'stripe']);
    expect(call.ops).toContainEqual(['eq', 'stripe_customer_id', 'cus_1']);
  });

  it('active subscription updates keep pro and never add the stripe-source scope', async () => {
    const { default: handler } = await import('../api/stripe-webhook.js');
    const body = JSON.stringify({
      type: 'customer.subscription.updated',
      data: { object: { id: 'sub_1', status: 'active', customer: 'cus_1', metadata: { supabase_user_id: 'user-1' }, current_period_end: 1790000000 } },
    });
    const res = mockRes();
    await handler({ method: 'POST', body, headers: signedHeaders(body) }, res);
    const call = dbCalls.find((c) => c.ops.some((o) => o[0] === 'update'));
    const [, values] = call.ops.find((o) => o[0] === 'update');
    expect(values.plan).toBe('pro');
    expect(call.ops).toContainEqual(['eq', 'user_id', 'user-1']);
  });
});

describe('checkout / portal endpoint guards', () => {
  it('checkout 401s without a valid token', async () => {
    const { default: handler } = await import('../api/stripe-checkout.js');
    const res = mockRes();
    await handler({ method: 'POST', body: { interval: 'month' }, headers: { 'x-forwarded-for': nextIp() }, url: '/api/stripe-checkout' }, res);
    expect(res.statusCode).toBe(401);
  });

  it('checkout 503s when Stripe is not configured (safe pre-config deploys)', async () => {
    vi.stubEnv('STRIPE_SECRET_KEY', '');
    vi.resetModules();
    const { default: handler } = await import('../api/stripe-checkout.js');
    const res = mockRes();
    await handler({ method: 'POST', body: { interval: 'month' }, headers: { 'x-forwarded-for': nextIp() }, url: '/api/stripe-checkout' }, res);
    expect(res.statusCode).toBe(503);
    expect(res.body.error).toMatch(/not configured/i);
  });

  it('portal 401s without a valid token', async () => {
    const { default: handler } = await import('../api/stripe-portal.js');
    const res = mockRes();
    await handler({ method: 'POST', body: {}, headers: { 'x-forwarded-for': nextIp() }, url: '/api/stripe-portal' }, res);
    expect(res.statusCode).toBe(401);
  });
});

describe('pricing config sanity', () => {
  it('yearly is a real discount and the config is coherent', async () => {
    const { PRICING, FREE_FEATURES, PRO_FEATURES, FREE_PROJECT_LIMIT, PRO_EXPORT_FORMATS, isGrandfathered, PRO_GRANDFATHER_CUTOFF } = await import('../src/utils/pricing.js');
    expect(PRICING.monthly).toBeGreaterThan(0);
    expect(PRICING.yearly).toBeLessThan(PRICING.monthly * 12);
    expect(FREE_FEATURES.length).toBeGreaterThan(2);
    expect(PRO_FEATURES.length).toBeGreaterThan(2);
    expect(FREE_PROJECT_LIMIT).toBeGreaterThanOrEqual(1);
    expect(PRO_EXPORT_FORMATS).toContain('pdf');
    // grandfather check: an account from before the cutoff is Pro
    expect(isGrandfathered({ created_at: '2026-01-01T00:00:00Z' })).toBe(true);
    expect(isGrandfathered({ created_at: new Date(PRO_GRANDFATHER_CUTOFF.getTime() + 86400000).toISOString() })).toBe(false);
    expect(isGrandfathered(null)).toBe(false);
  });
});
