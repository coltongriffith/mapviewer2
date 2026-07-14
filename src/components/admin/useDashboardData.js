import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../lib/supabase';

// Complete-Pacific-day window for the selected range. The window ENDS at
// 00:00 today Pacific (so it covers only finished days) and starts range*days
// before that. Prior-period comparison is handled server-side from these
// bounds. We approximate "Pacific midnight" without a tz lib by formatting
// now() in America/Vancouver and reconstructing the day boundary as UTC-ish;
// the RPC re-buckets in tz anyway, so the exact instant only needs to be
// "start of today, Pacific" to a few hours — good enough for day windows.
export function useDashboardWindow(range) {
  // Midnight Pacific today, expressed as an instant: take the Pacific date
  // string, treat it as that date at 07:00Z (~midnight PDT/PST) — the RPC's
  // AT TIME ZONE bucketing corrects any residual offset.
  const todayPacific = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Vancouver', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
  const end = new Date(`${todayPacific}T08:00:00Z`); // ~00:00 Pacific
  const start = new Date(end.getTime() - range * 86400000);
  return { p_start: start.toISOString(), p_end: end.toISOString() };
}

// Generic single-RPC hook returning { data, loading, error, reload }.
function useRpc(fn, params, enabled) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const paramKey = JSON.stringify(params || null);

  const reload = useCallback(() => {
    if (!enabled || !supabase) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    supabase.rpc(fn, params || undefined).then(({ data: d, error: e }) => {
      if (cancelled) return;
      if (e) { setError(e.message); setData(null); }
      else setData(d);
      setLoading(false);
    }, (e) => { if (!cancelled) { setError(String(e?.message || e)); setLoading(false); } });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fn, paramKey, enabled]);

  useEffect(() => {
    const cleanup = reload();
    return cleanup;
  }, [reload]);

  return { data, loading, error, reload };
}

export function useOverview(window, enabled) {
  return useRpc('admin_get_overview', window, enabled);
}
export function useEngagement(window, enabled) {
  return useRpc('admin_get_engagement', window, enabled);
}
export function useUsersOverview(enabled) {
  return useRpc('admin_get_users_overview', {}, enabled);
}

// On-demand single-user detail (drawer). Not a hook-per-render; call load(id).
export function useUserDetail() {
  const [byId, setById] = useState({});
  const [loadingId, setLoadingId] = useState(null);
  const load = useCallback((userId) => {
    if (!supabase || !userId || byId[userId]) return;
    setLoadingId(userId);
    supabase.rpc('admin_get_user_detail', { p_user_id: userId }).then(({ data, error }) => {
      if (!error && data) setById((m) => ({ ...m, [userId]: data }));
      setLoadingId(null);
    }, () => setLoadingId(null));
  }, [byId]);
  return { byId, loadingId, load };
}
