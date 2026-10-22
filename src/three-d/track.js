// Exploration Maps 3D usage, sent the way the app sends its own: postTrack (src/utils/trackCore.js) to
// /api/track, the same per-tab session id, the automated-browser flag, and the server's allowlist, so the rows
// land in product_events beside the 2D editor's. Page views come from /acquisition.js, which the page loads.
// Loaded on first use (the page's open event, a few seconds after it settles); never throws, never waits.
import { postTrack } from '../utils/trackCore.js';

// Mirrors the 3D block of EVENT_ALLOWLIST in api/track.js: anything else would be refused there.
export const EVENTS = new Set([
  'three_d_opened', 'three_d_data_added', 'three_d_export_completed', 'three_d_share_created',
  'three_d_share_viewed', 'three_d_share_forked', 'three_d_project_saved', 'three_d_version_published',
]);

// The access token supabase-js keeps in localStorage (sb-<ref>-auth-token), so a signed-in visitor's events carry
// their account without loading supabase-js. The server verifies it; an expired one just leaves user_id empty.
export function storedToken(now = Date.now()) {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i) || '';
      if (!/^sb-.+-auth-token$/.test(k)) continue;
      const s = JSON.parse(localStorage.getItem(k) || 'null');
      const t = s?.access_token || s?.currentSession?.access_token;
      if (typeof t === 'string' && t && !(s.expires_at && s.expires_at * 1000 < now)) return t;
    }
  } catch { /* storage blocked: anonymous */ }
  return null;
}

// Once per tab for the same key, like the app's trackEventOnce: three_d_opened per tab, data added per kind.
const sent = new Set();
function once(key) {
  if (sent.has(key)) return false;
  sent.add(key);
  try { const k = `em3d_track:${key}`; if (sessionStorage.getItem(k)) return false; sessionStorage.setItem(k, '1'); } catch { /* per page load then */ }
  return true;
}

// A shared figure (/3d/share/<id>, /3d/embed/<id>; public/3d/mode.js marks the page) reports only that it was viewed
// and copied. Opening it loads its data and terrain like any figure, which must not count as the viewer adding data,
// saving or exporting.
const VIEWER_EVENTS = new Set(['three_d_share_viewed', 'three_d_share_forked']);
const viewer = () => { try { return document.documentElement.classList.contains('em3d-viewer'); } catch { return false; } };

/** Fire-and-forget. `dedupe` sends the event at most once per tab for that key. Resolves to whether it was sent. */
export function track(event, props, dedupe) {
  try {
    if (!EVENTS.has(event)) return Promise.resolve(false);
    if (viewer() && !VIEWER_EVENTS.has(event)) return Promise.resolve(false);
    if (dedupe != null && !once(`${event}:${dedupe}`)) return Promise.resolve(false);
    const p = props && typeof props === 'object' && Object.keys(props).length ? props : undefined;
    return postTrack({ kind: 'event', event, props: p }, storedToken()).catch(() => false);
  } catch { return Promise.resolve(false); }
}
