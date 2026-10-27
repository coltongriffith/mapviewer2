import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({ shares: [], plans: {}, created: [], oauthEnabled: true, kits: [], projects: [], planReads: [], planError: null, planThrows: false, rateCalls: [], capability: undefined, capabilityReads: [] }));

vi.mock('../api/_lib/supabase-server.js', () => ({
  serverSupabase: () => ({
    from: (table) => {
      let userId;
      const query = {
        select: () => query,
        eq: (column, value) => { if (column === 'user_id') userId = value; return query; },
        gt: () => query,
        order: () => Promise.resolve({ data: db.shares.map((at) => ({ created_at: at })), error: null }),
        maybeSingle: () => {
          if (table === 'user_plans') {
            db.planReads.push(userId);
            if (db.planThrows) return Promise.reject(new Error('Plan lookup unavailable'));
            return Promise.resolve({ data: db.plans[userId] ?? null, error: db.planError });
          }
          return Promise.resolve({ data: null, error: null });
        },
      };
      return query;
    },
    rpc: (name, args) => { db.rateCalls.push({ name, args }); return Promise.resolve({ data: name === 'check_rate_limit' ? false : null, error: null }); },
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
      if (name === 'get_company_connector_allowance') {
        db.capabilityReads.push({ token, args });
        if (db.capability === 'throws') return Promise.reject(new Error('Unavailable'));
        return Promise.resolve(db.capability === undefined
          ? { data: { version: 1, subject: `user-${token}`, previews: 200, searches: 600 }, error: null }
          : db.capability);
      }
      db.created.push({ token, name, args });
      return Promise.resolve({ data: 'acct-share', error: null });
    },
  }),
}));

vi.mock('../api/_lib/user-auth.js', () => ({
  authenticateUserBearer: async (req) => {
    const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (/^(free|pro|company)-/.test(token)) {
      if (!Object.hasOwn(db.plans, `user-${token}`)) db.plans[`user-${token}`] = { plan: token.split('-')[0] };
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
    Object.assign(db, { shares: [], plans: {}, created: [], oauthEnabled: true, kits: [], projects: [], planReads: [], planError: null, planThrows: false, rateCalls: [], capability: undefined, capabilityReads: [] });
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

  it.each([30, 199, 200])('gives an explicitly stored Company account the bounded Pro preview allowance at %i existing previews', async count => {
    db.shares = Array.from({ length: count }, (_, i) => new Date(NOW - 3_000_000 + i * 1000).toISOString());
    const res = await call({ token: 'company-a', body: previewBody });
    const result = res.body.result.structuredContent;
    expect(db.planReads).toEqual(['user-company-a']);
    if (count < 200) {
      expect(result.allowance).toMatchObject({ tier: 'company', limit: 200, remaining: 199 - count });
      expect(result.warnings.join(' ')).toContain('Company');
      expect(db.created).toHaveLength(1);
      expect(db.created[0].token).toBe('company-a');
    } else {
      expect(result.error).toMatchObject({ code: 'RATE_LIMITED', tier: 'company', limit: 200 });
      expect(result.error.upgrade_url).toBeUndefined();
      expect(result.error.message).not.toContain('Upgrade to Pro');
      expect(db.created).toHaveLength(0);
    }
  });

  it.each([
    { plan: null },
    { plan: { plan: 'future-tier' } },
    { plan: { plan: 'company' }, error: { message: 'Plan query failed' } },
    { plan: { plan: 'company' }, throws: true },
  ])('uses only the Free allowance when the plan is missing, unknown or unavailable: %j', async scenario => {
    db.plans['user-free-safe'] = scenario.plan;
    db.planError = scenario.error || null; db.planThrows = scenario.throws || false;
    db.shares = shares(30, 50);
    const res = await call({ token: 'free-safe', body: previewBody });
    expect(res.body.result.structuredContent.error).toMatchObject({ code: 'RATE_LIMITED', tier: 'free', limit: 30 });
    expect(db.created).toHaveLength(0);
  });

  it('does not reuse another account’s Company plan or trust a caller-supplied plan', async () => {
    const handler = await freshHandler();
    const company = await send(handler, { token: 'company-owner', body: previewBody });
    expect(company.body.result.structuredContent.allowance.limit).toBe(200);
    db.shares = shares(30, 50);
    const res = await send(handler, { token: 'free-other', body: { ...previewBody, params: { ...previewBody.params, arguments: { ...previewBody.params.arguments, plan: 'company', user_id: 'user-company-owner' } } } });
    expect(res.body.result.structuredContent.error).toMatchObject({ tier: 'free', limit: 30 });
    expect(db.planReads).toEqual(['user-company-owner', 'user-free-other']);
    expect(db.created).toHaveLength(1);
  });

  it('keeps Company registry searches bounded by the existing Pro search allowance', async () => {
    await call({ token: 'company-search', body: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'search_mineral_claims', arguments: { jurisdiction: 'bc', query: 'Star' } } } });
    expect(db.rateCalls).toContainEqual({ name: 'check_rate_limit', args: expect.objectContaining({ p_bucket: 'mcp-search-account', p_max: 600, p_window_seconds: 3600 }) });
  });

  it.each([
    { data: null, error: { code: 'PGRST202' } },
    { data: null, error: { code: '42883' } },
    'throws',
    { data: null, error: null },
    { data: true, error: null },
    { data: [{ version: 1, subject: 'user-company-safe', previews: 200, searches: 600 }], error: null },
    ...[
      { version: 2 }, { subject: 'user-company-other' }, { previews: '200' },
      { previews: 201 }, { searches: 601 }, { version: undefined },
    ].map(patch => ({ data: { version: 1, subject: 'user-company-safe', previews: 200, searches: 600, ...patch }, error: null })),
    { data: { version: 1, subject: 'user-company-safe', previews: 200, searches: 600 }, error: { message: 'Unavailable' } },
  ])('keeps Company at 30 previews/90 searches unless capability is explicitly confirmed: %j', async capability => {
    db.capability = capability;
    db.shares = shares(30, 50);
    const handler = await freshHandler();
    const res = await send(handler, { token: 'company-safe', body: previewBody });
    const error = res.body.result.structuredContent.error;
    expect(error).toMatchObject({ tier: 'company', limit: 30, code: 'RATE_LIMITED' });
    expect(error.message).toContain('Company');
    expect(error.message).not.toMatch(/Free plan|Upgrade to Pro/);
    expect(error.upgrade_url).toBeUndefined();
    expect(db.created).toEqual([]);
    await send(handler, { token: 'company-safe', body: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'search_mineral_claims', arguments: { jurisdiction: 'bc', query: 'Star' } } } });
    expect(db.rateCalls).toContainEqual({ name: 'check_rate_limit', args: expect.objectContaining({ p_bucket: 'mcp-search-account', p_max: 90 }) });
  });

  it('rechecks capability on the same cached Company account after rollback and recovery', async () => {
    const handler = await freshHandler();
    db.shares = shares(30, 50);
    expect((await send(handler, { token: 'company-cache', body: previewBody })).body.result.structuredContent.allowance.limit).toBe(200);
    db.capability = { data: null, error: { code: 'PGRST202' } };
    expect((await send(handler, { token: 'company-cache', body: previewBody })).body.result.structuredContent.error.limit).toBe(30);
    db.capability = undefined;
    expect((await send(handler, { token: 'company-cache', body: previewBody })).body.result.structuredContent.allowance.limit).toBe(200);
    expect(db.planReads).toEqual(['user-company-cache']);
    expect(db.capabilityReads).toEqual(Array.from({ length: 3 }, () => ({ token: 'company-cache', args: undefined })));
  });

  it('reports the conservative Company allowance truthfully below the old limit', async () => {
    db.capability = { data: null, error: { code: 'PGRST202' } };
    db.shares = shares(29, 50);
    const result = (await call({ token: 'company-before-activation', body: previewBody })).body.result.structuredContent;
    expect(result.allowance).toMatchObject({ tier: 'company', limit: 30, remaining: 0 });
    expect(result.warnings.join(' ')).toContain('last of 30 previews this hour on Company');
    expect(result.warnings.join(' ')).not.toMatch(/Free plan|Upgrade to Pro/);
  });

  it('does not add capability lookups to Free, Pro or anonymous requests', async () => {
    for (const token of ['free-no-cap', 'pro-no-cap']) await call({ token, body: previewBody });
    await call({ query: {}, token: 'company-no-cap', body: { jsonrpc: '2.0', id: 1, method: 'tools/list' } });
    expect(db.capabilityReads).toEqual([]);
  });

  it('describes Company allowance as conditional until activation', async () => {
    db.capability = { data: null, error: { code: 'PGRST202' } };
    const tools = await call({ token: 'company-text', body: { jsonrpc: '2.0', id: 1, method: 'tools/list' } });
    expect(tools.body.result.tools.find(t => t.name === 'preview_exploration_map').description).toContain('Company uses 200 only when server support is confirmed; otherwise 30');
    const init = await call({ token: 'company-text', body: { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test', version: '1' } } } });
    expect(init.body.result.instructions).toContain('Company uses 200 only when server support is confirmed; otherwise 30');
  });

  it('does not look up a Company plan for an unauthenticated account request', async () => {
    db.plans['user-company-owner'] = { plan: 'company' };
    const res = await call({ token: 'invalid', body: previewBody });
    expect(res.statusCode).toBe(401);
    expect(db.planReads).toEqual([]);
    expect(db.created).toEqual([]);
  });

  it('keeps the public connector anonymous even if a Company bearer is supplied', async () => {
    db.shares = shares(10, 40);
    const res = await call({ query: {}, token: 'company-owner', body: previewBody });
    expect(res.body.result.structuredContent.error).toMatchObject({ code: 'RATE_LIMITED', tier: 'anonymous', limit: 10 });
    expect(db.planReads).toEqual([]);
    expect(db.created).toEqual([]);
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

  it('applies no kit when there are several and none is the default, and says so', async () => {
    // An agency keeps a kit per client company: guessing would put another
    // company's logo on the map.
    db.kits = [
      { token: 'pro-m', id: 'kit-a', name: 'Apex Critical Metals', is_default: false, config: { accentColor: '#111111' } },
      { token: 'pro-m', id: 'kit-b', name: 'Evolution Uranium', is_default: false, config: { accentColor: '#c9a227' } },
    ];
    const withArgs = (extra) => ({ ...previewBody, params: { ...previewBody.params, arguments: { ...previewBody.params.arguments, ...extra } } });

    let res = await call({ token: 'pro-m', body: previewBody });
    let result = res.body.result.structuredContent;
    expect(result.branding_applied.source).toBeNull();
    expect(db.created.at(-1).args.p_state.layout.accentColor).not.toBe('#111111');
    expect(result.warnings.join(' ')).toMatch(/No brand kit applied: the account has 2 brand kits and none is the default\. Pass brand_kit/);

    res = await call({ token: 'pro-m', body: withArgs({ brand_kit: 'kit-b' }) });
    result = res.body.result.structuredContent;
    expect(result.branding_applied.source).toBe('brand kit: Evolution Uranium');
    expect(db.created.at(-1).args.p_state.layout.accentColor).toBe('#c9a227');
    expect(result.warnings.join(' ')).not.toMatch(/No brand kit applied/);
  });

  it('treats two kits marked default as no clear default', async () => {
    db.kits = [
      { token: 'pro-d', id: 'kit-a', name: 'Apex Critical Metals', is_default: true, config: { accentColor: '#111111' } },
      { token: 'pro-d', id: 'kit-b', name: 'Evolution Uranium', is_default: true, config: { accentColor: '#c9a227' } },
      { token: 'pro-d', id: 'kit-c', name: 'Star Copper', is_default: false, config: {} },
    ];
    const res = await call({ token: 'pro-d', body: previewBody });
    const result = res.body.result.structuredContent;
    expect(result.branding_applied.source).toBeNull();
    expect(result.warnings.join(' ')).toMatch(/the account has 3 brand kits and 2 are marked default\. Pass brand_kit/);
  });

  it('applies the only kit even when it is not marked default', async () => {
    db.kits = [{ token: 'free-o', id: 'kit-o', name: 'Only Kit', is_default: false, config: { accentColor: '#0a7a50' } }];
    const res = await call({ token: 'free-o', body: previewBody });
    expect(res.body.result.structuredContent.branding_applied.source).toBe('brand kit: Only Kit');
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
