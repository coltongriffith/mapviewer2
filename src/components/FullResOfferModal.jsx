import React, { useState } from 'react';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Shown when a free PNG export was cut to the plan's pixel cap. Modes:
//   • email   → anonymous: an email buys one full-resolution export, delivered
//     as a sign-in link that creates the account.
//   • credit  → a signed-in free account that has not used its one export.
// `returning` is the credit mode after the sign-in link brought them back.
export default function FullResOfferModal({
  mode, requestedPx, allowedPx, returning = false, defaultEmail = '', link = null,
  onSendLink, onUseCredit, onSeePro, onClose,
}) {
  const [email, setEmail] = useState(defaultEmail);
  const [error, setError] = useState('');
  const full = requestedPx ? `${requestedPx.toLocaleString()} px` : 'full resolution';
  const capped = `${(allowedPx || 0).toLocaleString()} px`;

  const submit = (e) => {
    e.preventDefault();
    const trimmed = email.trim();
    if (!EMAIL_RE.test(trimmed)) { setError('Enter a valid email address.'); return; }
    onSendLink(trimmed);
  };

  let title;
  let body;
  if (mode === 'credit') {
    title = returning ? 'Your full-resolution map is ready' : 'Download it at full resolution';
    body = (
      <>
        <p className="export-hd-desc">
          {returning
            ? `You're signed in. Download this map at ${full}: your account's one free full-resolution export.`
            : `Your map downloaded at ${capped}, the free limit. Your account includes one free full-resolution export. Use it on this map for ${full}.`}
        </p>
        <div className="export-hd-actions">
          <button className="btn primary export-hd-btn-primary" type="button" onClick={onUseCredit} autoFocus>
            Download at {full}
          </button>
          <button className="export-hd-skip" type="button" onClick={onSeePro}>See Pro plans</button>
        </div>
      </>
    );
  } else if (link?.state === 'sent') {
    title = 'Check your email';
    body = (
      <>
        <p className="export-hd-desc">
          We sent a sign-in link to <strong>{link.email}</strong>. Open it in this browser and download your map at {full}.
        </p>
        <div className="export-hd-actions">
          <button className="btn primary export-hd-btn-primary" type="button" onClick={onClose} autoFocus>Done</button>
        </div>
      </>
    );
  } else {
    title = 'Get this map at full resolution';
    body = (
      // display: contents keeps the card's grid spacing inside the form.
      <form onSubmit={submit} noValidate style={{ display: 'contents' }}>
        <p className="export-hd-desc">
          Your map downloaded at {capped}, the free limit. Enter your email and we'll send a sign-in link.
          Open it in this browser to download the {full} version, free, once. No password.
        </p>
        <div className="export-hd-field">
          <label htmlFor="fullres-email" className="export-hd-label">Work email</label>
          <input
            id="fullres-email"
            type="email"
            className={`export-hd-input${error ? ' has-error' : ''}`}
            placeholder="you@company.com"
            value={email}
            onChange={(e) => { setEmail(e.target.value); setError(''); }}
            autoComplete="email"
            autoFocus
          />
          {(error || link?.state === 'failed') && (
            <div className="export-hd-error" role="alert">{error || 'We could not send the email. Try again.'}</div>
          )}
          <p className="export-hd-small">Creates a free account. No card required.</p>
        </div>
        <div className="export-hd-actions">
          <button className="btn primary export-hd-btn-primary" type="submit" disabled={link?.state === 'sending'}>
            {link?.state === 'sending' ? 'Sending…' : 'Email me the link'}
          </button>
          <button className="export-hd-skip" type="button" onClick={onSeePro}>See Pro plans</button>
        </div>
      </form>
    );
  }

  return (
    <div className="export-hd-overlay" role="dialog" aria-modal="true" aria-labelledby="fullres-title" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="export-hd-card">
        <button className="export-hd-close" type="button" onClick={onClose} aria-label="Close">✕</button>
        <h3 id="fullres-title" className="export-hd-title">{title}</h3>
        {body}
      </div>
    </div>
  );
}
