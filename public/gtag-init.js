window.dataLayer = window.dataLayer || [];
function gtag() { dataLayer.push(arguments); }
gtag('js', new Date());
// Google Ads and GA4. One-time codes in the address or referrer are never sent (see tests/site-analytics-tags.test.js).
(function (k) {
  var p = function (s) { try { return k.test(decodeURIComponent(s.split('=')[0])); } catch (e) { return k.test(s.split('=')[0]); } };
  var c = function (h) {
    try { h = new URL(h); } catch (e) { return null; }
    var q = h.search.slice(1).split('&').filter(Boolean);
    if (!q.some(p) && !h.hash.slice(1).split('&').some(p)) return null;
    q = q.filter(function (s) { return !p(s); });
    return h.origin + h.pathname + (q.length ? '?' + q.join('&') : '');
  };
  var r = document.referrer && c(document.referrer), a = c(location.href), o = r ? { page_referrer: r } : {};
  gtag('config', 'AW-18358773663', a ? { page_location: a, page_referrer: r || document.referrer || a } : o);
  // GA4 starts once the app has cleared the codes, so its own history pageviews never see them.
  (function ga() { if (c(location.href)) setTimeout(ga, 500); else gtag('config', 'G-6SR34P1CR7', o); })();
})(/^(session_id|authorization_id|code|token|token_hash|access_token|refresh_token)$/i);
