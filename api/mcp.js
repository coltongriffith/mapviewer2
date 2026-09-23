import { createHash } from 'node:crypto';
import { capabilities, AGENT_JURISDICTIONS, AGENT_BASEMAPS } from '../shared/agentSchema.js';
import { createAgentMapProject } from '../shared/agentMapBuilder.js';
import { runClaimsSearch } from './_lib/claims-internal.js';
import { resolveMapClaims } from './_lib/map-claims.js';
import { resolveBranding } from './_lib/branding.js';
import { claimSummary } from '../shared/claimData.js';
import { serverSupabase } from './_lib/supabase-server.js';
import { clientIp, rateLimited, rateLimitedShared } from './_lib/guard.js';

const SERVER_NAME = 'ExplorationMaps';
const SERVER_VERSION = '1.1.1'; // keep in step with server.json
const SERVER_INSTRUCTIONS = `ExplorationMaps creates mineral exploration maps from public registry records. For a request naming a company or project, identify the specific project before mapping. Search its claims, group records geographically, and pass verified claim_numbers to preview_exploration_map so unrelated projects stay out. If the project cannot be identified reliably, ask the user. When available, pass the company's HTTPS website in branding and verified project facts in facts_panel and claims_callout; do not invent ownership, grades, targets or coordinates. Choose a map type and basemap that match the request. The preview defaults to supported context overlays, nearby claims, a locator inset and a claim callout. After the call, report claims_found_primary separately from claims_found_neighbours, describe only layers_applied, and give the share_url. Public registry data is informational and is not a legal title opinion or survey. A rendered PNG and export pack are not currently returned by this MCP tool.`;
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
      default: 'investor',
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
    claim_numbers: { type: 'array', minItems: 1, maxItems: 40, uniqueItems: true, items: { type: 'string', pattern: '^[A-Za-z0-9.-]{1,40}$' }, description: 'Exact claim identifiers to map. Overrides search selection; all requested claims must be found.' },
    include: {
      oneOf: [
        { type: 'string', enum: ['all'] },
        { type: 'array', uniqueItems: true, maxItems: 8, items: { type: 'string', enum: ['claims', 'roads', 'settlements', 'labels', 'rail', 'geology'] } },
      ],
      default: 'all',
      description: 'Reference overlays. "all" enables those that suit the basemap: labels and rail always, roads/settlements only on white or light_grey, geology except on satellite. Pass a list to choose exactly.',
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
    basemap: { type: 'string', enum: AGENT_BASEMAPS, description: 'Main map basemap. Defaults by map type; geology uses the published bedrock overlay.' },
    basemap_opacity: { type: 'number', minimum: 0, maximum: 1, default: 1 },
    inset: { type: 'object', additionalProperties: false, properties: { show: { type: 'boolean', default: true }, basemap: { type: 'string', enum: AGENT_BASEMAPS } } },
    neighbours: { type: 'object', additionalProperties: false, properties: { show: { type: 'boolean', default: true }, label_holders: { type: 'boolean', default: true }, max_holders: { type: 'integer', minimum: 0, maximum: 8 } } },
    branding: { type: 'object', additionalProperties: false, properties: {
      website: { type: 'string', format: 'uri' }, logo_url: { type: 'string', format: 'uri' }, logo_url_dark: { type: 'string', format: 'uri' },
      primary_color: { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' }, accent_color: { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' }, font: { type: 'string', maxLength: 80 },
    } },
    facts_panel: { type: 'object', additionalProperties: false, properties: {
      project: { type: 'string' }, claims: { type: 'integer' }, hectares: { type: 'number' }, commodity: { type: 'string' }, ownership: { type: 'string' }, access: { type: 'string' }, tickers: { type: 'array', items: { type: 'string' } },
    } },
    claims_callout: { type: 'object', additionalProperties: false, properties: { show: { type: 'boolean', default: true }, anchor: { type: 'string', enum: ['auto'] }, fields: { type: 'object', additionalProperties: { type: 'string' } }, source_note: { type: 'string' }, style: { type: 'string', enum: ['brand', 'technical', 'minimal'] } } },
    annotations: { type: 'array', maxItems: 30, items: { type: 'object', additionalProperties: false, required: ['type', 'label', 'lat', 'lng'], properties: { type: { type: 'string', enum: ['target', 'airstrip', 'camp', 'mine', 'deposit', 'other'] }, label: { type: 'string' }, lat: { type: 'number' }, lng: { type: 'number' } } } },
  },
  // "One of search, location or claim_numbers" is enforced by
  // validateCreateMapInput, not a top-level anyOf: several MCP clients reject
  // tool input schemas with top-level anyOf/oneOf/allOf.
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
  // "query or bbox" is enforced in searchClaims — see PREVIEW_INPUT_SCHEMA.
};

const TOOLS = [
  {
    name: 'preview_exploration_map',
    title: 'Create a mineral exploration map preview',
    description: 'Create a branded mineral exploration map from public registry claims and return a shareable URL. Provide at least one of search, location or claim_numbers. For a specific project, search its claims first and pass exact claim_numbers. Supply published facts and branding when known; never invent ownership, targets, grades or coordinates. Supports separate neighbouring claims, a project callout, locator inset, and map basemap selection. Drill and NI 43-101 layouts require user-supplied data or qualified review; this tool does not generate drill results.',
    inputSchema: PREVIEW_INPUT_SCHEMA,
    outputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string' },
        share_url: { type: 'string', format: 'uri' },
        title: { type: 'string' },
        map_type: { type: 'string' },
        claims_found: { type: 'integer' },
        claims_found_primary: { type: 'integer' },
        claims_found_neighbours: { type: 'integer' },
        branding_applied: { type: 'object' },
        layers_applied: { type: 'array', items: { type: 'string' } },
        layers_empty: { type: 'array', items: { type: 'string' } },
        caption: { type: 'string' },
        alt_text: { type: 'string' },
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
    description: 'Search public mineral-claim registries by holder, exact claim number, claim name, or geographic bounding box; provide query, bbox, or both. Claim-name search is available for British Columbia and US BLM jurisdictions. Returns claim number as a string, name, holder, status, expiry, area and centroid when the registry supplies them. Cluster results geographically before selecting a specific project. Results are informational, not a legal title opinion or survey.',
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

function hashSubject(value) {
  return createHash('sha256').update(value).digest('hex').slice(0, 48);
}

// Per-caller key. ChatGPT sends an anonymised per-user `openai/subject`; other
// clients only identify themselves by clientInfo. Both are caller-supplied, so
// they only partition the budget — ipSubject() is the ceiling they cannot
// rotate their way past.
function callerSubject(req, toolName) {
  const ip = clientIp(req);
  const meta = req.body?.params?._meta || {};
  const user = typeof meta['openai/subject'] === 'string' ? meta['openai/subject'].slice(0, 200) : '';
  const clientName = String(meta['io.modelcontextprotocol/clientInfo']?.name || 'unknown').slice(0, 100);
  return hashSubject(user ? `mcp:${toolName}:openai:${user}` : `mcp:${toolName}:${ip}:${clientName}`);
}

function ipSubject(req, toolName) {
  return hashSubject(`mcp:${toolName}:ip:${clientIp(req)}`);
}

async function overToolLimit(sb, req, toolName, { perCaller, perIp, bucket }) {
  if (await rateLimitedShared(sb, req, { max: perCaller, windowSeconds: 60 * 60, bucket, subject: callerSubject(req, toolName) })) return true;
  return rateLimitedShared(sb, req, { max: perIp, windowSeconds: 60 * 60, bucket: `${bucket}-ip`, subject: ipSubject(req, toolName) });
}

async function createPreview(req, args) {
  if (args?.map_type && !['claims', 'investor', 'infrastructure'].includes(args.map_type)) {
    const error = new Error('Anonymous MCP previews support claims, investor, and infrastructure map types.');
    error.code = 'INVALID_REQUEST';
    throw error;
  }
  const normalizedBody = {
    map_type: args?.map_type || 'investor',
    title: args?.title,
    subtitle: args?.subtitle,
    jurisdiction: args?.jurisdiction || 'bc',
    search: args?.search,
    location: args?.location,
    include: args?.include ?? 'all',
    style: args?.style || 'investor_clean',
    company: args?.company,
    claim_numbers: args?.claim_numbers,
    branding: args?.branding,
    facts_panel: args?.facts_panel,
    claims_callout: args?.claims_callout,
    annotations: args?.annotations,
    neighbours: args?.neighbours,
    inset: args?.inset,
    basemap: args?.basemap,
    basemap_opacity: args?.basemap_opacity,
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
  // perCaller matches create_shared_map's anonymous limit (3 per creator key
  // per hour); a higher number only let calls 4-5 do the registry and branding
  // work and then fail at the share insert.
  if (await overToolLimit(sb, req, 'preview_exploration_map', { perCaller: 3, perIp: 60, bucket: 'mcp-preview' })) {
    const error = new Error('Free MCP preview limit reached. Try again later or connect an ExplorationMaps account.');
    error.code = 'RATE_LIMITED';
    throw error;
  }

  const { primary: claims, neighbours, neighboursWarning } = await resolveMapClaims(input, runClaimsSearch, clientIp(req));

  if (!claims?.features?.length) {
    const error = new Error('No matching mineral claims were found.');
    error.code = 'CLAIMS_NOT_FOUND';
    throw error;
  }
  if (Number.isInteger(input.facts_panel?.claims) && input.facts_panel.claims !== claims.features.length) {
    const error = new Error(`Published claim count (${input.facts_panel.claims}) does not match selected registry records (${claims.features.length}). Verify claim_numbers before creating the map.`);
    error.code = 'CLAIM_COUNT_MISMATCH';
    throw error;
  }

  input.branding = await resolveBranding({ ...input.branding, logo_url: input.style === 'modern_dark' ? input.branding.logo_url_dark || input.branding.logo_url : input.branding.logo_url });
  const project = createAgentMapProject(input, {
    featureCollection: claims,
    neighbours,
    source: jurisdiction?.registry,
    sourceMeta: claims.meta || null,
  });

  const { data: shareId, error: shareError } = await sb.rpc('create_shared_map', {
    p_state: project,
    p_creator_key: subject,
  });
  if (shareError) {
    const message = String(shareError.message || '');
    const error = new Error('The map preview could not be saved.');
    error.code = 'SHARE_FAILED';
    if (/SHARE_RATE_LIMIT/.test(message)) {
      error.message = 'Free MCP preview limit reached. Try again later or connect an ExplorationMaps account.';
      error.code = 'RATE_LIMITED';
    } else if (/SHARE_TOO_(LARGE|COMPLEX)/.test(message)) {
      error.message = 'This claim set is too large for a preview. Pass claim_numbers for one project, or set neighbours.show to false.';
      error.code = 'MAP_TOO_COMPLEX';
    }
    throw error;
  }

  const siteUrl = String(process.env.SITE_URL || 'https://explorationmaps.com').replace(/\/$/, '');
  const warnings = [
    ...sourceWarnings(input.jurisdiction, claims),
    ...(neighboursWarning ? [neighboursWarning] : []),
    'This map is generated from public registry data and is not a legal title opinion or legal survey.',
    'Anonymous preview links expire after 30 days.',
    'Reference overlays are configured on the map; third-party tile availability is checked when the share page renders.',
  ];
  const layersApplied = ['claims', input.basemap, ...input.include.filter((layer) => layer !== 'claims')];
  const layersEmpty = [];
  if (neighbours.features.length) layersApplied.push('neighbours'); else layersEmpty.push('neighbours');
  if (input.branding.logo_data_uri) layersApplied.push('company_logo'); else if (input.branding.website || input.branding.logo_url) layersEmpty.push('company_logo');
  if (input.annotations.length) layersApplied.push('annotations');
  if (input.claims_callout.show !== false) layersApplied.push('claims_callout');
  if (input.inset.show) layersApplied.push('locator_inset');
  if (input.facts_panel) layersApplied.push('facts_panel');
  const caption = `Figure 1. ${input.title}: ${claims.features.length} mineral claims in ${jurisdiction?.label || input.jurisdiction}, from ${jurisdiction?.registry || 'public registry'} records accessed ${new Date().toISOString().slice(0, 10)}. Verify current title with the registry.`;
  const altText = `Map of ${input.title} showing ${claims.features.length} selected mineral claims${neighbours.features.length ? ` and ${neighbours.features.length} neighbouring claims` : ''} in ${jurisdiction?.label || input.jurisdiction}.`;

  return {
    status: 'ready',
    share_url: `${siteUrl}/map/${shareId}`,
    title: input.title,
    map_type: input.map_type,
    claims_found: claims.features.length,
    claims_found_primary: claims.features.length,
    claims_found_neighbours: neighbours.features.length,
    branding_applied: { logo: Boolean(input.branding.logo_data_uri), primary_color: input.branding.primary_color || '#2563eb', source: input.branding.source || null },
    layers_applied: layersApplied,
    layers_empty: layersEmpty,
    caption,
    alt_text: altText,
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
  if (await overToolLimit(sb, req, 'search_mineral_claims', { perCaller: 30, perIp: 300, bucket: 'mcp-search' })) {
    const error = new Error('Mineral-registry search rate limit reached.');
    error.code = 'RATE_LIMITED';
    throw error;
  }

  const { primary: claims } = await resolveMapClaims({
    jurisdiction,
    search: { query, type },
    location: { bbox },
    claim_numbers: [],
    neighbours: { show: false },
  }, runClaimsSearch, clientIp(req));

  const summaries = (claims?.features || []).slice(0, limit).map(claimSummary);
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
    if (body.method.startsWith('notifications/') && body.id === undefined) {
      return res.status(202).end();
    }

    if (body.method === 'server/discover') {
      return res.status(200).json(jsonRpcResult(body.id, {
        supportedVersions: [MODERN_VERSION],
        capabilities: { tools: { listChanged: false } },
        instructions: SERVER_INSTRUCTIONS,
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
        instructions: SERVER_INSTRUCTIONS,
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
