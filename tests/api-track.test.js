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
    storage: {
      from: (bucket) => ({
        createSignedUploadUrl: (path) => Promise.resolve({ data: { signedUrl: `https://example.supabase.co/storage/v1/object/upload/sign/${bucket}/${path}?token=t` }, error: null }),
      }),
    },
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

  it('accepts the internal-browser marker used by admin reports', async () => {
    const res = mockRes();
    await handler(req({ kind: 'event', session_id: SID, event: 'internal_session' }, { ip: uniqueIp() }), res);
    expect(res.statusCode).toBe(204);
    expect(inserts[0]).toMatchObject({ table: 'product_events', row: { event: 'internal_session', user_id: null } });
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
      { kind: 'event', session_id: SID, event: 'editor_opened', user_id: 'attacker-forged' },
      { ip: uniqueIp(), authorization: 'Bearer sometoken' },
    ), res);
    expect(inserts[0].row.user_id).toBe('user-123');
  });

  it('an invalid token yields user_id null rather than an error', async () => {
    getUserMock.mockResolvedValue({ data: null, error: { message: 'bad token' } });
    const res = mockRes();
    await handler(req(
      { kind: 'event', session_id: SID, event: 'editor_opened' },
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

  it('accepts the full-resolution offer events', async () => {
    for (const event of ['fullres_offer_shown', 'fullres_offer_sent', 'fullres_export_completed']) {
      const res = mockRes();
      await handler(req({ kind: 'event', session_id: SID, event, props: { mode: 'email' } }, { ip: uniqueIp() }), res);
      expect(res.statusCode, event).toBe(204);
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

  // query_text: the term itself, recorded so a zero-result search can be
  // reproduced. A rate says how often search fails; only the term says whether
  // it should have.
  it('stores the search term as typed', async () => {
    const res = mockRes();
    await handler(req(
      { kind: 'search', session_id: SID, search_kind: 'registry', province: 'bc', mode: 'company',
        query_len: 22, query_text: 'Teck Resources Limited', result_count: 0, outcome: 'empty' },
      { ip: uniqueIp() },
    ), res);
    expect(res.statusCode).toBe(204);
    expect(inserts.at(-1).row.query_text).toBe('Teck Resources Limited');
  });

  it('collapses whitespace so one term does not split into two report rows', async () => {
    const res = mockRes();
    await handler(req(
      { kind: 'search', session_id: SID, search_kind: 'registry', query_text: '  Acme   Gold  Corp ' },
      { ip: uniqueIp() },
    ), res);
    expect(inserts.at(-1).row.query_text).toBe('Acme Gold Corp');
  });

  it('redacts a credential pasted into the search box', async () => {
    const res = mockRes();
    await handler(req(
      { kind: 'search', session_id: SID, search_kind: 'registry', query_text: 'mine api_key=abcdef123456 owner@example.com' },
      { ip: uniqueIp() },
    ), res);
    const stored = inserts.at(-1).row.query_text;
    expect(stored).not.toContain('abcdef123456');
    expect(stored).not.toContain('owner@example.com');
    expect(stored).toContain('[redacted]');
    expect(stored).toContain('[email]');
  });

  it('truncates an over-long term instead of dropping the event', async () => {
    const res = mockRes();
    await handler(req(
      { kind: 'search', session_id: SID, search_kind: 'registry', query_text: 'x'.repeat(400) },
      { ip: uniqueIp() },
    ), res);
    expect(res.statusCode).toBe(204);
    expect(inserts.at(-1).table).toBe('search_events');
    expect(inserts.at(-1).row.query_text.length).toBe(120);
  });

  it('records null rather than an empty string when there is no term', async () => {
    // A radius search has no term. Null keeps it out of the terms report
    // instead of showing a blank row that reads as an empty search.
    const res = mockRes();
    await handler(req(
      { kind: 'search', session_id: SID, search_kind: 'nearby', province: 'bc', mode: 'radius' },
      { ip: uniqueIp() },
    ), res);
    expect(inserts.at(-1).row.query_text).toBeNull();
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

describe('api/track automated traffic', () => {
  const chrome = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36';

  it.each([
    ['a headless browser', 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/154.0.0.0 Safari/537.36'],
    ['a search crawler', 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'],
    ['a script', 'python-requests/2.32.0'],
  ])('accepts and drops a page view from %s', async (_, ua) => {
    const res = mockRes();
    await handler(req({ kind: 'event', session_id: SID, event: 'editor_opened' }, { ip: uniqueIp(), 'user-agent': ua }), res);
    expect(res.statusCode).toBe(204);
    expect(inserts).toHaveLength(0);
  });

  it('drops events a browser flags as automated (navigator.webdriver)', async () => {
    const res = mockRes();
    await handler(req({ kind: 'event', session_id: SID, event: 'editor_opened', automated: true }, { ip: uniqueIp(), 'user-agent': chrome }), res);
    expect(res.statusCode).toBe(204);
    expect(inserts).toHaveLength(0);
  });

  it('still records an ordinary browser', async () => {
    const res = mockRes();
    await handler(req({ kind: 'event', session_id: SID, event: 'editor_opened' }, { ip: uniqueIp(), 'user-agent': chrome }), res);
    expect(res.statusCode).toBe(204);
    expect(inserts.at(-1).row.event).toBe('editor_opened');
  });

  it('never drops a confirmed signup, whatever the browser says', async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: '11111111-1111-4111-8111-111111111111', email_confirmed_at: '2026-10-01T00:00:00Z' } }, error: null });
    const res = mockRes();
    await handler(req({ kind: 'event', session_id: SID, event: 'signup_completed', automated: true },
      { ip: uniqueIp(), 'user-agent': 'HeadlessChrome', authorization: 'Bearer token' }), res);
    // Reached account verification instead of being dropped as automated.
    expect(getUserMock).toHaveBeenCalled();
  });
});

describe('api/track claim search requests', () => {
  const ask = (body, headers = {}) => req({ kind: 'claim_request', session_id: SID, province: 'on', mode: 'company', query_text: 'Torrance', ...body }, { ip: uniqueIp(), ...headers });

  it('stores what was looked for, where, and who to reply to', async () => {
    const res = mockRes();
    await handler(ask({ email: ' Reader@Example.COM ', note: 'Neotech project', province: 'ON' }, { 'user-agent': 'Mozilla/5.0' }), res);
    expect(res.statusCode).toBe(204);
    expect(inserts).toHaveLength(1);
    expect(inserts[0].table).toBe('claim_search_requests');
    expect(inserts[0].row).toMatchObject({
      email: 'reader@example.com', query_text: 'Torrance', province: 'on', mode: 'company',
      note: 'Neotech project', session_id: SID, user_id: null, user_agent: 'Mozilla/5.0',
    });
  });

  it('replies to a signed-in reader who left the email blank', async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: 'user-9', email: 'member@example.com' } }, error: null });
    const res = mockRes();
    await handler(ask({}, { authorization: 'Bearer token' }), res);
    expect(res.statusCode).toBe(204);
    expect(inserts[0].row).toMatchObject({ email: 'member@example.com', user_id: 'user-9' });
  });

  it('refuses a request with no way to reply, nothing to look for, or no province', async () => {
    for (const body of [{ email: 'nope' }, { email: 'a@b.co', query_text: '   ' }, { email: 'a@b.co', province: 'ontario!' }]) {
      const res = mockRes();
      await handler(ask(body), res);
      expect(res.statusCode, JSON.stringify(body)).toBe(400);
    }
    expect(inserts).toHaveLength(0);
  });
});

describe('api/track team enquiries', () => {
  const ask = (body, headers = {}) => req({ kind: 'team_enquiry', session_id: SID, email: 'geo@example.com', company: 'Star Copper', ...body }, { ip: uniqueIp(), 'user-agent': 'Mozilla/5.0', ...headers });

  it('stores the enquiry and returns a signed upload URL per declared file', async () => {
    const res = mockRes();
    await handler(ask({
      name: 'Pat', projects: 'Star project', materials: ['claims', 'sections_3d', 'bogus'], service_level: 'maps_presentation',
      deadline: '2026-11-15', deadline_note: 'AGM deck', message: 'Drilling starts soon', ref: '3d',
      files: [{ name: 'Collars 2026.CSV', size: 1200, type: 'text/csv' }, { name: 'huge.zip', size: 60 * 1024 * 1024 }],
    }), res);
    expect(res.statusCode).toBe(200);
    expect(inserts[0].table).toBe('team_enquiries');
    const row = inserts[0].row;
    expect(row).toMatchObject({
      email: 'geo@example.com', company: 'Star Copper', name: 'Pat', projects: 'Star project',
      materials: ['claims', 'sections_3d'], service_level: 'maps_presentation', deadline: '2026-11-15', ref: '3d',
    });
    // The over-size file is not offered an upload slot.
    expect(row.files).toEqual([{ name: 'Collars 2026.CSV', size: 1200, type: 'text/csv', path: `${row.id}/1-collars-2026.csv` }]);
    expect(res.body.id).toBe(row.id);
    expect(res.body.uploads).toHaveLength(1);
    expect(res.body.uploads[0].url).toContain(`team-enquiries/${row.id}/1-collars-2026.csv`);
  });

  it('refuses an enquiry with no way to reply or no company', async () => {
    for (const body of [{ email: 'nope' }, { company: '  ' }]) {
      const res = mockRes();
      await handler(ask(body), res);
      expect(res.statusCode, JSON.stringify(body)).toBe(400);
    }
    expect(inserts).toHaveLength(0);
  });

  it('drops unknown service levels and malformed deadlines rather than storing them', async () => {
    const res = mockRes();
    await handler(ask({ service_level: 'platinum', deadline: 'next week', ref: '<script>' }), res);
    expect(res.statusCode).toBe(200);
    expect(inserts[0].row).toMatchObject({ service_level: null, deadline: null, ref: null, files: [] });
  });
});
