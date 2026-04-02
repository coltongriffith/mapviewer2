import React, { useState } from 'react';
import { getLastLeadEmail } from '../utils/leadCapture';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * SVG Export modal — prompts for an optional email before triggering SVG export.
 *
 * Props:
 *   onConfirm(email: string | null) — called when the user clicks "Export SVG".
 *                                     email is null if skipped or left blank.
 *   onClose() — called when the user dismisses without downloading.
 */
export default function ExportHDModal({ onConfirm, onClose }) {
  const [email, setEmail] = useState(() => getLastLeadEmail() || '');
  const [error, setError] = useState('');

  const handleSubmit = () => {
    const trimmed = email.trim();
    if (trimmed && !EMAIL_RE.test(trimmed)) {
      setError('Please enter a valid email address.');
      return;
    }
    onConfirm(trimmed || null);
  };

  const handleSkip = () => {
    onConfirm(null);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') handleSubmit();
    if (e.key === 'Escape') onClose();
  };

  return (
    <div className="export-hd-overlay" role="dialog" aria-modal="true" aria-labelledby="hd-modal-title">
      <div className="export-hd-card">
        <button className="export-hd-close" type="button" onClick={onClose} aria-label="Close">✕</button>

        <div className="export-hd-icon-wrap" aria-hidden="true">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
        </div>

        <h3 id="hd-modal-title" className="export-hd-title">Export as SVG</h3>
        <p className="export-hd-desc">
          Vector format — scales to any size. Ideal for print, Illustrator, and Inkscape.
        </p>

        <div className="export-hd-field">
          <label htmlFor="hd-email" className="export-hd-label">
            Email address <span className="export-hd-optional">(optional)</span>
          </label>
          <input
            id="hd-email"
            type="email"
            className={`export-hd-input${error ? ' has-error' : ''}`}
            placeholder="you@company.com"
            value={email}
            onChange={(e) => { setEmail(e.target.value); setError(''); }}
            onKeyDown={handleKeyDown}
            autoComplete="email"
            autoFocus
          />
          {error && <div className="export-hd-error" role="alert">{error}</div>}
          <p className="export-hd-small">Occasionally used for product updates. No spam, unsubscribe anytime.</p>
        </div>

        <div className="export-hd-actions">
          <button className="btn primary export-hd-btn-primary" type="button" onClick={handleSubmit}>
            Download SVG
          </button>
          <button className="export-hd-skip" type="button" onClick={handleSkip}>
            Skip and download
          </button>
        </div>
      </div>
    </div>
  );
}
