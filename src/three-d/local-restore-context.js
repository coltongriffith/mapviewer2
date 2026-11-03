// A restored backup opens in its own editor document. Capture its one-shot
// intent before account boot or URL cleanup; never infer it from project data.
const initial = new URL(globalThis.location?.href || 'http://localhost/');
const fragment = new URLSearchParams(initial.hash.slice(1));
export const localRestoreBoot = fragment.has('local-restore') || initial.searchParams.has('local-restore');
const nonce = fragment.get('local-restore');
export const localRestoreNonce = localRestoreBoot
  && /^\/3d\/?$/.test(initial.pathname)
  && !initial.search
  && [...fragment.keys()].length === 1
  && /^[a-f0-9]{32}$/i.test(nonce || '') ? nonce : null;

// Neither the nonce nor mixed account/auth intent should travel as a referrer.
// Invalid restore intent still remains an isolated, unready document.
if (localRestoreBoot) {
  try { globalThis.history?.replaceState(globalThis.history.state, '', initial.pathname); } catch { /* immutable boot mode still prevents autoload */ }
}

let ready = false;
export const isLocalRestoreReady = () => ready;
export function markLocalRestoreReady() {
  if (!localRestoreBoot || !localRestoreNonce) return false;
  ready = true;
  return true;
}
