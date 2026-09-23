import { describe, expect, it } from 'vitest';
import handler from '../api/mcp.js';

function mockReq({
  method = 'POST',
  body = null,
  headers = {},
  query = {},
} = {}) {
  return {
    method,
    body,
    headers: {
      'x-forwarded-for': '203.0.113.18',
      ...headers,
    },
    query,
    url: '/mcp',
  };
}

function mockRes() {
  return {
    statusCode: 200,
    headers: {},
    body: undefined,
    ended: false,
    setHeader(name, value) {
      this.headers[String(name).toLowerCase()] = value;
      return this;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(value) {
      this.body = value;
      return this;
    },
    end(value) {
      this.body = value;
      this.ended = true;
      return this;
    },
  };
}

describe('ExplorationMaps MCP endpoint', () => {
  it('supports modern server discovery', async () => {
    const req = mockReq({
      headers: {
        'mcp-protocol-version': '2026-07-28',
        'mcp-method': 'server/discover',
      },
      body: {
        jsonrpc: '2.0',
        id: 1,
        method: 'server/discover',
        params: {
          _meta: {
            'io.modelcontextprotocol/protocolVersion': '2026-07-28',
            'io.modelcontextprotocol/clientCapabilities': {},
          },
        },
      },
    });
    const res = mockRes();
    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.result.resultType).toBe('complete');
    expect(res.body.result.supportedVersions).toContain('2026-07-28');
    expect(res.body.result.capabilities.tools).toBeTruthy();
    expect(res.body.result._meta['io.modelcontextprotocol/serverInfo'].name).toBe('ExplorationMaps');
    expect(res.headers['mcp-protocol-version']).toBe('2026-07-28');
  });

  it('lists deterministic mining tools with accurate review annotations', async () => {
    const req = mockReq({
      headers: {
        'mcp-protocol-version': '2026-07-28',
        'mcp-method': 'tools/list',
      },
      body: {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/list',
        params: {
          _meta: {
            'io.modelcontextprotocol/protocolVersion': '2026-07-28',
          },
        },
      },
    });
    const res = mockRes();
    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.result.resultType).toBe('complete');
    const names = res.body.result.tools.map((tool) => tool.name);
    expect(names).toEqual([
      'preview_exploration_map',
      'search_mineral_claims',
      'get_mapping_capabilities',
    ]);
    expect(res.body.result.tools[0].annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: true,
    });
    expect(res.body.result.tools[1].annotations.readOnlyHint).toBe(true);
    expect(res.body.result.ttlMs).toBe(60_000);
    expect(res.body.result.cacheScope).toBe('public');
  });

  it('serves legacy initialize clients on the same endpoint', async () => {
    const req = mockReq({
      body: {
        jsonrpc: '2.0',
        id: 3,
        method: 'initialize',
        params: {
          protocolVersion: '2025-11-25',
          capabilities: {},
          clientInfo: { name: 'legacy-test', version: '1.0.0' },
        },
      },
    });
    const res = mockRes();
    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.result.protocolVersion).toBe('2025-11-25');
    expect(res.body.result.serverInfo.name).toBe('ExplorationMaps');
    expect(res.body.result.capabilities.tools).toBeTruthy();
  });

  it('can call the static capabilities tool without authentication', async () => {
    const req = mockReq({
      headers: {
        'mcp-protocol-version': '2026-07-28',
        'mcp-method': 'tools/call',
        'mcp-name': 'get_mapping_capabilities',
      },
      body: {
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: {
          name: 'get_mapping_capabilities',
          arguments: {},
          _meta: {
            'io.modelcontextprotocol/protocolVersion': '2026-07-28',
          },
        },
      },
    });
    const res = mockRes();
    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.result.isError).toBe(false);
    expect(res.body.result.structuredContent.product).toBe('ExplorationMaps');
    expect(res.body.result.structuredContent.map_types.length).toBeGreaterThan(0);
  });

  it('returns a protocol error for an unknown tool', async () => {
    const req = mockReq({
      headers: {
        'mcp-protocol-version': '2026-07-28',
        'mcp-method': 'tools/call',
        'mcp-name': 'not_a_real_tool',
      },
      body: {
        jsonrpc: '2.0',
        id: 41,
        method: 'tools/call',
        params: {
          name: 'not_a_real_tool',
          arguments: {},
          _meta: {
            'io.modelcontextprotocol/protocolVersion': '2026-07-28',
          },
        },
      },
    });
    const res = mockRes();
    await handler(req, res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error.code).toBe(-32602);
  });

  it('rejects routing-header/body mismatches', async () => {
    const req = mockReq({
      headers: {
        'mcp-protocol-version': '2026-07-28',
        'mcp-method': 'tools/list',
      },
      body: {
        jsonrpc: '2.0',
        id: 5,
        method: 'server/discover',
        params: {},
      },
    });
    const res = mockRes();
    await handler(req, res);

    expect(res.statusCode).toBe(400);
    expect(res.body.error.code).toBe(-32020);
  });

  it('validates browser origins and refuses GET', async () => {
    const badOriginReq = mockReq({
      headers: { origin: 'https://malicious.invalid' },
      body: { jsonrpc: '2.0', id: 6, method: 'tools/list', params: {} },
    });
    const badOriginRes = mockRes();
    await handler(badOriginReq, badOriginRes);
    expect(badOriginRes.statusCode).toBe(403);

    const getReq = mockReq({ method: 'GET' });
    const getRes = mockRes();
    await handler(getReq, getRes);
    expect(getRes.statusCode).toBe(405);
  });

  it('keeps tool input schemas free of top-level combinators', async () => {
    // Several MCP clients reject tool schemas with a top-level anyOf/oneOf/allOf,
    // which would take every tool on the connector down with it.
    const res = mockRes();
    await handler(mockReq({ body: { jsonrpc: '2.0', id: 7, method: 'tools/list', params: {} } }), res);
    for (const tool of res.body.result.tools) {
      expect(tool.inputSchema.type).toBe('object');
      for (const key of ['anyOf', 'oneOf', 'allOf']) expect(tool.inputSchema[key]).toBeUndefined();
    }
  });

  it('issues a session id on initialize so hosted clients are not rate limited as one caller', async () => {
    const res = mockRes();
    await handler(mockReq({ body: { jsonrpc: '2.0', id: 9, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'claude-ai', version: '1' } } } }), res);
    expect(res.headers['mcp-session-id']).toMatch(/^[\x21-\x7e]{16,128}$/);
    expect(res.headers['access-control-expose-headers']).toMatch(/Mcp-Session-Id/);
  });

  it('accepts any notification with 202 and no body', async () => {
    const res = mockRes();
    await handler(mockReq({ body: { jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 3 } } }), res);
    expect(res.statusCode).toBe(202);
    expect(res.body).toBeUndefined();
  });

  it('still requires a query or bbox for claim search', async () => {
    const res = mockRes();
    await handler(mockReq({ body: { jsonrpc: '2.0', id: 8, method: 'tools/call', params: { name: 'search_mineral_claims', arguments: { jurisdiction: 'bc' } } } }), res);
    expect(res.body.result.isError).toBe(true);
    expect(res.body.result.structuredContent.error.message).toMatch(/query or bbox/);
  });
});
