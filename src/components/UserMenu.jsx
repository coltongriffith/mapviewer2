import React, { useState } from 'react';
import { useAuth } from '../hooks/useAuth.jsx';
import AuthModal from './AuthModal';

export default function UserMenu({ onOpenTemplates }) {
  const { user, signOut } = useAuth();
  const [showAuth, setShowAuth] = useState(false);

  if (!user) {
    return (
      <>
        <div className="sidebar-account-panel">
          <div className="sidebar-account-hint">Sign in to save projects to the cloud and use company templates.</div>
          <button className="sidebar-account-signin-btn" onClick={() => setShowAuth(true)}>
            Sign in / Create account
          </button>
        </div>
        {showAuth && <AuthModal onClose={() => setShowAuth(false)} />}
      </>
    );
  }

  return (
    <div className="sidebar-account-panel signed-in">
      <div className="sidebar-account-email" title={user.email}>
        <span className="sidebar-account-avatar">{user.email?.slice(0, 2).toUpperCase() ?? '??'}</span>
        <span className="sidebar-account-name">{user.email}</span>
      </div>
      <div className="sidebar-account-actions">
        <button className="sidebar-account-action-btn" onClick={onOpenTemplates}>
          My Templates
        </button>
        <button className="sidebar-account-action-btn muted" onClick={signOut}>
          Sign out
        </button>
      </div>
    </div>
  );
}
