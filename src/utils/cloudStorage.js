import { supabase } from '../lib/supabase';

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

export async function saveCloudProject({ id, name, payload }) {
  const user = await currentUser();

  const now = new Date().toISOString();
  const record = { name: name || payload?.layout?.title || 'Untitled map', payload, updated_at: now };

  if (id) {
    const { data, error } = await requireSupabase()
      .from('projects')
      .update(record)
      .eq('id', id)
      .eq('user_id', user.id)
      .select('id');
    if (error) throw error;
    if (!data || !data.length) throw new Error('Project not found in cloud');
    return id;
  } else {
    const { data, error } = await requireSupabase()
      .from('projects')
      .insert({ user_id: user.id, ...record })
      .select('id')
      .single();
    if (error) throw error;
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
  const { data, error } = await sb
    .from('shared_maps')
    .select('state')
    .eq('id', id)
    .single();
  if (error || !data) return null;
  // Increment view count in the background (fire-and-forget)
  sb.rpc('increment_shared_map_view', { map_id: id }).then(() => {});
  return data.state;
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
