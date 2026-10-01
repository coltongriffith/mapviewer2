import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({ shares: [], plans: {}, created: [], oauthEnabled: true, kits: [], projects: [] }));

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
    // Rows the user can read, filtered by eq() like RLS plus the query would.
    from: (table) => {
      let rows = (table === 'templates' ? db.kits : db.projects).filter((r) => r.token === token);
      const query = {
        select: () => query,
        eq: (col, value) => { rows = rows.filter((r) => col === 'user_id' || r[col] === value); return query; },
        is: () => query,
        order: () => query,
        limit: (n) => Promise.resolve({ data: rows.slice(0, n), error: null }),
        maybeSingle: () => Promise.resolve({ data: rows[0] || null, error: null }),
        then: (resolve) => resolve({ data: rows, error: null }),
      };
      return query;
    },
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

async function freshHandler() {
  vi.resetModules();
  return (await import('../api/mcp.js')).default;
}

// A fresh module per call: the sign-in availability and account caches are
// per-instance state.
async function call(options) {
  return send(await freshHandler(), options);
}

async function send(handler, { method = 'POST', query = { auth: 'account' }, token, body } = {}) {
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
    Object.assign(db, { shares: [], plans: {}, created: [], oauthEnabled: true, kits: [], projects: [] });
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

  it('rechecks a failed sign-in availability probe after 30 seconds', async () => {
    const handler = await freshHandler();
    const body = { jsonrpc: '2.0', id: 1, method: 'tools/list' };
    db.oauthEnabled = false;
    expect((await send(handler, { body })).statusCode).toBe(503);
    db.oauthEnabled = true;
    vi.setSystemTime(NOW + 20_000);
    expect((await send(handler, { body })).statusCode).toBe(503);
    vi.setSystemTime(NOW + 31_000);
    expect((await send(handler, { body })).statusCode).toBe(401);
    // A success is trusted for ten minutes without probing again.
    db.oauthEnabled = false;
    vi.setSystemTime(NOW + 9 * 60_000);
    expect((await send(handler, { body })).statusCode).toBe(401);
    expect(fetch).toHaveBeenCalledTimes(2);
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
    expect(result.png_download_url).toBe(`${result.share_url}?download=png`);
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

  it('applies the account\'s brand kit, and lists saved maps to copy a look from', async () => {
    const logo = 'data:image/png;base64,AAAA';
    db.kits = [{ token: 'pro-k', id: 'kit-1', name: 'Evolution', is_default: true, config: { logo, accentColor: '#c9a227', themeId: 'modern_dark', templateId: 'other', referenceOverlays: { roads: false } } }];
    db.projects = [{ token: 'pro-k', id: 'map-1', name: 'Tenure figure', updated_at: '2026-09-30T00:00:00Z', layout: { accentColor: '#112233', logoCorner: 'top-left', fonts: { title: 'Lora' } } }];

    let res = await call({ token: 'pro-k', body: previewBody });
    let result = res.body.result.structuredContent;
    expect(result.branding_applied).toMatchObject({ logo: true, primary_color: '#c9a227', source: 'brand kit: Evolution' });
    expect(result.layers_applied).toContain('company_logo');
    const layout = db.created.at(-1).args.p_state.layout;
    expect(layout).toMatchObject({ logo, accentColor: '#c9a227', themeId: 'modern_dark' });
    // The kit styles the map; it does not change its type or overlays.
    expect(layout.templateId).not.toBe('other');
    expect(layout.referenceOverlays).not.toEqual({ roads: false });

    res = await call({ token: 'pro-k', body: { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'list_my_maps', arguments: {} } } });
    expect(res.body.result.structuredContent).toMatchObject({
      maps: [expect.objectContaining({ id: 'map-1', name: 'Tenure figure' })],
      brand_kits: [expect.objectContaining({ id: 'kit-1', name: 'Evolution', is_default: true })],
    });

    res = await call({ token: 'pro-k', body: { ...previewBody, params: { ...previewBody.params, arguments: { ...previewBody.params.arguments, style_from_map: 'map-1', style: 'investor_clean' } } } });
    expect(res.body.result.structuredContent.branding_applied.source).toBe('saved map: Tenure figure');
    expect(db.created.at(-1).args.p_state.layout).toMatchObject({ accentColor: '#112233', logoCorner: 'top-left', themeId: 'investor_clean' });
    expect(db.created.at(-1).args.p_state.layout.fonts.title).toBe('Lora');
  });

  it('keeps branding the caller passed, and can skip the kit', async () => {
    db.kits = [{ token: 'free-k', id: 'kit-2', name: 'Kit', is_default: true, config: { accentColor: '#c9a227', themeId: 'modern_dark' } }];
    let res = await call({ token: 'free-k', body: { ...previewBody, params: { ...previewBody.params, arguments: { ...previewBody.params.arguments, branding: { primary_color: '#00aa00' } } } } });
    expect(db.created.at(-1).args.p_state.layout.accentColor).not.toBe('#c9a227');
    expect(db.created.at(-1).args.p_state.layout.themeId).toBe('modern_dark');
    res = await call({ token: 'free-k', body: { ...previewBody, params: { ...previewBody.params, arguments: { ...previewBody.params.arguments, use_brand_kit: false } } } });
    expect(res.body.result.structuredContent.branding_applied.source).toBeNull();
    expect(db.created.at(-1).args.p_state.layout.themeId).toBe('investor_clean');
  });

  it('rejects a map id that is not the user\'s', async () => {
    db.projects = [{ token: 'someone-else', id: 'map-x', name: 'Not yours', layout: {} }];
    const res = await call({ token: 'pro-z', body: { ...previewBody, params: { ...previewBody.params, arguments: { ...previewBody.params.arguments, style_from_map: 'map-x' } } } });
    expect(res.body.result.structuredContent.error).toMatchObject({ code: 'NOT_FOUND' });
    expect(db.created).toEqual([]);
  });

  it('offers list_my_maps and the look options only when signed in', async () => {
    const signedIn = (await call({ token: 'free-a', body: { jsonrpc: '2.0', id: 1, method: 'tools/list' } })).body.result.tools;
    expect(signedIn.map((t) => t.name)).toContain('list_my_maps');
    expect(Object.keys(signedIn.find((t) => t.name === 'preview_exploration_map').inputSchema.properties)).toEqual(expect.arrayContaining(['brand_kit', 'style_from_map', 'use_brand_kit']));
    const anonymous = (await call({ query: {}, body: { jsonrpc: '2.0', id: 1, method: 'tools/list' } })).body.result.tools;
    expect(anonymous.map((t) => t.name)).not.toContain('list_my_maps');
    expect(anonymous.find((t) => t.name === 'preview_exploration_map').inputSchema.properties.style_from_map).toBeUndefined();
    const anonCall = await call({ query: {}, body: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'list_my_maps', arguments: {} } } });
    expect(anonCall.statusCode).toBe(400);
  });

  it('tells an anonymous caller how to use their account branding', async () => {
    const init = await call({ query: {}, body: { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {} } } });
    expect(init.body.result.instructions).toMatch(/cannot see the user's ExplorationMaps account, brand kit or saved maps.*\/mcp\/account/);
    const res = await call({ query: {}, body: previewBody });
    expect(res.body.result.structuredContent.warnings.join(' ')).toMatch(/no account branding.*\/mcp\/account/);
  });
});
