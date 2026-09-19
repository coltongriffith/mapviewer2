import { createHash } from 'node:crypto';
import { serverSupabase } from './supabase-server.js';

export const DEFAULT_AGENT_SCOPES = ['maps:create', 'maps:read', 'claims:search'];

export function hashAgentToken(token) {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function bearerToken(req) {
  const header = String(req.headers?.authorization || '');
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

export async function authenticateAgent(req, requiredScope = null) {
  const token = bearerToken(req);
  if (!token || token.length < 24 || token.length > 256) {
    return { ok: false, status: 401, code: 'UNAUTHORIZED', message: 'Missing or invalid bearer token.' };
  }

  const hash = hashAgentToken(token);
  const sb = serverSupabase();
  const { data, error } = await sb
    .from('agent_api_keys')
    .select('id,user_id,name,scopes,expires_at,revoked_at')
    .eq('token_hash', hash)
    .maybeSingle();

  if (error) {
    return { ok: false, status: 503, code: 'AUTH_UNAVAILABLE', message: 'Agent authentication is temporarily unavailable.', retryable: true };
  }

  if (!data || data.revoked_at || (data.expires_at && new Date(data.expires_at).getTime() <= Date.now())) {
    return { ok: false, status: 401, code: 'UNAUTHORIZED', message: 'Bearer token is not active.' };
  }

  if (requiredScope && !(data.scopes || []).includes(requiredScope)) {
    return { ok: false, status: 403, code: 'FORBIDDEN', message: `API key lacks required scope: ${requiredScope}.` };
  }

  // Usage timestamp is non-critical and must never fail a real request.
  void sb.from('agent_api_keys').update({ last_used_at: new Date().toISOString() }).eq('id', data.id);

  return {
    ok: true,
    apiKey: {
      id: data.id,
      userId: data.user_id,
      name: data.name,
      scopes: data.scopes || [],
    },
  };
}
