import { supabase } from '../lib/supabase';
import { trackEvent, trackEventOnce } from './track';
import { FREE_PROJECT_LIMIT, isGrandfathered } from './pricing';

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

export async function updateProjectThumbnail(id, thumbnail) {
  const user = await currentUser();
  const { error } = await requireSupabase()
    .from('projects')
    .update({ thumbnail })
    .eq('id', id)
    .eq('user_id', user.id);
  if (error) throw error;
}

// Quota enforcement lives in the create_cloud_project RPC (see
// 20260728000002_project_quota_rpc.sql) — the database evaluates the limit in
// the same transaction as the insert, so it cannot be bypassed with a direct
// Supabase call or raced by two tabs. The client's only job is to turn the
// server's PROJECT_LIMIT error into the upgrade message.
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
export async function saveCloudProject({ id, name, payload, silent = false, expectedRevision }) {
  const user = await currentUser();

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
      throw error;
    }
    // "Worked on this project" — deduped per project per tab-session so the
    // ~10s autosave cadence doesn't turn into keystroke-count noise.
    if (!silent) trackEventOnce('project_saved', id, { project_id: id, name: cleanName.slice(0, 80) });
    return { id, revision: data };
  } else {
    // Transactional create + quota check. Direct INSERT on projects is
    // revoked, so this RPC is the only way a new row can appear.
    const { data, error } = await requireSupabase()
      .rpc('create_cloud_project', { p_name: cleanName, p_payload: payload });
    if (error) {
      if (/PROJECT_LIMIT/.test(error.message || '')) throw projectLimitError();
      throw error;
    }
    if (!silent) trackEvent('project_created', { project_id: data, name: cleanName.slice(0, 80) });
    return { id: data, revision: 1 };
  }
}

export async function loadCloudProject(id) {
  const user = await currentUser();
  const { data, error } = await requireSupabase()
    .from('projects')
    .select('*')
    .eq('id', id)
    .eq('user_id', user.id)
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
  const user = await currentUser();
  const { error } = await requireSupabase()
    .from('projects')
    .update({ name, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('user_id', user.id);
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

export const BRAND_KIT_SAVEABLE_KEYS = [
  // Style & theme
  'themeId', 'accentColor', 'titleBgColor', 'titleFgColor', 'panelBgColor', 'panelFgColor', 'templateId',
  // Logo
  'logo', 'logoScale', 'logoCorner', 'logoWidthPx', 'logoHeightPx', 'logoTransparent',
  // Title panel
  'titleCorner', 'titleWidthPx', 'titleHeightPx', 'titleTransparent', 'titleSize', 'titleWidth',
  // Legend
  'legendMode', 'legendTitle', 'legendCorner', 'legendWidthPx', 'legendHeightPx', 'legendTransparent', 'legendWidth',
  // Inset
  'insetEnabled', 'insetSize', 'insetMode', 'insetCorner', 'insetTitle', 'insetWidthPx', 'insetHeightPx',
  // Navigation elements
  'showNorthArrow', 'northArrowCorner', 'northArrowHeightPx', 'showScaleBar', 'scaleBarCorner',
  // Element layout & stacking order
  'cornerLayout', 'cornerOrder',
  // Footer
  'footerEnabled', 'footerText',
  // Display & composition
  'mode', 'compositionPreset', 'referenceOverlays', 'referenceOpacity', 'safeMargins',
  // Export defaults
  'exportSettings',
  // NI 43-101 fields
  'titleStripPosition', 'stripFontScale', 'qpName', 'qpCredentials', 'companyName', 'projectionName',
  // Marker/zone defaults
  'markerDefaults', 'zoneDefaults',
];

export function applyBrandKitConfig(config, currentLayout) {
  if (!config) return currentLayout;
  const patch = {};
  for (const key of BRAND_KIT_SAVEABLE_KEYS) {
    if (config[key] !== undefined) patch[key] = config[key];
  }
  // Merge fonts instead of overwriting so per-slot overrides are preserved
  if (config.fonts) patch.fonts = { ...currentLayout.fonts, ...config.fonts };
  return { ...currentLayout, ...patch };
}
