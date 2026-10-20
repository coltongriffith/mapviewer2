import React, { useState } from 'react';
import { useAuth } from '../../hooks/useAuth.jsx';
import AuthModal from '../AuthModal';
import WorkspacePage from './WorkspacePage';
import PropertyPage from './PropertyPage';
import InvitePage from './InvitePage';

// The /workspace, /workspace/p/<slug> and /invite screens, loaded on demand
// so the map editor's own chunk does not carry them.
export default function WorkspaceScreens({ screen, propertySlug, go, onOpenProperty, onOpenMap, onNewMap }) {
  const { user, loading } = useAuth();
  const [showAuth, setShowAuth] = useState(false);

  if (screen === 'invite') return <InvitePage onExit={() => go('landing')} onAccepted={() => go('workspace')} />;

  if (!user) {
    return (
      <div className="acct-signin-gate">
        <div className="acct-signin-card">
          <h2>Sign in to see your company workspace</h2>
          <p className="acct-signin-hint">Your company&apos;s properties, maps and 3D figures live in its workspace.</p>
          <div className="acct-signin-actions">
            <button className="btn primary" type="button" onClick={() => setShowAuth(true)} disabled={loading}>Sign in / Create account</button>
            <button className="secondary-btn" type="button" onClick={() => go('landing')}>← Back</button>
          </div>
        </div>
        {showAuth && <AuthModal onClose={() => setShowAuth(false)} />}
      </div>
    );
  }

  if (screen === 'workspace') {
    return <WorkspacePage onExit={() => go('landing')} onOpenDashboard={() => go('dashboard')} onOpenProperty={onOpenProperty} />;
  }
  return (
    <PropertyPage
      key={propertySlug}
      slug={propertySlug}
      onExit={() => go('landing')}
      onOpenDashboard={() => go('dashboard')}
      onOpenWorkspace={() => go('workspace')}
      onOpenMap={onOpenMap}
      onNewMap={onNewMap}
      onOpenTenureMonitor={() => go('tenure')}
    />
  );
}
