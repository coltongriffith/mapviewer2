import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Guard: don't call createClient with undefined values — it throws and crashes the app.
// When env vars are missing, supabase is null and the app falls back to localStorage.
export const supabase = (url && key) ? createClient(url, key) : null;
export const isSupabaseConfigured = !!(url && key);
