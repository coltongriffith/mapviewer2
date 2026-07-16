import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { trackEvent } from '../utils/track';
import { getAttribution } from '../utils/attribution';
import { isGrandfathered } from '../utils/pricing';

const AuthContext = createContext(null);

// Fire signup_completed exactly once per new account, on the first SIGNED_IN
// after the account was created (covers password+confirm and magic-link paths).
function trackSignupOnce(user) {
  if (!user?.id || !user.created_at) return;
  const ageMs = Date.now() - new Date(user.created_at).getTime();
  if (ageMs > 10 * 60 * 1000) return; // existing account signing back in
  const flag = `em_signup_tracked_${user.id}`;
  try {
    if (localStorage.getItem(flag)) return;
    localStorage.setItem(flag, '1');
  } catch { /* still fire; worst case a duplicate row */ }
  // Attach first-touch attribution (utm_source / utm_campaign / claimed ticker)
  // so the admin funnel can tell which channel produced each account.
  trackEvent('signup_completed', getAttribution(), user.id);
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  // Billing plan. FAIL-OPEN by design: while the plan is unknown (loading, or
  // the lookup errored) a signed-in user is treated as Pro — a paying or
  // grandfathered account must never be denied a feature because of a
  // transient fetch problem. `planReady` is true only after a definitive
  // answer, and gates deny ONLY when planReady && plan === 'free'.
  const [planState, setPlanState] = useState({ plan: null, source: null, ready: false });

  const refreshPlan = useCallback(async (u) => {
    const target = u || user;
    if (!supabase || !target) {
      setPlanState({ plan: null, source: null, ready: Boolean(target) === false });
      return;
    }
    // Grandfather backstop: any account created before the billing launch is
    // Pro forever, even if its user_plans row is missing for some reason.
    if (isGrandfathered(target)) {
      setPlanState({ plan: 'pro', source: 'grandfathered', ready: true });
      return;
    }
    try {
      const { data, error } = await supabase
        .from('user_plans')
        .select('plan, status, source')
        .eq('user_id', target.id)
        .maybeSingle();
      if (error) {
        // Lookup failed → fail open (treated as Pro until we know better).
        setPlanState({ plan: null, source: null, ready: false });
        return;
      }
      if (!data) {
        // No row (trigger raced the lookup) — a post-launch account is free.
        setPlanState({ plan: 'free', source: 'signup', ready: true });
        return;
      }
      setPlanState({ plan: data.plan, source: data.source, ready: true });
    } catch {
      setPlanState({ plan: null, source: null, ready: false });
    }
  }, [user]);

  useEffect(() => {
    if (!supabase) {
      // Supabase not configured — app runs in anonymous localStorage-only mode.
      setLoading(false);
      return;
    }

    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      setLoading(false);
      if (session?.user) refreshPlan(session.user);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      if (_event === 'SIGNED_IN' && session?.user) trackSignupOnce(session.user);
      if (session?.user) refreshPlan(session.user);
      else setPlanState({ plan: null, source: null, ready: false });
    });

    return () => subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function signIn(email, password) {
    if (!supabase) throw new Error('Auth not configured');
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
  }

  async function signUp(email, password) {
    if (!supabase) throw new Error('Auth not configured');
    // Return the user to the page they signed up from (e.g. a /map/:id share
    // link) after they confirm their email, so a pending "edit a copy" resumes.
    const emailRedirectTo = typeof window !== 'undefined' ? window.location.href : undefined;
    const { error } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo } });
    if (error) throw error;
  }

  async function signInWithMagicLink(email) {
    if (!supabase) throw new Error('Auth not configured');
    // One email, no password, no confirm round-trip — the link both creates
    // the account (if new) and signs in, returning to the page it was sent
    // from (so a pending shared-map fork or unsaved draft is still there).
    const emailRedirectTo = typeof window !== 'undefined' ? window.location.href : undefined;
    const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo } });
    if (error) throw error;
  }

  async function signOut() {
    if (!supabase) return;
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  }

  async function resetPassword(email) {
    if (!supabase) throw new Error('Auth not configured');
    const { error } = await supabase.auth.resetPasswordForEmail(email);
    if (error) throw error;
  }

  // isPro fails OPEN for signed-in users: unknown plan (not ready) → Pro.
  // Anonymous visitors are never Pro. Gates must deny only on planDenied.
  const isPro = Boolean(user) && (!planState.ready || planState.plan === 'pro');
  const planDenied = Boolean(user) ? (planState.ready && planState.plan === 'free') : true;

  return (
    <AuthContext.Provider value={{
      user, loading, signIn, signUp, signInWithMagicLink, signOut, resetPassword,
      isPro, planDenied, planSource: planState.source, planReady: planState.ready, refreshPlan,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
