// After a deploy, an open /3d page offers the new version instead of running on with the old script. When the
// tab is focused or shown again, at most every 10 minutes, the page fetches /3d/ uncached and compares its build
// stamp (<meta name="em-build">, written into the page by vite.config.js) with its own; a different one calls
// onNew, once. It never reloads by itself. A page without a stamp (the dev server) never checks.
export const due = (now, last) => now - last >= 6e5;
export const stampOf = (html) => /name="em-build" content="([^"]+)/.exec(html)?.[1];

export function watchVersion(onNew, doc = document, now = Date.now, get = () => fetch('/3d/', { cache: 'no-store' }).then((r) => r.text())) {
  const mine = stampOf(doc.head.innerHTML);
  let last = now(), told = !mine; // the page itself was just fetched
  const check = () => {
    if (told || doc.hidden || !due(now(), last)) return;
    last = now();
    return get().then((t) => { const s = stampOf(t); if (s && s !== mine) { told = true; onNew(); } }, () => {});
  };
  addEventListener('focus', check); doc.addEventListener('visibilitychange', check);
  return check;
}
