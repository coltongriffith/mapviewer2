// Submit in-app feedback / issue reports to /api/feedback.
//
// Unlike the error reporter this is user-initiated and the user is waiting on
// the answer, so it throws a readable message on failure instead of swallowing
// it. Diagnostics (recent client errors, viewport, path, release) ride along so
// a two-word report still arrives with enough context to act on.

import { supabase } from '../lib/supabase';
import { getSessionId } from './session';
import { getRecentErrors } from './errorReporter';

const RELEASE = (typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev');

export const FEEDBACK_KINDS = [
  { id: 'bug', label: 'Something broke' },
  { id: 'feedback', label: 'Feedback' },
  { id: 'idea', label: 'Idea' },
];

function collectContext(extra) {
  const ctx = { ...(extra || {}) };
  try {
    const errors = getRecentErrors();
    if (errors.length) ctx.recentErrors = errors;
    if (typeof window !== 'undefined') {
      ctx.viewport = `${window.innerWidth}x${window.innerHeight}`;
      ctx.language = navigator.language;
      if (navigator.connection?.effectiveType) ctx.network = navigator.connection.effectiveType;
    }
  } catch { /* diagnostics are best-effort */ }
  return ctx;
}

async function accessToken() {
  if (!supabase) return null;
  try {
    const { data } = await supabase.auth.getSession();
    return data?.session?.access_token || null;
  } catch {
    return null;
  }
}

/**
 * @param {{kind: string, message: string, email?: string, context?: object}} report
 * @returns {Promise<{id: string|null}>}
 */
export async function submitFeedback({ kind, message, email, context }) {
  const body = {
    kind,
    message: String(message || '').trim(),
    email: String(email || '').trim() || undefined,
    path: typeof window !== 'undefined' ? window.location.pathname : null,
    release: RELEASE,
    sessionId: getSessionId(),
    context: collectContext(context),
  };
  const token = await accessToken();
  let res;
  try {
    res = await fetch('/api/feedback', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error('Couldn’t reach the server. Check your connection and try again.');
  }
  let json = null;
  try { json = await res.json(); } catch { /* non-JSON error page */ }
  if (!res.ok) {
    throw new Error(json?.error || 'Couldn’t send your report. Please try again.');
  }
  return { id: json?.id || null };
}
