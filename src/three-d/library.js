// Exploration Maps 3D: files from a property's data library
// (src/utils/propertyFiles.js, 20261025100000_property_files.sql) for a
// figure that belongs to a company property. Loaded by account-core.js on
// first use: "From property library" in step 1, and, when a figure opens, a
// notice if a file it took from the library has a newer version.
//
// A library file is added like an uploaded one (its text is part of the
// figure and saved with it); S.libRefs records which library file and
// version each figure file came from, so the figure can be updated later.
import { library, staleRefs } from '../utils/propertyFiles.js';

const $ = (id) => document.getElementById(id);
const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const READABLE = /\.(csv|txt|obj|xyz|dat)$/i; // what the editor reads as a file of its own
const em = () => window.EM3D;
let host = null; // { client, current, say } from account-core.js
let shown = [];  // the files listed in the picker
let stale = [];  // [{ name, from, file }] behind the notice

const lib = async () => library(await host.client());
const propertyId = () => host.current()?.home?.propertyId || null;
const hideNotice = () => { $('lib-notice').hidden = true; };

export function init(h) {
  host = h;
  $('lib-list').addEventListener('click', (e) => { const b = e.target.closest('button[data-lib]'); if (b) add(b); });
  $('lib-update').addEventListener('click', update);
  $('lib-dismiss').addEventListener('click', hideNotice);
}

export async function toggle() {
  const box = $('lib-pick'), list = $('lib-list');
  box.hidden = !box.hidden;
  $('lib-add').setAttribute('aria-expanded', String(!box.hidden));
  if (box.hidden) return;
  list.innerHTML = '<p class="muted">Loading the property library…</p>';
  try {
    shown = (await (await lib()).list(propertyId())).filter((f) => READABLE.test(f.name));
    const refs = em().getState().libRefs;
    list.innerHTML = shown.length ? shown.map((f) => {
      const used = refs[f.name]?.libFileId === f.id;
      return `<div class="file lib-item"><span class="name" title="${esc(f.name)}">${esc(f.name)} <span class="muted">v${f.version}</span></span>
        <button class="btn" type="button" data-lib="${esc(f.id)}" aria-label="Add ${esc(f.name)} to the figure"${used ? ' disabled' : ''}>${used ? 'Added' : 'Add'}</button></div>`;
    }).join('') : '<p class="muted">No drill data in this property’s library yet. Add CSV, TXT, OBJ or XYZ files on the property page.</p>';
  } catch (err) {
    list.innerHTML = `<p class="bad">${esc(err.message)}</p>`;
  }
}

async function add(btn) {
  const f = shown.find((x) => x.id === btn.dataset.lib); if (!f) return;
  btn.disabled = true; btn.textContent = 'Adding…';
  try {
    const text = await (await lib()).text(f.path);
    em().addFiles([{ name: f.name, text, lib: { libFileId: f.id, version: f.version } }]);
    btn.textContent = 'Added';
  } catch (err) {
    host.say(err.message); btn.disabled = false; btn.textContent = 'Add';
  }
}

/** On opening a figure: offer the newer version of any library file it uses. */
export async function check() {
  hideNotice(); stale = [];
  const refs = em().getState().libRefs, prop = propertyId();
  if (!prop || !Object.keys(refs).length) return;
  const names = new Set(em().getState().files.map((f) => f.name));
  stale = staleRefs(refs, await (await lib()).list(prop)).filter((s) => names.has(s.name));
  if (!stale.length) return;
  $('lib-notice-text').textContent = `Newer data: ${stale.map((s) => `${s.file.name} v${s.file.version} (was v${s.from})`).join(', ')} ·`;
  $('lib-notice').hidden = false;
}

// Swap in the new text and reopen the figure exactly as it was otherwise
// (file types and columns picked by hand, camera, labels).
async function update() {
  const btn = $('lib-update');
  btn.disabled = true; btn.textContent = 'Updating…';
  let backup = null;
  try {
    const l = await lib();
    const texts = await Promise.all(stale.map((s) => l.text(s.file.path)));
    const p = em().getProject();
    stale.forEach((s, i) => {
      p.files.find((f) => f.name === s.name).text = texts[i];
      p.settings.libRefs[s.name] = { libFileId: s.file.id, version: s.file.version };
    });
    backup = em().getProject();
    await em().loadProject(p);
    host.say(`Updated to ${stale.map((s) => `${s.file.name} v${s.file.version}`).join(', ')}. Save to keep it.`);
    stale = []; hideNotice();
  } catch (err) {
    if (backup) try { await em().loadProject(backup); } catch { /* the editor keeps whatever it has */ }
    host.say(`Could not update the data (${err.message}). The figure is unchanged.`);
  } finally {
    btn.disabled = false; btn.textContent = 'Update';
  }
}
