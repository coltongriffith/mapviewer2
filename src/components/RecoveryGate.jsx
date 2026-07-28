import React from 'react';
import { useAuth } from '../hooks/useAuth';
import PasswordResetModal from './PasswordResetModal';

/**
 * Renders the password-reset form whenever a recovery link has been followed.
 *
 * Mounted next to <App /> rather than inside it: App returns a different tree
 * per screen (landing / editor / account / admin / shared map), so a modal
 * placed in one branch would be missed by the others. Recovery must be
 * reachable from wherever the emailed link happens to land.
 */
export default function RecoveryGate() {
  const { recovering, endRecovery } = useAuth();
  if (!recovering) return null;
  return <PasswordResetModal onDone={endRecovery} />;
}
