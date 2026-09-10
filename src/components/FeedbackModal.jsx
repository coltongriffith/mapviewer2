import React, { useState } from 'react';
import Dialog from './Dialog';
import { submitFeedback, FEEDBACK_KINDS } from '../utils/feedback';

/**
 * "Send feedback" form. Reachable from the sidebar account panel and from the
 * crash screen, so a user who just hit a wall can tell us while it is fresh.
 *
 * Deliberately does not use useAuth(): the error boundary renders it OUTSIDE
 * the AuthProvider. Callers that know the user pass `userEmail`; otherwise an
 * optional contact field is shown.
 */
export default function FeedbackModal({
  onClose,
  initialKind = 'feedback',
  initialMessage = '',
  userEmail = null,
  context = null,
  onSubmitted,
}) {
  const [kind, setKind] = useState(initialKind);
  const [message, setMessage] = useState(initialMessage);
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState('idle'); // idle | sending | sent | error
  const [error, setError] = useState('');

  const isBug = kind === 'bug';

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (status === 'sending') return;
    const text = message.trim();
    if (text.length < 3) {
      setError('Please tell us what happened — a sentence is plenty.');
      setStatus('error');
      return;
    }
    setStatus('sending');
    setError('');
    try {
      await submitFeedback({ kind, message: text, email: userEmail ? undefined : email, context });
      setStatus('sent');
      onSubmitted?.();
    } catch (err) {
      setError(err?.message || 'Couldn’t send your report. Please try again.');
      setStatus('error');
    }
  };

  return (
    <Dialog onClose={onClose} title={status === 'sent' ? 'Thanks — got it' : 'Send feedback'} titleId="feedback-title" panelClassName="modal-panel auth-modal feedback-modal">
      <button className="modal-close-btn" type="button" onClick={onClose} aria-label="Close">×</button>

      {status === 'sent' ? (
        <div className="feedback-sent">
          <p className="auth-modal-sub">
            Your report is in. {userEmail || email
              ? 'If we need more detail we’ll reply by email.'
              : 'Leave an email next time if you’d like a reply.'}
          </p>
          <button className="ui-btn ui-btn--primary auth-submit-btn" type="button" onClick={onClose}>Done</button>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="auth-form" noValidate>
          <div className="feedback-kind-row" role="radiogroup" aria-label="What kind of message is this?">
            {FEEDBACK_KINDS.map((k) => (
              <button
                key={k.id}
                type="button"
                role="radio"
                aria-checked={kind === k.id}
                className={`feedback-kind-btn${kind === k.id ? ' active' : ''}`}
                onClick={() => setKind(k.id)}
              >
                {k.label}
              </button>
            ))}
          </div>

          <label className="auth-label" htmlFor="feedback-message">
            {isBug ? 'What went wrong?' : 'Your message'}
            <textarea
              id="feedback-message"
              className="auth-input feedback-textarea"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder={isBug
                ? 'What were you trying to do, and what happened instead?'
                : 'What would make Exploration Maps more useful for you?'}
              rows={5}
              maxLength={4000}
              required
              autoFocus
            />
          </label>

          {!userEmail && (
            <label className="auth-label" htmlFor="feedback-email">
              Email <span className="feedback-optional">(optional, for a reply)</span>
              <input
                id="feedback-email"
                className="auth-input"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                autoComplete="email"
              />
            </label>
          )}

          {status === 'error' && error && <div className="auth-error-msg" role="alert">{error}</div>}

          <button className="ui-btn ui-btn--primary auth-submit-btn" type="submit" disabled={status === 'sending'}>
            {status === 'sending' ? 'Sending…' : (isBug ? 'Report problem' : 'Send')}
          </button>
          <p className="feedback-fineprint">
            {isBug
              ? 'The page you’re on, the app version and any recent errors from this tab are attached automatically. Nothing from your map data is sent.'
              : 'The page you’re on and the app version are attached so we have context.'}
          </p>
        </form>
      )}
    </Dialog>
  );
}

/**
 * Button + modal in one, so callers in the main editor chunk carry a single
 * element reference rather than the state and markup (bundle budget).
 */
export function FeedbackLauncher({ userEmail = null, className = 'sidebar-feedback-btn', label = 'Report a problem / send feedback' }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className={className} type="button" onClick={() => setOpen(true)} title="Report a problem or send feedback">
        {label}
      </button>
      {open && <FeedbackModal onClose={() => setOpen(false)} userEmail={userEmail} />}
    </>
  );
}
