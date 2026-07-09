import React, { useState } from 'react';
import { useAuth } from '../hooks/useAuth';

export default function AuthModal({ onClose, context = '' }) {
  const { signIn, signUp, signInWithMagicLink, resetPassword } = useAuth();
  // 'magic' is the default: one email, no password, no confirm round-trip.
  const [mode, setMode] = useState('magic'); // 'magic' | 'signin' | 'signup' | 'reset'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [loading, setLoading] = useState(false);
  const [linkSent, setLinkSent] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setInfo('');
    if (mode === 'signup' && password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    setLoading(true);
    try {
      if (mode === 'magic') {
        await signInWithMagicLink(email);
        setLinkSent(true);
        setInfo(`We emailed a sign-in link to ${email}. Open it on this device — your map will still be here.`);
      } else if (mode === 'signin') {
        await signIn(email, password);
        onClose();
      } else if (mode === 'signup') {
        await signUp(email, password);
        setInfo('Check your email to confirm your account, then sign in.');
        setMode('signin');
      } else if (mode === 'reset') {
        await resetPassword(email);
        setInfo('Password reset email sent. Check your inbox.');
        setMode('signin');
      }
    } catch (err) {
      setError(err.message || 'Something went wrong.');
    } finally {
      setLoading(false);
    }
  }

  const title = mode === 'magic' ? 'Sign in' : mode === 'signin' ? 'Sign in with password' : mode === 'signup' ? 'Create account' : 'Reset password';
  const submitLabel = mode === 'magic' ? (linkSent ? 'Resend link' : 'Email me a sign-in link') : title;

  return (
    <div className="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-panel auth-modal">
        <button className="modal-close-btn" onClick={onClose} aria-label="Close">×</button>
        <h2 className="auth-modal-title">{title}</h2>
        {context && !linkSent && (
          <p className="auth-modal-context">{context}</p>
        )}
        {mode === 'magic' && !linkSent && (
          <p className="auth-modal-sub">No password needed — we email you a link that signs you in (and creates your account if you're new).</p>
        )}

        {info && <div className="auth-info-msg">{info}</div>}
        {error && <div className="auth-error-msg">{error}</div>}

        <form onSubmit={handleSubmit} className="auth-form">
          <label className="auth-label">
            Email
            <input
              className="auth-input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              placeholder="you@example.com"
            />
          </label>

          {mode !== 'reset' && mode !== 'magic' && (
            <label className="auth-label">
              Password
              <input
                className="auth-input"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                placeholder="••••••••"
              />
            </label>
          )}

          {mode === 'signup' && (
            <label className="auth-label">
              Confirm password
              <input
                className="auth-input"
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
                autoComplete="new-password"
                placeholder="••••••••"
              />
            </label>
          )}

          <button className="btn auth-submit-btn" type="submit" disabled={loading}>
            {loading ? 'Please wait…' : submitLabel}
          </button>
        </form>

        <div className="auth-footer-links">
          {mode === 'magic' && (
            <button className="link-btn" onClick={() => { setError(''); setInfo(''); setMode('signin'); }}>
              Use a password instead
            </button>
          )}
          {mode === 'signin' && (
            <>
              <button className="link-btn" onClick={() => { setError(''); setInfo(''); setMode('magic'); }}>
                Email me a link instead
              </button>
              <span className="auth-link-sep">·</span>
              <button className="link-btn" onClick={() => { setError(''); setMode('signup'); }}>
                Create account
              </button>
              <span className="auth-link-sep">·</span>
              <button className="link-btn" onClick={() => { setError(''); setMode('reset'); }}>
                Forgot password?
              </button>
            </>
          )}
          {mode === 'signup' && (
            <button className="link-btn" onClick={() => { setError(''); setMode('signin'); }}>
              Already have an account? Sign in
            </button>
          )}
          {mode === 'reset' && (
            <button className="link-btn" onClick={() => { setError(''); setMode('signin'); }}>
              Back to sign in
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
