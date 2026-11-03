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
import { GEOPHYS_NUMERIC_POLICY } from './geophys-policy.js';

const $ = (id) => document.getElementById(id);
const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const READABLE = /\.(csv|txt|obj|xyz|dat)$/i; // what the editor reads as a file of its own
const em = () => window.EM3D;
let host = null; // { client, current, say } from account-core.js
let shown = [];  // the files listed in the picker
let stale = [];  // [{ name, from, file }] behind the notice
let shownContext = null, staleContext = null, checkGeneration = 0, pickerGeneration = 0;
const changed = () => Object.assign(new Error('The figure or account changed. Open its property library again.'), { code: 'PROJECT_CHANGED' });
function capture() {
  const context = host.captureContext();
  const property = propertyId();
  return {
    isCurrent(options) { return property === propertyId() && context.isCurrent(options); },
    assertCurrent(options) { if (!this.isCurrent(options)) throw changed(); },
  };
}

const lib = async () => library(await host.client());
const propertyId = () => host.current()?.home?.propertyId || null;
const hideNotice = () => { $('lib-notice').hidden = true; };

export function init(h) {
  host = h;
  window.addEventListener('em3d:account-context', () => {
    checkGeneration++; pickerGeneration++; shown = []; stale = []; shownContext = staleContext = null;
    hideNotice(); $('lib-pick').hidden = true; $('lib-add').setAttribute('aria-expanded', 'false');
  });
  $('lib-list').addEventListener('click', (e) => { const b = e.target.closest('button[data-lib]'); if (b) add(b); });
  $('lib-update').addEventListener('click', update);
  $('lib-dismiss').addEventListener('click', hideNotice);
}

export async function toggle() {
  const box = $('lib-pick'), list = $('lib-list');
  box.hidden = !box.hidden;
  $('lib-add').setAttribute('aria-expanded', String(!box.hidden));
  if (box.hidden) return;
  const context = capture(), generation = ++pickerGeneration;
  list.innerHTML = '<p class="muted">Loading the property library…</p>';
  try {
    const l = await lib(); context.assertCurrent();
    const files = await l.list(propertyId()); context.assertCurrent();
    if (generation !== pickerGeneration) return;
    shown = files.filter((f) => READABLE.test(f.name)); shownContext = context;
    const refs = em().getState().libRefs;
    list.innerHTML = shown.length ? shown.map((f) => {
      const used = refs[f.name]?.libFileId === f.id;
      return `<div class="file lib-item"><span class="name" title="${esc(f.name)}">${esc(f.name)} <span class="muted">v${f.version}</span></span>
        <button class="btn" type="button" data-lib="${esc(f.id)}" aria-label="Add ${esc(f.name)} to the figure"${used ? ' disabled' : ''}>${used ? 'Added' : 'Add'}</button></div>`;
    }).join('') : '<p class="muted">No drill data in this property’s library yet. Add CSV, TXT, OBJ or XYZ files on the property page.</p>';
  } catch (err) {
    if (generation === pickerGeneration && context.isCurrent()) list.innerHTML = `<p class="bad">${esc(err.message)}</p>`;
  }
}

async function add(btn) {
  const f = shown.find((x) => x.id === btn.dataset.lib), context = shownContext; if (!f || !context?.isCurrent()) return;
  btn.disabled = true; btn.textContent = 'Adding…';
  try {
    const l = await lib(); context.assertCurrent();
    const text = await l.text(f.path); context.assertCurrent();
    em().addFiles([{ name: f.name, text, lib: { libFileId: f.id, version: f.version } }]);
    btn.textContent = 'Added';
  } catch (err) {
    if (context.isCurrent()) { host.say(err.message); btn.disabled = false; btn.textContent = 'Add'; }
  }
}

/** On opening a figure: offer the newer version of any library file it uses. */
export async function check() {
  const generation = ++checkGeneration, context = capture();
  hideNotice(); stale = []; staleContext = null;
  const refs = em().getState().libRefs, prop = propertyId();
  if (!prop || !Object.keys(refs).length) return;
  const names = new Set(em().getState().files.map((f) => f.name));
  const l = await lib(); context.assertCurrent();
  const files = await l.list(prop);
  if (generation !== checkGeneration || !context.isCurrent()) return;
  stale = staleRefs(refs, files).filter((s) => names.has(s.name)); staleContext = context;
  if (!stale.length) return;
  $('lib-notice-text').textContent = `Newer data: ${stale.map((s) => `${s.file.name} v${s.file.version} (was v${s.from})`).join(', ')} ·`;
  $('lib-notice').hidden = false;
}

// Swap in the new text and reopen the figure exactly as it was otherwise
// (file types and columns picked by hand, camera, labels).
async function update() {
  const btn = $('lib-update'), context = staleContext, replacements = stale.slice();
  if (!context?.isCurrent() || !replacements.length) { hideNotice(); return; }
  btn.disabled = true; btn.textContent = 'Updating…';
  let loading = false;
  try {
    const l = await lib(); context.assertCurrent();
    const texts = await Promise.all(replacements.map((s) => l.text(s.file.path)));
    context.assertCurrent();
    const p = structuredClone(em().getProject());
    replacements.forEach((s, i) => {
      const file = p.files.find((f) => f.name === s.name);
      if (!file || p.settings.libRefs[s.name]?.libFileId !== s.file.id) throw changed();
      file.text = texts[i];
      file.geophysNumericPolicy = GEOPHYS_NUMERIC_POLICY;
      p.settings.libRefs[s.name] = { libFileId: s.file.id, version: s.file.version };
    });
    loading = true;
    await em().loadProject(p, { isCurrent: () => context.isCurrent({ source: false }) });
    context.assertCurrent({ source: false });
    host.say(`Updated to ${replacements.map((s) => `${s.file.name} v${s.file.version}`).join(', ')}. Save to keep it.`);
    stale = []; staleContext = null; hideNotice();
  } catch (err) {
    if (loading && context.isCurrent({ source: false }) && err?.code !== 'PROJECT_CHANGED' && err?.stateRestored !== true) host.pauseSaving();
    if (context.isCurrent({ source: !loading }) && err?.code !== 'PROJECT_CHANGED') host.say(`Could not update the data (${err.message}). ${!loading || err?.stateRestored === true ? 'The figure is unchanged.' : 'The previous figure could not be fully restored. Keep this tab open.'}`);
  } finally {
    btn.disabled = false; btn.textContent = 'Update';
  }
}
