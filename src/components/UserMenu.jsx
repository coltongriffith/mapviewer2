import React, { useState } from 'react';
import { useAuth } from '../hooks/useAuth.jsx';
import AuthModal from './AuthModal';
import { FeedbackLauncher } from './FeedbackModal';

// `onSaveToAccount`, when given, keeps the open map for after sign-in (the
// editor passes its account-save request); without it the link only signs in.
export default function UserMenu({ onOpenTemplates, onOpenAccount, onOpenTenureMonitor, onSaveToAccount }) {
  const { user, signOut } = useAuth();
  const [showAuth, setShowAuth] = useState(false);

  if (!user) {
    return (
      <>
        {/* One line, not a block: the inspector's footer also carries the
            step's Next button, and every pixel here comes out of the panel. */}
        <div className="sidebar-account-panel sidebar-account-panel--compact">
          <span className="sidebar-account-hint">Saved on this device.</span>
          <button type="button" className="sidebar-account-link" onClick={() => (onSaveToAccount ? onSaveToAccount() : setShowAuth(true))}>
            {onSaveToAccount ? 'Save to a free account' : 'Sign in to keep it'}
          </button>
          <span className="sidebar-account-sep" aria-hidden="true">·</span>
          {/* One entry point for "this broke" / "I wish it did X", signed in or not. */}
          <FeedbackLauncher className="sidebar-account-link" label="Feedback" />
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
        {onOpenTenureMonitor && (
          <button
            className="sidebar-account-action-btn"
            onClick={onOpenTenureMonitor}
            title="Watch your B.C. mineral claims for approaching good-to-dates"
          >
            Tenure Monitor
          </button>
        )}
        <button className="sidebar-account-action-btn muted" onClick={signOut}>
          Sign out
        </button>
      </div>
      <FeedbackLauncher userEmail={user.email} />
    </div>
  );
}
