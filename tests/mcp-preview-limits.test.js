import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Shares this caller made, as seen by successive reads of shared_maps.
const db = vi.hoisted(() => ({ reads: [], ipLimited: false, insertError: null, rpcCalls: [] }));

vi.mock('../api/_lib/supabase-server.js', () => ({
  serverSupabase: () => ({
    from: () => {
      const query = {
        select: () => query,
        eq: () => query,
        gt: () => query,
        order: () => {
          const times = db.reads.length > 1 ? db.reads.shift() : db.reads[0] || [];
          return Promise.resolve({ data: times.map((at) => ({ created_at: at })), error: null });
        },
      };
      return query;
    },
    rpc: (name) => {
      db.rpcCalls.push(name);
      if (name === 'check_rate_limit') return Promise.resolve({ data: db.ipLimited, error: null });
      if (name === 'create_shared_map') {
        return Promise.resolve(db.insertError ? { data: null, error: db.insertError } : { data: 'share123', error: null });
      }
      return Promise.resolve({ data: null, error: null });
    },
  }),
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

const { default: handler } = await import('../api/mcp.js');

const NOW = Date.parse('2026-10-01T16:40:00Z');
const minutesAgo = (n) => new Date(NOW - n * 60_000).toISOString();
// n shares, oldest `oldest` minutes ago, the rest a minute apart after it.
const shares = (n, oldest) => Array.from({ length: n }, (_, i) => minutesAgo(oldest - i));

async function preview() {
  const res = {
    statusCode: 200,
    headers: {},
    setHeader(name, value) { this.headers[String(name).toLowerCase()] = value; return this; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
    end(value) { this.body = value; return this; },
  };
  await handler({
    method: 'POST',
    url: '/mcp',
    query: {},
    headers: { 'x-forwarded-for': '203.0.113.18', 'mcp-session-id': 'session-abcdefghijklmnop' },
    body: {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'preview_exploration_map', arguments: { title: 'Star Project', jurisdiction: 'bc', claim_numbers: ['71071'] } },
    },
  }, res);
  return res.body.result;
}

describe('MCP free preview allowance', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    Object.assign(db, { reads: [], ipLimited: false, insertError: null, rpcCalls: [] });
    // Supabase's OAuth server reads as off, so no sign-in offer is made here.
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false })));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('tells the caller how many free previews remain', async () => {
    db.reads = [shares(8, 30)];
    const result = await preview();
    expect(result.isError).toBe(false);
    expect(result.structuredContent.allowance).toEqual({ tier: 'anonymous', limit: 10, remaining: 1, window_seconds: 3600 });
    expect(result.structuredContent.warnings).toContain('Free previews left this hour: 1 of 10.');
  });

  it('says when the next preview frees up after the last one is used', async () => {
    db.reads = [shares(9, 50)];
    const result = await preview();
    expect(result.structuredContent.allowance.remaining).toBe(0);
    // The oldest share leaves the rolling hour 10 minutes from now.
    expect(result.structuredContent.allowance.next_available_at).toBe('2026-10-01T16:50:00.000Z');
    expect(result.structuredContent.warnings.at(-1)).toBe('That was the last of 10 free previews this hour. The next is available at 16:50 UTC (in 10 minutes).');
  });

  it('gives a capped caller the limit, reset time and editor link without doing the work', async () => {
    db.reads = [shares(10, 40)];
    const result = await preview();
    expect(result.isError).toBe(true);
    const { error } = result.structuredContent;
    expect(error).toMatchObject({
      code: 'RATE_LIMITED', scope: 'caller', limit: 10, window_seconds: 3600,
      resets_at: '2026-10-01T17:00:00.000Z', retry_after_seconds: 20 * 60, editor_url: 'https://explorationmaps.com/',
    });
    expect(error.message).toBe('Free preview limit reached: 10 map previews per hour. The next free preview is available at 17:00 UTC (in 20 minutes). To keep mapping now, use the ExplorationMaps editor at https://explorationmaps.com/, which has no preview limit.');
    expect(error.message).not.toMatch(/connect an ExplorationMaps account/);
    expect(db.rpcCalls).toEqual([]);
  });

  it('reports the shared network ceiling as capacity, not as the caller\'s allowance', async () => {
    db.ipLimited = true;
    const result = await preview();
    const { error } = result.structuredContent;
    expect(error).toMatchObject({ code: 'RATE_LIMITED', scope: 'network', limit: 300, resets_at: '2026-10-01T17:00:00.000Z' });
    expect(error.message).toMatch(/hourly preview capacity for requests from this network/);
    expect(db.rpcCalls).not.toContain('create_shared_map');
  });

  it('reports the real reset time when a concurrent call takes the last slot', async () => {
    db.reads = [shares(9, 45), shares(10, 45)];
    db.insertError = { message: 'SHARE_RATE_LIMIT: too many shares created recently' };
    const result = await preview();
    expect(result.structuredContent.error).toMatchObject({ code: 'RATE_LIMITED', scope: 'caller', resets_at: '2026-10-01T16:55:00.000Z' });
  });
});
