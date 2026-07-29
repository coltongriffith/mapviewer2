import React, { useState } from 'react';
import { supabase } from '../lib/supabase';
import Dialog from './Dialog';

/**
 * Completes password recovery.
 *
 * Supabase's recovery link returns the user to the app with a short-lived
 * session and fires a PASSWORD_RECOVERY auth event. Until now the app sent
 * the email but had no screen to finish the flow, so a user who clicked the
 * link could never actually set a new password.
 *
 * Rendered when useAuth reports `recovering`. Not dismissible by backdrop
 * click: leaving the recovery session half-used is the confusing case.
 */
export default function PasswordResetModal({ onDone }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (password.length < 8) {
      setError('Use at least 8 characters.');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    if (!supabase) {
      setError('Auth is not configured.');
      return;
    }
    setBusy(true);
    try {
      const { error: err } = await supabase.auth.updateUser({ password });
      if (err) throw err;
      setDone(true);
    } catch (err) {
      // An expired or already-used link surfaces here — say so plainly and
      // point back at requesting a fresh one.
      const msg = String(err?.message || '');
      setError(/expired|invalid|not found/i.test(msg)
        ? 'This reset link has expired or was already used. Request a new one from the sign-in screen.'
        : msg || 'Could not update the password.');
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <Dialog title="Password updated" titleId="pwdone-title" panelClassName="modal-panel auth-modal" dismissible={false}>
          <div className="auth-info-msg">
            Your password has been changed. If you didn’t request this, change it again
            immediately and sign out of other devices from your account settings.
          </div>
        <button className="btn primary" type="button" onClick={onDone} autoFocus>Continue</button>
      </Dialog>
    );
  }

  return (
    <Dialog title="Choose a new password" titleId="pwreset-title" panelClassName="modal-panel auth-modal" dismissible={false}>
        <p className="auth-modal-sub">You followed a password reset link. Set a new password to finish.</p>
        {error && <div className="auth-error-msg">{error}</div>}
        <form onSubmit={handleSubmit} className="auth-form">
          <label className="auth-label">
            New password
            <input
              className="auth-input"
              type="password"
              value={password}
              onChange={(e) => { setPassword(e.target.value); setError(''); }}
              required
              minLength={8}
              autoComplete="new-password"
              autoFocus
            />
          </label>
          <label className="auth-label">
            Confirm new password
            <input
              className="auth-input"
              type="password"
              value={confirm}
              onChange={(e) => { setConfirm(e.target.value); setError(''); }}
              required
              minLength={8}
              autoComplete="new-password"
            />
          </label>
          <button className="btn primary auth-submit" type="submit" disabled={busy}>
            {busy ? 'Updating…' : 'Update password'}
          </button>
      </form>
    </Dialog>
  );
}
