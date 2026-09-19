import { serverSupabase } from './supabase-server.js';

export async function authenticateUserBearer(req) {
  const header = String(req.headers?.authorization || '');
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return { ok: false, status: 401, message: 'Sign in required.' };

  const token = match[1].trim();
  try {
    const { data, error } = await serverSupabase().auth.getUser(token);
    if (error || !data?.user) return { ok: false, status: 401, message: 'Session is not valid.' };
    return { ok: true, user: data.user };
  } catch {
    return { ok: false, status: 503, message: 'Authentication is temporarily unavailable.' };
  }
}
