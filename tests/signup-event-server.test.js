import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const getUser = vi.fn();
let rows = [];
let failInsert = false;
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({
  auth: { getUser },
  from: () => ({
    select() {
      const filter = {};
      const q = { eq(key, value) { filter[key] = value; return q; },
        limit: async () => ({ data: rows.filter((r) => r.event === filter.event && r.user_id === filter.user_id).slice(0, 1) }) };
      return q;
    },
    async insert(row) {
      if (failInsert) return { error: { code: 'temporary', message: 'offline' } };
      if (rows.some((r) => r.id === row.id)) return { error: { code: '23505' } };
      rows.push(row); return { error: null };
    },
  }),
}) }));
const USER = { id: '12345678-1234-4123-8123-123456789012', created_at: '2026-09-01T10:00:00Z', email_confirmed_at: '2026-09-02T10:00:00Z', user_metadata: { em_acquisition: { utm_source: 'partner', email: 'must-not-log@example.com' } } };
let handler;
let ip = 0;
beforeEach(async () => {
  rows = []; failInsert = false;
  getUser.mockResolvedValue({ data: { user: USER }, error: null });
  vi.stubEnv('SUPABASE_URL', 'https://example.supabase.co');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test');
  ({ default: handler } = await import('../api/track.js'));
});
afterEach(() => vi.unstubAllEnvs());
const send = async (props = {}) => {
  const res = { statusCode: null, setHeader() {}, status(c) { this.statusCode = c; return this; }, json() { return this; }, end() { return this; } };
  await handler({ method: 'POST', headers: { authorization: 'Bearer valid', 'x-forwarded-for': `10.22.0.${++ip}` },
    body: { kind: 'event', event: 'signup_completed', session_id: 'session_abc123', props } }, res);
  return res;
};
describe('confirmed account milestone', () => {
  it('records delayed confirmation once using server identity and timestamp', async () => {
    await Promise.all([send({ utm_source: 'forged' }), send()]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: USER.id, user_id: USER.id, created_at: USER.email_confirmed_at, props: { utm_source: 'partner' } });
    expect(rows[0].props).not.toHaveProperty('email');
  });
  it('retains historical signup rows and rejects anonymous signup events', async () => {
    rows = [{ id: 'old-random-id', user_id: USER.id, event: 'signup_completed' }];
    await send(); expect(rows).toHaveLength(1);
    getUser.mockResolvedValue({ data: { user: null } });
    expect((await send()).statusCode).toBe(401);
  });
  it('allows failed delivery to retry without losing the account milestone', async () => {
    failInsert = true;
    expect((await send()).statusCode).toBe(502);
    failInsert = false;
    expect((await send()).statusCode).toBe(204);
    expect(rows).toHaveLength(1);
  });
});
