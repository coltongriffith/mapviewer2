import { figureSignature, watchUnsavedFigure } from './save-state.js';
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
  publishVersion: lazy('publishVersion'), listVersions: lazy('listVersions'), openVersion: lazy('openVersion'), closeVersion: lazy('closeVersion'),
});
// Help text: <script id="account-help"> in the page, like the share links' below.
const ACCOUNT_HELP = `\n\n${$('account-help')?.textContent.trim() || ''}`;

// Share links: the Share button, EM3D.share and the read-only viewer at
// /3d/share/<id> and /3d/embed/<id>, all in share.js (loaded on first use, or
// at once for a shared figure). Help text: <script id="share-help">.
const viewing = /^\/3d\/(share|embed)(\/|$)/i.test(location.pathname);
let shareP = null;
const shareCore = () => (shareP ||= import('./share.js').then(async (m) => { await m.start(); return m; }).catch((err) => { shareP = null; throw err; }));
const via = (name) => (...args) => shareCore().then((m) => m[name](...args));
const share = Object.freeze({ create: via('create'), update: via('update'), revoke: via('revoke'), list: via('list'), open: via('openDialog') });
const SHARE_HELP = `\n\n${$('share-help')?.textContent.trim() || ''}`;

if (window.EM3D && $('acct-save')) {
  const base = window.EM3D;
  window.EM3D = Object.freeze({ ...base, help: () => base.help() + ACCOUNT_HELP + SHARE_HELP, account, share });
  const help = $('ai-help'); if (help) help.textContent = window.EM3D.help();
  window.addEventListener('em3d:change', (e) => {
    if (!baseline && e.detail.ready) {
      baseline = { ...base.getProject(), $files: base.filesDigest() };
      if (!viewing) watchUnsavedFigure({ initial: baseline, signature: (project = base.getProject()) => figureSignature(project, base.filesDigest()), note: $('acct-note') });
    }
  });
  if (viewing) shareCore().catch(failed);
  $('share-open')?.addEventListener('click', () => share.open().catch(failed));
}
if (window.EM3D && $('acct-save') && !viewing) {
  $('brand-kits-load')?.addEventListener('click', () => import('./brand-kits.js').then((m) => m.open()).catch(failed));
  $('acct-save').addEventListener('click', () => run((m) => m.save()));
  $('acct-maps').addEventListener('click', () => run((m) => m.toggleMenu()));
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 's') { e.preventDefault(); run((m) => m.save()); }
  });
  if (somethingToPickUp()) core().catch(() => { /* retried on the first click */ });
}
