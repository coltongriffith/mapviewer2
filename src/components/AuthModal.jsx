import React, { useState } from 'react';
import { useAuth } from '../hooks/useAuth';

export default function AuthModal({ onClose }) {
  const { signIn, signUp, resetPassword } = useAuth();
  const [mode, setMode] = useState('signin'); // 'signin' | 'signup' | 'reset'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [loading, setLoading] = useState(false);

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
      if (mode === 'signin') {
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

  const title = mode === 'signin' ? 'Sign in' : mode === 'signup' ? 'Create account' : 'Reset password';

  return (
    <div className="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-panel auth-modal">
        <button className="modal-close-btn" onClick={onClose} aria-label="Close">×</button>
        <h2 className="auth-modal-title">{title}</h2>

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

          {mode !== 'reset' && (
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
            {loading ? 'Please wait…' : title}
          </button>
        </form>

        <div className="auth-footer-links">
          {mode === 'signin' && (
            <>
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
