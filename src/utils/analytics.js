/**
 * Centralized analytics abstraction.
 *
 * Set VITE_ANALYTICS_KEY in your .env file to enable.
 * Replace the stub in send() with your chosen provider SDK call
 * e.g. posthog.capture(event, props) or mixpanel.track(event, props).
 *
 * When VITE_ANALYTICS_KEY is absent the function is a safe no-op.
 * In dev mode it logs to the console for easy inspection.
 */

const key = import.meta.env.VITE_ANALYTICS_KEY;
const isDev = import.meta.env.DEV;

function send(event, props) {
  // TODO: swap this stub for your provider once you pick one.
  // PostHog example: posthog.capture(event, { ...props })
  // Mixpanel example: mixpanel.track(event, props)
  if (isDev) {
    console.debug('[analytics]', event, props);
  }
}

export function track(event, props = {}) {
  if (!key) {
    if (isDev) console.debug('[analytics:disabled]', event, props);
    return;
  }
  try {
    send(event, props);
  } catch {
    // never let analytics crash the app
  }
}
