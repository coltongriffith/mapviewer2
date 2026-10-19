import { supabase } from '../lib/supabase';

// One full-resolution PNG per account, free. Offered when a free export is cut
// to the plan's pixel cap: an anonymous exporter trades an email for it (the
// sign-in link creates the account), a signed-in free account just uses it.
//
// The request survives the email round trip in localStorage, so the link has
// to be opened in the browser that holds the map. Whether the account has
// spent its export lives in the user's metadata, so it is once per account,
// not once per browser.

const PENDING_KEY = 'mapviewer.pendingFullResExport.v1';
const PENDING_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
export const FULLRES_USED_KEY = 'em_fullres_export_at';

export function queueFullResExport({ requestedPx }, now = Date.now()) {
  try {
    localStorage.setItem(PENDING_KEY, JSON.stringify({ requestedPx: Math.round(requestedPx) || null, at: now }));
    return true;
  } catch {
    return false;
  }
}

export function loadFullResExport(now = Date.now()) {
  try {
    const pending = JSON.parse(localStorage.getItem(PENDING_KEY) || 'null');
    if (!Number.isFinite(pending?.at) || now - pending.at > PENDING_MAX_AGE_MS) return null;
    return pending;
  } catch {
    return null;
  }
}

export function clearFullResExport() {
  try { localStorage.removeItem(PENDING_KEY); } catch { /* noop */ }
}

export function fullResCreditUsed(user) {
  return Boolean(user?.user_metadata?.[FULLRES_USED_KEY]);
}

export async function markFullResCreditUsed(now = new Date()) {
  if (!supabase) return;
  await supabase.auth.updateUser({ data: { [FULLRES_USED_KEY]: now.toISOString() } });
}
