import React, { useEffect, useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { supabase } from '../lib/supabase';
import AuthModal from './AuthModal';

// Supabase's OAuth server sends people here (Site URL + authorization path)
// when an AI assistant asks to use their account through the MCP account
// connector (/mcp/account). Sign in if needed, then allow or deny. Supabase
// issues the tokens; this page only records the decision.
export default function OAuthConsentPage() {
  const { user, loading, signOut } = useAuth();
  const authorizationId = new URLSearchParams(window.location.search).get('authorization_id');
  const [details, setDetails] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [signingIn, setSigningIn] = useState(false);

  useEffect(() => {
    if (!authorizationId || loading || !user || !supabase) return undefined;
    let cancelled = false;
    setDetails(null);
    supabase.auth.oauth.getAuthorizationDetails(authorizationId).then(({ data, error: err }) => {
      if (cancelled) return;
      if (err || !data) {
        setError('This connection request is invalid or has expired. Start again from your assistant\'s connector settings.');
        return;
      }
      // Already allowed for this app: Supabase says where to send them back.
      if (!('authorization_id' in data) && data.redirect_url) {
        window.location.assign(data.redirect_url);
        return;
      }
      setDetails(data);
    });
    return () => { cancelled = true; };
  }, [authorizationId, loading, user]);

  async function decide(allow) {
    setBusy(true);
    setError('');
    const { data, error: err } = allow
      ? await supabase.auth.oauth.approveAuthorization(authorizationId)
      : await supabase.auth.oauth.denyAuthorization(authorizationId);
    if (err || !data?.redirect_url) {
      setBusy(false);
      setError('That did not go through. Start again from your assistant\'s connector settings.');
      return;
    }
    window.location.assign(data.redirect_url);
  }

  const appName = details?.client?.name || 'An AI assistant';
  let body;
  if (!authorizationId) {
    body = <p>This page finishes connecting an AI assistant to ExplorationMaps. Start from the ExplorationMaps connector in your assistant&apos;s settings.</p>;
  } else if (error) {
    body = <p role="alert">{error}</p>;
  } else if (loading || (user && !details)) {
    body = <p role="status">Loading…</p>;
  } else if (!user) {
    body = (
      <>
        <p>Sign in to ExplorationMaps to connect your account to your AI assistant. A free account works.</p>
        <button className="btn primary" type="button" onClick={() => setSigningIn(true)}>Sign in or create an account</button>
      </>
    );
  } else {
    body = (
      <>
        <p><strong>{appName}</strong> wants to use your ExplorationMaps account ({user.email}).</p>
        <ul>
          <li>Map previews it creates are saved to your account and don&apos;t expire.</li>
          <li>Your plan&apos;s hourly preview allowance applies: 30 on Free, 200 on Pro.</li>
          <li>Only allow apps you trust: the connection signs in as you.</li>
        </ul>
        <div className="oauth-consent-actions">
          <button className="btn primary" type="button" disabled={busy} onClick={() => decide(true)}>Allow</button>
          <button className="secondary-btn" type="button" disabled={busy} onClick={() => decide(false)}>Deny</button>
        </div>
        <p className="oauth-consent-switch">
          Not you? <button type="button" className="link-btn" disabled={busy} onClick={() => signOut()}>Sign out</button>
        </p>
      </>
    );
  }

  return (
    <main className="oauth-consent">
      <section className="oauth-consent-card">
        <h1>Connect to ExplorationMaps</h1>
        {body}
      </section>
      {signingIn && !user && <AuthModal onClose={() => setSigningIn(false)} />}
    </main>
  );
}
