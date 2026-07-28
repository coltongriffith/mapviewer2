import React, { useState } from 'react';
import { useAuth } from '../hooks/useAuth.jsx';
import { PRICING, PRO_FEATURES, yearlyMonthlyEquivalent } from '../utils/pricing';
import { startCheckout } from '../utils/billing';
import { trackEvent } from '../utils/track';

// Upgrade prompt shown when a free account (or anonymous visitor) hits a
// Pro-only feature. `reason` personalizes the headline; checkout requires an
// account, so anonymous visitors are pointed at sign-in first.
const REASON_COPY = {
  export: 'High-resolution SVG, Illustrator and PDF export are part of Pro.',
  projects: 'The free plan saves up to 3 cloud projects — Pro is unlimited.',
  watermark: 'Pro exports are fully clean — no watermark or corner credit.',
  general: 'Unlock the full toolkit for investor-ready maps.',
};

export default function UpgradeModal({ reason = 'general', onClose, onNeedSignIn }) {
  const { user } = useAuth();
  const [interval, setInterval] = useState('year');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const handleUpgrade = async () => {
    if (!user) {
      trackEvent('upgrade_needs_signin', { reason });
      onNeedSignIn?.();
      return;
    }
    setBusy(true);
    setError('');
    try {
      await startCheckout(interval); // redirects on success
    } catch (e) {
      setError(String(e.message || 'Could not start checkout.'));
      setBusy(false);
    }
  };

  return (
    <div className="export-hd-overlay" role="dialog" aria-modal="true" aria-labelledby="upgrade-title" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="export-hd-card">
        <button className="export-hd-close" type="button" onClick={onClose} aria-label="Close">✕</button>
        <div className="share-modal-icon-wrap" style={{ fontSize: 22 }} aria-hidden="true">⛏️</div>
        <h3 id="upgrade-title" className="export-hd-title">Upgrade to Pro</h3>
        <p className="export-hd-desc">{REASON_COPY[reason] || REASON_COPY.general}</p>

        <ul className="upgrade-feature-list">
          {PRO_FEATURES.map((f) => <li key={f}>✓ {f}</li>)}
        </ul>

        <div className="upgrade-interval-row" role="radiogroup" aria-label="Billing interval">
          <button
            type="button"
            className={`upgrade-interval${interval === 'year' ? ' active' : ''}`}
            onClick={() => setInterval('year')}
          >
            <strong>${PRICING.yearly}/year</strong>
            <span>≈ ${yearlyMonthlyEquivalent()}/mo — 2 months free</span>
          </button>
          <button
            type="button"
            className={`upgrade-interval${interval === 'month' ? ' active' : ''}`}
            onClick={() => setInterval('month')}
          >
            <strong>${PRICING.monthly}/month</strong>
            <span>billed monthly, cancel anytime</span>
          </button>
        </div>

        {error && <p className="claims-error" role="alert">⚠ {error}</p>}

        <div className="export-hd-actions">
          <button className="btn primary export-hd-btn-primary" type="button" disabled={busy} onClick={handleUpgrade}>
            {busy ? 'Opening checkout…' : user ? `Upgrade — $${interval === 'year' ? `${PRICING.yearly}/yr` : `${PRICING.monthly}/mo`}` : 'Create a free account to upgrade'}
          </button>
          <button className="export-hd-skip" type="button" onClick={onClose}>Not now</button>
        </div>
        {/* Renewal, cancellation and refund terms must be visible BEFORE
            payment, and linked from checkout (audit P0-09). */}
        <p className="export-hd-small">
          Secure checkout by Stripe. {interval === 'year' ? 'Renews annually' : 'Renews monthly'} until cancelled;
          cancel anytime from your account page and keep access to the end of the period you’ve paid for.
          {' '}By subscribing you agree to our <a href="/terms/" target="_blank" rel="noopener noreferrer">Terms</a>,
          {' '}<a href="/privacy/" target="_blank" rel="noopener noreferrer">Privacy Policy</a>, and
          {' '}<a href="/refunds/" target="_blank" rel="noopener noreferrer">Billing &amp; Refund Policy</a>.
        </p>
      </div>
    </div>
  );
}
