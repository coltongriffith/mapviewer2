// Exploration Maps 3D: published versions of a saved figure, an audit trail
// (supabase/migrations/20261029100000_figure_versions.sql). Loaded by
// account-core.js on first use: "Versions…" in My 3D maps, the
// EM3D.account version methods, or /3d?project=<id>&version=<n>.
//
// Publishing freezes the figure AS SAVED: the server copies the saved row
// (settings verbatim, so it keeps its design version, and its data files,
// which storage then keeps), labels it, dates it and hashes it. So a figure
// with unsaved changes cannot be published, and a save made elsewhere since
// this copy was opened is refused (VERSION_STALE).
//
// Opening a version shows it read-only, exactly as published: turn it, switch
// to the section, download the PNG. Later edits to the figure never reach it.
// "Start a new figure from this version" copies it into an unsaved figure;
// "Back to the current figure" reopens the latest save.
const $ = (id) => document.getElementById(id);
const html = document.documentElement;
const em = () => window.EM3D;
const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
let host = null; // { client, current, dirty, canPublish, say, frozen, setFrozen, reopen, detach, saveAsNew } from account-core.js

export const init = (h) => { host = h; };

// ── Plain words ─────────────────────────────────────────────────────────────
const ERRORS = {
  VERSION_STALE: 'This figure was saved somewhere else since you opened it. Reopen it from My 3D maps, then publish.',
  VERSION_READ_ONLY: 'You have view-only access to this figure, so you cannot publish versions of it.',
  VERSION_LIMIT: 'This figure already has 200 published versions, the most it can keep.',
  VERSION_RATE_LIMIT: 'You have published many versions in the last hour. Wait a while and try again.',
  VERSION_TOO_LARGE: 'This figure is too large to publish (the limit is 8 MB without its data files).',
  VERSION_FILES_MISSING: 'Some of this figure’s data files are missing from your account. Save the figure again, then publish.',
  VERSION_FILES_UNEXPECTED: 'This figure points at data files outside its folder. Save it as new, then publish.',
  NOT_FOUND: 'That figure was not found in your account. It may have been deleted.',
};
function plain(text, cause) { const e = new Error(text); e.plain = true; if (cause) e.cause = cause; return e; }
export function explain(err, doing = 'publish this version') {
  if (err?.plain) return err;
  const msg = String(err?.message || err || '');
  const code = Object.keys(ERRORS).find((k) => msg.includes(k));
  if (code) return plain(ERRORS[code], err);
  if (/VERSION_INVALID/.test(msg)) return plain(`${msg.replace(/^.*VERSION_INVALID:\s*/, '').replace(/^./, (c) => c.toUpperCase()).replace(/\.?$/, '.')}`, err);
  if (err?.code === 'PGRST202' || /could not find the function|relation .*figure_versions/i.test(msg)) return plain('Published versions are not available on this site yet.', err);
  if (err instanceof TypeError || /failed to fetch|network|load failed/i.test(msg)) return plain(`Could not reach Exploration Maps to ${doing}. Check your connection and try again.`, err);
  return plain(`Could not ${doing}${msg ? ` (${msg.replace(/\.$/, '')})` : ''}.`, err);
}

// ── Pure helpers (tested in tests/three-d-versions.test.js) ────────────────
export const today = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
/** A reason the form cannot be sent, or ''. */
export function checkForm({ label, releaseDate } = {}) {
  const l = String(label ?? '').trim();
  if (!l) return 'Give the version a label, such as “News release 2026-10-21”.';
  if (l.length > 200) return 'Keep the label to 200 characters.';
  if (releaseDate && (!/^\d{4}-\d{2}-\d{2}$/.test(releaseDate) || Number.isNaN(Date.parse(`${releaseDate}T00:00:00Z`)) || releaseDate < '1900-01-01' || releaseDate > '2200-12-31')) return 'The release date does not look right.';
  return '';
}
/** "Published version 3 · News release 2026-10-21 · read-only" (the date shown when the label lacks it). */
export function banner(v) {
  const date = v.releaseDate && !String(v.label).includes(v.releaseDate) ? ` · ${v.releaseDate}` : '';
  return `Published version ${v.version} · ${v.label}${date} · read-only`;
}
export const versionLink = (projectId, n, origin = location.origin) => `${origin}/3d?project=${encodeURIComponent(projectId)}&version=${n}`;
const toVersion = (r) => r && ({
  id: r.id, version: r.version, label: r.label, releaseDate: r.release_date || null, name: r.name,
  contentHash: r.content_hash, publishedBy: r.published_by_email ?? null, createdAt: r.created_at,
});
/** A version's snapshot as EM3D.loadProject takes it, its files supplied by `read(path)`. */
export async function projectOf(snapshot, read) {
  const s = snapshot?.settings;
  if (snapshot?.kind !== 'figure' || !s || typeof s !== 'object') throw plain('This version is not a 3D figure.');
  const sizes = new Map((snapshot.files || []).map((f) => [f.path, Number(f.size)]));
  // As openProject: files normally live in storage; a row may also carry them inline.
  const files = Array.isArray(s.files) ? s.files : await Promise.all((snapshot.file_paths || []).map(async (fp) => {
    const blob = await read(fp.path), want = sizes.get(fp.path);
    if (Number.isFinite(want) && want > 0 && blob.size !== want) throw plain(`The data file ${fp.name} does not match the published version.`);
    return { name: fp.name, text: await blob.text(), role: fp.role, cols: fp.cols };
  }));
  return { ...s, files };
}

// ── API ─────────────────────────────────────────────────────────────────────
const figureId = () => host.current()?.id || null;
async function rpc(fn, args, doing) {
  const sb = await host.client();
  const { data, error } = await sb.rpc(fn, args);
  if (error) throw explain(error, doing);
  return data;
}

export async function publish({ label, releaseDate = today() } = {}) {
  const cur = host.current();
  if (host.frozen()) throw plain('This is a published version, read-only. Go back to the current figure to publish it.');
  if (!cur) throw plain('Save this figure to your account first: a published version is the figure as saved.');
  if (host.dirty()) throw plain('This figure has unsaved changes. Save it first: a published version is the figure as saved.');
  const bad = checkForm({ label, releaseDate }); if (bad) throw plain(bad);
  const v = toVersion(await rpc('publish_figure_version', {
    p_kind: 'figure', p_figure_id: cur.id, p_label: String(label).trim(), p_release_date: releaseDate || null, p_expected_updated_at: cur.savedAt,
  }, 'publish this version'));
  try { window.gtag?.('event', 'three_d_version_published'); } catch { /* analytics never breaks publishing */ }
  return { ...v, link: versionLink(cur.id, v.version) };
}

export async function list(id = figureId()) {
  if (!id) return [];
  const rows = await rpc('list_figure_versions', { p_kind: 'figure', p_figure_id: id }, 'load the published versions');
  return (rows || []).map(toVersion);
}

let shown = null; // { version, project, figureId } while a version is on screen
/** Opens version `n` (its number, or its id) of the open figure, read-only. */
export async function open(n, { force = false } = {}) {
  const fid = host.frozen()?.figureId || figureId();
  if (!fid) throw plain('Open a saved figure first.');
  if (host.dirty() && !force) throw Object.assign(plain('This figure has unsaved changes. Save it first, or open the version anyway with { force: true }.'), { code: 'UNSAVED' });
  const sb = await host.client();
  let row, project;
  try {
    let q = sb.from('figure_versions').select('id, figure_id, version, label, release_date, name, snapshot, content_hash, created_at').eq('figure_kind', 'figure');
    q = /^[0-9a-f-]{36}$/.test(String(n)) ? q.eq('id', n) : q.eq('figure_id', fid).eq('version', Number(n));
    const res = await q.maybeSingle();
    if (res.error) throw res.error;
    row = res.data;
    if (!row) throw plain(`Version ${n} of this figure was not found, or you cannot see it.`);
    project = await projectOf(row.snapshot, async (path) => {
      const { data, error } = await sb.storage.from('three-d-files').download(path);
      if (error) throw error;
      return data;
    });
  } catch (err) { throw explain(err, 'open that version'); }
  const backup = shown ? null : em().getProject();
  readOnly(true);
  try {
    await em().loadProject(project);
  } catch (err) {
    if (backup) { exitView(); try { await em().loadProject(backup); } catch { /* the editor keeps whatever it has */ } }
    throw plain(`That version could not be opened (${err.message}).`, err);
  }
  const v = toVersion(row);
  shown = { version: v, project, figureId: row.figure_id };
  host.setFrozen({ ...v, figureId: row.figure_id });
  bar(v);
  setUrl(row.figure_id, v.version);
  return { ...v, state: em().getState() };
}

// Read-only without moving anything: the panel stays where it is (inert), so the figure keeps the size it
// was drawn at and exports exactly as published (the shared viewer's full-width layout would not).
function readOnly(on) {
  html.classList.toggle('em3d-version', on);
  document.querySelectorAll('.panel, .toolbar .acct').forEach((el) => { el.inert = on; });
}
function exitView() {
  readOnly(false);
  $('ver-bar')?.remove();
  host.setFrozen(null);
}
/** Back to the figure as last saved. */
export async function close() {
  if (!shown) return null;
  const fid = shown.figureId;
  exitView(); shown = null;
  setUrl(fid, null);
  return host.reopen(fid);
}
/** The version on screen becomes a new, unsaved figure (Save names it). */
export async function startCopy() {
  if (!shown) throw plain('Open a published version first.');
  const { version: v, project } = shown;
  exitView(); shown = null;
  await em().loadProject(project); // exactly as published, whatever was done on screen
  host.detach();
  setUrl(null, null);
  host.say(`This is now a new figure made from version ${v.version} (${v.label}). Save it to keep it.`);
  host.saveAsNew(`${v.name} (from v${v.version})`.slice(0, 200));
  return em().getState();
}
function setUrl(project, version) {
  try {
    const url = new URL(location.href);
    if (project) url.searchParams.set('project', project); else url.searchParams.delete('project');
    if (version) url.searchParams.set('version', String(version)); else url.searchParams.delete('version');
    history.replaceState(history.state, '', url.pathname + url.search);
  } catch { /* cosmetic */ }
}

// ── Read-only bar ───────────────────────────────────────────────────────────
function btn(text, fn, primary = false) {
  const b = document.createElement('button');
  b.type = 'button'; b.className = `btn${primary ? ' primary' : ''}`; b.textContent = text;
  b.addEventListener('click', () => Promise.resolve().then(fn).catch((err) => host.say(err.message)));
  return b;
}
function bar(v) {
  $('ver-bar')?.remove();
  const box = document.createElement('div');
  box.className = 'share-bar'; box.id = 'ver-bar';
  const note = document.createElement('span');
  note.className = 'share-note'; note.id = 'ver-banner'; note.setAttribute('role', 'status'); note.textContent = banner(v);
  note.title = `Published ${new Date(v.createdAt).toLocaleString()}${v.publishedBy ? ` by ${v.publishedBy}` : ''} · SHA-256 ${v.contentHash}`;
  box.append(note,
    btn('Download PNG', () => em().exportPNG({ view: em().getState().view, download: true }), true),
    btn('Start a new figure from this version', startCopy),
    btn('Back to the current figure', close));
  document.querySelector('.toolbar').appendChild(box);
}

// ── Versions dialog ─────────────────────────────────────────────────────────
let dlg = null, items = [], msg = { text: '', bad: false };
function dialog() {
  if (dlg) return dlg;
  dlg = document.createElement('dialog');
  dlg.className = 'acct-dialog share-dialog'; dlg.id = 'ver-dialog'; dlg.setAttribute('aria-labelledby', 'ver-title');
  document.body.appendChild(dlg);
  dlg.addEventListener('click', onClick);
  dlg.addEventListener('submit', (e) => { e.preventDefault(); doPublish(); });
  return dlg;
}
function render(loading = false) {
  const cur = host.current(), d = dialog(), mayPublish = host.canPublish(), dirty = host.dirty();
  d.innerHTML = `<div class="stack">
    <div><h2 id="ver-title">Published versions</h2>
      <p class="muted">A published version is frozen: the figure and its data as saved now, with a label and release date, who published it and a fingerprint (SHA-256). Later edits never change it.</p></div>
    ${mayPublish ? `<form class="stack" id="ver-form" novalidate>
      <label class="field"><span>Label</span><input type="text" id="ver-label" maxlength="200" placeholder="News release ${today()}" autocomplete="off"></label>
      <label class="field"><span>Release date</span><input type="date" id="ver-date" value="${today()}"></label>
      ${dirty ? '<p class="note">This figure has unsaved changes. Save it first: a version is the figure as saved.</p>' : ''}
      <div class="row"><button class="btn primary" type="submit" id="ver-publish"${dirty ? ' disabled' : ''}>Publish version</button></div>
    </form>` : '<p class="note">You can open this figure’s versions; publishing needs editor access.</p>'}
    <p class="${msg.bad ? 'bad' : 'ok'}" role="status" aria-live="polite"${msg.text ? '' : ' hidden'}>${esc(msg.text)}</p>
    <div id="ver-list">${loading ? '<p class="muted">Loading…</p>' : items.error ? `<p class="bad">${esc(items.error)}</p>` : !items.length ? '<p class="muted">No published versions yet.</p>'
    : `<ul class="share-list" aria-label="Versions of ${esc(cur?.name || 'this figure')}">${items.map((v) => `<li><b title="${esc(v.label)}">v${v.version} · ${esc(v.label)}</b>
        <span class="acct-acts"><button class="btn" type="button" data-ver="${v.version}" aria-label="Open version ${v.version}">Open</button><button class="btn" type="button" data-link="${v.version}" aria-label="Copy link to version ${v.version}">Copy link</button></span>
        <small>${v.releaseDate ? `Release ${esc(v.releaseDate)} · ` : ''}published ${esc(new Date(v.createdAt).toLocaleDateString())}${v.publishedBy ? ` by ${esc(v.publishedBy)}` : ''} · <span title="SHA-256 ${esc(v.contentHash)}">${esc(String(v.contentHash).slice(0, 10))}</span></small></li>`).join('')}</ul>`}</div>
    <div class="actions"><button class="btn" type="button" data-close="1">Close</button></div>
  </div>`;
}
async function refresh() {
  try { items = await list(); } catch (err) { items = Object.assign([], { error: err.message }); }
  render();
}
async function doPublish() {
  const b = $('ver-publish'); if (!b || b.disabled) return;
  b.disabled = true; b.textContent = 'Publishing…';
  const label = $('ver-label').value, releaseDate = $('ver-date').value;
  try {
    const v = await publish({ label, releaseDate });
    msg = { text: `Published version ${v.version} · ${v.label}.`, bad: false };
    await refresh();
  } catch (err) {
    msg = { text: err.message, bad: true }; render();
    $('ver-label').value = label; $('ver-date').value = releaseDate;
  }
}
async function onClick(e) {
  const b = e.target.closest('button'); if (!b || b.disabled) return;
  if (b.dataset.close) { dlg.close(); return; }
  if (b.dataset.link) {
    const url = versionLink(host.current().id, b.dataset.link);
    try { await navigator.clipboard.writeText(url); msg = { text: 'Link copied. It opens this version for people with access to the figure.', bad: false }; } catch { msg = { text: url, bad: false }; }
    render(); return;
  }
  if (b.dataset.ver) {
    if (host.dirty() && b.dataset.confirm !== '1') { b.dataset.confirm = '1'; b.textContent = 'Discard unsaved changes?'; return; }
    b.disabled = true; b.textContent = 'Opening…';
    try { await open(Number(b.dataset.ver), { force: true }); dlg.close(); } catch (err) { msg = { text: err.message, bad: true }; render(); }
  }
}
export async function openDialog() {
  msg = { text: '', bad: false };
  render(true);
  if (!dialog().open) dialog().showModal();
  await refresh();
  ($('ver-label') || dialog().querySelector('[data-close]'))?.focus();
}
