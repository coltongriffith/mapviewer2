import { describe, it, expect, vi, beforeEach } from 'vitest';

// Service-role Supabase client is mocked; every insert is recorded.
const inserts = [];
const getUserMock = vi.fn();
let insertError = null;
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table) => ({
      insert: (row) => {
        inserts.push({ table, row });
        return { select: () => ({ single: () => Promise.resolve(insertError ? { data: null, error: insertError } : { data: { id: 'fb-1' }, error: null }) }) };
      },
    }),
    // rateLimitedShared: no shared limiter in tests → fail open.
    rpc: () => Promise.resolve({ data: false, error: null }),
    auth: { getUser: getUserMock },
  }),
}));

process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key-for-tests';

const { default: handler } = await import('../api/feedback.js');

function mockRes() {
  return {
    headers: {}, statusCode: null, body: null, ended: false,
    setHeader(k, v) { this.headers[k] = v; },
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
    end() { this.ended = true; return this; },
  };
}

let ipCounter = 0;
const uniqueIp = () => `10.1.${Math.floor(ipCounter / 250)}.${(ipCounter++ % 250) + 1}`;
function req(body, headers = {}, method = 'POST') {
  return { method, body, headers: { 'x-forwarded-for': uniqueIp(), 'user-agent': 'TestBrowser/1.0', ...headers } };
}

beforeEach(() => {
  inserts.length = 0;
  insertError = null;
  getUserMock.mockReset();
});

describe('api/feedback', () => {
  it('rejects GET with 405', async () => {
    const res = mockRes();
    await handler(req({}, {}, 'GET'), res);
    expect(res.statusCode).toBe(405);
  });

  it('rejects an empty message with a readable 400, not a silent 204', async () => {
    // Telemetry endpoints answer 204 on every error path. This one must not:
    // the user is waiting on the answer.
    const res = mockRes();
    await handler(req({ kind: 'bug', message: '  ' }), res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/tell us/i);
    expect(inserts).toHaveLength(0);
  });

  it('rejects a malformed contact email', async () => {
    const res = mockRes();
    await handler(req({ kind: 'bug', message: 'export is broken', email: 'not-an-email' }), res);
    expect(res.statusCode).toBe(400);
    expect(inserts).toHaveLength(0);
  });

  it('stores an anonymous report with its contact email and diagnostics', async () => {
    const res = mockRes();
    await handler(req({
      kind: 'bug', message: 'PNG export hangs at 90%', email: 'me@example.test',
      path: '/map/abc', release: '1.0.0+deadbeef', sessionId: 'sid-1',
      context: { viewport: '1280x720', recentErrors: [{ kind: 'error', message: 'boom' }] },
    }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true, id: 'fb-1' });
    expect(inserts).toHaveLength(1);
    const { table, row } = inserts[0];
    expect(table).toBe('feedback');
    expect(row).toMatchObject({
      kind: 'bug', message: 'PNG export hangs at 90%', email: 'me@example.test', path: '/map/abc',
      release: '1.0.0+deadbeef', session_id: 'sid-1', user_id: null, user_agent: 'TestBrowser/1.0',
    });
    expect(row.context.viewport).toBe('1280x720');
    expect(row.context.recentErrors[0].message).toBe('boom');
  });

  it('takes identity from a verified bearer token and drops the typed email for signed-in users', async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: 'user-42' } } });
    const res = mockRes();
    await handler(req({ kind: 'idea', message: 'Let me pick a north arrow style', email: 'spoof@example.test' }, { authorization: 'Bearer good-token' }), res);
    expect(res.statusCode).toBe(200);
    expect(getUserMock).toHaveBeenCalledWith('good-token');
    expect(inserts[0].row.user_id).toBe('user-42');
    expect(inserts[0].row.email).toBeNull();
  });

  it('never trusts a user id from the body', async () => {
    const res = mockRes();
    await handler(req({ kind: 'feedback', message: 'hello there', user_id: 'attacker' }), res);
    expect(inserts[0].row.user_id).toBeNull();
  });

  it('falls back to "feedback" for an unknown kind', async () => {
    const res = mockRes();
    await handler(req({ kind: 'complaint', message: 'still a message' }), res);
    expect(inserts[0].row.kind).toBe('feedback');
  });

  it('redacts secrets inside diagnostics but leaves the user-typed message alone', async () => {
    const res = mockRes();
    await handler(req({
      kind: 'bug', message: 'reach me at me@example.test',
      context: { recentErrors: [{ message: 'GET /x?access_token=abc123 failed' }] },
    }), res);
    expect(inserts[0].row.message).toBe('reach me at me@example.test');
    expect(inserts[0].row.context.recentErrors[0].message).toContain('access_token=[redacted]');
  });

  it('bounds oversized diagnostics instead of storing them', async () => {
    const res = mockRes();
    await handler(req({ kind: 'bug', message: 'big context', context: { blob: 'x'.repeat(8000) } }), res);
    expect(res.statusCode).toBe(200);
    expect(inserts[0].row.context).toEqual({ truncated: true });
  });

  it('answers 500 with a readable error when storage fails', async () => {
    insertError = { message: 'relation "feedback" does not exist', code: '42P01' };
    const res = mockRes();
    await handler(req({ kind: 'bug', message: 'anything at all' }), res);
    expect(res.statusCode).toBe(500);
    expect(res.body.error).toMatch(/try again/i);
  });

  it('rate limits a single address', async () => {
    const ip = uniqueIp();
    let last;
    for (let i = 0; i < 11; i++) {
      last = mockRes();
      await handler({ method: 'POST', body: { kind: 'bug', message: `report ${i}` }, headers: { 'x-forwarded-for': ip } }, last);
    }
    expect(last.statusCode).toBe(429);
    expect(inserts).toHaveLength(10);
  });
});
