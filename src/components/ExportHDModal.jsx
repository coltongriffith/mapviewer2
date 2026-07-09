import React, { useState } from 'react';
import { getLastLeadEmail } from '../utils/leadCapture';
import { PDF_SIZES } from '../export/exportPDF';
import { EXPORT_RATIOS } from '../constants';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Export gate. Two modes:
//   • signed-in  → no email needed; clean export straight away (page size only
//     for PDF). This is the reward for having an account.
//   • anonymous  → one email removes the watermark NOW *and* emails a no-password
//     sign-in link that saves the map to a new account. Same one-field friction
//     as the old lead capture, but the prize is an account, not a spreadsheet row.
// "Download with watermark" always stays one click away so export is never blocked.
export default function ExportHDModal({ format = 'png', activeRatio = null, isSignedIn = false, userEmail = '', onConfirm, onWithWatermark, onClose }) {
  const [email, setEmail] = useState(() => userEmail || getLastLeadEmail() || '');
  const [error, setError] = useState('');
  const suggestedPdfSize = activeRatio ? (EXPORT_RATIOS[activeRatio]?.suggestedPdfSize || 'letter_landscape') : 'letter_landscape';
  const [pdfSize, setPdfSize] = useState(suggestedPdfSize);

  const isPdf = format === 'pdf';
  const formatLabel = format === 'svg' ? 'SVG' : format === 'pdf' ? 'PDF' : 'PNG';

  const handleSignedInExport = () => {
    onConfirm(userEmail || getLastLeadEmail() || '', { pdfSize, noWatermark: true });
  };

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

  const ratioBadge = activeRatio && (
    <div className="export-hd-ratio-badge">
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true" style={{ flexShrink: 0 }}>
        <rect x="1" y="1" width="12" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.6" />
      </svg>
      Exporting {EXPORT_RATIOS[activeRatio].label} ({EXPORT_RATIOS[activeRatio].description}) ratio
    </div>
  );

  const pdfSizeField = isPdf && (
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
  );

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

        {isSignedIn ? (
          <>
            <h3 id="hd-modal-title" className="export-hd-title">Export clean {formatLabel}</h3>
            <p className="export-hd-desc">
              No watermark — you're signed in. Choose your options and download.
            </p>
            {ratioBadge}
            {pdfSizeField}
            <div className="export-hd-actions">
              <button className="btn primary export-hd-btn-primary" type="button" onClick={handleSignedInExport} autoFocus>
                Download clean {formatLabel}
              </button>
              {!isPdf && (
                <button className="export-hd-skip" type="button" onClick={onWithWatermark}>
                  Download with watermark
                </button>
              )}
            </div>
          </>
        ) : (
          <>
            <h3 id="hd-modal-title" className="export-hd-title">Export {formatLabel} without watermark</h3>
            <p className="export-hd-desc">
              Enter your email to download a clean export now — no <em>explorationmaps.com</em> label.
              We'll also email you a one-click sign-in link (no password) so this map is saved to your
              free account and ready to reuse.
            </p>

            {ratioBadge}
            {pdfSizeField}

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
              <p className="export-hd-small">No spam. Your map and account stay free during early access.</p>
            </div>

            <div className="export-hd-actions">
              <button className="btn primary export-hd-btn-primary" type="button" onClick={handleSubmit}>
                Email my link &amp; download clean {formatLabel}
              </button>
              {!isPdf && (
                <button className="export-hd-skip" type="button" onClick={onWithWatermark}>
                  Download with watermark
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
