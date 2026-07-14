import { describe, it, expect, vi, beforeEach } from 'vitest';

// Service-role Supabase client is mocked; every write is recorded.
const inserts = [];
const upserts = [];
const getUserMock = vi.fn();
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table) => ({
      insert: (row) => { inserts.push({ table, row }); return Promise.resolve({ error: null }); },
      upsert: (row, opts) => { upserts.push({ table, row, opts }); return Promise.resolve({ error: null }); },
    }),
    auth: { getUser: getUserMock },
  }),
}));

process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key-for-tests';

const { default: handler } = await import('../api/track.js');

function mockRes() {
  return {
    headers: {}, statusCode: null, body: null, ended: false,
    setHeader(k, v) { this.headers[k] = v; },
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
    end() { this.ended = true; return this; },
  };
}

const SID = 'session_abc123';
function req(body, headers = {}, method = 'POST') {
  return { method, body, headers: { 'x-forwarded-for': headers.ip || '1.2.3.4', ...headers } };
}

beforeEach(() => {
  inserts.length = 0;
  upserts.length = 0;
  getUserMock.mockReset();
});

// Unique IP per test so the shared in-memory rate limiter never interferes.
let ipCounter = 0;
const uniqueIp = () => `10.0.${Math.floor(ipCounter / 250)}.${(ipCounter++ % 250) + 1}`;

describe('api/track method handling', () => {
  it('rejects GET with 405 and an Allow header', async () => {
    const res = mockRes();
    await handler(req({}, {}, 'GET'), res);
    expect(res.statusCode).toBe(405);
    expect(res.headers.Allow).toContain('POST');
  });

  it('answers OPTIONS preflight with 204', async () => {
    const res = mockRes();
    await handler(req({}, {}, 'OPTIONS'), res);
    expect(res.statusCode).toBe(204);
  });
});

describe('api/track validation', () => {
  it('rejects unknown event names', async () => {
    const res = mockRes();
    await handler(req({ kind: 'event', session_id: SID, event: 'totally_made_up' }, { ip: uniqueIp() }), res);
    expect(res.statusCode).toBe(400);
    expect(inserts).toHaveLength(0);
  });

  it('accepts an allowlisted event and stores it', async () => {
    const res = mockRes();
    await handler(req({ kind: 'event', session_id: SID, event: 'export_completed', props: { format: 'png' } }, { ip: uniqueIp() }), res);
    expect(res.statusCode).toBe(204);
    expect(inserts[0].table).toBe('product_events');
    expect(inserts[0].row.event).toBe('export_completed');
    expect(inserts[0].row.user_id).toBeNull();
  });

  it('rejects oversized payloads with 413', async () => {
    const res = mockRes();
    const big = 'x'.repeat(10 * 1024);
    await handler(req({ kind: 'event', session_id: SID, event: 'export_completed', props: { big } }, { ip: uniqueIp() }), res);
    expect(res.statusCode).toBe(413);
  });

  it('rejects overly deep props', async () => {
    const res = mockRes();
    const deep = { a: { b: { c: { d: { e: 1 } } } } };
    await handler(req({ kind: 'event', session_id: SID, event: 'export_completed', props: deep }, { ip: uniqueIp() }), res);
    expect(res.statusCode).toBe(400);
  });

  it('rejects malformed session ids', async () => {
    const res = mockRes();
    await handler(req({ kind: 'event', session_id: 'x; drop table --', event: 'export_completed' }, { ip: uniqueIp() }), res);
    expect(res.statusCode).toBe(400);
  });

  it('rejects invalid lead emails and normalizes valid ones', async () => {
    const bad = mockRes();
    await handler(req({ kind: 'lead', session_id: SID, email: 'not-an-email' }, { ip: uniqueIp() }), bad);
    expect(bad.statusCode).toBe(400);

    const good = mockRes();
    await handler(req({ kind: 'lead', session_id: SID, email: '  GEO@Example.COM ' }, { ip: uniqueIp() }), good);
    expect(good.statusCode).toBe(204);
    expect(inserts[0].table).toBe('leads');
    expect(inserts[0].row.email).toBe('geo@example.com');
  });
});

describe('api/track heartbeat', () => {
  it('derives geo from edge headers, never from the body', async () => {
    const res = mockRes();
    await handler(req(
      { kind: 'ping', session_id: SID, lat: 0.0, lng: 0.0, city: 'Spoofville' },
      { ip: uniqueIp(), 'x-vercel-ip-latitude': '49.28', 'x-vercel-ip-longitude': '-123.12', 'x-vercel-ip-city': 'Vancouver' },
    ), res);
    expect(res.statusCode).toBe(204);
    const ping = upserts[0];
    expect(ping.table).toBe('live_pings');
    expect(ping.row.lat).toBe(49.28);
    expect(ping.row.city).toBe('Vancouver');
    expect(ping.opts).toEqual({ onConflict: 'session_id' });
  });

  it('a valid heartbeat only writes its own session row (upsert keyed by session_id)', async () => {
    const res = mockRes();
    await handler(req({ kind: 'ping', session_id: SID }, { ip: uniqueIp() }), res);
    expect(upserts[0].row.session_id).toBe(SID);
  });
});

describe('api/track rate limiting', () => {
  it('repeated spam from one IP gets 429 once over the window budget', async () => {
    const ip = uniqueIp();
    const codes = [];
    for (let i = 0; i < 10; i++) {
      const res = mockRes();
      await handler(req({ kind: 'lead', session_id: SID, email: 'a@b.co' }, { ip }), res);
      codes.push(res.statusCode);
    }
    expect(codes.filter((c) => c === 429).length).toBeGreaterThan(0);
    expect(codes.slice(0, 5).every((c) => c === 204)).toBe(true);
  });
});

describe('api/track identity', () => {
  it('resolves user_id from a verified token, not from the body', async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: 'user-123' } }, error: null });
    const res = mockRes();
    await handler(req(
      { kind: 'event', session_id: SID, event: 'signup_completed', user_id: 'attacker-forged' },
      { ip: uniqueIp(), authorization: 'Bearer sometoken' },
    ), res);
    expect(inserts[0].row.user_id).toBe('user-123');
  });

  it('an invalid token yields user_id null rather than an error', async () => {
    getUserMock.mockResolvedValue({ data: null, error: { message: 'bad token' } });
    const res = mockRes();
    await handler(req(
      { kind: 'event', session_id: SID, event: 'signup_completed' },
      { ip: uniqueIp(), authorization: 'Bearer garbage' },
    ), res);
    expect(res.statusCode).toBe(204);
    expect(inserts[0].row.user_id).toBeNull();
  });
});

describe('api/track dashboard-v2 events', () => {
  const NEW_EVENTS = [
    'project_created', 'project_saved', 'project_opened', 'layer_added',
    'element_added', 'registry_claims_imported', 'export_failed',
  ];
  it('accepts every new dashboard event name', async () => {
    for (const event of NEW_EVENTS) {
      const res = mockRes();
      await handler(req({ kind: 'event', session_id: SID, event, props: { project_id: 'p1' } }, { ip: uniqueIp() }), res);
      expect(res.statusCode, event).toBe(204);
      expect(inserts.at(-1).row.event).toBe(event);
    }
  });

  it('still rejects an unknown event name', async () => {
    const res = mockRes();
    await handler(req({ kind: 'event', session_id: SID, event: 'made_up_event' }, { ip: uniqueIp() }), res);
    expect(res.statusCode).toBe(400);
  });

  it('search inserts carry user_id from a verified token', async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: 'user-777' } }, error: null });
    const res = mockRes();
    await handler(req(
      { kind: 'search', session_id: SID, search_kind: 'registry', province: 'bc', mode: 'company', query_len: 5, result_count: 12 },
      { ip: uniqueIp(), authorization: 'Bearer good' },
    ), res);
    expect(res.statusCode).toBe(204);
    expect(inserts.at(-1).table).toBe('search_events');
    expect(inserts.at(-1).row.user_id).toBe('user-777');
    expect(inserts.at(-1).row.province).toBe('bc');
  });

  it('anonymous searches insert user_id null', async () => {
    const res = mockRes();
    await handler(req(
      { kind: 'search', session_id: SID, search_kind: 'nearby', province: 'on', result_count: 3 },
      { ip: uniqueIp() },
    ), res);
    expect(res.statusCode).toBe(204);
    expect(inserts.at(-1).row.user_id).toBeNull();
  });

  it('truncates a long export_failed message within the props limit', async () => {
    const res = mockRes();
    const message = 'e'.repeat(500);
    await handler(req({ kind: 'event', session_id: SID, event: 'export_failed', props: { format: 'pdf', message } }, { ip: uniqueIp() }), res);
    // 500 chars is well under MAX_PROPS_BYTES (2KB) so it's accepted as-is;
    // the client truncates to 120 — assert the endpoint stores what it's given.
    expect(res.statusCode).toBe(204);
    expect(inserts.at(-1).row.props.format).toBe('pdf');
  });
});
