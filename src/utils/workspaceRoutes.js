// URLs of the company workspace screens. Kept apart from workspace.js so the
// map editor can route without loading the workspace client.
//
//   /workspace                          the active company's workspace
//   /workspace/<org slug>/p/<slug>      a property (slugs are unique per company)
//   /workspace/p/<slug>                 older property links: opened when only
//                                       one of the user's companies has that
//                                       slug, otherwise the user picks
//   /invite                             accept an invite

const seg = (s) => {
  try { return decodeURIComponent(s); } catch { return null; }
};

/** { screen, orgSlug, slug } for a workspace path, or null for any other path. */
export function parseWorkspacePath(pathname) {
  const p = String(pathname || '').replace(/\/+$/, '') || '/';
  if (p === '/workspace') return { screen: 'workspace', orgSlug: null, slug: null };
  if (p === '/invite') return { screen: 'invite', orgSlug: null, slug: null };
  let m = p.match(/^\/workspace\/([^/]+)\/p\/([^/]+)$/);
  if (m && seg(m[1]) && seg(m[2])) return { screen: 'property', orgSlug: seg(m[1]), slug: seg(m[2]) };
  m = p.match(/^\/workspace\/p\/([^/]+)$/);
  if (m && seg(m[1])) return { screen: 'property', orgSlug: null, slug: seg(m[1]) };
  return null;
}

/** The canonical address of a property; the older form when the company slug is unknown. */
export function propertyPath(orgSlug, slug) {
  const s = encodeURIComponent(slug);
  return orgSlug ? `/workspace/${encodeURIComponent(orgSlug)}/p/${s}` : `/workspace/p/${s}`;
}
