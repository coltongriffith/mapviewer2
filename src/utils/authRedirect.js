// Supabase honours an auth email's redirect only on its Site URL host
// (https://explorationmaps.com) or its Redirect URLs allowlist, and silently
// swaps anything else for the bare Site URL. The site is served from www, so
// confirmation links landed on the apex root and lost the page the user
// signed up from (e.g. /tenure-monitor). Point them at the apex host instead:
// Vercel's apex -> www redirect keeps the path, query and token fragment.
const SITE_HOST = 'explorationmaps.com';
// Signup metadata already carries these; replaying them on the confirmation
// visit would count a second attributed session.
const TRACKING_PARAMS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'gclid', 'gbraid', 'wbraid'];

export function authRedirectUrl(href) {
  const url = new URL(href);
  if (url.hostname === `www.${SITE_HOST}`) url.hostname = SITE_HOST;
  TRACKING_PARAMS.forEach((key) => url.searchParams.delete(key));
  // Supabase appends the session as #access_token=...; an existing fragment
  // would leave two and break the sign-in.
  url.hash = '';
  return url.href;
}
