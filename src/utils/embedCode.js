// The live investor web map: /embed/map/<share id>, the only app route other sites may frame (vercel.json).

const EMBED_PATH = /^\/embed\/map\/([A-Za-z0-9]{6,64})\/?$/;
export const embedShareId = (pathname) => EMBED_PATH.exec(pathname || '')?.[1] || null;
export const embedUrl = (id, origin = window.location.origin) => `${origin}/embed/map/${id}`;

export const EMBED_ASPECTS = { '16:9': [16, 9], '4:3': [4, 3], '1:1': [1, 1], '3:4': [3, 4] };
const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clampPx = (v, d) => Math.max(200, Math.min(4000, Math.round(Number(v) || d)));

// The <iframe> snippet. responsive: fills its container's width up to `width`, keeping the aspect (padding box,
// so it works without CSS aspect-ratio support); otherwise a fixed width × height that still shrinks on a phone.
export function embedCode(id, { origin, title, width = 960, height, aspect = '16:9', responsive = true } = {}) {
  const [aw, ah] = EMBED_ASPECTS[aspect] || EMBED_ASPECTS['16:9'];
  const w = clampPx(width, 960);
  const h = height ? clampPx(height, 540) : Math.round((w * ah) / aw);
  const attrs = `src="${esc(embedUrl(id, origin))}" title="${esc(title || 'Interactive project map')}" loading="lazy" allowfullscreen`;
  if (!responsive) return `<iframe ${attrs} width="${w}" height="${h}" style="border:0;max-width:100%"></iframe>`;
  const pad = +((h / w) * 100).toFixed(4);
  // The padding box sits inside the width cap: percentage padding resolves against the parent's width.
  return `<div style="width:100%;max-width:${w}px"><div style="position:relative;padding-top:${pad}%"><iframe ${attrs} style="position:absolute;top:0;left:0;width:100%;height:100%;border:0"></iframe></div></div>`;
}

// The page that embeds the map, as a host and path: never its query string or fragment.
export function embedReferrer(referrer = document.referrer) {
  try {
    const u = new URL(referrer);
    return /^https?:$/.test(u.protocol) ? `${u.hostname}${u.pathname === '/' ? '' : u.pathname}`.slice(0, 160) : null;
  } catch { return null; }
}

// The map as an investor sees it: claim layers answer a click with their public registry record (utils/claimInfo).
export const embedLayers = (layers = []) => layers.map((l) => (l.role === 'claims' && !l.claimInfo ? { ...l, claimInfo: true } : l));
