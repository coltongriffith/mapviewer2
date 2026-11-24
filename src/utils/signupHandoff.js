import { supabase } from '../lib/supabase';

// Carries an anonymous map across the sign-in email (migration
// 20261124120000_signup_map_handoff.sql). The local draft only lives in this
// browser; when the link opens in another one, the account starts empty and
// the map the visitor built is lost. The map is stashed server-side when the
// link is sent and claimed by the account the link was sent to.

const SENT_KEY = 'em_handoffs_sent';
const PENDING_KEY = 'em_signup_handoff';
const STASH_TIMEOUT_MS = 4000;
const TOKEN_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function sentTokens() {
  try { return JSON.parse(localStorage.getItem(SENT_KEY)) || []; } catch { return []; }
}

/** Stash the map; resolves to a token, or null (never throws, never waits long). */
export async function stashSignupHandoff({ email, payload, projectName, extras = null }) {
  if (!supabase || !email || !payload?.layers?.length) return null;
  const call = supabase.rpc('stash_signup_handoff', {
    p_email: email, p_payload: payload, p_project_name: projectName || null, p_extras: extras,
  }).then(({ data, error }) => (error || !TOKEN_RE.test(String(data || '')) ? null : String(data)));
  const timeout = new Promise((resolve) => { setTimeout(() => resolve(null), STASH_TIMEOUT_MS); });
  const token = await Promise.race([call.catch(() => null), timeout]);
  if (token) {
    // Remember it here: a link opened in THIS browser finds the draft already
    // in place, and must not import a second copy of the same map.
    try { localStorage.setItem(SENT_KEY, JSON.stringify([...sentTokens(), token].slice(-10))); } catch { /* noop */ }
  }
  return token;
}

/** The link the sign-in email should open. */
export function handoffRedirectPath(token) {
  return token ? `/?intent=resume&handoff=${token}` : '/?intent=resume';
}

/** Read the token off the landing URL before the query string is stripped. */
export function captureHandoffToken(params) {
  const token = params.get('handoff');
  if (!token || !TOKEN_RE.test(token)) return;
  try { sessionStorage.setItem(PENDING_KEY, token); } catch { /* noop */ }
}

export function takePendingHandoff() {
  let token = null;
  try { token = sessionStorage.getItem(PENDING_KEY); sessionStorage.removeItem(PENDING_KEY); } catch { /* noop */ }
  if (!token) return null;
  return { token, sameBrowser: sentTokens().includes(token) };
}

/** → { payload, projectName, extras } for the signed-in account the link was sent to, or null. */
export async function claimSignupHandoff(token) {
  if (!supabase || !token) return null;
  const { data, error } = await supabase.rpc('claim_signup_handoff', { p_token: token });
  if (error || !data?.payload) return null;
  return { payload: data.payload, projectName: data.project_name || null, extras: data.extras || null };
}
