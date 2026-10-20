import React, { useEffect, useState } from 'react';
import { useAuth } from '../../hooks/useAuth.jsx';
import AuthModal from '../AuthModal';
import BrandMark from '../BrandMark';
import { acceptInvite, rememberInviteToken, pendingInviteToken, clearInviteToken } from '../../utils/workspace';
import '../../styles/workspace.css';

// /invite?token=...: accept a workspace invite. Signed out, the token is kept
// (in the URL the sign-in link returns to, and in localStorage in case the
// link lands elsewhere) until the visitor signs in with the invited address.
export function inviteTokenFromUrl(search = window.location.search) {
  const t = new URLSearchParams(search).get('token') || '';
  return /^[0-9a-f]{64}$/.test(t) ? t : null;
}

export default function InvitePage({ onAccepted, onExit }) {
  const { user, loading } = useAuth();
  const [token] = useState(() => inviteTokenFromUrl() || pendingInviteToken());
  const [showAuth, setShowAuth] = useState(false);
  const [state, setState] = useState({ status: 'idle' });

  // Keep the token in this browser and take it out of the address bar, so a
  // sign-in link sent from here (which returns to the current URL) does not
  // carry it through the auth provider.
  useEffect(() => {
    if (!token) return;
    rememberInviteToken(token);
    if (inviteTokenFromUrl()) {
      try { window.history.replaceState(window.history.state, '', '/invite'); } catch { /* cosmetic */ }
    }
  }, [token]);

  const accept = async () => {
    setState({ status: 'busy' });
    try {
      const r = await acceptInvite(token);
      clearInviteToken();
      setState({ status: 'done', result: r });
      onAccepted(r);
    } catch (e) {
      if (/expired|already been accepted|not valid/i.test(e.message)) clearInviteToken();
      setState({ status: 'error', message: e.message });
    }
  };

  let body;
  if (!token) {
    body = <>
      <h2>This invite link is incomplete</h2>
      <p className="acct-signin-hint">Open the link from your invite email again, or ask for a new invite.</p>
    </>;
  } else if (loading) {
    body = <p className="acct-signin-hint">Checking your sign-in…</p>;
  } else if (!user) {
    body = <>
      <h2>You&apos;ve been invited to a company workspace</h2>
      <p className="acct-signin-hint">Sign in, or create a free account, with the email address the invite was sent to. You&apos;ll come back here to accept.</p>
      <div className="acct-signin-actions">
        <button className="btn primary" type="button" onClick={() => setShowAuth(true)}>Sign in / Create account</button>
      </div>
    </>;
  } else {
    body = <>
      <h2>Join the workspace</h2>
      <p className="acct-signin-hint">You&apos;re signed in as <b>{user.email}</b>.</p>
      {state.status === 'error' && <p className="ws-error" role="alert">{state.message}</p>}
      <div className="acct-signin-actions">
        <button className="btn primary" type="button" onClick={accept} disabled={state.status === 'busy' || state.status === 'done'}>
          {state.status === 'busy' ? 'Joining…' : 'Accept invite'}
        </button>
      </div>
    </>;
  }

  return (
    <div className="acct-signin-gate">
      <div className="acct-signin-card">
        <div style={{ marginBottom: 14 }}><BrandMark size={30} /></div>
        {body}
        <div className="acct-signin-actions" style={{ marginTop: 10 }}>
          <button className="secondary-btn" type="button" onClick={onExit}>← Exploration Maps</button>
        </div>
      </div>
      {showAuth && <AuthModal onClose={() => setShowAuth(false)} />}
    </div>
  );
}
