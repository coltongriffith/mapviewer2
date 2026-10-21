import { getSessionId } from './session';

// The one /api/track sender, shared by the app (src/utils/track.js, which looks
// up the Supabase access token first) and the standalone /3d page
// (src/three-d/track.js, which reads it from storage so the page never loads
// supabase-js just to count a visit). Fire-and-forget: never throws, resolves
// true when the server took the payload.
export async function postTrack(payload, token = null) {
  try {
    const res = await fetch('/api/track', {
      method: 'POST',
      keepalive: true,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      // Automated browsers are flagged so /api/track can leave them out.
      body: JSON.stringify({ session_id: getSessionId(), ...payload, ...(navigator.webdriver ? { automated: true } : {}) }),
    });
    if (import.meta.env.DEV && !res.ok && res.status !== 204) {
      console.warn(`[track] ${payload.kind} rejected: ${res.status}`);
    }
    return res.ok;
  } catch (e) {
    if (import.meta.env.DEV) console.warn('[track] failed:', e?.message);
    return false;
  }
}
