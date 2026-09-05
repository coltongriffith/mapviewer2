import React from 'react';

export default function SigninLinkStatus({ status, onRetry, onClose }) {
  if (!status) return null;
  return <div className="signup-link-status" role={status.state === 'failed' ? 'alert' : 'status'}>
    <span>{status.state === 'sending' ? 'Sending your sign-in link…'
      : status.state === 'sent' ? 'Sign-in link sent. Open it on this device to save your map to your account.'
        : 'We couldn’t send your sign-in link. Your map remains on this device.'}</span>
    {status.state === 'failed' && <button type="button" onClick={onRetry}>Retry email</button>}
    <button type="button" onClick={onClose} aria-label="Dismiss email status">×</button>
  </div>;
}
