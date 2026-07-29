// Client-side error reporting (audit P1-12).
//
// Captures uncaught errors, unhandled promise rejections, and React render
// failures, and posts them to /api/client-error. Previously these only ever
// reached the user's console, so a broken export, import, share or billing
// path was invisible to us until someone complained.
//
// Rules this follows:
//  * never throw from the reporter itself,
//  * never block the UI (fire-and-forget, keepalive so it survives unload),
//  * cap volume so a render loop cannot flood the endpoint or the network.

import { supabase } from '../lib/supabase';
import { getSessionId } from './session';

// Vite replaces this at build time; ties a report to the deploy that produced
// it, which is what makes "did my last deploy break something" answerable.
const RELEASE = (typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev');

const MAX_REPORTS_PER_SESSION = 25;
let sent = 0;
const recentlySent = new Map(); // message -> timestamp

function shouldSend(key) {
  if (sent >= MAX_REPORTS_PER_SESSION) return false;
  const now = Date.now();
  const last = recentlySent.get(key);
  // Same fault more than once a minute is noise.
  if (last && now - last < 60_000) return false;
  recentlySent.set(key, now);
  if (recentlySent.size > 100) recentlySent.clear();
  return true;
}

/**
 * Report an error. Safe to call from anywhere, including inside a catch.
 * @param {Error|string} error
 * @param {{kind?: string, context?: object}} [opts]
 */
export function reportError(error, { kind = 'error', context } = {}) {
  try {
    const message = String(error?.message || error || '').slice(0, 500);
    if (!message) return;
    if (!shouldSend(`${kind}:${message}`)) return;
    sent += 1;

    const payload = {
      kind,
      message,
      stack: error?.stack ? String(error.stack).slice(0, 4000) : null,
      path: typeof window !== 'undefined' ? window.location.pathname : null,
      release: RELEASE,
      sessionId: getSessionId(),
      context: context || null,
    };

    const send = (token) => {
      fetch('/api/client-error', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(payload),
        // Survives a navigation or tab close, which is exactly when the
        // interesting crashes happen.
        keepalive: true,
      }).catch(() => { /* telemetry must never surface */ });
    };

    // Attach identity when we already have a session; never block on it.
    if (supabase) {
      supabase.auth.getSession()
        .then(({ data }) => send(data?.session?.access_token || null))
        .catch(() => send(null));
    } else {
      send(null);
    }
  } catch {
    /* the reporter must never be the thing that breaks */
  }
}

/** Install global handlers. Call once at startup. */
export function installErrorReporting() {
  if (typeof window === 'undefined') return;

  window.addEventListener('error', (e) => {
    // Resource load failures (img/script 404) surface here with no message;
    // they are not application faults.
    if (!e.message && e.target !== window) return;
    reportError(e.error || e.message, { kind: 'error', context: { line: e.lineno, col: e.colno, file: e.filename } });
  });

  window.addEventListener('unhandledrejection', (e) => {
    reportError(e.reason, { kind: 'unhandledrejection' });
  });
}
