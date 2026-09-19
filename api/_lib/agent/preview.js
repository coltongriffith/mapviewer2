import { createHash } from 'node:crypto';
import { validateCreateMapInput, AGENT_JURISDICTIONS } from '../../../shared/agentSchema.js';
import { createAgentMapProject } from '../../../shared/agentMapBuilder.js';
import { applyCors, clientIp, handleMethods, rateLimited, rateLimitedShared } from '../guard.js';
import { runClaimsSearch } from '../claims-internal.js';
import { agentError, requestId } from '../agent-response.js';
import { serverSupabase } from '../supabase-server.js';

const MAX_BODY_BYTES = 32 * 1024;

function bodyObject(req) {
  if (req.body && typeof req.body === 'object' && !Array.isArray(req.body)) return req.body;
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch { return null; }
  }
  return null;
}

function anonymousSubject(req) {
  const ip = clientIp(req);
  return createHash('sha256').update(`agent-preview:${ip}`).digest('hex').slice(0, 40);
}

export default async function handler(req, res) {
  applyCors(req, res);
  res.setHeader('Cache-Control', 'no-store');
  if (handleMethods(req, res, ['POST'])) return;

  const rid = requestId(req);
  res.setHeader('X-Request-Id', rid);

  if (rateLimited(req, { max: 6, windowMs: 60 * 60_000, bucket: 'agent-preview-ip' })) {
    return agentError(res, 429, 'RATE_LIMITED', 'Free preview limit reached. Connect an ExplorationMaps account for more maps.', true);
  }

  const body = bodyObject(req);
  if (!body) return agentError(res, 400, 'INVALID_REQUEST', 'Request body must be valid JSON.', false);
  if (Buffer.byteLength(JSON.stringify(body), 'utf8') > MAX_BODY_BYTES) {
    return agentError(res, 413, 'INVALID_REQUEST', 'Request body is too large.', false);
  }

  // Anonymous preview is deliberately registry-only. Uploaded/company data
  // belongs behind an account so arbitrary geometry cannot become an anonymous
  // public-file hosting path.
  if (body.data?.geojson) {
    return agentError(res, 401, 'ACCOUNT_REQUIRED', 'Connect an ExplorationMaps account to map supplied GeoJSON or drill data.', false);
  }

  const checked = validateCreateMapInput(body);
  if (!checked.ok) {
    return agentError(res, 400, 'INVALID_REQUEST', 'The map request is invalid.', false, checked.errors);
  }
  const input = checked.value;

  const sb = serverSupabase();
  const subject = anonymousSubject(req);
  if (await rateLimitedShared(sb, req, {
    max: 3,
    windowSeconds: 60 * 60,
    bucket: 'agent-preview',
    subject,
  })) {
    return agentError(res, 429, 'RATE_LIMITED', 'Free preview limit reached. Connect an ExplorationMaps account for more maps.', true);
  }

  try {
    const jurisdiction = AGENT_JURISDICTIONS[input.jurisdiction];
    const claims = await runClaimsSearch({
      jurisdiction: input.jurisdiction,
      query: input.search.query,
      type: input.search.type,
      bbox: input.location.bbox,
      clientIp: clientIp(req),
    });

    if (!claims?.features?.length) {
      return agentError(res, 404, 'CLAIMS_NOT_FOUND', 'No matching mineral claims were found.', false);
    }

    const project = createAgentMapProject(input, {
      featureCollection: claims,
      source: jurisdiction?.registry,
      sourceMeta: claims.meta || null,
    });

    const { data: shareId, error } = await sb.rpc('create_shared_map', {
      p_state: project,
      p_creator_key: subject,
    });

    if (error) {
      const message = String(error.message || '');
      if (/SHARE_RATE_LIMIT/.test(message)) {
        return agentError(res, 429, 'RATE_LIMITED', 'Free preview limit reached. Connect an ExplorationMaps account for more maps.', true);
      }
      if (/SHARE_TOO_(LARGE|COMPLEX)/.test(message)) {
        return agentError(res, 413, 'MAP_TOO_COMPLEX', 'This claim set is too large for an anonymous preview. Connect an account or narrow the search.', false);
      }
      throw error;
    }

    const siteUrl = String(process.env.SITE_URL || 'https://explorationmaps.com').replace(/\/$/, '');
    return res.status(201).json({
      status: 'ready',
      preview: true,
      title: input.title,
      map_type: input.map_type,
      share_url: `${siteUrl}/map/${shareId}`,
      expires_in_days: 30,
      project: {
        jurisdiction: input.jurisdiction,
        claims_found: claims.features.length,
        feature_count: claims.features.length,
      },
      sources: [{
        name: jurisdiction?.registry || 'Official mineral registry',
        jurisdiction: jurisdiction?.label || input.jurisdiction,
      }],
      warnings: [
        ...(jurisdiction?.caveat ? [jurisdiction.caveat] : []),
        ...(claims?.meta?.degraded ? ['The registry response used degraded jurisdiction scoping; verify the mapped claims before relying on the figure.'] : []),
        ...(claims?.meta?.relaxed ? ['The registry search was relaxed from the exact phrase supplied. Review the returned owners/claims.'] : []),
        'Anonymous preview links expire after 30 days. Connect an ExplorationMaps account to save and edit the map.',
      ],
      request_id: rid,
    });
  } catch (error) {
    const status = error?.status === 400 ? 400 : (error?.status === 429 ? 429 : 503);
    const code = status === 400 ? 'INVALID_REQUEST' : (status === 429 ? 'RATE_LIMITED' : 'CLAIM_PROVIDER_UNAVAILABLE');
    return agentError(
      res,
      status,
      code,
      status >= 500 ? 'The mineral registry is temporarily unavailable.' : String(error?.message || 'Preview map creation failed.'),
      status >= 500 || status === 429,
    );
  }
}
