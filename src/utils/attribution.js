// First-touch acquisition attribution for the first-10-accounts phase.
//
// Captured once per browser session BEFORE the various deep-link effects strip
// the query string (see App.jsx). Stashed in sessionStorage so it survives the
// magic-link round-trip within the same tab, then read back when
// `signup_completed` fires — the only reliable way to answer "which channel /
// which company outreach link produced this account".
const KEY = 'em_attribution';

/**
 * Record the landing context if we haven't already this session. First touch
 * wins: a later in-app navigation that adds no utm params won't overwrite the
 * source the visitor actually arrived from.
 */
export function captureAttribution() {
  if (typeof window === 'undefined' || typeof sessionStorage === 'undefined') return;
  try {
    if (sessionStorage.getItem(KEY)) return;
    const params = new URLSearchParams(window.location.search);
    const ref = document.referrer || null;
    const refDomain = ref ? (() => { try { return new URL(ref).hostname; } catch { return ref; } })() : null;
    const data = {
      utm_source: params.get('utm_source') || null,
      utm_medium: params.get('utm_medium') || null,
      utm_campaign: params.get('utm_campaign') || null,
      // `claims` (deep link) or `claim` (account-claim flag) carry the company
      // ticker — the single most useful attribution for the concierge campaign.
      claim: params.get('claims') || params.get('claim') || null,
      referrer: refDomain,
      landing_path: window.location.pathname || null,
    };
    // Only persist when there's a real acquisition signal. landing_path is
    // always set (even "/"), so it must NOT count — otherwise a plain direct
    // visit would store an empty first touch and the early-return above would
    // then drop the utm_campaign / claimed ticker from a later company-link
    // load in the same tab, which is exactly the attribution we want to keep.
    const hasSignal = data.utm_source || data.utm_medium || data.utm_campaign || data.claim || data.referrer;
    if (hasSignal) {
      sessionStorage.setItem(KEY, JSON.stringify(data));
    }
  } catch {
    // attribution is best-effort — never break the app over it
  }
}

/** Return the captured first-touch attribution, or {} if none. */
export function getAttribution() {
  if (typeof sessionStorage === 'undefined') return {};
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    // Drop null keys so event props stay compact.
    return Object.fromEntries(Object.entries(parsed).filter(([, v]) => v));
  } catch {
    return {};
  }
}
