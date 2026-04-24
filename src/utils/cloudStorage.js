import { supabase } from '../lib/supabase';

// ── Projects ─────────────────────────────────────────────────────────────────

export async function listCloudProjects() {
  const { data, error } = await supabase
    .from('projects')
    .select('id, name, updated_at')
    .order('updated_at', { ascending: false });
  if (error) throw error;
  return (data || []).map((r) => ({
    id: r.id,
    name: r.name,
    updatedAt: r.updated_at,
  }));
}

export async function saveCloudProject({ id, name, payload }) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const now = new Date().toISOString();
  const record = { name: name || payload?.layout?.title || 'Untitled map', payload, updated_at: now };

  if (id) {
    const { error } = await supabase
      .from('projects')
      .upsert({ id, user_id: user.id, ...record })
      .eq('id', id);
    if (error) throw error;
    return id;
  } else {
    const { data, error } = await supabase
      .from('projects')
      .insert({ user_id: user.id, ...record })
      .select('id')
      .single();
    if (error) throw error;
    return data.id;
  }
}

export async function loadCloudProject(id) {
  const { data, error } = await supabase
    .from('projects')
    .select('*')
    .eq('id', id)
    .single();
  if (error) throw error;
  return data;
}

export async function deleteCloudProject(id) {
  const { error } = await supabase.from('projects').delete().eq('id', id);
  if (error) throw error;
}

export async function renameCloudProject(id, name) {
  const { error } = await supabase
    .from('projects')
    .update({ name, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
}

// ── Templates ─────────────────────────────────────────────────────────────────

export async function listTemplates() {
  const { data, error } = await supabase
    .from('templates')
    .select('*')
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function saveTemplate({ name, config, isDefault = false }) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  if (isDefault) {
    await supabase
      .from('templates')
      .update({ is_default: false })
      .eq('user_id', user.id);
  }

  const { data, error } = await supabase
    .from('templates')
    .insert({ user_id: user.id, name, config, is_default: isDefault })
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

export async function updateTemplate(id, updates) {
  const { error } = await supabase
    .from('templates')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
}

export async function setDefaultTemplate(id) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');
  await supabase.from('templates').update({ is_default: false }).eq('user_id', user.id);
  const { error } = await supabase.from('templates').update({ is_default: true }).eq('id', id);
  if (error) throw error;
}

export async function deleteTemplate(id) {
  const { error } = await supabase.from('templates').delete().eq('id', id);
  if (error) throw error;
}

export async function getDefaultTemplate() {
  const { data, error } = await supabase
    .from('templates')
    .select('*')
    .eq('is_default', true)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

export function applyTemplateConfig(config, currentLayout) {
  if (!config) return currentLayout;
  const allowed = ['themeId', 'accentColor', 'titleBgColor', 'titleFgColor', 'panelBgColor', 'panelFgColor', 'logo', 'logoScale', 'mode', 'fonts'];
  const patch = {};
  for (const key of allowed) {
    if (config[key] !== undefined) patch[key] = config[key];
  }
  return { ...currentLayout, ...patch };
}
