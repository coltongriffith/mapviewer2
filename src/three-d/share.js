// Exploration Maps 3D: share links. Loaded on first use (the Share button,
// EM3D.share) and at once on a shared figure; account.js holds the hooks.
//
//   /3d/share/<id>   the figure, read-only: turn and zoom it, switch to the
//                    section, download a PNG, save a copy to an account
//   /3d/embed/<id>   the same figure with minimal chrome, for an <iframe>
//                    (the only /3d page other sites may frame; vercel.json)
//   ?download=png    downloads the PNG once the figure is drawn, as on 2D maps
//
// A share is a snapshot of EM3D.getProject() (settings, camera, file texts)
// and a thumbnail, stored by the create_3d_share RPC behind an unguessable id
// (supabase/migrations/20261024100000_three_d_shares.sql). Signed in, a link
// belongs to the account; signed out, to this browser (the em_share_key the
// 2D editor already uses, which also rate-limits anonymous shares), and it
// expires after 30 days. Owners can update a link with the current figure
// (one link a company refreshes after new assays), list and revoke links.
import { client, getUser, saveProject } from './account-core.js';
import { track as usage } from './track.js';

const $ = (id) => document.getElementById(id);
const html = document.documentElement;
const MAX_BYTES = 8 * 1024 * 1024;
const LAST_KEY = 'em3d.share.last.v1';
const studio = () => {
  if (!window.EM3D?.getProject) throw new Error('The 3D editor has not started.');
  return window.EM3D;
};
const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtWhen = (iso) => { try { return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(iso)); } catch { return ''; } };
// Google tag as before, and our own usage counts (track.js, which keeps only created, viewed and forked). Never the
// share id: it is the link itself.
const track = (name, params) => { try { window.gtag?.('event', name, params); } catch { /* analytics never breaks sharing */ } usage(name, params); };

export const shareUrl = (id) => `${location.origin}/3d/share/${id}`;
export const embedUrl = (id) => `${location.origin}/3d/embed/${id}`;
export function embedCode(id, { title, width = 960, aspect = 16 / 9 } = {}) {
  const h = Math.round(width / (aspect || 16 / 9));
  return `<iframe src="${esc(embedUrl(id))}" width="${width}" height="${h}" style="border:0;max-width:100%" title="${esc(title || '3D drilling figure')}" loading="lazy" allowfullscreen></iframe>`;
}

// ── Errors in plain words ───────────────────────────────────────────────────
function plain(text, cause) { const e = new Error(text); e.plain = true; if (cause) e.cause = cause; return e; }
function explain(err, doing) {
  if (err?.plain) return err;
  const msg = String(err?.message || err || '');
  if (/SHARE_TOO_LARGE: signed out/.test(msg)) return plain('Signed out, a shared figure is limited to 2 MB. Sign in (Save) to share figures up to 8 MB, or remove large files such as dense topography.', err);
  if (/SHARE_TOO_LARGE/.test(msg)) return plain('This figure is too large to share: the limit is 8 MB, mostly its data files. Remove large files such as dense topography or model shapes, and try again.', err);
  if (/SHARE_RATE_LIMIT/.test(msg)) return plain(/anonymous/.test(msg) ? 'Too many links are being made without an account right now. Sign in (Save) to share, or try again later.' : /updated/.test(msg) ? 'This link has been updated many times in the last hour. Try again later.' : 'You have made several share links recently. Wait a while and try again.', err);
  if (/SHARE_NOT_FOUND/.test(msg)) return plain('That link is not one of yours, or no longer exists.', err);
  if (/SHARE_GONE/.test(msg)) return plain('That link was revoked or has expired. Create a new link instead.', err);
  if (/SHARE_INVALID/.test(msg)) return plain(`This figure could not be shared (${msg.replace(/^.*SHARE_INVALID:\s*/, '').replace(/\.$/, '')}).`, err);
  if (err?.code === 'NOT_CONFIGURED' || err?.code === 'PGRST202' || /could not find the function/i.test(msg)) return plain('Sharing is not available on this site right now.', err);
  if (err instanceof TypeError || /failed to fetch|network|load failed/i.test(msg)) return plain(`Could not reach Exploration Maps to ${doing}. Check your connection and try again.`, err);
  return plain(`Could not ${doing}${msg ? ` (${msg.replace(/\.$/, '')})` : ''}.`, err);
}

// Opaque per-browser key: owns this browser's anonymous links and rate-limits
// them. Shared with the 2D editor (src/utils/cloudStorage.js). Never shown to viewers.
function creatorKey() {
  try {
    let k = localStorage.getItem('em_share_key');
    if (!k || k.length < 16) { k = crypto.randomUUID().replace(/-/g, ''); localStorage.setItem('em_share_key', k); }
    return k;
  } catch { return crypto.randomUUID().replace(/-/g, ''); }
}
function remember(id, projectId) { try { localStorage.setItem(LAST_KEY, JSON.stringify({ id, projectId: projectId || null })); } catch { /* optional */ } }
function recalled() { try { return JSON.parse(localStorage.getItem(LAST_KEY) || 'null'); } catch { return null; } }

async function rpc(fn, args, doing) {
  let sb;
  try { sb = await client(); } catch (err) { throw explain(err, doing); }
  const { data, error } = await sb.rpc(fn, args);
  if (error) throw explain(error, doing);
  return data;
}

// The figure on screen, checked against the server's limits before it is sent.
function snapshot() {
  const em = studio();
  if (!em.getState().ready) throw plain('Nothing to share yet: add a collar file and an assay file.');
  const state = em.getProject();
  if (new TextEncoder().encode(JSON.stringify(state)).length > MAX_BYTES) throw explain(new Error('SHARE_TOO_LARGE'));
  let thumbnail = null;
  try { thumbnail = em.getThumbnail(480); } catch { /* a link without a picture is fine */ }
  if (thumbnail && (thumbnail.length > 300000 || !/^data:image\/(jpeg|png|webp);base64,/.test(thumbnail))) thumbnail = null;
  return { state, thumbnail };
}
async function currentProjectId(user) {
  if (!user) return null;
  try { return (await window.EM3D?.account?.currentProject?.())?.id || null; } catch { return null; }
}
const describe = (id, extra = {}) => {
  const st = window.EM3D?.getState?.(), f = st?.figureSize;
  return { id, url: shareUrl(id), embedUrl: embedUrl(id), embedCode: embedCode(id, { title: st?.brand?.title, aspect: f ? f.width / f.height : undefined }), ...extra };
};

// ── API (EM3D.share) ────────────────────────────────────────────────────────
export async function create() {
  const { state, thumbnail } = snapshot();
  const user = await getUser().catch(() => null);
  let projectId = await currentProjectId(user), id;
  const args = { p_state: state, p_creator_key: creatorKey(), p_project_id: projectId, p_thumbnail: thumbnail };
  try {
    id = await rpc('create_3d_share', args, 'create the link');
  } catch (err) {
    // A figure the caller can open but does not own (a colleague's, in a company
    // workspace) is shared without the link back to its saved project.
    if (!projectId || !/not in your account/.test(err.cause?.message || '')) throw err;
    projectId = null;
    id = await rpc('create_3d_share', { ...args, p_project_id: null }, 'create the link');
  }
  remember(id, projectId);
  track('three_d_share_created', { signed_in: !!user });
  return describe(id, { signedIn: !!user, expires: user ? null : 'in 30 days' });
}
export async function update(id) {
  if (!/^[0-9a-f]{32}$/.test(String(id || ''))) throw plain('update(id) needs the id of one of your share links.');
  const { state, thumbnail } = snapshot();
  await rpc('update_3d_share', { share_id: id, p_state: state, p_thumbnail: thumbnail, p_creator_key: creatorKey() }, 'update the link');
  track('three_d_share_updated');
  return describe(id, { updated: true });
}
export async function revoke(id) {
  const ok = await rpc('revoke_3d_share', { share_id: String(id || ''), p_creator_key: creatorKey() }, 'revoke the link');
  if (ok) { const last = recalled(); if (last?.id === id) try { localStorage.removeItem(LAST_KEY); } catch { /* optional */ } }
  return Boolean(ok);
}
export async function list() {
  const rows = await rpc('list_my_3d_shares', { p_creator_key: creatorKey() }, 'load your share links');
  const now = Date.now();
  return (rows || []).map((r) => ({
    id: r.id, url: shareUrl(r.id), title: r.title || null, projectId: r.project_id || null, createdAt: r.created_at, updatedAt: r.updated_at,
    expiresAt: r.expires_at, revokedAt: r.revoked_at, views: r.view_count ?? 0, anonymous: !!r.anonymous,
    active: !r.revoked_at && (!r.expires_at || new Date(r.expires_at).getTime() > now),
  }));
}

// ── Share dialog (editor) ───────────────────────────────────────────────────
let dlg = null;
let ui = { link: null, user: null, busy: false, msg: '', bad: false, shares: null };
function dialog() {
  if (dlg) return dlg;
  dlg = document.createElement('dialog');
  dlg.className = 'acct-dialog share-dialog'; dlg.id = 'share-dialog'; dlg.setAttribute('aria-labelledby', 'share-title');
  document.body.appendChild(dlg);
  dlg.addEventListener('click', onDialogClick);
  dlg.addEventListener('toggle', (e) => { if (e.target.id === 'share-mine' && e.target.open && !ui.shares) loadMine(); }, true);
  return dlg;
}
function renderDialog() {
  const d = dialog(), L = ui.link, st = (() => { try { return studio().getState(); } catch { return null; } })();
  const nFiles = st?.files?.length || 0;
  const mineOpen = d.querySelector('#share-mine')?.open;
  d.innerHTML = `<div class="stack">
    <div><h2 id="share-title">Share this 3D figure</h2>
      <p class="muted">Anyone with the link can view the figure, turn and zoom it, switch to the section and download a PNG. They cannot change it.</p></div>
    <p class="note">The link carries the figure's ${nFiles === 1 ? 'data file' : `${nFiles} data files`} (collars, assays and the rest), so anyone with it can see that data.
      ${ui.user ? 'It stays in your account until you revoke it.' : 'Made without an account, it expires after 30 days. Sign in with Save to keep links in your account.'}</p>
    ${L ? `<label class="field"><span>${L.fresh ? 'Link' : 'This figure already has a link'}</span>
        <span class="url-row"><input type="text" id="share-url" readonly aria-label="Share link"><button class="btn" type="button" data-sh="copy">Copy link</button></span></label>
      ${L.fresh ? '' : '<div class="row"><button class="btn primary" type="button" data-sh="update">Update this link with the current figure</button><button class="btn" type="button" data-sh="create">Create a new link</button></div>'}
      <label class="field"><span>Embed on a website</span><textarea id="share-embed" rows="3" readonly aria-label="Embed code"></textarea></label>
      <div class="row"><button class="btn" type="button" data-sh="copy-embed">Copy embed code</button><a class="btn" id="share-view" target="_blank" rel="noopener">Open link</a><button class="btn danger" type="button" data-sh="revoke">Revoke link</button></div>`
    : '<div class="row"><button class="btn primary" type="button" data-sh="create">Create link</button></div>'}
    <p class="${ui.bad ? 'bad' : 'ok'}" role="status" aria-live="polite"${ui.msg ? '' : ' hidden'}>${esc(ui.msg)}</p>
    <details id="share-mine"${mineOpen ? ' open' : ''}><summary>Your 3D share links</summary><div id="share-mine-body"></div></details>
    <div class="actions"><button class="btn" type="button" data-sh="close">Close</button></div>
  </div>`;
  if (L) { $('share-url').value = L.url; $('share-embed').value = L.embedCode; $('share-view').href = L.url; }
  d.querySelectorAll('[data-sh]').forEach((b) => { b.disabled = ui.busy && b.dataset.sh !== 'close'; });
  renderMine();
}
function renderMine() {
  const body = $('share-mine-body'); if (!body) return;
  if (!ui.shares) { body.innerHTML = '<p class="muted">Loading…</p>'; return; }
  if (ui.shares.error) { body.innerHTML = `<p class="bad">${esc(ui.shares.error)}</p>`; return; }
  if (!ui.shares.length) { body.innerHTML = '<p class="muted">No share links yet.</p>'; return; }
  body.innerHTML = `<ul class="share-list">${ui.shares.map((s) => `<li><b title="${esc(s.title || 'Untitled figure')}">${esc(s.title || (s.revokedAt ? 'Revoked link' : 'Untitled figure'))}</b>
      <span class="acct-acts">${s.active ? `<button class="btn" type="button" data-copy="${esc(s.id)}" aria-label="Copy link to ${esc(s.title || 'figure')}">Copy</button><button class="btn" type="button" data-revoke="${esc(s.id)}" aria-label="Revoke link to ${esc(s.title || 'figure')}">Revoke</button>` : ''}</span>
      <small>${s.revokedAt ? 'Revoked' : s.active ? `Made ${esc(fmtWhen(s.createdAt))} · ${s.views} view${s.views === 1 ? '' : 's'}${s.expiresAt ? ` · expires ${esc(fmtWhen(s.expiresAt))}` : ''}` : 'Expired'}</small></li>`).join('')}</ul>`;
}
async function loadMine() {
  try { ui.shares = await list(); } catch (err) { ui.shares = { error: err.message }; }
  renderMine();
}
function say(msg, bad = false) { ui.msg = msg; ui.bad = bad; renderDialog(); }
async function copy(text, what) {
  try { await navigator.clipboard.writeText(text); say(`${what} copied.`); } catch { say(`Select the ${what.toLowerCase()} and copy it.`, true); }
}
async function act(fn, done) {
  if (ui.busy) return;
  ui.busy = true; say('Working…');
  try { await fn(); ui.busy = false; say(done()); } catch (err) { ui.busy = false; say(explain(err, 'share').message, true); }
  if (ui.shares) loadMine();
}
async function onDialogClick(e) {
  const b = e.target.closest('button'); if (!b || b.disabled) return;
  const a = b.dataset.sh;
  if (a === 'close') { dlg.close(); return; }
  if (a === 'copy') return copy(ui.link.url, 'Link');
  if (a === 'copy-embed') return copy(ui.link.embedCode, 'Embed code');
  if (a === 'create') return act(async () => { ui.link = { ...(await create()), fresh: true }; }, () => 'Link created. Copy it and send it, or embed the figure on a website.');
  if (a === 'update') return act(async () => { ui.link = { ...(await update(ui.link.id)), fresh: true }; }, () => 'Link updated: it now opens the figure as it is on screen.');
  if (a === 'revoke') {
    if (b.dataset.confirm !== '1') { b.dataset.confirm = '1'; b.textContent = 'Confirm revoke'; return; }
    const id = ui.link.id;
    return act(async () => { if (!(await revoke(id))) throw plain('That link was already revoked.'); ui.link = null; }, () => 'Link revoked. It no longer opens the figure.');
  }
  if (b.dataset.copy) return copy(shareUrl(b.dataset.copy), 'Link');
  if (b.dataset.revoke) {
    if (b.dataset.confirm !== '1') { b.dataset.confirm = '1'; b.textContent = 'Confirm'; return; }
    const id = b.dataset.revoke;
    return act(async () => { await revoke(id); if (ui.link?.id === id) ui.link = null; }, () => 'Link revoked.');
  }
}
export async function openDialog() {
  const d = dialog();
  ui = { link: null, user: null, busy: true, msg: 'Checking for an existing link…', bad: false, shares: null };
  renderDialog();
  if (!d.open) d.showModal();
  try {
    ui.user = await getUser().catch(() => null);
    const projectId = await currentProjectId(ui.user);
    const last = recalled();
    let mine = [];
    try { mine = await list(); ui.shares = mine; } catch { /* offer a new link */ }
    const active = mine.filter((s) => s.active);
    // The same saved 3D map, else the last link this browser made for this figure.
    const found = (projectId && active.find((s) => s.projectId === projectId))
      || (last && (last.projectId || null) === (projectId || null) && active.find((s) => s.id === last.id));
    if (found) ui.link = { ...describe(found.id), fresh: false };
    ui.msg = found ? `Made ${fmtWhen(found.createdAt)}${found.updatedAt && found.updatedAt !== found.createdAt ? `, last updated ${fmtWhen(found.updatedAt)}` : ''}. Update it after new results so the same link shows them.` : '';
  } catch { ui.msg = ''; }
  ui.busy = false; renderDialog();
  (d.querySelector('[data-sh="update"]') || d.querySelector('[data-sh="create"]') || d.querySelector('[data-sh="copy"]'))?.focus();
}

// ── Viewer (/3d/share/<id>, /3d/embed/<id>) ─────────────────────────────────
const IMG_URL = /^data:image\/(png|jpe?g|webp|gif|svg\+xml)[;,]/i;
const BAD_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
// A shared figure was written by someone else: keep it to plain data, images
// to data: URLs (no remote fetches from a viewer's browser) and files to text.
function cleanValue(v, depth = 0) {
  if (v === null || typeof v === 'string' || typeof v === 'boolean') return v;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'object' || depth > 14) return undefined;
  if (Array.isArray(v)) return v.map((x) => { const c = cleanValue(x, depth + 1); return c === undefined ? null : c; });
  if ('$image' in v) return typeof v.$image === 'string' && IMG_URL.test(v.$image) ? { $image: v.$image } : null;
  const out = {};
  for (const [k, x] of Object.entries(v)) { if (BAD_KEYS.has(k)) continue; const c = cleanValue(x, depth + 1); if (c !== undefined) out[k] = c; }
  return out;
}
export function cleanSnapshot(p) {
  if (!p || typeof p !== 'object' || p.v !== 1 || !p.settings || typeof p.settings !== 'object' || Array.isArray(p.settings) || !Array.isArray(p.files)) return null;
  const settings = cleanValue(p.settings);
  const imgs = settings.geology?.images;
  if (imgs && typeof imgs === 'object') for (const k of Object.keys(imgs)) if (typeof imgs[k] !== 'string' || !IMG_URL.test(imgs[k])) delete imgs[k];
  const files = p.files.filter((f) => f && typeof f.name === 'string' && typeof f.text === 'string').slice(0, 100).map((f) => ({
    name: f.name.slice(0, 300), text: f.text, role: typeof f.role === 'string' ? f.role : undefined,
    cols: f.cols && typeof f.cols === 'object' ? Object.fromEntries(Object.entries(f.cols).filter(([k, i]) => !BAD_KEYS.has(k) && Number.isInteger(i))) : undefined,
  }));
  const cam = p.camera && typeof p.camera === 'object' ? Object.fromEntries(['azimuth', 'plunge', 'zoom'].filter((k) => Number.isFinite(p.camera[k])).map((k) => [k, p.camera[k]])) : null;
  return { v: 1, settings, camera: cam && Object.keys(cam).length === 3 ? cam : null, usingSample: !!p.usingSample, secSet: !!p.secSet, files };
}

const shareId = () => html.getAttribute('data-share') || (/^\/3d\/(?:share|embed)\/([0-9a-f]{32})\/?$/.exec(location.pathname) || [])[1] || '';
const isEmbed = () => html.classList.contains('em3d-embed');
const wantsDownload = () => { try { return new URLSearchParams(location.search).get('download') === 'png'; } catch { return false; } };
const outLink = (el) => { if (isEmbed()) { el.target = '_blank'; el.rel = 'noopener'; } return el; };
function el(tag, props = {}, text) { const e = document.createElement(tag); Object.assign(e, props); if (text !== undefined) e.textContent = text; return e; }

let viewerBar = null;
function showMessage(title, body, { retry = false } = {}) {
  let box = $('share-msg');
  if (!box) { box = el('div', { id: 'share-msg', className: 'share-msg' }); box.setAttribute('role', 'status'); $('stage').appendChild(box); }
  box.replaceChildren(el('h1', {}, title), ...(body ? [el('p', {}, body)] : []));
  const row = el('div', { className: 'row' });
  if (retry) { const b = el('button', { className: 'btn', type: 'button' }, 'Try again'); b.addEventListener('click', () => location.reload()); row.appendChild(b); }
  row.appendChild(outLink(el('a', { className: 'btn primary', href: '/3d' }, 'Make your own 3D figure')));
  box.appendChild(row);
  box.hidden = false;
}
function hideMessage() { const box = $('share-msg'); if (box) box.hidden = true; }

function viewerChrome() {
  const toolbar = document.querySelector('.toolbar');
  viewerBar = el('div', { className: 'share-bar' });
  const note = el('span', { className: 'share-note' }, 'Shared 3D figure · ');
  note.appendChild(el('a', { href: '/3d' }, 'Make your own'));
  const dl = el('button', { className: 'btn primary', type: 'button', id: 'share-download' }, 'Download PNG');
  dl.addEventListener('click', () => downloadPng());
  viewerBar.append(note, dl);
  toolbar.appendChild(viewerBar);
  const credit = outLink(el('a', { className: 'share-credit', href: `${location.origin}/3d` }, 'Exploration Maps'));
  credit.title = 'Made with Exploration Maps 3D';
  $('stage').appendChild(credit);
}
function downloadPng() {
  const b = $('share-download');
  try {
    const em = studio();
    em.exportPNG({ view: em.getState().view, download: true });
    if (b) b.textContent = 'Download PNG again';
    track('three_d_share_download');
    return true;
  } catch (err) {
    const s = $('status'); if (s) { s.textContent = `The PNG could not be made: ${err.message}`; s.style.opacity = '1'; }
    return false;
  }
}
async function offerCopy() {
  if (isEmbed()) return; // nothing that acts on an account inside someone else's page
  let user = null;
  try { user = await getUser(); } catch { user = null; }
  if (!user) return;
  const b = el('button', { className: 'btn', type: 'button', id: 'share-fork' }, 'Save a copy to my account');
  b.addEventListener('click', async () => {
    if (b.disabled) return;
    b.disabled = true; b.textContent = 'Saving a copy…';
    try {
      const title = String(studio().getState().brand?.title || '').trim() || 'Shared 3D figure';
      const res = await saveProject(`${title} (copy)`.slice(0, 200));
      const open = el('a', { className: 'btn', href: `/3d?project=${encodeURIComponent(res.id)}`, id: 'share-fork-open' }, 'Open my copy');
      b.replaceWith(open);
      const s = $('status'); if (s) { s.textContent = `Saved “${res.name}” to your account.`; s.style.opacity = '1'; }
      track('three_d_share_forked');
    } catch (err) {
      b.disabled = false; b.textContent = 'Save a copy to my account';
      const s = $('status'); if (s) { s.textContent = err.message; s.style.opacity = '1'; }
    }
  });
  viewerBar.appendChild(b);
}
const timeout = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function bootViewer() {
  html.classList.add('em3d-viewer');
  viewerChrome();
  const id = shareId();
  if (!id) { showMessage('This link is not complete', 'Check that the whole link was copied, including the part after /3d/share/.'); return; }
  showMessage('Loading the shared figure…', '');
  let res;
  try {
    const sb = await client();
    const { data, error } = await sb.rpc('get_3d_share', { share_id: id });
    if (error) throw error;
    res = data;
  } catch {
    showMessage('Could not load this figure', 'We could not reach Exploration Maps. The link may still be fine: check your connection and try again.', { retry: true });
    return;
  }
  const snap = cleanSnapshot(res?.state);
  if (!res || !snap) { showMessage('This figure is no longer shared', 'The link has expired, or its owner has stopped sharing it.'); return; }
  try {
    await studio().loadProject(snap);
  } catch {
    showMessage('This figure could not be opened', 'The shared figure is damaged or was made with a newer version. Ask the person who sent it for a new link.');
    return;
  }
  hideMessage();
  html.classList.add('em3d-shown');
  const title = String(studio().getState().brand?.title || '').trim();
  if (title) document.title = `${title} · Exploration Maps 3D`;
  track('three_d_share_viewed', { embed: isEmbed() });
  offerCopy();
  if (wantsDownload()) {
    try { await Promise.race([studio().terrainReady(), timeout(20000)]); } catch { /* draw with what has loaded */ }
    downloadPng();
  }
}

let started = null;
export function start() {
  if (started) return started;
  started = html.classList.contains('em3d-viewer') || /^\/3d\/(share|embed)(\/|$)/i.test(location.pathname) ? bootViewer().catch(() => showMessage('This figure could not be opened', '')) : Promise.resolve();
  return started;
}
