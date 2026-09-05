// Shared by static SEO pages and the app. No email, map data, or auth tokens.
(function () {
  if (typeof window === 'undefined' || window.emAcquisition) return;
  var KEY = 'em_acquisition_v2';
  var TTL = 90 * 24 * 60 * 60 * 1000;
  var fields = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'gclid', 'gbraid', 'wbraid', 'claim', 'referrer', 'landing_path', 'acquisition_session'];
  function clean(value) {
    var out = {};
    fields.forEach(function (key) {
      if (value && typeof value[key] === 'string' && value[key]) out[key] = value[key].slice(0, 160);
    });
    return out;
  }
  function read() {
    try {
      var saved = JSON.parse(localStorage.getItem(KEY));
      if (saved && saved.expires > Date.now()) return clean(saved.data);
      localStorage.removeItem(KEY);
    } catch (_) { /* storage is optional */ }
    return {};
  }
  function session() {
    try {
      var id = sessionStorage.getItem('em_live_sid');
      if (!id) {
        id = Date.now() + '-' + Math.random().toString(36).slice(2);
        sessionStorage.setItem('em_live_sid', id);
      }
      return id;
    } catch (_) { return null; }
  }
  var params = new URLSearchParams(window.location.search);
  var referrer = '';
  try { referrer = new URL(document.referrer).hostname; } catch (_) { /* direct visit */ }
  var external = referrer && referrer !== window.location.hostname;
  var current = { landing_path: window.location.pathname, acquisition_session: session() };
  fields.slice(0, 7).forEach(function (key) { if (params.get(key)) current[key] = params.get(key); });
  if (params.get('claims')) current.claim = params.get('claims');
  if (external) current.referrer = referrer;
  var saved = read();
  // Internal CTAs describe navigation, not a new acquisition channel.
  var internalSource = /^(blog\/?|companies)$/.test(current.utm_source || '');
  if (!Object.keys(saved).length && (external || current.utm_source || current.gclid || current.gbraid || current.wbraid || current.claim)) {
    saved = clean(current);
    if (external && internalSource) {
      delete saved.utm_source;
      delete saved.utm_medium;
      delete saved.utm_campaign;
    }
    try { localStorage.setItem(KEY, JSON.stringify({ data: saved, expires: Date.now() + TTL })); } catch (_) { /* optional */ }
  }
  window.emAcquisition = {
    get: function () { return clean(saved); },
    clean: clean,
    entry: { path: window.location.pathname, referrer: referrer, utm_source: params.get('utm_source'), utm_medium: params.get('utm_medium'), utm_campaign: params.get('utm_campaign') }
  };
  // Static documents do not execute React. Use the same tab id as the editor.
  if (!document.getElementById('root')) {
    var sid = session();
    var visitKey = 'em_pageview:' + window.location.pathname;
    try { if (sessionStorage.getItem(visitKey)) return; } catch (_) { /* optional */ }
    if (!sid) return;
    fetch('/api/track', {
      method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign({ kind: 'pageview', session_id: sid, device: /Mobi|Android/i.test(navigator.userAgent) ? 'mobile' : 'desktop' }, window.emAcquisition.entry))
    }).then(function (res) {
      if (res.ok) try { sessionStorage.setItem(visitKey, '1'); } catch (_) { /* optional */ }
    }).catch(function () { /* analytics never blocks navigation */ });
  }
})();
