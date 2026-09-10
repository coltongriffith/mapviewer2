import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../hooks/useAuth';
import { dashboardWindow, pacificDate } from './dateWindow';

export function useDashboardWindow(range) {
  const [today, setToday] = useState(pacificDate);
  useEffect(() => {
    const update = () => setToday(pacificDate());
    const timer = setInterval(update, 60000);
    document.addEventListener('visibilitychange', update);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', update); };
  }, []);
  return dashboardWindow(range, new Date(`${today}T12:00:00Z`));
}

// One bounded cache per hook, scoped to the account and exact query window.
// Abort on tab/range/account changes; sequence checks also cover refresh races.
export function useRpc(fn, params, enabled = true) {
  const { user } = useAuth();
  const key = JSON.stringify([user?.id, fn, params || null]);
  const [state, setState] = useState({ key: null, data: null, error: null, updatedAt: null });
  const [pending, setPending] = useState(null);
  const [revision, setRevision] = useState(0);
  const cache = useRef(null);
  const sequence = useRef(0);
  const reload = useCallback(() => { cache.current = null; setRevision(n => n + 1); }, []);

  useEffect(() => {
    const id = ++sequence.current;
    let cancelled = false;
    if (!enabled || !supabase) return;
    if (cache.current?.key === key && Date.now() - cache.current.updatedAt < 60000) {
      setState(cache.current);
      setPending(null);
      return;
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    setPending(key);
    const [, rpc, args] = JSON.parse(key);
    Promise.resolve(supabase.rpc(rpc, args || undefined).abortSignal(controller.signal))
      .then(({ data, error }) => {
        if (cancelled || sequence.current !== id) return;
        if (error) throw error;
        if (data == null) throw new Error('Report returned no data. Please retry.');
        const next = { key, data, error: null, updatedAt: Date.now() };
        cache.current = next;
        setState(next);
      })
      .catch(error => {
        if (!cancelled && sequence.current === id) setState({ key, data: null, error: error?.message || 'Report unavailable. Please retry.', updatedAt: null });
      })
      .finally(() => { clearTimeout(timeout); if (!cancelled && sequence.current === id) setPending(null); });
    return () => { cancelled = true; clearTimeout(timeout); controller.abort(); };
  }, [key, enabled, revision]);

  const current = state.key === key;
  return {
    data: current ? state.data : null,
    error: current ? state.error : null,
    updatedAt: current ? state.updatedAt : null,
    loading: !!enabled && !!supabase && (pending === key || !current),
    reload,
  };
}

export const useGrowth = (window, enabled) => useRpc('admin_get_growth', window, enabled);
const reportingParams = window => ({ ...window, p_tz: window.p_start >= '2026-03-09' ? 'Etc/GMT+7' : 'America/Vancouver' });
export const useOverview = (window, enabled) => useRpc('admin_get_overview', reportingParams(window), enabled);
export const useEngagement = (window, enabled) => useRpc('admin_get_engagement', reportingParams(window), enabled);
export const useUsersOverview = enabled => useRpc('admin_get_users_overview', { p_tz: pacificDate() >= '2026-03-09' ? 'Etc/GMT+7' : 'America/Vancouver' }, enabled);
export const useRevenue = enabled => useRpc('admin_get_billing_metrics', {}, enabled);
export const useTenureOps = enabled => useRpc('admin_get_tenure_ops', {}, enabled);
export const useErrorSummary = (enabled, hours = 24) => useRpc('admin_get_error_summary', { p_hours: hours }, enabled);
export const useFeedback = (enabled, status = null) => useRpc('admin_get_feedback', { p_status: status, p_limit: 100 }, enabled);

export function useUserDetail() {
  const [userId, load] = useState(null);
  const result = useRpc('admin_get_user_detail', { p_user_id: userId }, !!userId);
  return {
    byId: result.data && !result.loading ? { [userId]: result.data } : {},
    loadingId: result.loading ? userId : null, error: result.error,
    load: id => { if (id === userId) result.reload(); else load(id); },
  };
}
