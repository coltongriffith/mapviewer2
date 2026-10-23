window.dataLayer = window.dataLayer || [];
function gtag() { dataLayer.push(arguments); }
gtag('js', new Date());
gtag('config', 'AW-18358773663');
// GA4. One-time codes in the address are never sent (see tests/site-analytics-tags.test.js).
(function (l, k) {
  var p = function (s) { try { return k.test(decodeURIComponent(s.split('=')[0])); } catch (e) { return k.test(s.split('=')[0]); } };
  var q = l.search.slice(1).split('&').filter(Boolean);
  if (!q.some(p) && !l.hash.slice(1).split('&').some(p)) return gtag('config', 'G-6SR34P1CR7');
  q = q.filter(function (s) { return !p(s); });
  gtag('config', 'G-6SR34P1CR7', { page_location: l.origin + l.pathname + (q.length ? '?' + q.join('&') : '') });
})(location, /^(session_id|authorization_id|code|token|token_hash|access_token|refresh_token)$/i);
