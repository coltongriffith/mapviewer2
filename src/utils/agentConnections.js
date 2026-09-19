import { supabase } from '../lib/supabase';

async function authHeaders(extra = {}) {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  if (!token) throw new Error('Sign in required.');
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    ...extra,
  };
}

async function readResponse(res) {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error?.message || 'Agent connection request failed.');
  return body;
}

export async function listAgentConnections() {
  const res = await fetch('/api/agent/v1/keys', { headers: await authHeaders() });
  const body = await readResponse(res);
  return body.keys || [];
}

export async function createAgentConnection(name = 'Muse') {
  const res = await fetch('/api/agent/v1/keys', {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify({ name }),
  });
  const body = await readResponse(res);
  return body.key;
}

export async function revokeAgentConnection(id) {
  const res = await fetch(`/api/agent/v1/keys?id=${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: await authHeaders(),
  });
  return readResponse(res);
}
