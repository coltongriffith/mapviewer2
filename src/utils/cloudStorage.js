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
    .select('id, name, updated_at')
    .eq('user_id', user.id)
    .order('updated_at', { ascending: false });
  if (error) throw error;
  return (data || []).map((r) => ({
    id: r.id,
    name: r.name,
    updatedAt: r.updated_at,
  }));
}

export async function saveCloudProject({ id, name, payload }) {
  const user = await currentUser();

  const now = new Date().toISOString();
  const record = { name: name || payload?.layout?.title || 'Untitled map', payload, updated_at: now };

  if (id) {
    const { error } = await requireSupabase()
      .from('projects')
      .update(record)
      .eq('id', id)
      .eq('user_id', user.id);
    if (error) throw error;
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

// ── Templates ─────────────────────────────────────────────────────────────────

export async function listTemplates() {
  const user = await currentUser();
  const { data, error } = await requireSupabase()
    .from('templates')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function saveTemplate({ name, config, isDefault = false }) {
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

export async function updateTemplate(id, updates) {
  const user = await currentUser();
  const { error } = await requireSupabase()
    .from('templates')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('user_id', user.id);
  if (error) throw error;
}

export async function setDefaultTemplate(id) {
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

export async function deleteTemplate(id) {
  const user = await currentUser();
  const { error } = await requireSupabase()
    .from('templates')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id);
  if (error) throw error;
}

export async function getDefaultTemplate() {
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

export const TEMPLATE_SAVEABLE_KEYS = [
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

export function applyTemplateConfig(config, currentLayout) {
  if (!config) return currentLayout;
  const patch = {};
  for (const key of TEMPLATE_SAVEABLE_KEYS) {
    if (config[key] !== undefined) patch[key] = config[key];
  }
  // Merge fonts instead of overwriting so per-slot overrides are preserved
  if (config.fonts) patch.fonts = { ...currentLayout.fonts, ...config.fonts };
  return { ...currentLayout, ...patch };
}
