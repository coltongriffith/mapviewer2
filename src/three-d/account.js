// Exploration Maps 3D: Save and My 3D maps, backed by the visitor's
// Exploration Maps account. This module is what the page loads up front and
// stays small: it wires the two buttons and Ctrl/Cmd+S, and exposes
// EM3D.account for agents. Everything else (Supabase, the dialog, the list,
// the work kept across a sign-in link) is in account-core.js, loaded on first
// use, or at start when there is something to pick up: a stored session, a
// sign-in link coming back, a figure waiting to be saved, or ?project=<id>.
const $ = (id) => document.getElementById(id);
let coreP = null;
// The figure as first shown (the sample, usually), so a later Open can tell
// whether there is work on screen to confirm before replacing it.
let baseline = null;
function core() {
  if (!coreP) {
    coreP = import('./account-core.js').then(async (m) => { await m.start({ baseline }); return m; })
      .catch((err) => { coreP = null; throw err; });
  }
  return coreP;
}
function failed() {
  const el = $('status');
  if (el) { el.textContent = 'Could not load account features. Check your connection and try again. Your figure is still here.'; el.style.opacity = '1'; }
}
const run = (fn) => core().then(fn, failed);

function somethingToPickUp() {
  if (/access_token=|error_description=/.test(location.hash) || /[?&](code|project)=/.test(location.search)) return true;
  try {
    if (localStorage.getItem('em3d.pendingSave.v1.flag') || localStorage.getItem('em3d.pendingSave.v1')) return true;
    for (let i = 0; i < localStorage.length; i++) if (/^sb-.+-auth-token$/.test(localStorage.key(i) || '')) return true;
  } catch { /* storage blocked: nothing to pick up */ }
  return false;
}

const lazy = (name) => (...args) => core().then((m) => m[name](...args));
const account = Object.freeze({
  getUser: lazy('getUser'), listProjects: lazy('listProjects'), saveProject: lazy('saveProject'),
  openProject: lazy('openProject'), deleteProject: lazy('deleteProject'), currentProject: lazy('currentProject'),
  sendSignInLink: lazy('sendSignInLink'), signInWithPassword: lazy('signInWithPassword'), signOut: lazy('signOut'),
});
const ACCOUNT_HELP = `

Exploration Maps account (all Promises; saving needs a signed-in visitor):
  EM3D.account.getUser()          { id, email } or null
  EM3D.account.listProjects()     [{ id, name, thumbnail, createdAt, updatedAt }]
  EM3D.account.saveProject(name, existingId?)   saves the figure; returns { id, name, savedAt }
  EM3D.account.openProject(id)    reopens a saved figure
  EM3D.account.deleteProject(id)  removes it from the list
The Save button (or Ctrl/Cmd+S) does the same for a person, and asks them to sign in first.`;

if (window.EM3D && $('acct-save')) {
  const base = window.EM3D;
  window.EM3D = Object.freeze({ ...base, help: () => base.help() + ACCOUNT_HELP, account });
  const help = $('ai-help'); if (help) help.textContent = window.EM3D.help();
  window.addEventListener('em3d:change', (e) => { if (!baseline) baseline = e.detail; });
  $('acct-save').addEventListener('click', () => run((m) => m.save()));
  $('acct-maps').addEventListener('click', () => run((m) => m.toggleMenu()));
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 's') { e.preventDefault(); run((m) => m.save()); }
  });
  if (somethingToPickUp()) core().catch(() => { /* retried on the first click */ });
}
