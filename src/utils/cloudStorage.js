import { supabase } from '../lib/supabase';
import { trackEvent, trackEventOnce } from './track';
import { FREE_PROJECT_LIMIT } from './pricing';
import { rememberCloudRevision } from './projectStorage';

function requireSupabase() {
  if (!supabase) throw new Error('Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to your environment.');
  return supabase;
}

async function currentUser() {
  const { data: { user } } = await requireSupabase().auth.getUser();
  if (!user) throw new Error('Not authenticated');
  return user;
}

// ── Projects ─────────────────────────────────────────────────────────────────

export async function listCloudProjects() {
  const user = await currentUser();
  const { data, error } = await requireSupabase()
    .from('projects')
    .select('id, name, updated_at, thumbnail, revision')
    .eq('user_id', user.id)
    .is('org_id', null)       // company maps live on their property's page
    .is('deleted_at', null)   // trashed projects are restorable, not listed
    .order('updated_at', { ascending: false });
  if (error) throw error;
  return (data || []).map((r) => ({
    id: r.id,
    name: r.name,
    updatedAt: r.updated_at,
    thumbnail: r.thumbnail || null,
    revision: r.revision ?? 1,
  }));
}

/** Trashed projects still inside the 30-day restore window. */
export async function listTrashedProjects() {
  const user = await currentUser();
  const { data, error } = await requireSupabase()
    .from('projects')
    .select('id, name, updated_at, deleted_at')
    .eq('user_id', user.id)
    .is('org_id', null)
    .not('deleted_at', 'is', null)
    .order('deleted_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function restoreCloudProject(id) {
  const { data, error } = await requireSupabase().rpc('restore_cloud_project', { p_id: id });
  if (error) throw error;
  return Boolean(data);
}

// No user_id filter: row-level security already limits the write to the
// owner of a personal map or an editor of a company map.
export async function updateProjectThumbnail(id, thumbnail) {
  await currentUser();
  const { error } = await requireSupabase()
    .from('projects')
    .update({ thumbnail })
    .eq('id', id);
  if (error) throw error;
}

// Quota enforcement lives in the create_cloud_project RPC (see
// 20260728000002_project_quota_rpc.sql) — the database evaluates the limit in
// the same transaction as the insert, so it cannot be bypassed with a direct
// Supabase call or raced by two tabs. The client's only job is to turn the
// server's PROJECT_LIMIT error into the upgrade message.
// A viewer of a company workspace opened one of its maps.
function readOnlyError() {
  const err = new Error('You have view-only access to this map, so changes are not saved. Use Save As to keep a personal copy, or ask a workspace admin for editor access.');
  err.code = 'ORG_READ_ONLY';
  return err;
}

function projectLimitError() {
  const err = new Error(
    `The free plan saves up to ${FREE_PROJECT_LIMIT} cloud projects — upgrade to Pro for unlimited projects. Your work is still safe in this browser.`,
  );
  err.code = 'PROJECT_LIMIT';
  return err;
}

// silent=true suppresses the analytics events — used by the sign-in bulk
// migration, which creates cloud rows for projects made earlier and must not
// count them as "created now" or flood the activity feed.
/**
 * @param {object} opts
 * @param {number|null} [opts.expectedRevision] The revision this client last
 *   read. The server refuses the write if the row moved on since — which is
 *   what stops two tabs silently overwriting each other. Pass null to
 *   deliberately overwrite (the user chose to after being warned).
 * @returns {Promise<string|{id:string, revision:number}>}
 */
export async function saveCloudProject({ id, name, payload, silent = false, expectedRevision, propertyId = null }) {
  await currentUser(); // throws when signed out — the guard is the point, not the value

  const cleanName = (name || payload?.layout?.title || 'Untitled map');

  if (id) {
    // Compare-and-swap in the database (see 20260728000006). Last-write-wins
    // updates used to discard the other editor's work with no signal.
    const { data, error } = await requireSupabase().rpc('save_cloud_project', {
      p_id: id,
      p_name: cleanName,
      p_payload: payload,
      p_expected_revision: expectedRevision === undefined ? null : expectedRevision,
    });
    if (error) {
      if (/SAVE_CONFLICT/.test(error.message || '')) {
        const e = new Error('This project was changed somewhere else — reload it, save a copy, or overwrite.');
        e.code = 'SAVE_CONFLICT';
        throw e;
      }
      if (/PROJECT_NOT_FOUND/.test(error.message || '')) throw new Error('Project not found in cloud');
      if (/ORG_READ_ONLY/.test(error.message || '')) throw readOnlyError();
      throw error;
    }
    // "Worked on this project" — deduped per project per tab-session so the
    // ~10s autosave cadence doesn't turn into keystroke-count noise.
    if (!silent) trackEventOnce('project_saved', id, { project_id: id, name: cleanName.slice(0, 80) });
    rememberCloudRevision(id, data);
    return { id, revision: data };
  } else {
    // Transactional create + quota check. Direct INSERT on projects is
    // revoked, so this RPC is the only way a new row can appear. A map made
    // inside a company property counts against the company, not the person.
    const { data, error } = propertyId
      ? await requireSupabase().rpc('create_org_project', { p_property: propertyId, p_name: cleanName, p_payload: payload })
      : await requireSupabase().rpc('create_cloud_project', { p_name: cleanName, p_payload: payload });
    if (error) {
      if (/ORG_PROJECT_LIMIT/.test(error.message || '')) {
        const e = new Error('This workspace has reached its map limit on the current plan.');
        e.code = 'ORG_PROJECT_LIMIT';
        throw e;
      }
      if (/ORG_READ_ONLY/.test(error.message || '')) throw readOnlyError();
      if (/PROJECT_LIMIT/.test(error.message || '')) throw projectLimitError();
      throw error;
    }
    if (!silent) trackEvent('project_created', { project_id: data, name: cleanName.slice(0, 80) });
    rememberCloudRevision(data, 1);
    return { id: data, revision: 1 };
  }
}

// Personal maps and the maps of the user's workspaces: row-level security
// decides which, so a viewer can open a company map too.
export async function loadCloudProject(id) {
  await currentUser();
  const { data, error } = await requireSupabase()
    .from('projects')
    .select('*')
    .eq('id', id)
    .single();
  if (error) throw error;
  return data;
}

// Soft delete: the project moves to trash and is restorable for 30 days.
// Permanent deletion on a mis-click was unrecoverable customer data loss.
export async function deleteCloudProject(id) {
  const { data, error } = await requireSupabase().rpc('trash_cloud_project', { p_id: id });
  if (error) throw error;
  if (!data) throw new Error('Project not found');
}

export async function renameCloudProject(id, name) {
  await currentUser();
  const { error } = await requireSupabase()
    .from('projects')
    .update({ name, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
}

// ── Brand Kits (stored in the `templates` table) ────────────────────────────

export async function listBrandKits() {
  const user = await currentUser();
  const { data, error } = await requireSupabase()
    .from('templates')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function saveBrandKit({ name, config, isDefault = false }) {
  const user = await currentUser();

  if (isDefault) {
    await requireSupabase()
      .from('templates')
      .update({ is_default: false })
      .eq('user_id', user.id);
  }

  const { data, error } = await requireSupabase()
    .from('templates')
    .insert({ user_id: user.id, name, config, is_default: isDefault })
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

export async function updateBrandKit(id, updates) {
  const user = await currentUser();
  const { error } = await requireSupabase()
    .from('templates')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('user_id', user.id);
  if (error) throw error;
}

export async function setDefaultBrandKit(id) {
  const user = await currentUser();
  await requireSupabase()
    .from('templates')
    .update({ is_default: false })
    .eq('user_id', user.id);
  const { error } = await requireSupabase()
    .from('templates')
    .update({ is_default: true })
    .eq('id', id)
    .eq('user_id', user.id);
  if (error) throw error;
}

export async function deleteBrandKit(id) {
  const user = await currentUser();
  const { error } = await requireSupabase()
    .from('templates')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id);
  if (error) throw error;
}

export async function getDefaultBrandKit() {
  const user = await currentUser();
  const { data, error } = await requireSupabase()
    .from('templates')
    .select('*')
    .eq('user_id', user.id)
    .eq('is_default', true)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

// ── Shared Maps ──────────────────────────────────────────────────────────────

// Opaque per-browser key used ONLY to rate-limit anonymous share creation.
// Not an identity and never shown to readers.
function creatorKey() {
  try {
    let k = localStorage.getItem('em_share_key');
    if (!k) {
      k = crypto.randomUUID().replace(/-/g, '');
      localStorage.setItem('em_share_key', k);
    }
    return k;
  } catch {
    return crypto.randomUUID().replace(/-/g, '');
  }
}

export async function shareMap(project) {
  const sb = requireSupabase();
  // Creation goes through a validating RPC (size, shape, feature count, rate
  // limit, expiry). Direct INSERT on shared_maps is revoked, so the public
  // anon key can no longer be used as an unmetered write API.
  const { data, error } = await sb.rpc('create_shared_map', {
    p_state: project,
    p_creator_key: creatorKey(),
  });
  if (error) {
    const msg = error.message || '';
    if (msg.includes('SHARE_TOO_LARGE')) throw new Error('This map is too large to share — remove some layers or simplify the geometry and try again.');
    if (msg.includes('SHARE_TOO_COMPLEX')) throw new Error('This map has too many features to share. Simplify or split it and try again.');
    if (msg.includes('SHARE_RATE_LIMIT')) throw new Error('You’ve created several share links recently. Please wait a few minutes and try again.');
    if (msg.includes('SHARE_INVALID')) throw new Error('This map could not be shared. Save it and try again.');
    throw error;
  }
  return data;
}

/** Statuses distinguish "gone" from "we couldn't reach the service" (P1-04). */
export const SHARE_LOAD = { OK: 'ok', UNAVAILABLE: 'unavailable', ERROR: 'error' };

export async function loadSharedMap(id) {
  const sb = requireSupabase();
  // Narrow lookup RPC (get_shared_map): returns only the map state for one
  // id and bumps view_count server-side. Direct table SELECT is revoked —
  // anonymous clients cannot enumerate shared_maps. Revoked and expired
  // shares return null.
  const { data, error } = await sb.rpc('get_shared_map', { share_id: id });
  if (error) {
    // A transport/database failure is NOT the same as a removed link.
    const e = new Error('Could not load this shared map right now.');
    e.status = SHARE_LOAD.ERROR;
    throw e;
  }
  return data ?? null;
}

export async function listMySharedMaps() {
  const { data, error } = await requireSupabase().rpc('list_my_shared_maps');
  if (error) throw error;
  return data || [];
}

export async function revokeSharedMap(id) {
  const { data, error } = await requireSupabase().rpc('revoke_shared_map', { p_id: id });
  if (error) throw error;
  return Boolean(data);
}

// The saved map's live web map (one share link, republished in place for every site that embeds it): migration
// 20261103110000. Publishing is always the owner's explicit action; edits never reach the link on their own.
function liveMapError(error) {
  if (error?.code !== 'PGRST202' && error?.code !== '42883') return error;
  return Object.assign(new Error('Live maps are not available yet. Your saved map is unchanged.'), { code: 'LIVE_MAP_UNAVAILABLE' });
}

export async function publishLiveMap(projectId, state) {
  const { data, error } = await requireSupabase().rpc('publish_live_map', { p_project: projectId, p_state: state });
  if (error) {
    const unavailable = liveMapError(error);
    if (unavailable !== error) throw unavailable;
    const msg = error.message || '';
    if (msg.includes('LIVE_MAP_PLAN')) throw new Error('Live web maps are part of Pro.');
    if (msg.includes('SHARE_RATE_LIMIT')) throw new Error('This map was published moments ago. Try again in a few seconds.');
    if (msg.includes('SHARE_TOO_LARGE')) throw new Error('This map is too large to publish. Remove some layers or simplify the geometry.');
    if (msg.includes('SHARE_TOO_COMPLEX')) throw new Error('This map has too many features to publish. Simplify or split it.');
    if (msg.includes('NOT_FOUND')) throw new Error('Save this map to your account first.');
    throw error;
  }
  return data;
}

export async function revokeLiveMap(projectId) {
  const { data, error } = await requireSupabase().rpc('revoke_live_map', { p_project: projectId });
  if (error) throw liveMapError(error);
  return data === true;
}

export async function getLiveMap(projectId) {
  const { data, error } = await requireSupabase().rpc('get_live_map', { p_project: projectId });
  if (error) throw liveMapError(error);
  return data ?? null;
}

// Fork a shared map's state into the signed-in user's own account as a brand-new
// project. The shared `state` is the exact same shape as a project `payload`, so
// it can be inserted directly; the recipient gets a fully independent copy and
// the original sender's map is untouched. Requires an authenticated session.
export async function cloneSharedMapToCloud(state, name) {
  const displayName = name || state?.layout?.title || 'Shared map';
  return saveCloudProject({ id: null, name: displayName, payload: state });
}

// ── Account settings (one row per user in `account_settings`) ───────────────
// Reusable defaults (company, QP info, projection) seeded into new projects.

export async function getAccountSettings() {
  const user = await currentUser();
  const { data, error } = await requireSupabase()
    .from('account_settings')
    .select('settings')
    .eq('user_id', user.id)
    .maybeSingle();
  if (error) throw error;
  return data?.settings || {};
}

export async function saveAccountSettings(settings) {
  const user = await currentUser();
  const { error } = await requireSupabase()
    .from('account_settings')
    .upsert(
      { user_id: user.id, settings, updated_at: new Date().toISOString() },
      { onConflict: 'user_id' },
    );
  if (error) throw error;
  return settings;
}

// Fields the account settings panel manages; also the keys merged into new
// projects' layout so a long-time user's company/QP defaults pre-fill.
export const ACCOUNT_SETTINGS_KEYS = ['companyName', 'qpName', 'qpCredentials', 'projectionName'];

// Shared with the MCP connector, which applies an account's kit server-side.
export { BRAND_KIT_SAVEABLE_KEYS, applyBrandKitConfig } from '../brandKit.js';
