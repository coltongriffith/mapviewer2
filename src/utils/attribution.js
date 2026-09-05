import '../../public/acquisition.js';

export function captureAttribution() { return getAttribution(); }
export function getAttribution() { return window.emAcquisition?.get() || {}; }
export function signupAttribution(user) {
  // Metadata is analytics context only; it must never authorize access.
  return window.emAcquisition?.clean(user?.user_metadata?.em_acquisition || getAttribution()) || {};
}

const inFlight = new Set();
export async function recordSignupOnce(user, send) {
  if (!user?.id || inFlight.has(user.id)) return;
  const flag = `em_signup_recorded_v2_${user.id}`;
  try { if (localStorage.getItem(flag)) return; } catch { /* optional */ }
  inFlight.add(user.id);
  try {
    // Server uses confirmed account time and a stable event id. Failed delivery
    // retries on the next sign-in, including confirmations in another tab.
    const ok = await send('signup_completed', signupAttribution(user));
    if (ok) try { localStorage.setItem(flag, '1'); } catch { /* optional */ }
  } catch { /* Delivery must never interrupt sign-in; retry next time. */ }
  finally { inFlight.delete(user.id); }
}
