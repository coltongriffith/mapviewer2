import { createHash } from 'node:crypto';
import { capabilities, AGENT_JURISDICTIONS } from '../shared/agentSchema.js';
import { createAgentMapProject } from '../shared/agentMapBuilder.js';
import { runClaimsSearch } from './_lib/claims-internal.js';
import { serverSupabase } from './_lib/supabase-server.js';
import { clientIp, rateLimited, rateLimitedShared } from './_lib/guard.js';

const SERVER_NAME = 'ExplorationMaps';
const SERVER_VERSION = '1.0.0';
const MODERN_VERSION = '2026-07-28';
const LEGACY_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26'];
const SUPPORTED_VERSIONS = [MODERN_VERSION, ...LEGACY_VERSIONS];
const MAX_BODY_BYTES = 96 * 1024;

const ALLOWED_ORIGINS = new Set([
  'https://explorationmaps.com',
  'https://www.explorationmaps.com',
  'https://chatgpt.com',
  'https://openai.com',
  'https://platform.openai.com',
  'https://developers.openai.com',
  'https://claude.ai',
  'https://gemini.google.com',
  'https://aistudio.google.com',
]);

const PREVIEW_INPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    map_type: {
      type: 'string',
      enum: ['claims', 'investor', 'infrastructure'],
      default: 'claims',
      description: 'The mining-specific map format to create.',
    },
    title: {
      type: 'string',
      maxLength: 160,
      description: 'Optional finished-map title.',
    },
    subtitle: {
      type: 'string',
      maxLength: 160,
      description: 'Optional subtitle shown in the map frame.',
    },
    jurisdiction: {
      type: 'string',
      enum: Object.keys(AGENT_JURISDICTIONS),
      default: 'bc',
      description: 'Mineral-registry jurisdiction.',
    },
    search: {
      type: 'object',
      additionalProperties: false,
      required: ['query'],
      properties: {
        type: {
          type: 'string',
          enum: ['company', 'number', 'name'],
          default: 'company',
          description: 'Search by claim holder/company, claim number, or claim name.',
        },
        query: {
          type: 'string',
          minLength: 2,
          maxLength: 120,
          description: 'Company/holder name, claim number, or claim name.',
        },
      },
    },
    location: {
      type: 'object',
      additionalProperties: false,
      required: ['bbox'],
      properties: {
        bbox: {
          type: 'array',
          minItems: 4,
          maxItems: 4,
          items: { type: 'number' },
          description: 'Optional [minLng,minLat,maxLng,maxLat] bounding box instead of a text search.',
        },
      },
    },
    include: {
      type: 'array',
      uniqueItems: true,
      maxItems: 8,
      items: {
        type: 'string',
        enum: ['claims', 'roads', 'settlements', 'labels', 'rail', 'geology'],
      },
      default: ['claims', 'roads', 'settlements'],
      description: 'Context layers to turn on in the finished map.',
    },
    style: {
      type: 'string',
      enum: ['investor_clean', 'technical_sharp', 'modern_dark', 'warm_terrain'],
      default: 'investor_clean',
      description: 'ExplorationMaps visual theme.',
    },
    company: {
      type: 'object',
      additionalProperties: false,
      properties: {
        name: { type: 'string', maxLength: 160 },
      },
    },
  },
  anyOf: [
    { required: ['search'] },
    { required: ['location'] },
  ],
};

const SEARCH_INPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['jurisdiction'],
  properties: {
    jurisdiction: {
      type: 'string',
      enum: Object.keys(AGENT_JURISDICTIONS),
      description: 'Mineral-registry jurisdiction.',
    },
    search_type: {
      type: 'string',
      enum: ['company', 'number', 'name'],
      default: 'company',
      description: 'Search by holder/company, claim number, or claim name.',
    },
    query: {
      type: 'string',
      minLength: 2,
      maxLength: 120,
      description: 'Company/holder name, claim number, or claim name.',
    },
    bbox: {
      type: 'array',
      minItems: 4,
      maxItems: 4,
      items: { type: 'number' },
      description: 'Optional [minLng,minLat,maxLng,maxLat] spatial query.',
    },
    limit: {
      type: 'integer',
      minimum: 1,
      maximum: 100,
      default: 25,
      description: 'Maximum claim summaries returned to the model.',
    },
  },
  anyOf: [
    { required: ['query'] },
    { required: ['bbox'] },
  ],
};

const TOOLS = [
  {
    name: 'preview_exploration_map',
    title: 'Create a mineral exploration map preview',
    description: 'Create a professional mining claim, mineral tenure, investor-presentation, project-location, or infrastructure map from a supported public mineral registry. Use this when the user asks to make, draw, visualize, map, or present a mineral exploration property or claims. It returns a shareable ExplorationMaps URL. This tool does not accept uploaded drill or GeoJSON data; those require a connected ExplorationMaps account.',
    inputSchema: PREVIEW_INPUT_SCHEMA,
    outputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string' },
        share_url: { type: 'string', format: 'uri' },
        title: { type: 'string' },
        map_type: { type: 'string' },
        claims_found: { type: 'integer' },
        source: { type: 'string' },
        expires_in_days: { type: 'integer' },
        warnings: { type: 'array', items: { type: 'string' } },
      },
      required: ['status', 'share_url', 'title', 'map_type', 'claims_found', 'source', 'expires_in_days', 'warnings'],
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
  {
    name: 'search_mineral_claims',
    title: 'Search mineral claims and tenure',
    description: 'Search supported official mineral-claim registries by holder/company, claim number, claim name, or geographic bounding box. Use this to answer factual questions about claim records or to identify the ground that should be mapped. Results are registry records, not a legal title opinion or survey.',
    inputSchema: SEARCH_INPUT_SCHEMA,
    outputSchema: {
      type: 'object',
      properties: {
        jurisdiction: { type: 'string' },
        source: { type: 'string' },
        count: { type: 'integer' },
        returned: { type: 'integer' },
        claims: { type: 'array', items: { type: 'object' } },
        warnings: { type: 'array', items: { type: 'string' } },
      },
      required: ['jurisdiction', 'source', 'count', 'returned', 'claims', 'warnings'],
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  {
    name: 'get_mapping_capabilities',
    title: 'Get ExplorationMaps mapping capabilities',
    description: 'Return the map types, mineral-registry jurisdictions, context overlays, search modes, and styles supported by ExplorationMaps. Use this when deciding whether ExplorationMaps can fulfill a mapping request or when a jurisdiction is unclear.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {},
    },
    outputSchema: {
      type: 'object',
      additionalProperties: true,
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
];

function jsonRpcResult(id, result, modern = false) {
  const response = { jsonrpc: '2.0', id, result };
  if (modern) {
    response.result = {
      resultType: 'complete',
      ...result,
      _meta: {
        ...(result?._meta || {}),
        'io.modelcontextprotocol/serverInfo': {
          name: SERVER_NAME,
          version: SERVER_VERSION,
        },
      },
    };
  }
  return response;
}

function jsonRpcError(id, code, message, data = undefined) {
  return {
    jsonrpc: '2.0',
    id: id ?? null,
    error: {
      code,
      message,
      ...(data === undefined ? {} : { data }),
    },
  };
}

function parseBody(req) {
  if (req.body && typeof req.body === 'object' && !Array.isArray(req.body)) return req.body;
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch { return null; }
  }
  return null;
}

function modernRequest(req, body) {
  const headerVersion = String(req.headers?.['mcp-protocol-version'] || '');
  const metaVersion = body?.params?._meta?.['io.modelcontextprotocol/protocolVersion'];
  return headerVersion === MODERN_VERSION || metaVersion === MODERN_VERSION || body?.method === 'server/discover';
}

function validateRoutingHeaders(req, body) {
  const declaredVersion = req.headers?.['mcp-protocol-version'];
  if (declaredVersion && !SUPPORTED_VERSIONS.includes(String(declaredVersion))) {
    return jsonRpcError(body?.id, -32022, 'Unsupported protocol version.', { supported: SUPPORTED_VERSIONS });
  }

  const methodHeader = req.headers?.['mcp-method'];
  if (methodHeader && String(methodHeader) !== String(body?.method || '')) {
    return jsonRpcError(body?.id, -32020, 'Mcp-Method header does not match JSON-RPC method.');
  }

  const nameHeader = req.headers?.['mcp-name'];
  if (nameHeader && body?.method === 'tools/call' && String(nameHeader) !== String(body?.params?.name || '')) {
    return jsonRpcError(body?.id, -32020, 'Mcp-Name header does not match tool name.');
  }

  return null;
}

function sourceWarnings(jurisdiction, featureCollection) {
  const warnings = [];
  const cfg = AGENT_JURISDICTIONS[jurisdiction];
  if (cfg?.caveat) warnings.push(cfg.caveat);
  if (featureCollection?.meta?.degraded) {
    warnings.push('The registry response used degraded jurisdiction scoping; verify the mapped claims before relying on the figure.');
  }
  if (featureCollection?.meta?.relaxed) {
    warnings.push('The registry search was relaxed from the exact phrase supplied. Review the returned owners/claims.');
  }
  return warnings;
}

function simplifyClaim(feature) {
  const p = feature?.properties || {};
  const pick = (...keys) => {
    for (const key of keys) {
      if (p[key] !== undefined && p[key] !== null && String(p[key]).trim() !== '') return p[key];
      const found = Object.keys(p).find((k) => k.toLowerCase() === String(key).toLowerCase());
      if (found && p[found] !== undefined && p[found] !== null && String(p[found]).trim() !== '') return p[found];
    }
    return null;
  };
  return {
    claim_number: pick('TAG_NUMBER', 'TENURE_NUMBER_ID', 'CLAIM_NUMBER', 'SERIAL_NR', 'SERIAL_NO', 'claim_number', 'tag_number'),
    claim_name: pick('CLAIM_NAME', 'CSE_NAME', 'name', 'claim_name'),
    holder: pick('OWNER_NAME', 'HOLDER_NAME', 'CLAIMANT_NAME', 'owner_name', 'holder'),
    status: pick('STATUS', 'TENURE_STATUS', 'status'),
    good_to_date: pick('GOOD_TO_DATE', 'good_to_date', 'EXPIRY_DATE', 'expiration_date'),
    area_hectares: pick('AREA_HECTARES', 'AREA_HA', 'area_hectares'),
  };
}

function callerSubject(req, toolName) {
  const ip = clientIp(req);
  const clientName = req.body?.params?._meta?.['io.modelcontextprotocol/clientInfo']?.name || 'unknown';
  return createHash('sha256').update(`mcp:${toolName}:${ip}:${clientName}`).digest('hex').slice(0, 48);
}

async function createPreview(req, args) {
  if (args?.map_type && !['claims', 'investor', 'infrastructure'].includes(args.map_type)) {
    throw new Error('Anonymous MCP previews support claims, investor, and infrastructure map types.');
  }

  const normalizedBody = {
    map_type: args?.map_type || 'claims',
    title: args?.title,
    subtitle: args?.subtitle,
    jurisdiction: args?.jurisdiction || 'bc',
    search: args?.search,
    location: args?.location,
    include: args?.include,
    style: args?.style || 'investor_clean',
    company: args?.company,
  };

  // Mirror the high-level validation contract without accepting direct GeoJSON.
  const { validateCreateMapInput } = await import('../shared/agentSchema.js');
  const checked = validateCreateMapInput(normalizedBody);
  if (!checked.ok) {
    const error = new Error(checked.errors.join(' '));
    error.code = 'INVALID_REQUEST';
    throw error;
  }
  const input = checked.value;
  const jurisdiction = AGENT_JURISDICTIONS[input.jurisdiction];

  const sb = serverSupabase();
  const subject = callerSubject(req, 'preview_exploration_map');
  if (await rateLimitedShared(sb, req, {
    max: 5,
    windowSeconds: 60 * 60,
    bucket: 'mcp-preview',
    subject,
  })) {
    const error = new Error('Free MCP preview limit reached. Try again later or connect an ExplorationMaps account.');
    error.code = 'RATE_LIMITED';
    throw error;
  }

  const claims = await runClaimsSearch({
    jurisdiction: input.jurisdiction,
    query: input.search.query,
    type: input.search.type,
    bbox: input.location.bbox,
    clientIp: clientIp(req),
  });

  if (!claims?.features?.length) {
    const error = new Error('No matching mineral claims were found.');
    error.code = 'CLAIMS_NOT_FOUND';
    throw error;
  }

  const project = createAgentMapProject(input, {
    featureCollection: claims,
    source: jurisdiction?.registry,
    sourceMeta: claims.meta || null,
  });

  const { data: shareId, error: shareError } = await sb.rpc('create_shared_map', {
    p_state: project,
    p_creator_key: subject,
  });
  if (shareError) throw shareError;

  const siteUrl = String(process.env.SITE_URL || 'https://explorationmaps.com').replace(/\/$/, '');
  const warnings = [
    ...sourceWarnings(input.jurisdiction, claims),
    'This map is generated from public registry data and is not a legal title opinion or legal survey.',
    'Anonymous preview links expire after 30 days.',
  ];

  return {
    status: 'ready',
    share_url: `${siteUrl}/map/${shareId}`,
    title: input.title,
    map_type: input.map_type,
    claims_found: claims.features.length,
    source: jurisdiction?.registry || 'Official mineral registry',
    expires_in_days: 30,
    warnings,
  };
}

async function searchClaims(req, args) {
  const jurisdiction = String(args?.jurisdiction || '').toLowerCase();
  const cfg = AGENT_JURISDICTIONS[jurisdiction];
  if (!cfg) {
    const error = new Error(`Unsupported jurisdiction '${jurisdiction}'.`);
    error.code = 'INVALID_REQUEST';
    throw error;
  }
  const query = typeof args?.query === 'string' ? args.query.trim().slice(0, 120) : null;
  const bbox = Array.isArray(args?.bbox) ? args.bbox.map(Number) : null;
  if (!query && !bbox) {
    const error = new Error('Provide query or bbox.');
    error.code = 'INVALID_REQUEST';
    throw error;
  }
  const type = ['company', 'number', 'name'].includes(args?.search_type) ? args.search_type : 'company';
  const limit = Math.max(1, Math.min(100, Number(args?.limit) || 25));

  const sb = serverSupabase();
  const subject = callerSubject(req, 'search_mineral_claims');
  if (await rateLimitedShared(sb, req, {
    max: 30,
    windowSeconds: 60 * 60,
    bucket: 'mcp-search',
    subject,
  })) {
    const error = new Error('Mineral-registry search rate limit reached.');
    error.code = 'RATE_LIMITED';
    throw error;
  }

  const claims = await runClaimsSearch({
    jurisdiction,
    query,
    type,
    bbox,
    clientIp: clientIp(req),
  });

  const summaries = (claims?.features || []).slice(0, limit).map(simplifyClaim);
  return {
    jurisdiction: cfg.label,
    source: cfg.registry,
    count: claims?.features?.length || 0,
    returned: summaries.length,
    claims: summaries,
    warnings: [
      ...sourceWarnings(jurisdiction, claims),
      'Registry results are informational and are not a substitute for official title records or a legal survey.',
    ],
  };
}

async function callTool(req, name, args) {
  if (name === 'preview_exploration_map') return createPreview(req, args || {});
  if (name === 'search_mineral_claims') return searchClaims(req, args || {});
  if (name === 'get_mapping_capabilities') return capabilities();
  const error = new Error(`Unknown tool '${name}'.`);
  error.code = 'UNKNOWN_TOOL';
  throw error;
}

function callToolResponse(result) {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(result),
      },
    ],
    structuredContent: result,
    isError: false,
  };
}

function callToolError(error) {
  const code = error?.code || 'TOOL_ERROR';
  const message = String(error?.message || 'Tool call failed.');
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({ error: { code, message } }),
      },
    ],
    structuredContent: { error: { code, message } },
    isError: true,
  };
}

function setCors(req, res) {
  const origin = req.headers?.origin;
  if (origin && ALLOWED_ORIGINS.has(String(origin))) {
    res.setHeader('Access-Control-Allow-Origin', String(origin));
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'content-type, accept, authorization, mcp-protocol-version, mcp-method, mcp-name, mcp-param-*');
  res.setHeader('Access-Control-Expose-Headers', 'MCP-Protocol-Version, X-Request-Id');
}

export default async function handler(req, res) {
  setCors(req, res);
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS');
    return res.status(405).json(jsonRpcError(null, -32600, 'Streamable HTTP MCP endpoint accepts POST requests.'));
  }

  const origin = req.headers?.origin;
  if (origin && !ALLOWED_ORIGINS.has(String(origin))) {
    return res.status(403).json(jsonRpcError(null, -32030, 'Origin not allowed.'));
  }

  if (rateLimited(req, { max: 120, windowMs: 60_000, bucket: 'mcp-http' })) {
    return res.status(429).json(jsonRpcError(null, -32029, 'MCP rate limit exceeded.'));
  }

  const body = parseBody(req);
  if (!body) return res.status(400).json(jsonRpcError(null, -32700, 'Invalid JSON.'));
  if (Buffer.byteLength(JSON.stringify(body), 'utf8') > MAX_BODY_BYTES) {
    return res.status(413).json(jsonRpcError(body?.id, -32600, 'MCP request body too large.'));
  }
  req.body = body;

  if (body.jsonrpc !== '2.0' || typeof body.method !== 'string') {
    return res.status(400).json(jsonRpcError(body?.id, -32600, 'Invalid JSON-RPC request.'));
  }

  const routingError = validateRoutingHeaders(req, body);
  if (routingError) return res.status(400).json(routingError);

  const modern = modernRequest(req, body);
  if (modern) res.setHeader('MCP-Protocol-Version', MODERN_VERSION);

  try {
    if (body.method === 'notifications/initialized') {
      return res.status(202).end();
    }

    if (body.method === 'server/discover') {
      return res.status(200).json(jsonRpcResult(body.id, {
        supportedVersions: [MODERN_VERSION],
        capabilities: { tools: { listChanged: false } },
        instructions: 'ExplorationMaps is a mining-specific mapping server. Use preview_exploration_map when a user asks to create or visualize a mining claim, mineral tenure, investor, project-location, or infrastructure map. Use search_mineral_claims for factual claim-registry lookups. Public registry data must not be represented as a legal title opinion or legal survey.',
        ttlMs: 60_000,
        cacheScope: 'public',
      }, true));
    }

    if (body.method === 'initialize') {
      const requested = String(body.params?.protocolVersion || '2025-11-25');
      const negotiated = LEGACY_VERSIONS.includes(requested) ? requested : '2025-11-25';
      return res.status(200).json(jsonRpcResult(body.id, {
        protocolVersion: negotiated,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
        instructions: 'ExplorationMaps creates and searches professional mineral exploration maps using supported public mineral registries.',
      }, false));
    }

    if (body.method === 'ping') {
      return res.status(200).json(jsonRpcResult(body.id, {}, modern));
    }

    if (body.method === 'tools/list') {
      return res.status(200).json(jsonRpcResult(body.id, {
        tools: TOOLS,
        ...(modern ? { ttlMs: 60_000, cacheScope: 'public' } : {}),
      }, modern));
    }

    if (body.method === 'tools/call') {
      const name = body.params?.name;
      if (typeof name !== 'string' || !name) {
        return res.status(400).json(jsonRpcError(body.id, -32602, 'tools/call requires params.name.'));
      }
      try {
        const result = await callTool(req, name, body.params?.arguments || {});
        return res.status(200).json(jsonRpcResult(body.id, callToolResponse(result), modern));
      } catch (error) {
        if (error?.code === 'UNKNOWN_TOOL') {
          return res.status(400).json(jsonRpcError(body.id, -32602, String(error.message || 'Unknown tool.')));
        }
        return res.status(200).json(jsonRpcResult(body.id, callToolError(error), modern));
      }
    }

    if (body.method === 'resources/list') {
      return res.status(200).json(jsonRpcResult(body.id, { resources: [], ...(modern ? { ttlMs: 60_000, cacheScope: 'public' } : {}) }, modern));
    }

    if (body.method === 'prompts/list') {
      return res.status(200).json(jsonRpcResult(body.id, { prompts: [], ...(modern ? { ttlMs: 60_000, cacheScope: 'public' } : {}) }, modern));
    }

    return res.status(404).json(jsonRpcError(body.id, -32601, `Method not found: ${body.method}`));
  } catch (error) {
    if (process.env.NODE_ENV !== 'production') console.error('[mcp]', error);
    return res.status(500).json(jsonRpcError(body.id, -32603, 'Internal MCP server error.'));
  }
}
