import { createClient } from '@supabase/supabase-js';

let client = null;

export function serverSupabase() {
  if (client) return client;
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('Server Supabase credentials are not configured.');
  }
  client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return client;
}

// Acts as the signed-in user, so auth.uid() and RLS apply to its calls.
export function userSupabase(accessToken) {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error('Server Supabase credentials are not configured.');
  }
  return createClient(url, key, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
