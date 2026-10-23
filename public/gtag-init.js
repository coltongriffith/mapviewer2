window.dataLayer = window.dataLayer || [];
function gtag() { dataLayer.push(arguments); }
gtag('js', new Date());
gtag('config', 'AW-18358773663');
// Google Analytics 4 (Exploration Maps property). gtag.js is loaded once with the Ads ID; a second config
// is all GA4 needs. The CSP allows its collection hosts (*.google-analytics.com, *.analytics.google.com).
// GA4's pageview reports the page address, and some app addresses carry one-time codes: Stripe's checkout
// return (?session_id=), the connector consent page (?authorization_id=) and sign-in links (?code=,
// #access_token=). As public/ahrefs-pageview.js does, those never leave the browser: on such an address the
// automatic pageview is off and one pageview is sent with the codes removed from the query and without the
// fragment. The setting is per event, so later in-app pageviews (after the app clears the codes with
// replaceState) report their own address as usual.
(function () {
  var PRIVATE = /^(?:session_id|authorization_id|code|token|token_hash|access_token|refresh_token)$/i;
  var loc = window.location;
  var isPrivate = function (pair) {
    var key = pair.split('=')[0];
    try { key = decodeURIComponent(key); } catch (e) { /* keep the raw key */ }
    return PRIVATE.test(key);
  };
  var params = loc.search.replace(/^\?/, '').split('&').filter(Boolean);
  var hash = loc.hash.replace(/^#/, '').split('&').filter(Boolean);
  if (!params.some(isPrivate) && !hash.some(isPrivate)) {
    gtag('config', 'G-6SR34P1CR7');
    return;
  }
  var kept = params.filter(function (pair) { return !isPrivate(pair); });
  gtag('config', 'G-6SR34P1CR7', { send_page_view: false });
  gtag('event', 'page_view', {
    send_to: 'G-6SR34P1CR7',
    page_location: loc.origin + loc.pathname + (kept.length ? '?' + kept.join('&') : ''),
  });
})();
