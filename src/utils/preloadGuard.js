// A tab opened before a deploy may ask for a lazy chunk whose hashed name is gone; Vite then fires
// vite:preloadError. Reload once for the new build (not again within a minute, so it can never loop:
// the same guard as /3d's studio.js). Unsaved work is whatever makes the page warn on leaving (App.jsx's
// beforeunload guard): then show a notice instead and leave the error be. Lives in the entry, not App.
export function installPreloadGuard(win = window) {
  win.addEventListener('vite:preloadError', (e) => {
    const leave = new win.Event('beforeunload', { cancelable: true });
    win.dispatchEvent(leave);
    if (leave.defaultPrevented) {
      const d = win.document;
      if (d.querySelector('.update-notice')) return;
      const n = d.createElement('div');
      n.className = 'update-notice'; n.setAttribute('role', 'status'); n.title = 'Dismiss'; n.onclick = () => n.remove();
      d.body.append(n);
      n.textContent = 'A new version is available — save your work, then reload.';
      return;
    }
    try { if (Date.now() - (+win.sessionStorage.getItem('em.reloadedAt') || 0) < 6e4) return; win.sessionStorage.setItem('em.reloadedAt', Date.now()); } catch { return; }
    e.preventDefault(); win.location.reload();
  });
}
