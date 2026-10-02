import { createHash, randomUUID } from 'node:crypto';
import { capabilities, AGENT_JURISDICTIONS, AGENT_BASEMAPS } from '../shared/agentSchema.js';
import { createAgentMapProject } from '../shared/agentMapBuilder.js';
import { runClaimsSearch } from './_lib/claims-internal.js';
import { resolveMapClaims } from './_lib/map-claims.js';
import { resolveBranding } from './_lib/branding.js';
import { BRAND_KIT_SAVEABLE_KEYS, applyBrandKitConfig } from '../shared/brandKit.js';
import { claimSummary } from '../shared/claimData.js';
import { serverSupabase, userSupabase } from './_lib/supabase-server.js';
import { authenticateUserBearer } from './_lib/user-auth.js';
import { clientIp, rateLimited, rateLimitedShared } from './_lib/guard.js';

// Hourly preview allowance by tier. create_shared_map enforces the same
// numbers over a rolling hour (per creator key when anonymous, per account when
// signed in), so these are the figures users are told.
const PREVIEWS_PER_HOUR = { anonymous: 10, free: 30, pro: 200 };
// A map usually takes one to three claim searches.
const SEARCHES_PER_HOUR = { anonymous: 30, free: 90, pro: 600 };
// Abuse ceilings per egress IP, for anonymous calls only. Hosted assistants
// share egress IPs, so hitting one says nothing about the individual caller.
const NETWORK_PREVIEWS_PER_HOUR = 300;
const NETWORK_SEARCHES_PER_HOUR = 300;
const PLAN_LABEL = { free: 'the Free plan', pro: 'Pro' };
// Public connector URLs, on the host the docs and server.json advertise.
const CONNECTOR_ORIGIN = 'https://www.explorationmaps.com';
const LIMIT_TEXT = {
  anonymous: `Free use allows ${PREVIEWS_PER_HOUR.anonymous} previews per hour; allowance in the result reports how many remain.`,
  account: `Signed-in use allows ${PREVIEWS_PER_HOUR.free} previews per hour on the Free plan and ${PREVIEWS_PER_HOUR.pro} on Pro; allowance in the result reports how many remain.`,
};

const SERVER_NAME = 'ExplorationMaps';
const SERVER_VERSION = '1.1.1'; // keep in step with server.json
const SERVER_INSTRUCTIONS = `ExplorationMaps creates mineral exploration maps from public registry records. For a request naming a company or project, identify the specific project before mapping. Search its claims, group records geographically, and pass verified claim_numbers to preview_exploration_map so unrelated projects stay out. If the project cannot be identified reliably, ask the user. When available, pass the company's HTTPS website in branding and verified project facts in facts_panel and claims_callout; do not invent ownership, grades, targets or coordinates. Choose a map type and basemap that match the request. The preview defaults to supported context overlays, nearby claims, a locator inset and a claim callout. After the call, report claims_found_primary separately from claims_found_neighbours, describe only layers_applied, and give the share_url. For an image file, give png_download_url: opening it downloads the map as a PNG in the user's browser. This tool does not return image data itself. Public registry data is informational and is not a legal title opinion or survey.`;
const LIMIT_INSTRUCTIONS = {
  anonymous: ` Free use allows ${PREVIEWS_PER_HOUR.anonymous} map previews per hour: tell the user how many remain after each preview, and if the limit is reached, give them the reset time and links from the error. This connection is anonymous: it cannot see the user's ExplorationMaps account, brand kit or saved maps. If the user wants their account branding or saved maps, tell them to add ${CONNECTOR_ORIGIN}/mcp/account as a custom connector (Settings, Connectors, Add custom connector) and sign in there.`,
  account: ` The user is signed in to ExplorationMaps: ${PREVIEWS_PER_HOUR.free} map previews per hour on the Free plan, ${PREVIEWS_PER_HOUR.pro} on Pro. Tell the user how many remain after each preview, and if the limit is reached, give them the reset time and links from the error. Previews use the user's default brand kit (logo, colours, fonts, layout), or their only kit, automatically; omit style so the kit's theme applies. If the user has several kits and none is the default, none is applied: call list_my_maps, pick the kit for the company being mapped and pass its id as brand_kit, and ask the user if it is unclear. To match one of the user's saved maps, pass its id as style_from_map. Previews are saved to the user's account.`,
};

function instructionsFor(req) {
  return SERVER_INSTRUCTIONS + LIMIT_INSTRUCTIONS[req.account ? 'account' : 'anonymous'];
}
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
    facts_panel: { type: 'object', additionalProperties: false, description: 'Verified, published project facts, drawn in the project callout. claims must equal the number of mapped claims.', properties: {
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
    description: `Create a branded mineral exploration map from public registry claims and return a shareable URL. Provide at least one of search, location or claim_numbers. For a specific project, search its claims first and pass exact claim_numbers. Supply published facts and branding when known; never invent ownership, targets, grades or coordinates. Supports separate neighbouring claims, a project callout, locator inset, and map basemap selection. Drill and NI 43-101 layouts require user-supplied data or qualified review; this tool does not generate drill results. ${LIMIT_TEXT.anonymous}`,
    inputSchema: PREVIEW_INPUT_SCHEMA,
    outputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string' },
        share_url: { type: 'string', format: 'uri' },
        png_download_url: { type: 'string', format: 'uri' },
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
        expires_in_days: { type: ['integer', 'null'] },
        allowance: {
          type: 'object',
          properties: {
            tier: { type: 'string' },
            limit: { type: 'integer' },
            remaining: { type: 'integer' },
            window_seconds: { type: 'integer' },
            next_available_at: { type: 'string', format: 'date-time' },
          },
        },
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

// Signed in, previews take the account's look and the user's saved maps can
// be listed; everything else is the same as the anonymous connector.
const ACCOUNT_PREVIEW_PROPERTIES = {
  brand_kit: { type: 'string', format: 'uuid', description: 'Brand kit id from list_my_maps. Without it, the account\'s default kit (or its only kit) applies; with several kits and no default, none does.' },
  style_from_map: { type: 'string', format: 'uuid', description: 'Saved map id from list_my_maps: copy its logo, colours, fonts and layout. Overrides brand_kit.' },
  use_brand_kit: { type: 'boolean', default: true, description: 'Set false for the plain ExplorationMaps look.' },
};

const LIST_MY_MAPS_TOOL = {
  name: 'list_my_maps',
  title: 'List my saved maps and brand kits',
  description: 'List the signed-in user\'s saved ExplorationMaps maps and brand kits, newest first. Pass a map id as style_from_map, or a kit id as brand_kit, to preview_exploration_map to make a new map in the same style.',
  inputSchema: { type: 'object', additionalProperties: false, properties: {} },
  outputSchema: {
    type: 'object',
    properties: {
      maps: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' }, updated_at: { type: 'string' } } } },
      brand_kits: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' }, is_default: { type: 'boolean' } } } },
      dashboard_url: { type: 'string', format: 'uri' },
    },
    required: ['maps', 'brand_kits'],
  },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
};

const ACCOUNT_TOOLS = [
  ...TOOLS.map((tool) => (tool.name === 'preview_exploration_map'
    ? {
      ...tool,
      description: tool.description.replace(LIMIT_TEXT.anonymous, LIMIT_TEXT.account),
      inputSchema: { ...tool.inputSchema, properties: { ...tool.inputSchema.properties, ...ACCOUNT_PREVIEW_PROPERTIES } },
    }
    : tool)),
  LIST_MY_MAPS_TOOL,
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

// Session ids this server issues on initialize: visible ASCII, per the spec.
const SESSION_ID = /^[\x21-\x7e]{16,128}$/;

// Per-caller key. Hosted assistants call from shared egress IPs, so an IP-only
// key would give every user of one platform a single budget. ChatGPT sends an
// anonymised per-user `openai/subject`; legacy Streamable HTTP clients (Claude
// among them) echo the Mcp-Session-Id issued on initialize, i.e. one budget per
// conversation; anything else falls back to IP + clientInfo. All of these are
// caller-supplied, so they only partition the budget — ipSubject() is the
// ceiling they cannot rotate their way past.
function callerSubject(req, toolName) {
  if (req.account) return hashSubject(`mcp:${toolName}:user:${req.account.user.id}`);
  const ip = clientIp(req);
  const meta = req.body?.params?._meta || {};
  const user = typeof meta['openai/subject'] === 'string' ? meta['openai/subject'].slice(0, 200) : '';
  if (user) return hashSubject(`mcp:${toolName}:openai:${user}`);
  const session = String(req.headers?.['mcp-session-id'] || '');
  if (SESSION_ID.test(session)) return hashSubject(`mcp:${toolName}:session:${session}`);
  const clientName = String(meta['io.modelcontextprotocol/clientInfo']?.name || 'unknown').slice(0, 100);
  return hashSubject(`mcp:${toolName}:${ip}:${clientName}`);
}

function ipSubject(req, toolName) {
  return hashSubject(`mcp:${toolName}:ip:${clientIp(req)}`);
}

const HOUR_MS = 60 * 60_000;

function siteUrl() {
  return String(process.env.SITE_URL || 'https://explorationmaps.com').replace(/\/$/, '');
}

function supabaseUrl() {
  return String(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
}

function tierOf(req) {
  return req.account?.tier || 'anonymous';
}

// Creation times (ms) of the caller's shares in the rolling hour, oldest first:
// by account when signed in, else by creator key. Fails open (null) like the
// other limiters; create_shared_map still enforces the cap.
async function previewTimes(sb, req, subject) {
  try {
    const query = sb.from('shared_maps').select('created_at');
    const scoped = req.account ? query.eq('user_id', req.account.user.id) : query.eq('creator_key', subject);
    const { data, error } = await scoped
      .gt('created_at', new Date(Date.now() - HOUR_MS).toISOString())
      .order('created_at', { ascending: true });
    if (error || !Array.isArray(data)) return null;
    return data.map((row) => Date.parse(row.created_at)).filter(Number.isFinite);
  } catch {
    return null;
  }
}

// When the rolling-hour count next drops below the allowance.
function nextPreviewAt(times, limit) {
  return new Date(times[times.length - limit] + HOUR_MS);
}

// check_rate_limit counts in fixed clock-hour windows.
function nextClockHour() {
  return new Date((Math.floor(Date.now() / HOUR_MS) + 1) * HOUR_MS);
}

function secondsUntil(at) {
  return Math.max(1, Math.ceil((at.getTime() - Date.now()) / 1000));
}

function whenText(at) {
  const minutes = Math.ceil(secondsUntil(at) / 60);
  return `${at.toISOString().slice(11, 16)} UTC (in ${minutes} minute${minutes === 1 ? '' : 's'})`;
}

// Whether Supabase's OAuth server is switched on, so the account connector can
// be offered. A yes is trusted for ten minutes per instance; a no is rechecked
// after 30 seconds, so a timeout or 5xx does not turn sign-in away for long.
let signInState = { until: 0, ok: false };
async function accountSignInAvailable() {
  if (Date.now() < signInState.until) return signInState.ok;
  let ok = false;
  try {
    const response = await fetch(`${supabaseUrl()}/.well-known/oauth-authorization-server/auth/v1`, { signal: AbortSignal.timeout(2000) });
    ok = response.ok;
  } catch {
    ok = false;
  }
  signInState = { until: Date.now() + (ok ? 10 * 60_000 : 30_000), ok };
  return ok;
}

async function previewLimitError(req, scope, resetsAt) {
  const tier = tierOf(req);
  const editor = `${siteUrl()}/`;
  const upgradeUrl = `${siteUrl()}/account`;
  const when = whenText(resetsAt);
  let message;
  if (scope === 'network') {
    message = `ExplorationMaps has reached its hourly preview capacity for requests from this network. Try again at ${when}, or use the ExplorationMaps editor at ${editor}.`;
  } else if (tier === 'anonymous') {
    const signIn = await accountSignInAvailable()
      ? ` Signed-in accounts get ${PREVIEWS_PER_HOUR.free} per hour: add the ExplorationMaps account connector at ${CONNECTOR_ORIGIN}/mcp/account and sign in.`
      : '';
    message = `Free preview limit reached: ${PREVIEWS_PER_HOUR.anonymous} map previews per hour. The next free preview is available at ${when}.${signIn} To keep mapping now, use the ExplorationMaps editor at ${editor}, which has no preview limit.`;
  } else {
    const upgrade = tier === 'free' ? ` Upgrade to Pro for ${PREVIEWS_PER_HOUR.pro} per hour at ${upgradeUrl}.` : '';
    message = `Preview limit reached: ${PREVIEWS_PER_HOUR[tier]} map previews per hour on ${PLAN_LABEL[tier]}. The next preview is available at ${when}.${upgrade}`;
  }
  const error = new Error(message);
  error.code = 'RATE_LIMITED';
  error.details = {
    scope,
    tier,
    limit: scope === 'network' ? NETWORK_PREVIEWS_PER_HOUR : PREVIEWS_PER_HOUR[tier],
    window_seconds: HOUR_MS / 1000,
    resets_at: resetsAt.toISOString(),
    retry_after_seconds: secondsUntil(resetsAt),
    editor_url: editor,
    ...(tier === 'free' ? { upgrade_url: upgradeUrl } : {}),
  };
  return error;
}

function allowanceNotice({ tier, limit, remaining, next_available_at: nextAt }) {
  const plan = tier === 'anonymous' ? '' : ` on ${PLAN_LABEL[tier]}`;
  if (remaining) return `${tier === 'anonymous' ? 'Free previews' : 'Previews'} left this hour: ${remaining} of ${limit}${plan}.`;
  const upgrade = tier === 'free' ? ` Upgrade to Pro for ${PREVIEWS_PER_HOUR.pro} per hour at ${siteUrl()}/account.` : '';
  return `That was the last of ${limit} ${tier === 'anonymous' ? 'free ' : ''}previews this hour${plan}. The next is available at ${whenText(new Date(nextAt))}.${upgrade}`;
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
  const tier = tierOf(req);
  const limit = PREVIEWS_PER_HOUR[tier];
  // Read the caller's allowance from the shares create_shared_map counts, so
  // the stated number and reset time are exact and failed calls cost nothing.
  // Checked before the registry and branding work so a capped call fails fast.
  const times = await previewTimes(sb, req, subject);
  if (times && times.length >= limit) throw await previewLimitError(req, 'caller', nextPreviewAt(times, limit));
  if (!req.account && await rateLimitedShared(sb, req, {
    max: NETWORK_PREVIEWS_PER_HOUR, windowSeconds: HOUR_MS / 1000, bucket: 'mcp-preview-ip', subject: ipSubject(req, 'preview_exploration_map'),
  })) {
    throw await previewLimitError(req, 'network', nextClockHour());
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

  const accountChoice = req.account ? await accountLook(req, args) : null;
  const look = accountChoice?.config ? accountChoice : null;
  // The kit's accent also colours the callout and markers the builder draws.
  if (look && !input.branding?.primary_color && !input.branding?.accent_color && /^#[0-9a-f]{6}$/i.test(look.config.accentColor || '')) {
    input.branding = { ...input.branding, primary_color: look.config.accentColor };
  }
  input.branding = await resolveBranding({ ...input.branding, logo_url: input.style === 'modern_dark' ? input.branding.logo_url_dark || input.branding.logo_url : input.branding.logo_url });
  const project = createAgentMapProject(input, {
    featureCollection: claims,
    neighbours,
    source: jurisdiction?.registry,
    sourceMeta: claims.meta || null,
  });
  if (look) project.layout = applyAccountLook(project.layout, look, args);

  // Signed-in previews are created as the user, so the map is owned by the
  // account and does not expire; anonymous ones carry the caller's key.
  const { data: shareId, error: shareError } = req.account
    ? await userSupabase(req.account.token).rpc('create_shared_map', { p_state: project })
    : await sb.rpc('create_shared_map', { p_state: project, p_creator_key: subject });
  if (shareError) {
    const message = String(shareError.message || '');
    const error = new Error('The map preview could not be saved.');
    error.code = 'SHARE_FAILED';
    if (/SHARE_RATE_LIMIT/.test(message)) {
      // A concurrent call took the last slot after the check above.
      const latest = await previewTimes(sb, req, subject);
      throw await previewLimitError(req, 'caller', latest?.length >= limit ? nextPreviewAt(latest, limit) : new Date(Date.now() + HOUR_MS));
    } else if (/SHARE_TOO_(LARGE|COMPLEX)/.test(message)) {
      error.message = 'This claim set is too large for a preview. Pass claim_numbers for one project, or set neighbours.show to false.';
      error.code = 'MAP_TOO_COMPLEX';
    }
    throw error;
  }

  // This share now counts toward the caller's rolling hour.
  const after = times && [...times, Date.now()];
  const allowance = after && {
    tier,
    limit,
    remaining: Math.max(0, limit - after.length),
    window_seconds: HOUR_MS / 1000,
  };
  if (allowance && !allowance.remaining) allowance.next_available_at = nextPreviewAt(after, limit).toISOString();
  const warnings = [
    ...sourceWarnings(input.jurisdiction, claims),
    ...(neighboursWarning ? [neighboursWarning] : []),
    'This map is generated from public registry data and is not a legal title opinion or legal survey.',
    req.account ? 'This map is saved to your ExplorationMaps account and does not expire.' : 'Anonymous preview links expire after 30 days.',
    ...(accountChoice?.unchosenKits ? [`No brand kit applied: the account has ${accountChoice.unchosenKits} brand kits and none is the default. Pass brand_kit with the kit for this company (list_my_maps lists them), or set a default kit in ExplorationMaps.`] : []),
    ...(req.account ? [] : [`Anonymous preview: no account branding. To use your ExplorationMaps brand kit and saved maps, add ${CONNECTOR_ORIGIN}/mcp/account as a custom connector and sign in.`]),
    'Reference overlays are configured on the map; third-party tile availability is checked when the share page renders.',
  ];
  if (allowance) warnings.push(allowanceNotice(allowance));
  const layersApplied = ['claims', input.basemap, ...input.include.filter((layer) => layer !== 'claims')];
  const layersEmpty = [];
  if (neighbours.features.length) layersApplied.push('neighbours'); else layersEmpty.push('neighbours');
  if (project.layout.logo) layersApplied.push('company_logo'); else if (input.branding.website || input.branding.logo_url) layersEmpty.push('company_logo');
  if (input.annotations.length) layersApplied.push('annotations');
  if (input.claims_callout.show !== false) layersApplied.push('claims_callout');
  if (input.inset.show) layersApplied.push('locator_inset');
  // Facts are drawn inside the project callout (see createAgentMapProject).
  if (input.facts_panel && input.claims_callout.show !== false) layersApplied.push('facts_panel');
  else if (input.facts_panel) {
    layersEmpty.push('facts_panel');
    warnings.push('facts_panel is drawn in the project callout, which claims_callout.show=false turned off.');
  }
  const caption = `Figure 1. ${input.title}: ${claims.features.length} mineral claims in ${jurisdiction?.label || input.jurisdiction}, from ${jurisdiction?.registry || 'public registry'} records accessed ${new Date().toISOString().slice(0, 10)}. Verify current title with the registry.`;
  const altText = `Map of ${input.title} showing ${claims.features.length} selected mineral claims${neighbours.features.length ? ` and ${neighbours.features.length} neighbouring claims` : ''} in ${jurisdiction?.label || input.jurisdiction}.`;

  return {
    status: 'ready',
    share_url: `${siteUrl()}/map/${shareId}`,
    png_download_url: `${siteUrl()}/map/${shareId}?download=png`,
    title: input.title,
    map_type: input.map_type,
    claims_found: claims.features.length,
    claims_found_primary: claims.features.length,
    claims_found_neighbours: neighbours.features.length,
    branding_applied: { logo: Boolean(project.layout.logo), primary_color: input.branding.primary_color || '#2563eb', source: look?.source || input.branding.source || null },
    layers_applied: layersApplied,
    layers_empty: layersEmpty,
    caption,
    alt_text: altText,
    source: jurisdiction?.registry || 'Official mineral registry',
    expires_in_days: req.account ? null : 30,
    ...(allowance ? { allowance } : {}),
    warnings,
  };
}

// ── Account look and saved maps (signed in only) ────────────────────────────
// Keys that describe this map's content or type rather than the account's look.
const LOOK_CONTENT_KEYS = ['templateId', 'mode', 'compositionPreset', 'referenceOverlays', 'referenceOpacity', 'insetMode', 'footerText'];

function notFound(message) {
  const error = new Error(message);
  error.code = 'NOT_FOUND';
  return error;
}

// The look a signed-in preview takes: a saved map's (style_from_map), a chosen
// kit (brand_kit), or the account's default kit. Read as the user, so RLS
// limits it to their own rows.
async function accountLook(req, args) {
  if (args.use_brand_kit === false && !args.style_from_map) return null;
  const db = userSupabase(req.account.token);
  const userId = req.account.user.id;
  if (args.style_from_map) {
    const { data } = await db.from('projects').select('name, layout:payload->layout')
      .eq('id', args.style_from_map).eq('user_id', userId).is('deleted_at', null).maybeSingle();
    if (!data) throw notFound('style_from_map is not one of your saved maps. Call list_my_maps for ids.');
    const layout = data.layout || {};
    const config = Object.fromEntries(BRAND_KIT_SAVEABLE_KEYS.filter((k) => layout[k] !== undefined).map((k) => [k, layout[k]]));
    if (layout.fonts) config.fonts = layout.fonts;
    return { config, source: `saved map: ${data.name}` };
  }
  if (args.brand_kit) {
    const { data } = await db.from('templates').select('name, config')
      .eq('id', args.brand_kit).eq('user_id', userId).maybeSingle();
    if (!data) throw notFound('brand_kit is not one of your brand kits. Call list_my_maps for ids.');
    return { config: data.config || {}, source: `brand kit: ${data.name}` };
  }
  // Unasked, only an unambiguous kit applies: the default, or the only one.
  // Someone mapping for several companies keeps a kit per company, and the
  // most recent one would put another company's logo on the map.
  const { data: kits, error } = await db.from('templates').select('id, name, is_default').eq('user_id', userId);
  if (error || !kits?.length) return null;
  const chosen = kits.find((k) => k.is_default) || (kits.length === 1 ? kits[0] : null);
  if (!chosen) return { unchosenKits: kits.length };
  const { data } = await db.from('templates').select('name, config')
    .eq('id', chosen.id).eq('user_id', userId).maybeSingle();
  return data ? { config: data.config || {}, source: `brand kit: ${data.name}` } : null;
}

// Branding the caller passed explicitly wins over the account's look.
function applyAccountLook(layout, look, args) {
  const config = { ...look.config };
  for (const key of LOOK_CONTENT_KEYS) delete config[key];
  const branding = args.branding || {};
  if (branding.logo_url || branding.logo_url_dark || branding.website) delete config.logo;
  if (branding.primary_color || branding.accent_color) delete config.accentColor;
  if (branding.font) delete config.fonts;
  if (args.style) delete config.themeId;
  const next = applyBrandKitConfig(config, layout);
  return { ...next, exportSettings: { ...next.exportSettings, filename: layout.exportSettings?.filename } };
}

async function listMyMaps(req) {
  const db = userSupabase(req.account.token);
  const userId = req.account.user.id;
  const [maps, kits] = await Promise.all([
    db.from('projects').select('id, name, updated_at').eq('user_id', userId).is('deleted_at', null)
      .order('updated_at', { ascending: false }).limit(50),
    db.from('templates').select('id, name, is_default').eq('user_id', userId).order('created_at', { ascending: true }),
  ]);
  if (maps.error || kits.error) {
    const error = new Error('Your saved maps could not be loaded. Try again shortly.');
    error.code = 'ACCOUNT_UNAVAILABLE';
    throw error;
  }
  return {
    maps: maps.data || [],
    brand_kits: (kits.data || []).map((k) => ({ ...k, is_default: Boolean(k.is_default) })),
    dashboard_url: `${siteUrl()}/dashboard`,
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
  const limited = req.account
    ? await rateLimitedShared(sb, req, { max: SEARCHES_PER_HOUR[tierOf(req)], windowSeconds: HOUR_MS / 1000, bucket: 'mcp-search-account', subject: callerSubject(req, 'search_mineral_claims') })
    : await overToolLimit(sb, req, 'search_mineral_claims', { perCaller: SEARCHES_PER_HOUR.anonymous, perIp: NETWORK_SEARCHES_PER_HOUR, bucket: 'mcp-search' });
  if (limited) {
    const resetsAt = nextClockHour();
    const error = new Error(`Mineral-registry search limit reached. Try again at ${whenText(resetsAt)}.`);
    error.code = 'RATE_LIMITED';
    error.details = { resets_at: resetsAt.toISOString(), retry_after_seconds: secondsUntil(resetsAt) };
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
  if (name === 'list_my_maps' && req.account) return listMyMaps(req);
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
  const payload = { error: { code, message, ...(error?.details || {}) } };
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(payload),
      },
    ],
    structuredContent: payload,
    isError: true,
  };
}

// ── Account connector (/mcp/account) ────────────────────────────────────────
// The same tools behind sign-in. Supabase Auth is the OAuth 2.1 authorization
// server (with dynamic client registration and our /oauth/consent page); this
// endpoint is the protected resource and only checks the bearer it is sent.
function isAccountEndpoint(req) {
  return req.query?.auth === 'account';
}

const RESOURCE_HOST = /^(?:(?:www\.)?explorationmaps\.com|[a-z0-9-]+\.vercel\.app)$/;

// The origin the client connected to, so the advertised resource matches the
// URL it holds; anything unexpected falls back to the documented host.
function requestOrigin(req) {
  const host = String(req.headers?.['x-forwarded-host'] || req.headers?.host || '').split(',')[0].trim().toLowerCase();
  return RESOURCE_HOST.test(host) ? `https://${host}` : CONNECTOR_ORIGIN;
}

// RFC 9728 protected resource metadata.
function protectedResourceMetadata(req) {
  const origin = requestOrigin(req);
  return {
    resource: `${origin}/mcp/account`,
    authorization_servers: [`${supabaseUrl()}/auth/v1`],
    bearer_methods_supported: ['header'],
    resource_name: 'ExplorationMaps',
    resource_documentation: `${origin}/mcp/`,
  };
}

function signInChallenge(req, res, id, invalidToken) {
  const metadata = `${requestOrigin(req)}/.well-known/oauth-protected-resource/mcp/account`;
  res.setHeader('WWW-Authenticate', `Bearer resource_metadata="${metadata}"${invalidToken ? ', error="invalid_token"' : ''}`);
  return res.status(401).json(jsonRpcError(id ?? null, -32001, 'Sign in to ExplorationMaps to use this connector.'));
}

// Validated accounts by token, briefly, so a conversation does not cost an
// Auth round trip and a plan lookup on every call.
const ACCOUNT_CACHE_MS = 60_000;
const accountCache = new Map();

async function accountFor(req) {
  const token = String(req.headers?.authorization || '').match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (!token) return { status: 'missing' };
  const key = hashSubject(`account:${token}`);
  const hit = accountCache.get(key);
  if (hit && hit.until > Date.now()) return hit.result;
  const auth = await authenticateUserBearer(req);
  if (!auth.ok) return { status: auth.status === 401 ? 'invalid' : 'unavailable' };
  let tier = 'free';
  try {
    const { data } = await serverSupabase().from('user_plans').select('plan').eq('user_id', auth.user.id).maybeSingle();
    if (data?.plan === 'pro') tier = 'pro';
  } catch {
    // Plan unknown: the free allowance, never Pro by accident.
  }
  const result = { status: 'ok', account: { user: auth.user, token, tier } };
  accountCache.set(key, { result, until: Date.now() + ACCOUNT_CACHE_MS });
  if (accountCache.size > 1000) accountCache.delete(accountCache.keys().next().value);
  return result;
}

function setCors(req, res) {
  const origin = req.headers?.origin;
  if (origin && ALLOWED_ORIGINS.has(String(origin))) {
    res.setHeader('Access-Control-Allow-Origin', String(origin));
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'content-type, accept, authorization, mcp-protocol-version, mcp-method, mcp-name, mcp-session-id, mcp-param-*');
  res.setHeader('Access-Control-Expose-Headers', 'MCP-Protocol-Version, Mcp-Session-Id, X-Request-Id, WWW-Authenticate');
}

export default async function handler(req, res) {
  setCors(req, res);
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method === 'GET' && req.query?.wellknown === 'protected-resource') {
    // Public discovery metadata, readable from any origin.
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'public, max-age=300');
    return res.status(200).json(protectedResourceMetadata(req));
  }
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

  if (isAccountEndpoint(req)) {
    const auth = await accountFor(req);
    if (auth.status === 'unavailable') {
      return res.status(503).json(jsonRpcError(body.id, -32603, 'ExplorationMaps sign-in is temporarily unavailable. Try again shortly.'));
    }
    if (auth.status !== 'ok') {
      // Until Supabase's OAuth server is switched on, a challenge would send
      // clients into a discovery that fails; say so instead.
      if (!(await accountSignInAvailable())) {
        return res.status(503).json(jsonRpcError(body.id, -32603, `ExplorationMaps account sign-in is not available yet. Use ${CONNECTOR_ORIGIN}/mcp/server for now.`));
      }
      return signInChallenge(req, res, body.id, auth.status === 'invalid');
    }
    req.account = auth.account;
  }

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
        instructions: instructionsFor(req),
        ttlMs: 60_000,
        cacheScope: 'public',
      }, true));
    }

    if (body.method === 'initialize') {
      const requested = String(body.params?.protocolVersion || '2025-11-25');
      const negotiated = LEGACY_VERSIONS.includes(requested) ? requested : '2025-11-25';
      // Stateless: the id is never stored or required, only echoed back by the
      // client so previews can be rate limited per conversation (callerSubject).
      res.setHeader('Mcp-Session-Id', randomUUID());
      return res.status(200).json(jsonRpcResult(body.id, {
        protocolVersion: negotiated,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
        instructions: instructionsFor(req),
      }, false));
    }

    if (body.method === 'ping') {
      return res.status(200).json(jsonRpcResult(body.id, {}, modern));
    }

    if (body.method === 'tools/list') {
      return res.status(200).json(jsonRpcResult(body.id, {
        tools: req.account ? ACCOUNT_TOOLS : TOOLS,
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
