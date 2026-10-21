// Exploration Maps 3D: save figures to an Exploration Maps account. This is
// the lazy half of account.js, loaded on the first click on Save or My 3D
// maps, or at start when there is a session, a sign-in link coming back, or
// a figure waiting to be saved.
//
// The page is same-origin with the main app, so a visitor signed in there
// already has a Supabase session in localStorage and a client created here
// with the same URL and key sees it. supabase-js is loaded only when it is
// needed (a stored session, a sign-in link coming back, or a click), so the
// first load of /3d does not grow.
//
// Storage: one row per figure in public.three_d_projects (settings, camera,
// file list, thumbnail) and the raw CSV/OBJ text in the private bucket
// three-d-files under <uid>/<project id>/<file>. See
// supabase/migrations/20261022100000_three_d_projects.sql.
//
// Company workspaces (20261023100000_workspaces_properties.sql): a figure
// can belong to a property of the user's company instead. Its row then
// carries org_id and property_id, its files live under org/<org>/<id>/, and
// the database lets every member read it and editors and up save it.
import { authRedirectUrl } from '../utils/authRedirect.js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
const configured = !!(SUPABASE_URL && SUPABASE_KEY);
const TABLE = 'three_d_projects';
const BUCKET = 'three-d-files';
export const STASH_KEY = 'em3d.pendingSave.v1';
export const STASH_FLAG = `${STASH_KEY}.flag`;
const STASH_MAX_AGE = 7 * 24 * 3600 * 1000;
const RETURN_PATH = '/3d';

const $ = (id) => document.getElementById(id);
const studio = () => {
  if (!window.EM3D?.getProject) throw new Error('The 3D editor has not started.');
  return window.EM3D;
};

// ── Errors in plain words ───────────────────────────────────────────────────
const KEEP = 'Your figure is still here in this browser.';
function plain(message, cause, code) {
  const e = new Error(message);
  if (cause) e.cause = cause;
  if (code) e.code = code;
  return e;
}
function explain(err, doing) {
  if (err?.code === 'SIGNED_OUT' || err?.code === 'NOT_CONFIGURED' || err?.plain) return err;
  const msg = String(err?.message || err || '');
  const status = Number(err?.status || err?.statusCode || 0);
  let text;
  if (err instanceof TypeError || /failed to fetch|network|load failed/i.test(msg)) text = `Could not reach Exploration Maps. Check your connection and try again. ${KEEP}`;
  else if (status === 401 || /jwt|token|not authenticated|row-level security|permission/i.test(msg)) {
    const e = plain(`Your sign-in has expired. Sign in again to ${doing}. ${KEEP}`, err, 'SIGNED_OUT'); e.plain = true; return e;
  } else if (status === 413 || /maximum allowed size|too large|payload/i.test(msg)) text = `A file is too large to save (the limit is 50 MB a file). ${KEEP}`;
  else if (status === 429 || /rate limit|too many/i.test(msg)) text = 'Too many attempts. Wait a minute and try again.';
  else if (/invalid login credentials/i.test(msg)) text = 'That email and password do not match. Try again, or use a sign-in link.';
  else if (/email/i.test(msg) && /invalid/i.test(msg)) text = 'That email address does not look right.';
  else text = `Could not ${doing}${msg ? ` (${msg.replace(/\.$/, '')})` : ''}. ${KEEP}`;
  const e = plain(text, err); e.plain = true; return e;
}

// ── Lazy client ─────────────────────────────────────────────────────────────
let clientPromise = null;
let homes = null; // company workspaces for one signed-in user: { uid, promise } (see listHomes)
function client() {
  if (!configured) {
    const e = plain(`Saving to an account is not available on this site right now. ${KEEP}`, null, 'NOT_CONFIGURED');
    e.plain = true; return Promise.reject(e);
  }
  if (!clientPromise) {
    clientPromise = import('@supabase/supabase-js')
      .then(({ createClient }) => {
        const sb = createClient(SUPABASE_URL, SUPABASE_KEY);
        // Another account (or none) must never see the last one's companies.
        try { sb.auth.onAuthStateChange((event) => { if (event !== 'TOKEN_REFRESHED') homes = null; }); } catch { /* the user-id key still guards */ }
        return sb;
      })
      .catch((err) => { clientPromise = null; throw explain(err, 'connect to your account'); });
  }
  return clientPromise;
}

// Synchronous: is there any reason to load supabase-js now?
function storedSession() {
  try {
    for (let i = 0; i < localStorage.length; i++) if (/^sb-.+-auth-token$/.test(localStorage.key(i) || '')) return true;
  } catch { /* storage blocked */ }
  return false;
}
const linkReturn = () => /access_token=|error_description=/.test(location.hash) || /[?&]code=/.test(location.search);

export async function getUser() {
  if (!configured || (!storedSession() && !linkReturn() && !clientPromise)) return null;
  const sb = await client();
  const { data, error } = await sb.auth.getSession();
  if (error) throw explain(error, 'check your sign-in');
  const u = data?.session?.user;
  return u ? { id: u.id, email: u.email || '' } : null;
}
async function requireUser(doing) {
  const user = await getUser();
  if (!user) throw Object.assign(plain(`Sign in to ${doing}.`, null, 'SIGNED_OUT'), { plain: true });
  return user;
}

export async function sendSignInLink(email) {
  const sb = await client();
  const acquisition = window.emAcquisition?.get?.();
  const { error } = await sb.auth.signInWithOtp({
    email: String(email || '').trim(),
    options: { emailRedirectTo: authRedirectUrl(`${location.origin}${RETURN_PATH}`), ...(acquisition ? { data: { em_acquisition: acquisition } } : {}) },
  });
  if (error) throw explain(error, 'send the sign-in link');
}
export async function signInWithPassword(email, password) {
  const sb = await client();
  const { error } = await sb.auth.signInWithPassword({ email: String(email || '').trim(), password: String(password || '') });
  if (error) throw explain(error, 'sign in');
  return getUser();
}
export async function signOut() {
  if (!clientPromise && !storedSession()) return;
  const sb = await client();
  await sb.auth.signOut();
  current = null;
  homes = null;
}

// ── Projects ────────────────────────────────────────────────────────────────
let current = null; // { id, name, savedAt } of the figure open in the editor

const safeName = (name) => (String(name).replace(/[^\w.-]+/g, '_').replace(/^\.+/, '').slice(-120) || 'file');

// ── Company workspaces ──────────────────────────────────────────────────────
// The user's workspaces and their live properties, with the user's role.
// Any failure means "no workspaces": the personal account works as before.
// Cached per signed-in user; dropped on sign-in, sign-out and account change.
export async function listHomes({ fresh = false } = {}) {
  const u = await getUser().catch(() => null);
  if (!u) return { orgs: [], properties: [] };
  if (homes && homes.uid === u.id && !fresh) return homes.promise;
  const promise = (async () => {
    const sb = await client();
    const { data: orgs, error } = await sb.rpc('get_my_workspaces');
    if (error || !Array.isArray(orgs) || !orgs.length) return { orgs: [], properties: [] };
    const { data: props } = await sb.from('properties').select('id, name, slug, org_id')
      .in('org_id', orgs.map((o) => o.id)).is('deleted_at', null).order('name', { ascending: true });
    const byId = new Map(orgs.map((o) => [o.id, o]));
    const properties = (Array.isArray(props) ? props : []).filter((p) => byId.has(p.org_id))
      .map((p) => ({ id: p.id, name: p.name, slug: p.slug, orgId: p.org_id, orgName: byId.get(p.org_id).name, role: byId.get(p.org_id).role }));
    return { orgs, properties };
  })().catch(() => ({ orgs: [], properties: [] }));
  homes = { uid: u.id, promise };
  return promise;
}
const canEdit = (role) => ['editor', 'admin', 'owner'].includes(role);
async function homeOf(row) {
  if (!row?.org_id) return null;
  const { orgs, properties } = await listHomes();
  const org = orgs.find((o) => o.id === row.org_id);
  const prop = properties.find((p) => p.id === row.property_id);
  return { orgId: row.org_id, propertyId: row.property_id || null, propertyName: prop?.name || null, orgName: org?.name || 'Company workspace', role: org?.role || 'viewer' };
}

export async function listProjects() {
  await requireUser('see your saved 3D maps');
  const sb = await client();
  // Row-level security returns the user's own figures and their companies'.
  const { data, error } = await sb.from(TABLE)
    .select('id, name, thumbnail, created_at, updated_at, org_id, property_id')
    .is('deleted_at', null)
    .order('updated_at', { ascending: false })
    .limit(200);
  if (error) throw explain(error, 'load your saved 3D maps');
  const list = [];
  for (const r of data || []) {
    list.push({ id: r.id, name: r.name, thumbnail: r.thumbnail || null, createdAt: r.created_at, updatedAt: r.updated_at, home: await homeOf(r) });
  }
  return list;
}

// A save would overwrite a newer version: the saved row's updated_at is later than the version this tab
// opened or last saved (another tab, another computer, or an older copy reopened).
export const isConflict = (loadedAt, savedAt) => !!(loadedAt && savedAt && Date.parse(savedAt) > Date.parse(loadedAt));
/**
 * @param {string} name
 * @param {string|null} existingId  the figure to overwrite, or null for a new one
 * @param {{orgId:string, propertyId:string, propertyName?:string, orgName?:string, role?:string}|null} [dest]
 *   a company property for a new figure (an existing one stays where it is)
 * @param {{force?:boolean}} [opts]  force: overwrite even when the saved copy is newer than this one
 */
export async function saveProject(name, existingId, dest = null, { force = false } = {}) {
  const title = String(name || '').trim().slice(0, 200);
  if (!title) throw Object.assign(plain('Give the 3D map a name first.'), { plain: true });
  const user = await requireUser('save this 3D map');
  const sb = await client();
  const home = existingId ? (current?.id === existingId ? current.home : null) : dest;
  if (home && !canEdit(home.role)) {
    throw Object.assign(plain(`You have view-only access to ${home.propertyName || home.orgName}, so this figure cannot be saved there. Use Save as new to keep a personal copy.`), { plain: true, code: 'READ_ONLY' });
  }
  const guarded = !!(existingId && !force && current?.id === existingId && current.savedAt);
  const conflict = (savedAt) => Object.assign(plain(`“${current.name}” was saved somewhere else${savedAt ? ` at ${when(savedAt)}` : ''}, after this copy was opened. Overwrite it, save this as a new 3D map, or reload the saved version.`), { plain: true, code: 'CONFLICT', savedAt });
  if (guarded) {
    // Early check before uploading; the write below is conditional as well.
    const { data, error } = await sb.from(TABLE).select('updated_at').eq('id', existingId).is('deleted_at', null).maybeSingle();
    if (error) throw explain(error, 'save this 3D map');
    if (isConflict(current.savedAt, data?.updated_at)) throw conflict(data.updated_at);
  }
  const em = studio();
  const { files, ...settings } = em.getProject();
  let thumbnail = null;
  try { thumbnail = em.getThumbnail(320); } catch { /* a list without a picture is fine */ }
  const id = existingId || crypto.randomUUID();
  const rev = `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const root = home ? `org/${home.orgId}/${id}` : `${user.id}/${id}`, dir = `${root}/${rev}`;
  const used = new Set();
  const filePaths = files.map((f, i) => {
    let base = safeName(f.name);
    if (used.has(base)) base = `${i}-${base}`;
    used.add(base);
    return { name: f.name, path: `${dir}/${base}`, size: f.text.length, role: f.role, cols: f.cols };
  });
  try {
    // Files first, each save in a folder of its own: a row is never written
    // pointing at text that is not there, and a failed save never touches
    // the files the last saved row points at.
    await Promise.all(files.map(async (f, i) => {
      const { error } = await sb.storage.from(BUCKET).upload(filePaths[i].path, f.text, { upsert: false, contentType: 'text/plain;charset=utf-8' });
      if (error) throw error;
    }));
    const row = { id, name: title, settings, file_paths: filePaths, thumbnail, updated_at: new Date().toISOString(), deleted_at: null };
    if (home) Object.assign(row, { org_id: home.orgId, property_id: home.propertyId });
    // Overwriting the version this tab opened: only if it is still that version, so two
    // tabs saving at once cannot silently overwrite each other.
    const { data, error } = guarded
      ? await sb.from(TABLE).update(row).eq('id', id).eq('updated_at', current.savedAt).select('id, name, updated_at').maybeSingle()
      : await sb.from(TABLE).upsert(row, { onConflict: 'id' }).select('id, name, updated_at').single();
    if (error) throw error;
    if (!data) throw conflict(null);
    current = { id: data.id, name: data.name, savedAt: data.updated_at, home };
  } catch (err) {
    // Best effort: this save's files are not referenced by any row.
    try { await sb.storage.from(BUCKET).remove(filePaths.map((p) => p.path)); } catch { /* leftovers are harmless */ }
    throw explain(err, 'save this 3D map');
  }
  if (existingId) {
    // Best effort, now the row points at this save's folder: drop earlier
    // saves' files (older rows kept them directly under the project).
    try {
      const { data: objs } = await sb.storage.from(BUCKET).list(root, { limit: 1000 });
      const stale = [];
      for (const o of objs || []) {
        if (o.name === rev) continue;
        if (o.id) { stale.push(`${root}/${o.name}`); continue; }
        const { data: inner } = await sb.storage.from(BUCKET).list(`${root}/${o.name}`, { limit: 1000 });
        for (const x of inner || []) stale.push(`${root}/${o.name}/${x.name}`);
      }
      if (stale.length) await sb.storage.from(BUCKET).remove(stale);
    } catch { /* leftovers are harmless */ }
  }
  return { ...current };
}

export async function openProject(id) {
  await requireUser('open your saved 3D maps');
  const sb = await client();
  let project, row;
  try {
    const res = await sb.from(TABLE).select('id, name, settings, file_paths, updated_at, org_id, property_id').eq('id', id).is('deleted_at', null).maybeSingle();
    if (res.error) throw res.error;
    row = res.data;
    if (!row) throw Object.assign(plain('That 3D map was not found. It may have been deleted.'), { plain: true });
    // Files normally live in storage; a row may also carry them inline.
    const files = Array.isArray(row.settings?.files) ? row.settings.files : await Promise.all((row.file_paths || []).map(async (fp) => {
      const { data, error } = await sb.storage.from(BUCKET).download(fp.path);
      if (error) throw error;
      return { name: fp.name, text: await data.text(), role: fp.role, cols: fp.cols };
    }));
    project = { ...row.settings, files };
  } catch (err) {
    throw explain(err, 'open that 3D map');
  }
  const em = studio();
  const backup = em.getProject();
  try {
    await em.loadProject(project);
  } catch (err) {
    try { await em.loadProject(backup); } catch { /* the editor keeps whatever it has */ }
    throw Object.assign(plain(`That 3D map could not be opened (${err.message}). The figure you had is back.`, err), { plain: true });
  }
  current = { id: row.id, name: row.name, savedAt: row.updated_at, home: await homeOf(row) };
  return { ...current, state: em.getState() };
}

export async function deleteProject(id) {
  await requireUser('delete a saved 3D map');
  const sb = await client();
  const { data, error } = await sb.from(TABLE).update({ deleted_at: new Date().toISOString() }).eq('id', id).is('deleted_at', null).select('id');
  if (error) throw explain(error, 'delete that 3D map');
  if (!data?.length) throw Object.assign(plain('That 3D map was not found. It may already be deleted.'), { plain: true });
  if (current?.id === id) current = null;
  return true;
}

export const currentProject = () => (current ? { ...current } : null);

// ── Work kept across the sign-in round trip ─────────────────────────────────
// IndexedDB holds any size; localStorage is the fallback for small figures.
function idb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('em3d', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('kv');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function idbDo(mode, fn) {
  const db = await idb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('kv', mode), req = fn(tx.objectStore('kv'));
      tx.oncomplete = () => resolve(req?.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally { db.close(); }
}
export async function stashWork(extra = {}) {
  let entry;
  try { entry = { at: Date.now(), ...extra, project: studio().getProject() }; } catch { return false; }
  try { localStorage.setItem(STASH_FLAG, '1'); } catch { /* the link return still finds it */ }
  try { await idbDo('readwrite', (s) => s.put(entry, STASH_KEY)); return true; } catch { /* fall through */ }
  try {
    const json = JSON.stringify(entry);
    if (json.length > 2_000_000) return false;
    localStorage.setItem(STASH_KEY, json);
    return true;
  } catch { return false; }
}
export async function readStash() {
  let entry = null;
  try { entry = await idbDo('readonly', (s) => s.get(STASH_KEY)); } catch { /* none */ }
  if (!entry) try { entry = JSON.parse(localStorage.getItem(STASH_KEY) || 'null'); } catch { entry = null; }
  if (!entry || !entry.project || Date.now() - (entry.at || 0) > STASH_MAX_AGE) { await clearStash(); return null; }
  return entry || null;
}
export async function clearStash() {
  try { await idbDo('readwrite', (s) => s.delete(STASH_KEY)); } catch { /* none */ }
  try { localStorage.removeItem(STASH_KEY); localStorage.removeItem(STASH_FLAG); } catch { /* none */ }
}

// ── UI ──────────────────────────────────────────────────────────────────────
const fmtWhen = (iso, opts) => { try { return new Intl.DateTimeFormat(undefined, opts).format(new Date(iso)); } catch { return ''; } };
const when = (iso) => fmtWhen(iso, { dateStyle: 'medium', timeStyle: 'short' });
const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

let user = null;
let busy = false;
let dirty = false;
// What the figure looked like when last saved or opened (or when the page
// loaded), as a signature of its state and its files' raw text; any
// difference is unsaved work. A state captured earlier carries its own
// $files; otherwise the files on screen now are the ones it describes.
const sig = (st) => {
  const { step, $files, ...rest } = st || {};
  let files = $files;
  if (files === undefined) try { files = studio().filesDigest(); } catch { files = null; }
  return JSON.stringify({ ...rest, $files: files });
};
let savedSig = null;
let statusT = 0;
let pending = null; // { intent, name, id } while a sign-in link is out for a save
let pendingT = 0;

function say(msg) {
  const el = $('status'); if (!el) return;
  el.textContent = msg; el.style.opacity = '1';
  clearTimeout(statusT); statusT = setTimeout(() => { el.style.opacity = '0'; }, 7000);
}
function settle() { dirty = false; try { savedSig = sig(studio().getState()); } catch { savedSig = null; } renderNote(); }
function renderNote() {
  const note = $('acct-note'); if (!note) return;
  if (busy) { note.textContent = 'Saving…'; note.hidden = false; return; }
  if (!current) { note.hidden = true; return; }
  note.hidden = false;
  const where = current.home ? ` · ${current.home.propertyName || current.home.orgName}${canEdit(current.home.role) ? '' : ' (view only)'}` : '';
  note.textContent = (dirty ? 'Unsaved changes' : `Saved ${fmtWhen(current.savedAt, { timeStyle: 'short' })}`) + where;
  note.title = dirty ? `Last saved ${when(current.savedAt)}${where}` : `${current.name} · saved ${when(current.savedAt)}${where}`;
}
function setUrlProject(id) {
  try {
    const url = new URL(location.href);
    if (id) url.searchParams.set('project', id); else url.searchParams.delete('project');
    history.replaceState(history.state, '', url.pathname + url.search);
  } catch { /* cosmetic */ }
}

// Dialog: sign in (optionally saving afterwards), or name a first save.
let dialogMode = null; // 'save-signin' | 'signin' | 'name'
function openDialog(mode, { error = '', asNew = false, toProperty = false } = {}) {
  const d = $('acct-dialog'); if (!d) return;
  dialogMode = mode;
  // A save conflict: overwrite, save as new or reload, in place of the form.
  $('acct-conflict').hidden = mode !== 'conflict'; d.setAttribute('aria-labelledby', mode === 'conflict' ? 'acct-conflict-title' : 'acct-title');
  if (mode === 'conflict') { $('acct-form').hidden = true; $('acct-sent').hidden = true; $('acct-conflict-text').textContent = error; if (!d.open) d.showModal(); $('acct-reload').focus(); return; }
  const saving = mode !== 'signin';
  $('acct-title').textContent = saving ? 'Save to your account' : 'Sign in to Exploration Maps';
  $('acct-intro').textContent = mode === 'name'
    ? 'Name this 3D map. You can open it again from My 3D maps.'
    : saving
      ? 'Sign in to keep this figure in your Exploration Maps account and open it again later. It stays in this browser while you sign in.'
      : 'Sign in to see and open the 3D maps saved to your account.';
  $('acct-name-row').hidden = !saving;
  const destRow = $('acct-dest-row');
  if (destRow) { destRow.hidden = true; if (mode === 'name') fillDest(toProperty); }
  if (saving) { let t = ''; try { t = studio().getState().brand.title; } catch { /* default below */ } $('acct-name').value = (asNew && current ? `${current.name} (copy)` : current?.name) || t || 'Untitled 3D map'; }
  $('acct-signin').hidden = mode === 'name';
  $('acct-name-actions').hidden = mode !== 'name';
  $('acct-sent').hidden = true;
  $('acct-form').hidden = false;
  $('acct-password-row').hidden = true;
  $('acct-use-password').hidden = false;
  $('acct-link-btn').hidden = false;
  $('acct-password-btn').hidden = true;
  $('acct-new').hidden = false;
  showError(error);
  if (!d.open) d.showModal();
  (mode === 'name' ? $('acct-name') : $('acct-email')).focus();
}
// "Save to": personal, or a property of a company the user edits for.
async function fillDest(toProperty = false) {
  const row = $('acct-dest-row'), sel = $('acct-dest');
  if (!row || !sel) return;
  const { properties } = await listHomes();
  const editable = properties.filter((p) => canEdit(p.role));
  if (!editable.length || dialogMode !== 'name') return;
  const groups = new Map();
  for (const p of editable) { if (!groups.has(p.orgName)) groups.set(p.orgName, []); groups.get(p.orgName).push(p); }
  sel.innerHTML = '<option value="">My personal 3D maps</option>' + [...groups].map(([org, list]) =>
    `<optgroup label="${esc(org)}">${list.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}</optgroup>`).join('');
  const preferred = current?.home && canEdit(current.home.role) ? current.home.propertyId : toProperty ? editable[0].id : '';
  sel.value = editable.some((p) => p.id === preferred) ? preferred : '';
  row.hidden = false;
}
async function chosenDest() {
  const id = $('acct-dest-row')?.hidden ? '' : ($('acct-dest')?.value || '');
  if (!id) return null;
  const p = (await listHomes()).properties.find((x) => x.id === id);
  return p ? { orgId: p.orgId, propertyId: p.id, propertyName: p.name, orgName: p.orgName, role: p.role } : null;
}

function showError(msg) { const e = $('acct-error'); e.textContent = msg || ''; e.hidden = !msg; }
function closeDialog() { const d = $('acct-dialog'); if (d?.open) d.close(); dialogMode = null; }

export async function save({ asNew = false, force = false } = {}) {
  if (busy || $('acct-dialog')?.open) return;
  if (!configured) { say(`Saving to an account is not available on this site right now. ${KEEP}`); return; }
  try { user = await getUser(); } catch (err) { say(err.message); return; }
  if (!user) { openDialog('save-signin'); return; }
  // A first save, or Save as new, asks for a name; the name step always creates a new row.
  if (!current || asNew) { openDialog('name', { asNew }); return; }
  if (current.home && !canEdit(current.home.role)) {
    say(`You have view-only access to ${current.home.propertyName || current.home.orgName}, so changes here are not saved. Use Save as new in My 3D maps to keep a personal copy.`);
    return;
  }
  await doSave(current.name, current.id, null, { force });
}
async function doSave(name, id, dest = null, opts) {
  busy = true; renderNote(); renderButtons();
  try {
    const res = await saveProject(name, id, dest, opts);
    if (pending) { pending = null; clearTimeout(pendingT); await clearStash(); }
    setUrlProject(res.id);
    settle();
    say(`Saved “${res.name}” to ${res.home ? (res.home.propertyName || res.home.orgName) : 'your account'} at ${fmtWhen(res.savedAt, { timeStyle: 'short' })}.`);
    if (!$('acct-menu').hidden) renderMenu();
    return true;
  } catch (err) {
    if (err.code === 'SIGNED_OUT') { user = null; renderButtons(); openDialog('save-signin', { error: err.message }); }
    else if (err.code === 'CONFLICT') openDialog('conflict', { error: err.message });
    else say(err.message);
    return false;
  } finally {
    busy = false; renderNote(); renderButtons();
  }
}

function renderButtons() {
  const s = $('acct-save'); if (!s) return;
  s.disabled = busy;
  s.title = user ? `Save to your account (${navigator.platform?.startsWith('Mac') ? '⌘' : 'Ctrl'}+S)` : 'Sign in and save this figure to your account';
}

// "My 3D maps" menu
let menuItems = [];
async function renderMenu() {
  const body = $('acct-menu-body'), foot = $('acct-menu-foot');
  foot.innerHTML = '';
  if (!user) {
    body.innerHTML = '<p class="muted">Sign in to keep your 3D maps in your Exploration Maps account and open them on any computer.</p>';
    foot.innerHTML = '<button class="btn primary" type="button" data-acct="signin">Sign in</button>';
    return;
  }
  body.innerHTML = '<p class="muted">Loading your 3D maps…</p>';
  try {
    menuItems = await listProjects();
  } catch (err) {
    body.innerHTML = `<p class="bad">${esc(err.message)}</p>`;
    foot.innerHTML = '<button class="btn" type="button" data-acct="retry">Try again</button>';
    if (err.code === 'SIGNED_OUT') { user = null; renderButtons(); foot.innerHTML = '<button class="btn primary" type="button" data-acct="signin">Sign in</button>'; }
    return;
  }
  // Personal figures first, then each company property's, under its name.
  const item = (p) => `<li class="acct-item${current?.id === p.id ? ' current' : ''}">
        ${/^data:image\/(jpeg|png|webp);base64,/.test(p.thumbnail || '') ? `<img src="${esc(p.thumbnail)}" alt="" width="96" height="54">` : '<span class="acct-noimg" aria-hidden="true"></span>'}
        <span class="acct-meta"><b title="${esc(p.name)}">${esc(p.name)}</b><small>${current?.id === p.id ? 'Open now · ' : ''}${esc(when(p.updatedAt))}${p.home && !canEdit(p.home.role) ? ' · view only' : ''}</small></span>
        <span class="acct-acts"><button class="btn" type="button" data-open="${esc(p.id)}" aria-label="Open ${esc(p.name)}">Open</button>
        ${p.home && !['admin', 'owner'].includes(p.home.role) ? '' : `<button class="btn acct-del" type="button" data-del="${esc(p.id)}" aria-label="Delete ${esc(p.name)}">Delete</button>`}</span></li>`;
  const groups = new Map();
  for (const p of menuItems) {
    const key = p.home ? `${p.home.orgName} · ${p.home.propertyName || 'Workspace'}` : '';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(p);
  }
  const keys = [...groups.keys()].sort((a, b) => (a === '' ? -1 : b === '' ? 1 : a.localeCompare(b)));
  const titled = keys.length > 1 || (keys.length === 1 && keys[0] !== '');
  body.innerHTML = menuItems.length
    ? keys.map((k) => `${titled ? `<h4 class="acct-group">${esc(k || 'Personal')}</h4>` : ''}<ul class="acct-list"${titled ? ` aria-label="${esc(k || 'Personal')}"` : ''}>${groups.get(k).map(item).join('')}</ul>`).join('')
    : '<p class="muted">No saved 3D maps yet. Use Save to keep this figure.</p>';
  const toProperty = (await listHomes()).properties.some((p) => canEdit(p.role));
  foot.innerHTML = `<span class="muted acct-who" title="${esc(user.email)}">${esc(user.email)}</span>`
    + (current ? '<button class="btn" type="button" data-acct="save-new">Save as new</button>' : '')
    + (toProperty ? '<button class="btn" type="button" data-acct="save-prop">Save to property…</button>' : '')
    + '<button class="btn" type="button" data-acct="signout">Sign out</button>';
}
export function toggleMenu(show) {
  const m = $('acct-menu'), b = $('acct-maps');
  const open = show ?? m.hidden;
  m.hidden = !open; b.setAttribute('aria-expanded', String(open));
  if (open) renderMenu();
}

async function onMenuClick(e) {
  const t = e.target.closest('button'); if (!t) return;
  if (t.dataset.open) {
    if (dirty && t.dataset.confirm !== '1') { t.dataset.confirm = '1'; t.textContent = 'Replace current figure?'; return; }
    t.disabled = true; t.textContent = 'Opening…';
    try {
      const res = await openProject(t.dataset.open);
      if (pending) { pending = null; clearTimeout(pendingT); await clearStash(); }
      setUrlProject(res.id); settle(); toggleMenu(false);
      say(`Opened “${res.name}”.`);
    } catch (err) { say(err.message); t.disabled = false; t.textContent = 'Open'; delete t.dataset.confirm; }
    return;
  }
  if (t.dataset.del) {
    if (t.dataset.confirm !== '1') { t.dataset.confirm = '1'; t.textContent = 'Confirm delete'; t.classList.add('danger'); return; }
    t.disabled = true;
    try {
      const wasCurrent = current?.id === t.dataset.del;
      await deleteProject(t.dataset.del);
      if (wasCurrent) { setUrlProject(null); renderNote(); }
      say('Deleted. The figure on screen is unchanged.');
      renderMenu();
    } catch (err) { say(err.message); t.disabled = false; }
    return;
  }
  const act = t.dataset.acct;
  if (act === 'signin') { toggleMenu(false); openDialog('signin'); }
  else if (act === 'retry') renderMenu();
  else if (act === 'save-new') { toggleMenu(false); save({ asNew: true }); }
  else if (act === 'save-prop') { toggleMenu(false); openDialog('name', { asNew: Boolean(current), toProperty: true }); }
  else if (act === 'signout') {
    try { await signOut(); } catch { /* local sign-out still clears */ }
    user = null; current = null; setUrlProject(null); renderNote(); renderButtons(); renderMenu();
    say('Signed out. The figure on screen is unchanged.');
  }
}

async function afterSignIn() {
  user = await getUser();
  renderButtons();
  if (!user) return;
  const mode = dialogMode;
  if (mode === 'save-signin') {
    const name = $('acct-name').value.trim() || 'Untitled 3D map';
    closeDialog();
    await doSave(name, current?.id);
  } else {
    closeDialog();
    say(`Signed in as ${user.email}.`);
    toggleMenu(true);
  }
}

function wire() {
  $('acct-menu').addEventListener('click', (e) => { e.stopPropagation(); onMenuClick(e); });
  document.addEventListener('click', (e) => { if (!$('acct-menu').hidden && !e.target.closest('#acct-menu, #acct-maps')) toggleMenu(false); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !$('acct-menu').hidden) { toggleMenu(false); $('acct-maps').focus(); }
  });
  window.addEventListener('em3d:change', (e) => {
    const now = sig(e.detail) !== savedSig;
    if (now !== dirty) { dirty = now; renderNote(); }
    // While a sign-in link is out, keep the stashed copy up to date.
    if (pending) { clearTimeout(pendingT); pendingT = setTimeout(() => stashWork(pending), 1500); }
  });

  $('acct-use-password').addEventListener('click', () => {
    $('acct-password-row').hidden = false; $('acct-use-password').hidden = true; $('acct-link-btn').hidden = true; $('acct-password-btn').hidden = false; $('acct-new').hidden = true; $('acct-password').focus();
  });
  $('acct-cancel').addEventListener('click', closeDialog);
  $('acct-overwrite').addEventListener('click', () => { closeDialog(); save({ force: true }); });
  $('acct-asnew').addEventListener('click', () => { closeDialog(); save({ asNew: true }); });
  $('acct-reload').addEventListener('click', async () => {
    closeDialog(); if (!current) return;
    try { const res = await openProject(current.id); settle(); say(`Reloaded “${res.name}” as saved at ${fmtWhen(res.savedAt, { timeStyle: 'short' })}.`); } catch (err) { say(err.message); }
  });
  $('acct-name-cancel').addEventListener('click', closeDialog);
  $('acct-sent-close').addEventListener('click', closeDialog);
  $('acct-dialog').addEventListener('close', () => { if (!$('acct-dialog').open) dialogMode = null; }); // the close event comes late: the dialog may be open again in another mode
  $('acct-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    showError('');
    const submit = e.submitter || $('acct-link-btn');
    if (dialogMode === 'name') {
      const name = $('acct-name').value.trim();
      if (!name) { showError('Give the 3D map a name.'); return; }
      const dest = await chosenDest();
      closeDialog();
      await doSave(name, null, dest);
      return;
    }
    const email = $('acct-email').value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { showError('Enter the email address for your Exploration Maps account.'); $('acct-email').focus(); return; }
    const usePassword = !$('acct-password-row').hidden;
    submit.disabled = true;
    try {
      if (usePassword) {
        await signInWithPassword(email, $('acct-password').value);
        $('acct-password').value = '';
        await afterSignIn();
      } else {
        // The link opens a fresh /3d: keep this figure so it can be restored and saved there.
        let kept = true;
        const meta = { intent: 'save', name: $('acct-name').value.trim() || 'Untitled 3D map', id: current?.id || null };
        if (dialogMode === 'save-signin') kept = await stashWork(meta);
        await sendSignInLink(email);
        if (dialogMode === 'save-signin' && kept) pending = meta;
        $('acct-form').hidden = true; $('acct-sent').hidden = false;
        $('acct-sent-text').textContent = dialogMode !== 'save-signin'
          ? `We sent a sign-in link to ${email}. Open it in this browser to finish signing in.`
          : kept
            ? `We sent a sign-in link to ${email}. Open it in this browser and this figure will be saved to your account. You can keep working here meanwhile.`
            : `We sent a sign-in link to ${email}. This figure is too large to carry over, so keep this tab open: after you sign in, come back here and press Save.`;
      }
    } catch (err) {
      showError(err.message);
    } finally { submit.disabled = false; }
  });
}

async function boot() {
  // A sign-in link that failed comes back with the reason in the fragment.
  const hash = new URLSearchParams(location.hash.slice(1));
  if (hash.get('error_description')) {
    say(`Sign-in did not complete: ${hash.get('error_description')}. Try again from Save.`);
    try { history.replaceState(history.state, '', location.pathname + location.search); } catch { /* cosmetic */ }
  }
  const stash = await readStash();
  if (stash) {
    try {
      await studio().loadProject(stash.project);
      say('Restored the figure you were saving.');
    } catch { await clearStash(); }
  }
  try { user = await getUser(); } catch { user = null; }
  renderButtons();
  if (stash && user && stash.intent === 'save') {
    const ok = await doSave(stash.name || 'Untitled 3D map', stash.id || null);
    if (ok) await clearStash();
    return;
  }
  if (stash && !user) { pending = { intent: stash.intent, name: stash.name, id: stash.id || null }; say('Restored the figure you were saving. Sign in to finish saving it.'); return; }
  if (stash) await clearStash();
  const wanted = new URLSearchParams(location.search).get('project');
  if (wanted && user) {
    try { const res = await openProject(wanted); settle(); say(`Opened “${res.name}”.`); } catch (err) { setUrlProject(null); say(err.message); }
  }
}

let started = null;
export function start({ baseline = null } = {}) {
  if (started) return started;
  try {
    const now = sig(studio().getState());
    savedSig = baseline ? sig(baseline) : now;
    dirty = now !== savedSig;
  } catch { /* compared from the next save */ }
  wire();
  renderButtons();
  started = boot().catch(() => { /* the editor works without an account */ });
  return started;
}
