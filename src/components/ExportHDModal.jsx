import React, { useState } from 'react';
import { getLastLeadEmail } from '../utils/leadCapture';
import { PDF_SIZES } from '../export/exportPDF';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function ExportHDModal({ format = 'png', onConfirm, onWithWatermark, onClose }) {
  const [email, setEmail] = useState(() => getLastLeadEmail() || '');
  const [error, setError] = useState('');
  const [pdfSize, setPdfSize] = useState('letter_landscape');

  const isPdf = format === 'pdf';
  const formatLabel = format === 'svg' ? 'SVG' : format === 'pdf' ? 'PDF' : 'PNG';

  const handleSubmit = () => {
    const trimmed = email.trim();
    if (!trimmed) { setError('Email is required to remove the watermark.'); return; }
    if (!EMAIL_RE.test(trimmed)) { setError('Please enter a valid email address.'); return; }
    onConfirm(trimmed, { pdfSize });
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

        {isPdf && (
          <div className="export-hd-field" style={{ marginBottom: 12 }}>
            <label htmlFor="hd-pdf-size" className="export-hd-label">Page size</label>
            <select
              id="hd-pdf-size"
              value={pdfSize}
              onChange={(e) => setPdfSize(e.target.value)}
              style={{ width: '100%', padding: '8px 10px', borderRadius: 6, border: '1.5px solid #e2e8f0', fontSize: 14 }}
            >
              {Object.entries(PDF_SIZES).map(([key, val]) => (
                <option key={key} value={key}>{val.label} ({val.w}" × {val.h}")</option>
              ))}
            </select>
          </div>
        )}

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
          {!isPdf && (
            <button className="export-hd-skip" type="button" onClick={onWithWatermark}>
              Download with watermark
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
