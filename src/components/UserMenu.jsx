import React, { useState } from 'react';
import { useAuth } from '../hooks/useAuth.jsx';
import AuthModal from './AuthModal';

export default function UserMenu({ onOpenTemplates, onOpenAccount }) {
  const { user, signOut } = useAuth();
  const [showAuth, setShowAuth] = useState(false);

  if (!user) {
    return (
      <>
        <div className="sidebar-account-panel">
          <div className="sidebar-account-hint">Sign in to save projects to the cloud and use brand kits.</div>
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
      <button
        className="sidebar-account-email sidebar-account-email-btn"
        title={`${user.email} — open dashboard`}
        type="button"
        onClick={onOpenAccount}
      >
        <span className="sidebar-account-avatar">{user.email?.slice(0, 2).toUpperCase() ?? '??'}</span>
        <span className="sidebar-account-name">{user.email}</span>
      </button>
      <div className="sidebar-account-actions">
        <button className="sidebar-account-action-btn" onClick={onOpenTemplates}>
          Brand Kits
        </button>
        <button className="sidebar-account-action-btn muted" onClick={signOut}>
          Sign out
        </button>
      </div>
    </div>
  );
}
