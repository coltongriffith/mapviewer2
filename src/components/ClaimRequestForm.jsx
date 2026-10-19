import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { getLastLeadEmail } from '../utils/leadCapture';
import { sendClaimRequest, trackEvent } from '../utils/track';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Under an empty claim search. Registries hold owners and claim numbers, not
// project names, so "Torrance" finds nothing even though Neotech Metals holds
// it. The request lands in public.claim_search_requests for a person to answer.
export default function ClaimRequestForm({ query, province, provinceLabel, mode }) {
  const [open, setOpen] = useState(false);
  const [what, setWhat] = useState(query || '');
  const [email, setEmail] = useState(() => getLastLeadEmail() || '');
  const [note, setNote] = useState('');
  const [state, setState] = useState('idle'); // idle | sending | sent | failed
  const [error, setError] = useState('');
  const company = mode === 'company';

  useEffect(() => { setWhat(query || ''); setState('idle'); setOpen(false); }, [query, province]);

  useEffect(() => {
    if (!open || email || !supabase) return;
    supabase.auth.getSession()
      .then(({ data }) => { const known = data?.session?.user?.email; if (known) setEmail((e) => e || known); })
      .catch(() => {});
  }, [open, email]);

  const submit = async (e) => {
    e.preventDefault();
    if (!what.trim()) { setError('Tell us what you were looking for.'); return; }
    if (!EMAIL_RE.test(email.trim())) { setError('Enter your email so we can reply.'); return; }
    setError('');
    setState('sending');
    const ok = await sendClaimRequest({ email: email.trim(), query: what.trim(), province, mode, note: note.trim() });
    setState(ok ? 'sent' : 'failed');
    if (ok) trackEvent('search_recovery_clicked', { province, mode, action: 'request_sent' });
  };

  if (state === 'sent') {
    return (
      <p className="claims-request-line" role="status">
        Thanks. We'll look up “{what.trim()}” in {provinceLabel} and reply to {email.trim()}.
      </p>
    );
  }

  return (
    <>
      <p className="claims-request-line">
        {company ? 'Searching a project name? Try the company that holds it, or ' : 'Can’t find it? '}
        <button type="button" className="link-btn" aria-expanded={open} onClick={() => {
          setOpen((v) => !v);
          if (!open) trackEvent('search_recovery_clicked', { province, mode, action: 'request' });
        }}>{company ? 'tell us the project' : 'tell us what you’re looking for'}</button>.
      </p>
      {open && (
        <form className="claims-request-form" onSubmit={submit} noValidate>
          <label>
            {company ? 'Project or company' : 'What are you looking for?'}
            <input className="export-hd-input" value={what} onChange={(e) => setWhat(e.target.value)} maxLength={200} />
          </label>
          <label>
            Your email
            <input className="export-hd-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" placeholder="you@company.com" />
          </label>
          <label>
            Anything that helps (optional)
            <textarea className="export-hd-input" rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000}
              placeholder="Company, nearby town or lake, claim numbers" />
          </label>
          {(error || state === 'failed') && (
            <p className="claims-error" role="alert">{error || 'We could not send that. Try again.'}</p>
          )}
          <button type="submit" className="ui-btn ui-btn--primary" disabled={state === 'sending'}>
            {state === 'sending' ? 'Sending…' : 'Send'}
          </button>
          <p className="claims-request-small">We'll look it up in {provinceLabel} and reply by email.</p>
        </form>
      )}
    </>
  );
}
