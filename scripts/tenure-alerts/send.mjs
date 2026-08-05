// Email transport for the alert engine.
//
// Separated from run.mjs so it can be tested without importing the job — that
// module calls main() at load and would try to reach Supabase.
//
// The contract callers depend on: THIS FUNCTION NEVER THROWS. It is invoked
// after the dispatcher has already claimed an alert row out of 'pending', and
// an escaping exception leaves that row in 'sending' — a status nothing
// selects and nothing requeues, so the reminder is lost rather than retried.
// Every failure comes back as a value instead.

import { credential } from '../lib/env.mjs';

export async function send(to, { subject, html, text }) {
  const from = process.env.TENURE_ALERT_FROM
    || 'Exploration Maps <notifications@explorationmaps.com>';
  try {
    // Read inside the try: credential() throws on a key carrying a newline,
    // which is a configuration fault, not a bad address. It has to read as a
    // retryable delivery failure so the reminder survives to the next run.
    const apiKey = credential('RESEND_API_KEY');
    if (!apiKey) {
      return { ok: false, error: 'RESEND_API_KEY not configured', hardBounce: false };
    }
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to, subject, html, text }),
    });
    const body = await res.json().catch(() => ({}));
    if (res.ok) return { ok: true, id: body.id };
    // 422 from Resend means the address itself is unusable — retrying will
    // fail identically forever.
    return { ok: false, error: body.message || `resend ${res.status}`, hardBounce: res.status === 422 };
  } catch (e) {
    // hardBounce stays false: our configuration being wrong must never mark a
    // recipient's address as permanently bad and burn their future alerts.
    return { ok: false, error: String(e?.message || e), hardBounce: false };
  }
}
