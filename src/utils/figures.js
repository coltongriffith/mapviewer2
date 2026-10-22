// The signed-in user's own 3D figures, for the dashboard and the account page.
// A thin client over public.three_d_projects and the private three-d-files
// bucket (supabase/migrations/20261022100000_three_d_projects.sql), using the
// app's Supabase client. The /3d page has its own lazy client for the same
// rows (src/three-d/account-core.js); both follow the same storage layout:
// a personal figure's files live under <uid>/<figure id>/<save>/<file>.
//
// Personal figures only (org_id is null), like the dashboard's maps: company
// figures are listed on their property's page. Row-level security decides
// every permission; nothing here widens it.
import { supabase } from '../lib/supabase';
import { copyName } from './mapName.js';
import { listMyWorkspaces, listProperties, hasRole, moveFigureToProperty } from './workspace';

const TABLE = 'three_d_projects';
const BUCKET = 'three-d-files';

/** Opens a saved figure in the 3D maker. */
export const figureUrl = (id) => `/3d?project=${encodeURIComponent(id)}`;
/** Opens the 3D maker with a property preselected for the first save. */
export const newFigureUrl = (propertyId = null) => (propertyId ? `/3d?property=${encodeURIComponent(propertyId)}` : '/3d');

/** Only a stored JPEG, PNG or WebP data URL is shown as a thumbnail. */
export const safeThumbnail = (t) => (/^data:image\/(jpeg|png|webp);base64,/.test(t || '') ? t : null);

/** Bytes of data files a figure keeps in storage (the sizes saved with it). */
export function figureBytes(filePaths) {
  return (Array.isArray(filePaths) ? filePaths : []).reduce((n, f) => n + (Number(f?.size) > 0 ? Number(f.size) : 0), 0);
}

function sb() {
  if (!supabase) throw new Error('3D figures need an Exploration Maps account, which is not available on this site right now.');
  return supabase;
}
async function me() {
  const { data, error } = await sb().auth.getUser();
  if (error || !data?.user) throw new Error('Sign in to see your 3D figures.');
  return data.user;
}
function friendly(err, doing) {
  const msg = String(err?.message || err || '');
  if (/failed to fetch|network|load failed/i.test(msg)) return new Error(`Could not reach Exploration Maps to ${doing}. Check your connection and try again.`);
  if (/jwt|not authenticated|row-level security|permission/i.test(msg)) return new Error(`You do not have permission to ${doing}. Sign in again and retry.`);
  return new Error(`Could not ${doing}${msg ? ` (${msg.replace(/\.$/, '')})` : ''}.`);
}

const toFigure = (r) => ({
  id: r.id, name: r.name, updatedAt: r.updated_at, createdAt: r.created_at,
  thumbnail: safeThumbnail(r.thumbnail), bytes: figureBytes(r.file_paths),
});

/** The user's personal figures, most recently changed first. */
export async function listMyFigures() {
  const user = await me();
  const { data, error } = await sb().from(TABLE)
    .select('id, name, thumbnail, created_at, updated_at, file_paths')
    .eq('user_id', user.id).is('org_id', null).is('deleted_at', null)
    .order('updated_at', { ascending: false }).limit(200);
  if (error) throw friendly(error, 'load your 3D figures');
  return (data || []).map(toFigure);
}

export async function renameFigure(id, name) {
  const title = String(name || '').trim().slice(0, 200);
  if (!title) throw new Error('Give the 3D figure a name.');
  const { data, error } = await sb().from(TABLE).update({ name: title }).eq('id', id).is('deleted_at', null).select('id, name, updated_at');
  if (error) throw friendly(error, 'rename that 3D figure');
  if (!data?.length) throw new Error('That 3D figure was not found. It may have been deleted.');
  return data[0];
}

/** Soft delete, as the 3D maker's own Delete does: the row and its files stay. */
export async function deleteFigure(id) {
  const { data, error } = await sb().from(TABLE).update({ deleted_at: new Date().toISOString() }).eq('id', id).is('deleted_at', null).select('id');
  if (error) throw friendly(error, 'delete that 3D figure');
  if (!data?.length) throw new Error('That 3D figure was not found. It may already be deleted.');
}

/** Where a duplicate's copy of `path` goes: the same file name, in the copy's own save folder. */
export function copyPath(path, uid, newId, rev) {
  const p = String(path || '');
  if (!p || /(^|\/)\.\.?(\/|$)/.test(p)) throw new Error('A file of this figure is outside its folder.');
  return `${uid}/${newId}/${rev}/${p.split('/').pop()}`;
}

/**
 * A personal copy of a figure, named "<name> (copy)", then "(copy 2)"… (as
 * the 2D dashboard names copies). Its data files are copied into the new
 * figure's own folder first, so the copy never points at the original's
 * files; a failure removes whatever was copied. Published versions and share
 * links stay with the original.
 */
export async function duplicateFigure(id, takenNames = []) {
  const user = await me();
  const client = sb();
  const { data: src, error } = await client.from(TABLE).select('id, name, settings, file_paths, thumbnail').eq('id', id).is('deleted_at', null).maybeSingle();
  if (error) throw friendly(error, 'copy that 3D figure');
  if (!src) throw new Error('That 3D figure was not found. It may have been deleted.');
  const newId = crypto.randomUUID();
  const rev = `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const files = Array.isArray(src.file_paths) ? src.file_paths : [];
  const used = new Set();
  const copied = [];
  const filePaths = files.map((f, i) => {
    let to = copyPath(f.path, user.id, newId, rev);
    if (used.has(to)) to = `${user.id}/${newId}/${rev}/${i}-${to.split('/').pop()}`;
    used.add(to);
    return { ...f, path: to };
  });
  const store = client.storage.from(BUCKET);
  const name = copyName(src.name, takenNames);
  try {
    for (let i = 0; i < files.length; i += 1) {
      const { error: copyError } = await store.copy(files[i].path, filePaths[i].path);
      if (copyError) throw copyError;
      copied.push(filePaths[i].path);
    }
    const { data, error: insertError } = await client.from(TABLE)
      .insert({ id: newId, name, settings: src.settings, file_paths: filePaths, thumbnail: src.thumbnail || null })
      .select('id, name, thumbnail, created_at, updated_at, file_paths').single();
    if (insertError) throw insertError;
    return toFigure(data);
  } catch (err) {
    if (copied.length) { try { await store.remove(copied); } catch { /* leftovers are harmless */ } }
    throw friendly(err, 'copy that 3D figure');
  }
}

/**
 * Company properties the user may move a figure into (editor and up), as
 * [{ id, org_id, name, orgName }], sorted by company then property. Any
 * failure means none: the personal list works without workspaces.
 */
export async function editableProperties() {
  try {
    const orgs = (await listMyWorkspaces()).filter((o) => hasRole(o.role, 'editor'));
    const lists = await Promise.all(orgs.map((o) => listProperties(o.id).then((ps) => ps.map((p) => ({ id: p.id, org_id: p.org_id, name: p.name, orgName: o.name })))));
    return lists.flat().sort((a, b) => a.orgName.localeCompare(b.orgName) || a.name.localeCompare(b.name));
  } catch { return []; }
}

/** Moves a personal figure (and its files) into a company property. */
export const moveFigure = (id, property) => moveFigureToProperty(id, property);
