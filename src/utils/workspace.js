// Company workspaces: a thin client over the RPCs and tables in
// supabase/migrations/20261023100000_workspaces_properties.sql.
//
// Every permission is decided by the database (RLS and SECURITY DEFINER
// RPCs). The role helpers here only decide what the UI offers, so a stale
// role in the browser can at worst show a button the server then refuses.
import { supabase } from '../lib/supabase';

export const ROLES = ['viewer', 'editor', 'admin', 'owner'];
export const ROLE_LABELS = {
  owner: 'Owner',
  admin: 'Admin',
  editor: 'Editor',
  viewer: 'Viewer',
};
export const ROLE_HINTS = {
  owner: 'Everything, including managing other owners',
  admin: 'Invite people, change roles, delete properties',
  editor: 'Create and edit properties, maps and 3D figures',
  viewer: 'Read-only: investors, JV partners, auditors',
};
export const PROPERTY_STATUSES = [
  { value: 'active', label: 'Active' },
  { value: 'option', label: 'Under option' },
  { value: 'dormant', label: 'Dormant' },
  { value: 'sold', label: 'Sold' },
];
export const COMMON_COMMODITIES = ['Au', 'Ag', 'Cu', 'Mo', 'Zn', 'Pb', 'Ni', 'Co', 'Li', 'U', 'REE', 'W', 'PGE', 'Graphite'];

export const roleRank = (role) => Math.max(0, ROLES.indexOf(role) + 1);
export const hasRole = (role, min) => roleRank(min) > 0 && roleRank(role) >= roleRank(min);

/** What the UI may offer a member with `role`. Mirrors the SQL. */
export function permissions(role) {
  return {
    read: hasRole(role, 'viewer'),
    edit: hasRole(role, 'editor'),
    invite: hasRole(role, 'admin'),
    manageMembers: hasRole(role, 'admin'),
    deleteProperty: hasRole(role, 'admin'),
    moveOut: hasRole(role, 'admin'),
    manageOwners: role === 'owner',
  };
}

/** Roles `myRole` may hand out (as an invite, or by changing someone's role). */
export function assignableRoles(myRole) {
  if (myRole === 'owner') return ['owner', 'admin', 'editor', 'viewer'];
  if (myRole === 'admin') return ['admin', 'editor', 'viewer'];
  return [];
}

/** May `myRole` change or remove a member whose role is `theirRole`? */
export function canManageMember(myRole, theirRole) {
  if (!hasRole(myRole, 'admin')) return false;
  return theirRole !== 'owner' || myRole === 'owner';
}

export function slugify(text) {
  return String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
}

export function parseCommodities(text) {
  const seen = new Set();
  return String(text || '').split(/[,;/\s]+/).map((s) => s.trim()).filter(Boolean)
    .filter((s) => { const k = s.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; })
    .map((s) => s.slice(0, 30)).slice(0, 20);
}

export function inviteLink(token, origin = 'https://www.explorationmaps.com') {
  return `${origin}/invite?token=${encodeURIComponent(token)}`;
}

// ── 3D figure files ─────────────────────────────────────────────────────────
// Same rules as public.ws_figure_root / ws_rebase_figure_files: personal
// figures live under <uid>/<id>/, company figures under org/<org>/<id>/.
export function figureRoot({ orgId, ownerId, id }) {
  return orgId ? `org/${orgId}/${id}/` : `${ownerId}/${id}/`;
}
export function rebaseFigurePath(path, fromRoot, toRoot) {
  const p = String(path || '');
  if (!p.startsWith(fromRoot) || /(^|\/)\.\.?(\/|$)/.test(p)) throw new Error('A file of this figure is outside its folder.');
  return toRoot + p.slice(fromRoot.length);
}

// ── Friendly errors ─────────────────────────────────────────────────────────
const MESSAGES = [
  [/ORG_READ_ONLY/, 'You have view-only access here. Ask an admin of the workspace for editor access.'],
  [/LAST_OWNER/, 'A workspace needs at least one owner. Make someone else an owner first.'],
  [/INVITE_EMAIL_MISMATCH/, 'This invite was sent to a different email address. Sign in with the address the invite was sent to.'],
  [/INVITE_EXPIRED/, 'This invite has expired. Ask whoever invited you to send a new one.'],
  [/INVITE_USED/, 'This invite has already been accepted.'],
  [/INVITE_INVALID/, 'This invite link is not valid, or it was cancelled.'],
  [/INVITE_RATE_LIMIT/, 'Too many invites have been sent today. Try again tomorrow.'],
  [/ALREADY_MEMBER/, 'That person is already in this workspace.'],
  [/INVALID_EMAIL/, 'That email address does not look right.'],
  [/ORG_RATE_LIMIT/, 'You have created several workspaces today. Try again tomorrow.'],
  [/ORG_PROJECT_LIMIT/, 'This workspace has reached its map limit on the current plan.'],
  [/PROJECT_LIMIT/, 'Your personal plan is full. Upgrade to Pro, or keep the map in the workspace.'],
  [/PROPERTY_NOT_EMPTY/, 'Move this property’s maps, 3D figures and claim portfolios out before deleting it.'],
  [/PROPERTY_NOT_FOUND/, 'That property was not found. It may have been deleted.'],
  [/FILES_NOT_COPIED|FILE_PATH_UNEXPECTED/, 'The 3D figure’s files could not be moved. Try again.'],
  [/duplicate key.*properties_org_slug/, 'Another property already uses that address.'],
  [/forbidden|permission denied|row-level security/i, 'You do not have permission to do that in this workspace.'],
];
export function workspaceError(err) {
  const msg = String(err?.message || err || '');
  const hit = MESSAGES.find(([re]) => re.test(msg));
  const e = new Error(hit ? hit[1] : (msg || 'Something went wrong.'));
  e.code = (msg.match(/^[A-Z_]{4,}/) || [])[0] || err?.code;
  e.cause = err;
  return e;
}

function sb() {
  if (!supabase) throw new Error('Workspaces need an Exploration Maps account, which is not available on this site right now.');
  return supabase;
}
async function rpc(fn, args) {
  const { data, error } = await sb().rpc(fn, args);
  if (error) throw workspaceError(error);
  return data;
}
async function rows(query) {
  const { data, error } = await query;
  if (error) throw workspaceError(error);
  return Array.isArray(data) ? data : [];
}

// ── Active workspace (a per-browser convenience) ────────────────────────────
const ACTIVE_KEY = 'em.activeWorkspace.v1';
export function getActiveWorkspaceId() {
  try { return localStorage.getItem(ACTIVE_KEY) || null; } catch { return null; }
}
export function setActiveWorkspaceId(id) {
  try { if (id) localStorage.setItem(ACTIVE_KEY, id); else localStorage.removeItem(ACTIVE_KEY); } catch { /* optional */ }
  try { window.dispatchEvent(new CustomEvent('em:workspace', { detail: { id: id || null } })); } catch { /* optional */ }
}
/** The active workspace from a list, falling back to the first one. */
export function pickActive(workspaces, id = getActiveWorkspaceId()) {
  if (!workspaces?.length) return null;
  if (id === 'personal') return null;
  return workspaces.find((w) => w.id === id) || workspaces[0];
}

// An invite token kept across the sign-in round trip (the email link returns
// to /invite?token=..., this covers a link that lands somewhere else).
const INVITE_KEY = 'em.pendingInvite.v1';
export function rememberInviteToken(token) {
  try { if (token) localStorage.setItem(INVITE_KEY, JSON.stringify({ token, at: Date.now() })); } catch { /* optional */ }
}
export function pendingInviteToken() {
  try {
    const v = JSON.parse(localStorage.getItem(INVITE_KEY) || 'null');
    if (!v?.token || Date.now() - v.at > 14 * 864e5) return null;
    return v.token;
  } catch { return null; }
}
export function clearInviteToken() {
  try { localStorage.removeItem(INVITE_KEY); } catch { /* optional */ }
}

// ── Workspaces and members ──────────────────────────────────────────────────
let mineCache = null; // { userId, at, promise }
export function listMyWorkspaces({ fresh = false } = {}) {
  const run = async () => {
    const data = await rpc('get_my_workspaces');
    return Array.isArray(data) ? data : [];
  };
  if (!fresh && mineCache && Date.now() - mineCache.at < 30_000) return mineCache.promise;
  const promise = run().catch((e) => { mineCache = null; throw e; });
  mineCache = { at: Date.now(), promise };
  return promise;
}
export const forgetWorkspaces = () => { mineCache = null; };

export async function createWorkspace(name) {
  const r = await rpc('create_organization', { p_name: String(name || '').trim() });
  forgetWorkspaces();
  setActiveWorkspaceId(r.id);
  return r;
}
export const renameWorkspace = (orgId, name) => rpc('update_organization', { p_org: orgId, p_name: name });
export const listMembers = async (orgId) => (await rpc('list_org_members', { p_org: orgId })) || [];
export const setMemberRole = (orgId, userId, role) => rpc('set_member_role', { p_org: orgId, p_user: userId, p_role: role });
export async function removeMember(orgId, userId) {
  const r = await rpc('remove_member', { p_org: orgId, p_user: userId });
  forgetWorkspaces();
  return r;
}

// ── Invites ─────────────────────────────────────────────────────────────────
export const createInvite = (orgId, email, role) => rpc('create_org_invite', { p_org: orgId, p_email: email, p_role: role });
export const listInvites = async (orgId) => (await rpc('list_org_invites', { p_org: orgId })) || [];
export const revokeInvite = (inviteId) => rpc('revoke_org_invite', { p_id: inviteId });
export async function acceptInvite(token) {
  const r = await rpc('accept_org_invite', { p_token: token });
  forgetWorkspaces();
  setActiveWorkspaceId(r.org_id);
  return r;
}

// ── Properties ──────────────────────────────────────────────────────────────
const PROPERTY_COLS = 'id, org_id, name, slug, jurisdiction, commodities, status, description, centroid_lon, centroid_lat, crs, created_at, updated_at';
export const listProperties = (orgId) => rows(sb().from('properties').select(PROPERTY_COLS)
  .eq('org_id', orgId).is('deleted_at', null).order('name', { ascending: true }));

/** Property for /workspace/p/<slug>: prefers the active workspace. */
export async function getPropertyBySlug(slug, preferOrgId = getActiveWorkspaceId()) {
  const list = await rows(sb().from('properties').select(PROPERTY_COLS).eq('slug', slug).is('deleted_at', null));
  return list.find((p) => p.org_id === preferOrgId) || list[0] || null;
}

function propertyFields(f) {
  const out = {};
  if (f.name !== undefined) out.name = String(f.name).trim();
  if (f.jurisdiction !== undefined) out.jurisdiction = f.jurisdiction || null;
  if (f.commodities !== undefined) out.commodities = Array.isArray(f.commodities) ? f.commodities : parseCommodities(f.commodities);
  if (f.status !== undefined) out.status = f.status || 'active';
  if (f.description !== undefined) out.description = String(f.description || '').trim() || null;
  return out;
}
export async function createProperty(orgId, fields) {
  const list = await rows(sb().from('properties').insert({ org_id: orgId, ...propertyFields(fields) }).select(PROPERTY_COLS));
  forgetWorkspaces();
  return list[0] || null;
}
export async function updateProperty(id, fields) {
  const list = await rows(sb().from('properties').update(propertyFields(fields)).eq('id', id).select(PROPERTY_COLS));
  return list[0] || null;
}
export async function deleteProperty(id) {
  const { error } = await sb().from('properties').update({ deleted_at: new Date().toISOString() }).eq('id', id);
  if (error) throw workspaceError(error);
  forgetWorkspaces();
}

// ── What a property owns ────────────────────────────────────────────────────
export async function listPropertyMaps(propertyId) {
  const list = await rows(sb().from('projects').select('id, name, updated_at, thumbnail, revision, user_id')
    .eq('property_id', propertyId).is('deleted_at', null).order('updated_at', { ascending: false }));
  return list.map((r) => ({ id: r.id, name: r.name, updatedAt: r.updated_at, thumbnail: r.thumbnail || null, revision: r.revision ?? 1 }));
}
export async function listPropertyFigures(propertyId) {
  const list = await rows(sb().from('three_d_projects').select('id, name, thumbnail, updated_at')
    .eq('property_id', propertyId).is('deleted_at', null).order('updated_at', { ascending: false }));
  return list.map((r) => ({ id: r.id, name: r.name, updatedAt: r.updated_at, thumbnail: r.thumbnail || null }));
}
export async function listPersonalFigures(userId) {
  const list = await rows(sb().from('three_d_projects').select('id, name, updated_at')
    .eq('user_id', userId).is('org_id', null).is('deleted_at', null).order('updated_at', { ascending: false }));
  return list.map((r) => ({ id: r.id, name: r.name, updatedAt: r.updated_at }));
}
/** The user's own Tenure Monitor portfolios, with any property link. */
export const listMyPortfolios = (userId) => rows(sb().from('monitored_portfolios').select('id, name, property_id')
  .eq('user_id', userId).order('created_at', { ascending: true }));
export const getPropertyClaims = async (propertyId) => (await rpc('get_property_claims', { p_property: propertyId })) || [];

export const createPropertyMap = (propertyId, name, payload) =>
  rpc('create_org_project', { p_property: propertyId, p_name: name, p_payload: payload });

export const moveToProperty = (kind, id, propertyId) => rpc('move_to_property', { p_kind: kind, p_id: id, p_property: propertyId });
export const moveToPersonal = (kind, id) => rpc('move_to_personal', { p_kind: kind, p_id: id });

const BUCKET = 'three-d-files';
// Copy a figure's files into the destination folder, then switch the row
// (the RPC checks every copy exists), then tidy the old copies.
async function moveFigure(figureId, toRoot, finish) {
  const { data: fig, error } = await sb().from('three_d_projects').select('id, user_id, org_id, file_paths').eq('id', figureId).maybeSingle();
  if (error) throw workspaceError(error);
  if (!fig) throw new Error('That 3D figure was not found.');
  const fromRoot = figureRoot({ orgId: fig.org_id, ownerId: fig.user_id, id: fig.id });
  const paths = Array.isArray(fig.file_paths) ? fig.file_paths.map((f) => f.path).filter(Boolean) : [];
  const moved = fromRoot === toRoot ? [] : paths.map((p) => [p, rebaseFigurePath(p, fromRoot, toRoot)]);
  const store = sb().storage.from(BUCKET);
  for (const [from, to] of moved) {
    const { error: copyError } = await store.copy(from, to);
    if (copyError && !/exists|duplicate/i.test(copyError.message || '')) throw workspaceError(copyError);
  }
  const result = await finish();
  if (moved.length) {
    try { await store.remove(moved.map(([from]) => from)); } catch { /* leftovers are harmless */ }
  }
  return result;
}
export async function moveFigureToProperty(figureId, property) {
  return moveFigure(figureId, figureRoot({ orgId: property.org_id, id: figureId }),
    () => moveToProperty('figure', figureId, property.id));
}
export async function moveFigureToPersonal(figureId, userId) {
  return moveFigure(figureId, figureRoot({ ownerId: userId, id: figureId }),
    () => moveToPersonal('figure', figureId));
}

// ── Activity ────────────────────────────────────────────────────────────────
export async function getActivity(orgId, { propertyId = null, limit = 50, before = null } = {}) {
  const data = await rpc('get_org_activity', { p_org: orgId, p_property: propertyId, p_limit: limit, p_before: before });
  return Array.isArray(data) ? data : [];
}

// ── Where an open map lives ─────────────────────────────────────────────────
/**
 * The workspace and property a saved map belongs to, with the caller's role,
 * or null for a personal map (or when the user is in no workspace at all, in
 * which case no request is made for the map).
 */
export async function getProjectHome(projectId) {
  if (!projectId || !supabase) return null;
  const mine = await listMyWorkspaces().catch(() => []);
  if (!mine.length) return null;
  const { data, error } = await supabase.from('projects').select('org_id, property_id').eq('id', projectId).maybeSingle();
  if (error || !data?.org_id) return null;
  const org = mine.find((w) => w.id === data.org_id);
  if (!org) return null;
  let property = null;
  if (data.property_id) {
    const { data: p } = await supabase.from('properties').select('id, name, slug').eq('id', data.property_id).maybeSingle();
    property = p || null;
  }
  return {
    orgId: org.id,
    orgName: org.name,
    role: org.role,
    readOnly: !hasRole(org.role, 'editor'),
    propertyId: property?.id || data.property_id || null,
    propertyName: property?.name || null,
    propertySlug: property?.slug || null,
  };
}

export function formatWhen(iso) {
  if (!iso) return '';
  try {
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
  } catch { return ''; }
}
