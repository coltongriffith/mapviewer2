import React, { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { trackEvent } from '../utils/track';

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
  trackEvent('signup_completed', {}, user.id);
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!supabase) {
      // Supabase not configured — app runs in anonymous localStorage-only mode.
      setLoading(false);
      return;
    }

    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      if (_event === 'SIGNED_IN' && session?.user) trackSignupOnce(session.user);
    });

    return () => subscription.unsubscribe();
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

  return (
    <AuthContext.Provider value={{ user, loading, signIn, signUp, signOut, resetPassword }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
