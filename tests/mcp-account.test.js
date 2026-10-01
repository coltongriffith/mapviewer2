import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({ shares: [], plans: {}, created: [], oauthEnabled: true }));

vi.mock('../api/_lib/supabase-server.js', () => ({
  serverSupabase: () => ({
    from: (table) => {
      const query = {
        select: () => query,
        eq: () => query,
        gt: () => query,
        order: () => Promise.resolve({ data: db.shares.map((at) => ({ created_at: at })), error: null }),
        maybeSingle: () => Promise.resolve({ data: table === 'user_plans' ? db.plans.current : null, error: null }),
      };
      return query;
    },
    rpc: (name) => Promise.resolve({ data: name === 'check_rate_limit' ? false : null, error: null }),
  }),
  // Signed-in previews must be created as the user, never with a creator key.
  userSupabase: (token) => ({
    rpc: (name, args) => {
      db.created.push({ token, name, args });
      return Promise.resolve({ data: 'acct-share', error: null });
    },
  }),
}));

vi.mock('../api/_lib/user-auth.js', () => ({
  authenticateUserBearer: async (req) => {
    const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (token.startsWith('free-') || token.startsWith('pro-')) {
      db.plans.current = { plan: token.startsWith('pro-') ? 'pro' : 'free' };
      return { ok: true, user: { id: `user-${token}`, email: 'geo@example.com' } };
    }
    return { ok: false, status: 401, message: 'Session is not valid.' };
  },
}));

vi.mock('../api/_lib/map-claims.js', () => ({
  resolveMapClaims: async () => ({
    primary: {
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        properties: { TENURE_NUMBER_ID: 71071, OWNER_NAME: 'Star Copper', FEATURE_AREA_SQM: 10000 },
        geometry: { type: 'Polygon', coordinates: [[[-130, 55], [-129.99, 55], [-129.99, 55.01], [-130, 55.01], [-130, 55]]] },
      }],
    },
    neighbours: { type: 'FeatureCollection', features: [] },
  }),
}));

const NOW = Date.parse('2026-10-01T16:40:00Z');
const minutesAgo = (n) => new Date(NOW - n * 60_000).toISOString();
const shares = (n, oldest) => Array.from({ length: n }, (_, i) => minutesAgo(oldest - i));

// A fresh module per test: the sign-in availability and account caches are
// per-instance state.
async function call({ method = 'POST', query = { auth: 'account' }, token, body } = {}) {
  vi.resetModules();
  const { default: handler } = await import('../api/mcp.js');
  const res = {
    statusCode: 200,
    headers: {},
    setHeader(name, value) { this.headers[String(name).toLowerCase()] = value; return this; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
    end(value) { this.body = value; return this; },
  };
  await handler({
    method,
    url: '/mcp/account',
    query,
    headers: {
      host: 'www.explorationmaps.com',
      'x-forwarded-for': '203.0.113.18',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body,
  }, res);
  return res;
}

const previewBody = {
  jsonrpc: '2.0', id: 1, method: 'tools/call',
  params: { name: 'preview_exploration_map', arguments: { title: 'Star Project', jurisdiction: 'bc', claim_numbers: ['71071'] } },
};

describe('MCP account connector', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    process.env.SUPABASE_URL = 'https://proj.supabase.co';
    Object.assign(db, { shares: [], plans: {}, created: [], oauthEnabled: true });
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: db.oauthEnabled })));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    delete process.env.SUPABASE_URL;
  });

  it('publishes protected resource metadata pointing at Supabase Auth', async () => {
    const res = await call({ method: 'GET', query: { wellknown: 'protected-resource' } });
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      resource: 'https://www.explorationmaps.com/mcp/account',
      authorization_servers: ['https://proj.supabase.co/auth/v1'],
    });
    expect(res.headers['access-control-allow-origin']).toBe('*');
  });

  it('challenges an unsigned request so the client starts OAuth', async () => {
    const res = await call({ body: { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {} } } });
    expect(res.statusCode).toBe(401);
    expect(res.headers['www-authenticate']).toBe('Bearer resource_metadata="https://www.explorationmaps.com/.well-known/oauth-protected-resource/mcp/account"');
  });

  it('marks a rejected token invalid', async () => {
    const res = await call({ token: 'expired', body: { jsonrpc: '2.0', id: 1, method: 'tools/list' } });
    expect(res.statusCode).toBe(401);
    expect(res.headers['www-authenticate']).toMatch(/error="invalid_token"/);
  });

  it('points to the open connector until the OAuth server is switched on', async () => {
    db.oauthEnabled = false;
    const res = await call({ body: { jsonrpc: '2.0', id: 1, method: 'tools/list' } });
    expect(res.statusCode).toBe(503);
    expect(res.body.error.message).toMatch(/\/mcp\/server/);
  });

  it('states the signed-in allowance in the tool description', async () => {
    const res = await call({ token: 'free-a', body: { jsonrpc: '2.0', id: 1, method: 'tools/list' } });
    const preview = res.body.result.tools.find((tool) => tool.name === 'preview_exploration_map');
    expect(preview.description).toMatch(/Signed-in use allows 30 previews per hour on the Free plan and 200 on Pro/);
  });

  it('saves a signed-in preview to the account with the plan allowance', async () => {
    db.shares = shares(4, 30);
    const res = await call({ token: 'free-b', body: previewBody });
    const result = res.body.result.structuredContent;
    expect(result.allowance).toEqual({ tier: 'free', limit: 30, remaining: 25, window_seconds: 3600 });
    expect(result.expires_in_days).toBeNull();
    expect(result.warnings).toContain('This map is saved to your ExplorationMaps account and does not expire.');
    expect(result.warnings).toContain('Previews left this hour: 25 of 30 on the Free plan.');
    expect(db.created).toEqual([{ token: 'free-b', name: 'create_shared_map', args: { p_state: expect.any(Object) } }]);
  });

  it('offers Pro when a Free account reaches its allowance', async () => {
    db.shares = shares(30, 50);
    const res = await call({ token: 'free-c', body: previewBody });
    const { error } = res.body.result.structuredContent;
    expect(error).toMatchObject({ code: 'RATE_LIMITED', tier: 'free', limit: 30, upgrade_url: 'https://explorationmaps.com/account' });
    expect(error.message).toBe('Preview limit reached: 30 map previews per hour on the Free plan. The next preview is available at 16:50 UTC (in 10 minutes). Upgrade to Pro for 200 per hour at https://explorationmaps.com/account.');
    expect(db.created).toEqual([]);
  });

  it('gives Pro accounts 200 an hour', async () => {
    db.shares = shares(30, 50);
    const res = await call({ token: 'pro-a', body: previewBody });
    expect(res.body.result.structuredContent.allowance).toMatchObject({ tier: 'pro', limit: 200, remaining: 169 });
  });

  it('tells a capped anonymous caller about the account connector once sign-in is live', async () => {
    db.shares = shares(10, 40);
    const res = await call({ query: {}, body: previewBody });
    expect(res.body.result.structuredContent.error.message).toMatch(/Signed-in accounts get 30 per hour: add the ExplorationMaps account connector at https:\/\/www\.explorationmaps\.com\/mcp\/account and sign in\./);
  });
});
