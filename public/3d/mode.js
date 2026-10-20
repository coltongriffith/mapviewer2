// Exploration Maps 3D: is this page a shared figure? /3d/share/<id> opens the
// read-only viewer and /3d/embed/<id> its minimal version for iframes
// (src/three-d/share.js). Runs in <head>, before the page paints, so the
// editor never flashes on a shared link, and keeps viewer pages out of search.
(function () {
  var m = /^\/3d\/(share|embed)(?:\/([^/]*))?\/?$/i.exec(location.pathname);
  if (!m) return;
  var h = document.documentElement, embed = m[1].toLowerCase() === 'embed' || /[?&]embed=1(?:&|$)/.test(location.search);
  h.classList.add('em3d-viewer');
  if (embed) h.classList.add('em3d-embed');
  h.setAttribute('data-share', /^[0-9a-f]{32}$/.test(m[2] || '') ? m[2] : '');
  var robots = document.createElement('meta');
  robots.name = 'robots'; robots.content = 'noindex, nofollow';
  document.head.appendChild(robots);
  var canonical = document.querySelector('link[rel="canonical"]');
  if (canonical) canonical.parentNode.removeChild(canonical);
})();
