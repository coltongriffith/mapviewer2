import { beforeEach, afterEach, expect, it, vi } from 'vitest';
const requestStripe = vi.fn();
const getUser = vi.fn();
vi.mock('../api/_lib/stripe.js', () => ({ stripeConfigured: () => true, stripeRequest: (...args) => requestStripe(...args) }));
vi.mock('../api/_lib/guard.js', () => ({ applyCors() {}, handleMethods: () => false, rateLimited: () => false }));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ auth: { getUser }, from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { plan: 'pro' } }) }) }) }) }) }));
let handler;
beforeEach(async () => {
  vi.stubEnv('SUPABASE_URL', 'https://example.supabase.co'); vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test');
  getUser.mockResolvedValue({ data: { user: { id: 'owner' } } });
  ({ default: handler } = await import('../api/stripe-session.js'));
});
afterEach(() => vi.unstubAllEnvs());
async function verify(session) {
  requestStripe.mockResolvedValue(session);
  const res = { setHeader() {}, status(c) { this.code = c; return this; }, json(data) { this.body = data; return this; } };
  await handler({ method: 'GET', headers: { authorization: 'Bearer valid' }, query: { session_id: 'cs_live_123456789012' } }, res);
  return res;
}
it('returns the verified amount, currency, transaction, and test/live flag', async () => {
  const res = await verify({ id: 'cs_live_123456789012', client_reference_id: 'owner', payment_status: 'paid', amount_total: 29000, currency: 'usd', livemode: true });
  expect(res.body.purchase).toEqual({ value: 290, currency: 'USD', transaction_id: 'cs_live_123456789012', livemode: true });
});
it('does not expose checkout details without an exact owner binding', async () => {
  expect((await verify({ payment_status: 'paid' })).code).toBe(403);
  expect((await verify({ client_reference_id: 'another', payment_status: 'paid' })).code).toBe(403);
});
