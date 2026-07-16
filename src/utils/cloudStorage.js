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
    .select('id, name, updated_at, thumbnail')
    .eq('user_id', user.id)
    .order('updated_at', { ascending: false });
  if (error) throw error;
  return (data || []).map((r) => ({
    id: r.id,
    name: r.name,
    updatedAt: r.updated_at,
    thumbnail: r.thumbnail || null,
  }));
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

// Free-plan cap on NEW cloud projects. FAIL-OPEN by design: any error in
// this check (plan row missing, lookup failed, count failed) allows the
// save — a grandfathered or paying user must never lose a save to a
// transient lookup problem. Only a definitive free plan at the limit denies.
async function assertProjectQuota(user) {
  try {
    if (isGrandfathered(user)) return; // early accounts: unlimited, forever
    const sb = requireSupabase();
    const { data: planRow, error: planErr } = await sb
      .from('user_plans').select('plan').eq('user_id', user.id).maybeSingle();
    if (planErr || !planRow || planRow.plan === 'pro') return;
    const { count, error: countErr } = await sb
      .from('projects').select('id', { count: 'exact', head: true }).eq('user_id', user.id);
    if (countErr || count == null || count < FREE_PROJECT_LIMIT) return;
    const err = new Error(
      `The free plan saves up to ${FREE_PROJECT_LIMIT} cloud projects — upgrade to Pro for unlimited projects. Your work is still safe in this browser.`,
    );
    err.code = 'PROJECT_LIMIT';
    throw err;
  } catch (e) {
    if (e?.code === 'PROJECT_LIMIT') throw e;
    // Anything else (network, schema) — fail open.
  }
}

// silent=true suppresses the analytics events — used by the sign-in bulk
// migration, which creates cloud rows for projects made earlier and must not
// count them as "created now" or flood the activity feed.
export async function saveCloudProject({ id, name, payload, silent = false }) {
  const user = await currentUser();

  const now = new Date().toISOString();
  const cleanName = (name || payload?.layout?.title || 'Untitled map');
  const record = { name: cleanName, payload, updated_at: now };

  if (id) {
    const { data, error } = await requireSupabase()
      .from('projects')
      .update(record)
      .eq('id', id)
      .eq('user_id', user.id)
      .select('id');
    if (error) throw error;
    if (!data || !data.length) throw new Error('Project not found in cloud');
    // "Worked on this project" — deduped per project per tab-session so the
    // ~10s autosave cadence doesn't turn into keystroke-count noise.
    if (!silent) trackEventOnce('project_saved', id, { project_id: id, name: cleanName.slice(0, 80) });
    return id;
  } else {
    await assertProjectQuota(user); // free plan: capped new-project count
    const { data, error } = await requireSupabase()
      .from('projects')
      .insert({ user_id: user.id, ...record })
      .select('id')
      .single();
    if (error) throw error;
    if (!silent) trackEvent('project_created', { project_id: data.id, name: cleanName.slice(0, 80) });
    return data.id;
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

export async function deleteCloudProject(id) {
  const user = await currentUser();
  const { error } = await requireSupabase()
    .from('projects')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id);
  if (error) throw error;
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

export async function shareMap(project, userId = null) {
  const sb = requireSupabase();
  const id = crypto.randomUUID().replace(/-/g, '');
  const { error } = await sb.from('shared_maps').insert({
    id,
    state: project,
    user_id: userId ?? null,
  });
  if (error) throw error;
  return id;
}

export async function loadSharedMap(id) {
  const sb = requireSupabase();
  // Narrow lookup RPC (get_shared_map): returns only the map state for one
  // id and bumps view_count server-side. Direct table SELECT is revoked —
  // anonymous clients cannot enumerate shared_maps.
  const { data, error } = await sb.rpc('get_shared_map', { share_id: id });
  if (error || !data) return null;
  return data;
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
