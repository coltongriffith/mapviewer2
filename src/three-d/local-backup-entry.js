// Local file handling stays lazy; restore context is captured before account boot.
import { localRestoreBoot } from './local-restore-context.js';
import { canUseLocalBackup } from './local-backup-access.js';

const flow = () => import('./local-backup.js');
const fail = () => {
  const status = document.getElementById('status');
  if (status) status.textContent = 'Could not open project backups. Your current figure is unchanged.';
};
function bindActions() {
  const sync = () => {
    const allowed = canUseLocalBackup();
    for (const id of ['backup-download', 'backup-restore']) {
      const button = document.getElementById(id); if (button) { button.hidden = !allowed; button.disabled = !allowed; }
    }
    return allowed;
  };
  sync();
  new MutationObserver(sync).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  window.addEventListener('popstate', sync);
  window.addEventListener('em3d:account-context', sync);
  document.getElementById('backup-download')?.addEventListener('click', () => { if (sync()) flow().then((m) => m.downloadLocalBackup()).catch(fail); });
  const picker = document.getElementById('backup-file');
  document.getElementById('backup-restore')?.addEventListener('click', () => { if (sync()) picker?.click(); });
  picker?.addEventListener('change', () => {
    const file = picker.files?.[0]; picker.value = '';
    if (file && sync()) flow().then((m) => m.reviewLocalBackup(file)).catch(fail);
  });
}
if (localRestoreBoot) {
  const protectedNodes = [...document.body.children].filter((el) => !['SCRIPT', 'DIALOG'].includes(el.tagName));
  protectedNodes.forEach((el) => { el.inert = true; });
  const block = (event) => { event.preventDefault(); event.stopImmediatePropagation(); };
  ['keydown', 'drop', 'dragover'].forEach((type) => document.addEventListener(type, block, true));
  flow().then((m) => m.receiveLocalRestore(() => {
    protectedNodes.forEach((el) => { el.inert = false; });
    ['keydown', 'drop', 'dragover'].forEach((type) => document.removeEventListener(type, block, true));
    bindActions();
  })).catch(fail);
} else {
  bindActions();
}
