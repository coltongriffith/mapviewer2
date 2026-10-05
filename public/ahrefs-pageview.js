// The app's first Ahrefs pageview (index.html loads Ahrefs with
// data-no-pageview-on-load). Ahrefs reports the page's full address, query
// and fragment included, and some app addresses carry one-time codes:
// Stripe's checkout return (?session_id=), the connector consent page
// (?authorization_id=) and sign-in links (#access_token=). Those loads send
// no pageview. Later in-app navigation is tracked by Ahrefs itself, and the
// app clears these codes (replaceState) before it navigates.
(function () {
  var PRIVATE = /(?:^|[?&#])(?:session_id|authorization_id|code|token|token_hash|access_token|refresh_token)=/i;
  if (PRIVATE.test(window.location.search) || PRIVATE.test(window.location.hash)) return;
  var tries = 0;
  (function send() {
    if (window.AhrefsAnalytics) {
      window.AhrefsAnalytics.sendEvent('pageview');
    } else if (++tries < 40) {
      setTimeout(send, 250);
    }
  })();
})();
