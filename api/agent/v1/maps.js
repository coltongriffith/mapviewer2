import { validateCreateMapInput, AGENT_JURISDICTIONS } from '../../../shared/agentSchema.js';
import { createAgentMapProject } from '../../../shared/agentMapBuilder.js';
import { applyCors, clientIp, handleMethods, rateLimited, rateLimitedShared } from '../../_lib/guard.js';
import { authenticateAgent } from '../../_lib/agent-auth.js';
import { runClaimsSearch } from '../../_lib/claims-internal.js';
import { agentError, platformName, requestId } from '../../_lib/agent-response.js';
import { serverSupabase } from '../../_lib/supabase-server.js';

const MAX_BODY_BYTES = 128 * 1024;

function bodyObject(req) {
  if (req.body && typeof req.body === 'object' && !Array.isArray(req.body)) return req.body;
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch { return null; }
  }
  return null;
}

function idempotencyKey(req, fallback) {
  const raw = req.headers?.['idempotency-key'];
  if (typeof raw !== 'string') return fallback;
  const key = raw.trim();
  return /^[A-Za-z0-9._:-]{8,160}$/.test(key) ? key : null;
}

async function getRun(sb, apiKeyId, key) {
  const { data } = await sb
    .from('agent_runs')
    .select('id,status,result,error_code,created_at')
    .eq('api_key_id', apiKeyId)
    .eq('idempotency_key', key)
    .maybeSingle();
  return data || null;
}

async function beginRun(sb, auth, key, platform) {
  const existing = await getRun(sb, auth.apiKey.id, key);
  if (existing?.status === 'ready' && existing.result) return { replay: true, run: existing };
  if (existing?.status === 'started') {
    const ageMs = Date.now() - new Date(existing.created_at).getTime();
    if (ageMs < 2 * 60_000) return { inProgress: true, run: existing };
  }
  if (existing) {
    const { data, error } = await sb
      .from('agent_runs')
      .update({
        status: 'started',
        error_code: null,
        result: null,
        completed_at: null,
      })
      .eq('id', existing.id)
      .select('id,status,result,error_code,created_at')
      .single();
    if (error) throw error;
    return { run: data };
  }

  const { data, error } = await sb
    .from('agent_runs')
    .insert({
      user_id: auth.apiKey.userId,
      api_key_id: auth.apiKey.id,
      platform,
      idempotency_key: key,
      action: 'maps:create',
      status: 'started',
    })
    .select('id,status,result,error_code,created_at')
    .single();

  if (!error) return { run: data };

  // A concurrent retry can win the unique(api_key_id,idempotency_key) race.
  if (error.code === '23505') {
    const raced = await getRun(sb, auth.apiKey.id, key);
    if (raced?.status === 'ready' && raced.result) return { replay: true, run: raced };
    return { inProgress: true, run: raced };
  }
  throw error;
}

function warningList(input, claims) {
  const warnings = [];
  const jurisdiction = AGENT_JURISDICTIONS[input.jurisdiction];
  if (jurisdiction?.caveat) warnings.push(jurisdiction.caveat);
  if (claims?.meta?.degraded) warnings.push('The registry response used degraded jurisdiction scoping; verify the mapped claims before relying on the figure.');
  if (claims?.meta?.relaxed) warnings.push('The registry search was relaxed from the exact phrase supplied. Review the returned owners/claims.');
  return warnings;
}

function mapErrorCode(error) {
  const message = String(error?.message || '');
  if (/PROJECT_LIMIT/.test(message)) return ['PROJECT_LIMIT', 402, false];
  if (/SHARE_RATE_LIMIT|rate limit/i.test(message)) return ['RATE_LIMITED', 429, true];
  if (/MAP_TOO_COMPLEX|SHARE_TOO_(LARGE|COMPLEX)/.test(message)) return ['MAP_TOO_COMPLEX', 413, false];
  if (error?.status === 429) return ['RATE_LIMITED', 429, true];
  if (error?.status === 400) return ['INVALID_REQUEST', 400, false];
  if (error?.status === 502 || error?.status === 503) return ['CLAIM_PROVIDER_UNAVAILABLE', 503, true];
  return ['INTERNAL_ERROR', 500, true];
}

export default async function handler(req, res) {
  applyCors(req, res);
  res.setHeader('Cache-Control', 'no-store');
  if (handleMethods(req, res, ['POST'])) return;

  const rid = requestId(req);
  res.setHeader('X-Request-Id', rid);

  if (rateLimited(req, { max: 30, windowMs: 60_000, bucket: 'agent-maps-ip' })) {
    return agentError(res, 429, 'RATE_LIMITED', 'Too many map requests. Slow down and try again.', true);
  }

  const auth = await authenticateAgent(req, 'maps:create');
  if (!auth.ok) {
    return agentError(res, auth.status, auth.code, auth.message, Boolean(auth.retryable));
  }

  const sb = serverSupabase();
  if (await rateLimitedShared(sb, req, {
    max: 20,
    windowSeconds: 60,
    bucket: 'agent-maps-key',
    subject: auth.apiKey.id,
  })) {
    return agentError(res, 429, 'RATE_LIMITED', 'This API key has exceeded the map creation rate limit.', true);
  }

  const body = bodyObject(req);
  if (!body) return agentError(res, 400, 'INVALID_REQUEST', 'Request body must be valid JSON.', false);
  if (Buffer.byteLength(JSON.stringify(body), 'utf8') > MAX_BODY_BYTES) {
    return agentError(res, 413, 'INVALID_REQUEST', 'Request body is too large.', false);
  }

  const checked = validateCreateMapInput(body);
  if (!checked.ok) {
    return agentError(res, 400, 'INVALID_REQUEST', 'The map request is invalid.', false, checked.errors);
  }
  const input = checked.value;

  const idem = idempotencyKey(req, rid);
  if (!idem) {
    return agentError(res, 400, 'INVALID_REQUEST', 'Idempotency-Key contains unsupported characters or length.', false);
  }

  let begun;
  try {
    begun = await beginRun(sb, auth, idem, platformName(req));
  } catch {
    return agentError(res, 503, 'INTERNAL_ERROR', 'Could not start the map-generation request.', true);
  }

  if (begun.replay) {
    res.setHeader('X-Idempotent-Replay', 'true');
    return res.status(200).json(begun.run.result);
  }
  if (begun.inProgress) {
    return agentError(res, 409, 'REQUEST_IN_PROGRESS', 'A request with this idempotency key is already running.', true);
  }

  const started = Date.now();
  try {
    const jurisdiction = AGENT_JURISDICTIONS[input.jurisdiction];
    let featureCollection;
    let sourceName;
    let sourceMeta = null;
    let usedRegistry = false;

    if (input.data?.geojson) {
      featureCollection = input.data.geojson;
      sourceName = input.data.source_name || 'Agent supplied GeoJSON';
    } else {
      usedRegistry = true;
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
      featureCollection = claims;
      sourceName = jurisdiction?.registry;
      sourceMeta = claims.meta || null;
    }

    const project = createAgentMapProject(input, {
      featureCollection,
      source: sourceName,
      sourceMeta,
    });

    const { data: created, error: createError } = await sb.rpc('create_agent_project_and_share', {
      p_user_id: auth.apiKey.userId,
      p_name: input.title,
      p_payload: project,
      p_api_key_id: auth.apiKey.id,
    });
    if (createError) throw createError;

    const siteUrl = String(process.env.SITE_URL || 'https://explorationmaps.com').replace(/\/$/, '');
    const result = {
      id: created.project_id,
      status: 'ready',
      title: input.title,
      map_type: input.map_type,
      share_url: `${siteUrl}/map/${created.share_id}`,
      project: {
        jurisdiction: input.jurisdiction,
        feature_count: featureCollection.features.length,
        ...(usedRegistry ? { claims_found: featureCollection.features.length } : {}),
      },
      sources: [{
        name: sourceName || jurisdiction?.registry || 'Exploration data',
        jurisdiction: jurisdiction?.label || input.jurisdiction,
      }],
      warnings: [
        ...warningList(input, usedRegistry ? featureCollection : null),
        ...(!usedRegistry ? ['Agent-supplied geometry has not been independently verified by ExplorationMaps.'] : []),
      ],
      request_id: rid,
    };

    await sb
      .from('agent_runs')
      .update({
        status: 'ready',
        project_id: created.project_id,
        share_id: created.share_id,
        duration_ms: Date.now() - started,
        result,
        completed_at: new Date().toISOString(),
      })
      .eq('id', begun.run.id);

    return res.status(201).json(result);
  } catch (error) {
    const isNotFound = error?.code === 'CLAIMS_NOT_FOUND';
    const [code, status, retryable] = isNotFound
      ? ['CLAIMS_NOT_FOUND', 404, false]
      : mapErrorCode(error);

    void sb
      .from('agent_runs')
      .update({
        status: 'failed',
        error_code: code,
        duration_ms: Date.now() - started,
        completed_at: new Date().toISOString(),
      })
      .eq('id', begun.run.id);

    return agentError(
      res,
      status,
      code,
      isNotFound ? 'No matching mineral claims were found.' : (status < 500 ? String(error?.message || 'Map creation failed.') : 'Map creation failed.'),
      retryable,
    );
  }
}
