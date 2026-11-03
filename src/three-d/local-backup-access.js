// Public shares and published versions keep their existing read-only flows.
export function canUseLocalBackup(loc = location, html = document.documentElement) {
  const url = new URL(loc.href || '/', loc.origin || 'http://localhost');
  return !/^\/3d\/(share|embed)(\/|$)/i.test(url.pathname)
    && !url.searchParams.has('version')
    && !html?.matches('.em3d-viewer,.em3d-version');
}
