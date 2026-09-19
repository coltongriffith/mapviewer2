import { randomBytes } from 'node:crypto';
import { applyCors, handleMethods, rateLimited } from '../guard.js';
import { hashAgentToken, DEFAULT_AGENT_SCOPES } from '../agent-auth.js';
import { authenticateUserBearer } from '../user-auth.js';
import { agentError } from '../agent-response.js';
import { serverSupabase } from '../supabase-server.js';

const ALLOWED_SCOPES = new Set(['maps:create','maps:read','maps:update','claims:search','exports:create']);

function cleanName(value) {
  const name = String(value || 'AI agent').trim().slice(0, 80);
  return name || 'AI agent';
}

function cleanScopes(value) {
  if (!Array.isArray(value)) return DEFAULT_AGENT_SCOPES;
  const scopes = [...new Set(value.filter((v) => ALLOWED_SCOPES.has(v)))];
  return scopes.length ? scopes : DEFAULT_AGENT_SCOPES;
}

function parseBody(req) {
  if (req.body && typeof req.body === 'object' && !Array.isArray(req.body)) return req.body;
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  return {};
}

export default async function handler(req, res) {
  applyCors(req, res);
  res.setHeader('Cache-Control', 'no-store');
  if (handleMethods(req, res, ['GET','POST','DELETE'])) return;

  if (rateLimited(req, { max: 30, windowMs: 60_000, bucket: 'agent-keys' })) {
    return agentError(res, 429, 'RATE_LIMITED', 'Too many key-management requests.', true);
  }

  const auth = await authenticateUserBearer(req);
  if (!auth.ok) return agentError(res, auth.status, 'UNAUTHORIZED', auth.message, auth.status === 503);

  const sb = serverSupabase();
  const userId = auth.user.id;

  if (req.method === 'GET') {
    const { data, error } = await sb
      .from('agent_api_keys')
      .select('id,name,token_prefix,scopes,created_at,last_used_at,expires_at,revoked_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    if (error) return agentError(res, 503, 'INTERNAL_ERROR', 'Could not load agent connections.', true);
    return res.status(200).json({ keys: data || [] });
  }

  if (req.method === 'DELETE') {
    const id = String(req.query?.id || '');
    if (!/^[0-9a-f-]{36}$/i.test(id)) return agentError(res, 400, 'INVALID_REQUEST', 'A valid key id is required.', false);
    const { data, error } = await sb
      .from('agent_api_keys')
      .update({ revoked_at: new Date().toISOString() })
      .eq('id', id)
      .eq('user_id', userId)
      .is('revoked_at', null)
      .select('id')
      .maybeSingle();
    if (error) return agentError(res, 503, 'INTERNAL_ERROR', 'Could not revoke the agent connection.', true);
    if (!data) return agentError(res, 404, 'NOT_FOUND', 'Agent connection was not found.', false);
    return res.status(200).json({ revoked: true, id });
  }

  const body = parseBody(req);
  const { count, error: countError } = await sb
    .from('agent_api_keys')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .is('revoked_at', null);
  if (countError) return agentError(res, 503, 'INTERNAL_ERROR', 'Could not create the agent connection.', true);
  if ((count || 0) >= 10) return agentError(res, 409, 'KEY_LIMIT', 'Revoke an unused agent connection before creating another.', false);

  const token = `em_live_${randomBytes(32).toString('base64url')}`;
  const row = {
    user_id: userId,
    name: cleanName(body.name),
    token_prefix: token.slice(0, 16),
    token_hash: hashAgentToken(token),
    scopes: cleanScopes(body.scopes),
  };

  const { data, error } = await sb
    .from('agent_api_keys')
    .insert(row)
    .select('id,name,token_prefix,scopes,created_at')
    .single();
  if (error) return agentError(res, 503, 'INTERNAL_ERROR', 'Could not create the agent connection.', true);

  // The plaintext token is deliberately returned exactly once.
  return res.status(201).json({ key: { ...data, token } });
}
