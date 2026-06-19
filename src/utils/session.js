// A single, stable per-tab session id, shared by every tracking call
// (page views, searches, exports, leads, landing clicks, live-ping heartbeats)
// so the admin dashboard can reconstruct one visitor's full activity timeline.
const KEY = 'em_live_sid';

export function getSessionId() {
  if (typeof sessionStorage === 'undefined') return null;
  let id = sessionStorage.getItem(KEY);
  if (!id) {
    id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    sessionStorage.setItem(KEY, id);
  }
  return id;
}
