import React, { useState } from 'react';
import { getLastLeadEmail } from '../utils/leadCapture';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function ExportHDModal({ format = 'png', onConfirm, onWithWatermark, onClose }) {
  const [email, setEmail] = useState(() => getLastLeadEmail() || '');
  const [error, setError] = useState('');

  const formatLabel = format === 'svg' ? 'SVG' : 'PNG';

  const handleSubmit = () => {
    const trimmed = email.trim();
    if (!trimmed) { setError('Email is required to remove the watermark.'); return; }
    if (!EMAIL_RE.test(trimmed)) { setError('Please enter a valid email address.'); return; }
    onConfirm(trimmed);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') handleSubmit();
    if (e.key === 'Escape') onClose();
  };

  return (
    <div className="export-hd-overlay" role="dialog" aria-modal="true" aria-labelledby="hd-modal-title" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="export-hd-card">
        <button className="export-hd-close" type="button" onClick={onClose} aria-label="Close">✕</button>

        <div className="export-hd-icon-wrap" aria-hidden="true">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
        </div>

        <h3 id="hd-modal-title" className="export-hd-title">Export {formatLabel} without watermark</h3>
        <p className="export-hd-desc">
          Enter your email to unlock clean exports — no <em>explorationmaps.com</em> label. Free forever, and your email is remembered for future exports.
        </p>

        <div className="export-hd-field">
          <label htmlFor="hd-email" className="export-hd-label">Work email</label>
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
          <p className="export-hd-small">No spam. Occasionally used for product updates — unsubscribe anytime.</p>
        </div>

        <div className="export-hd-actions">
          <button className="btn primary export-hd-btn-primary" type="button" onClick={handleSubmit}>
            Download clean {formatLabel}
          </button>
          <button className="export-hd-skip" type="button" onClick={onWithWatermark}>
            Download with watermark
          </button>
        </div>
      </div>
    </div>
  );
}
