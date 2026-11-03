import { decodeBackup, encodeBackup, MAX_BACKUP_BYTES } from './local-backup-codec.js';
import { localRestoreBoot, localRestoreNonce, markLocalRestoreReady } from './local-restore-context.js';
import { downloadBlob } from '../utils/svg.js';
import { canUseLocalBackup } from './local-backup-access.js';

const WAIT = 90000;
const READY = 'emap-local-backup-ready';
const BIND = 'emap-local-backup-bind';
const fixedError = 'This backup could not be opened. Close this tab and try restoring it again. Your original figure is unchanged.';
const readOnlyMessage = 'Project backups are available in an editable figure, not this read-only view.';
const status = (text) => {
  const el = document.getElementById('status'); if (el) el.textContent = text;
  const error = document.getElementById('backup-error');
  if (document.getElementById('backup-dialog')?.open && error) { error.hidden = false; error.textContent = text; }
};
const nonceOf = (crypto) => [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');
const dependencyText = (dependencies = {}) => {
  const labels = { dem: 'Real terrain', imagery: 'Satellite imagery', insetTiles: 'Map inset', font: 'Fonts' };
  const external = [...new Set((dependencies.externalDependencies || []).map((d) => labels[d.kind]).filter(Boolean))];
  return [external.length ? `${external.join(', ')} may need a connection when reopened.` : '', dependencies.sourceReferences?.length ? 'Source references do not grant account access.' : ''].filter(Boolean).join(' ');
};

// Window messages carry only the one-shot handshake. File bytes use a private port.
export function openRestoreWindow({ bytes, isCurrent, onStatus = status, win = window, Channel = MessageChannel, timeout = WAIT }) {
  if (!canUseLocalBackup(win.location, win.document?.documentElement)) { onStatus(readOnlyMessage); return null; }
  let nonce;
  try { nonce = nonceOf(win.crypto); } catch { onStatus('A new restore request could not be created. Your current figure is unchanged.'); return null; }
  const origin = win.location.origin;
  let child, port, otherPort, timer, check, phase = 'waiting', done = false;
  const clean = () => { win.removeEventListener('message', ready); win.clearTimeout(timer); win.clearInterval(check); port?.close(); otherPort?.close(); };
  const stop = (message) => { if (done) return; done = true; clean(); try { child?.close(); } catch { /* already closed */ } onStatus(message); };
  const ready = (event) => {
    if (phase !== 'waiting' || done || event.origin !== origin || event.source !== child || event.data?.type !== READY || event.data?.nonce !== nonce) return;
    if (!isCurrent() || !canUseLocalBackup(win.location, win.document?.documentElement)) { stop('The current figure changed. Choose the backup again to restore it.'); return; }
    phase = 'binding'; win.removeEventListener('message', ready);
    try {
    const channel = new Channel(); port = channel.port1; otherPort = channel.port2;
    port.onmessage = (e) => {
      if (done) return;
      if (!isCurrent() || !canUseLocalBackup(win.location, win.document?.documentElement)) { stop('The current figure changed. Choose the backup again to restore it.'); return; }
      if (e.data?.type === 'bound' && phase === 'binding') {
        phase = 'sending';
        try {
          const copy = bytes.slice();
          port.postMessage({ type: 'backup', bytes: copy }, [copy.buffer]);
          phase = 'sent';
        } catch { stop('The backup could not be transferred. Your current figure is unchanged.'); }
      } else if (e.data?.type === 'opened' && phase === 'sent') {
        done = true; clean(); onStatus('Backup opened as a new figure in another tab. This figure is unchanged.');
      } else if (e.data?.type === 'failed' && phase === 'sent') stop('The backup could not be opened. Your current figure is unchanged.');
    };
    port.start?.();
    child.postMessage({ type: BIND, nonce }, origin, [channel.port2]);
    otherPort = null; // ownership transferred to the child
    } catch { stop('The backup could not be transferred. Your current figure is unchanged.'); }
  };
  win.addEventListener('message', ready);
  try { child = win.open(`/3d/#local-restore=${nonce}`, '_blank'); }
  catch { stop('A new tab could not be opened. Your current figure is unchanged.'); return null; }
  if (!child) { clean(); onStatus('Allow a new tab, then choose Open as new figure again.'); return null; }
  timer = win.setTimeout(() => stop('The restore request expired. Choose the backup again to retry.'), timeout);
  check = win.setInterval(() => { if (child.closed || !isCurrent()) stop('Restore cancelled. Your current figure is unchanged.'); }, 250);
  return { close: () => stop('Restore cancelled. Your current figure is unchanged.') };
}

export async function downloadLocalBackup() {
  if (!canUseLocalBackup()) { status(readOnlyMessage); return; }
  try {
    const E = window.EM3D, project = E.getProject();
    const result = await encodeBackup(project, { name: project.settings?.title || '3D figure', producerRevision: typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'local' });
    if (!canUseLocalBackup()) { status(readOnlyMessage); return; }
    await downloadBlob(result.filename, new Blob([result.bytes], { type: 'application/json' }));
    status(['Project backup downloaded. It contains private project data.', dependencyText(result.summary?.dependencies)].filter(Boolean).join(' '));
  } catch { status('This figure could not be backed up. Check that its images and size are supported. Your figure is unchanged.'); }
}

let reviewToken = 0;
let contextEpoch = 0;
for (const type of ['em3d:figure-loading', 'em3d:account-context']) window.addEventListener(type, () => { contextEpoch++; });
function returnBackupFocus() {
  const visible = (el) => {
    if (!el?.isConnected || el.disabled || el.closest('[hidden],[inert]')) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
  };
  [document.getElementById('backup-restore'), document.getElementById('acct-maps')].find(visible)?.focus();
}
const fingerprint = (E) => {
  const p = E.getProject();
  return JSON.stringify({ settings: p.settings, camera: p.camera, usingSample: p.usingSample, secSet: p.secSet,
    files: p.files.map(({ name, text, role, cols, geophysNumericPolicy }) => {
      // The public editor caches its text digests. Small test/host adapters may
      // not expose it, so retain a non-allocating fallback rather than raw JSON.
      let hash = 0x811c9dc5;
      if (!E.filesDigest) for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193);
      return { name, length: text.length, hash: E.filesDigest ? undefined : hash, role, cols, geophysNumericPolicy };
    }), digest: E.filesDigest?.() });
};
export async function reviewLocalBackup(file) {
  if (!canUseLocalBackup()) { status(readOnlyMessage); return; }
  const token = ++reviewToken, epoch = contextEpoch, href = location.href;
  const current = () => token === reviewToken && epoch === contextEpoch && href === location.href && canUseLocalBackup();
  try {
    if (!Number.isSafeInteger(file.size) || file.size <= 0 || file.size > MAX_BACKUP_BYTES) throw new Error('size');
    const E = window.EM3D, original = fingerprint(E);
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.byteLength !== file.size || bytes.byteLength > MAX_BACKUP_BYTES) throw new Error('size');
    const decoded = await decodeBackup(bytes);
    if (!current()) { status('The current figure changed. Choose the backup again to restore it.'); return; }
    const dialog = document.getElementById('backup-dialog'), name = document.getElementById('backup-name');
    document.getElementById('backup-error').hidden = true;
    name.textContent = decoded.name;
    const dependencies = document.getElementById('backup-dependencies');
    dependencies.textContent = dependencyText(decoded.dependencies); dependencies.hidden = !dependencies.textContent;
    const button = document.getElementById('backup-open');
    button.onclick = () => {
      if (!current() || fingerprint(E) !== original) { dialog.close(); status('The current figure changed. Choose the backup again to restore it.'); return; }
      const transfer = openRestoreWindow({ bytes, isCurrent: current });
      if (transfer) dialog.close();
    };
    dialog.addEventListener('close', () => { button.onclick = null; if (current()) returnBackupFocus(); }, { once: true });
    dialog.showModal();
  } catch { status('This file is not a supported project backup. Your current figure is unchanged.'); if (current()) returnBackupFocus(); }
}

export function receiveLocalRestore(onReady, { win = window, decode = decodeBackup, timeout = WAIT } = {}) {
  if (!localRestoreBoot || !localRestoreNonce || !win.opener) { status(fixedError); return; }
  const opener = win.opener, origin = win.location.origin, nonce = localRestoreNonce;
  let port, used = false, finished = false;
  const fail = () => {
    if (finished) return; finished = true; win.clearTimeout(timer); win.removeEventListener('message', bind);
    try { port?.postMessage({ type: 'failed' }); } catch { /* the source may have closed */ }
    port?.close(); status(fixedError);
  };
  const bind = (event) => {
    if (used || event.origin !== origin || event.source !== opener || event.data?.type !== BIND || event.data?.nonce !== nonce || event.ports?.length !== 1) return;
    used = true; win.removeEventListener('message', bind); port = event.ports[0];
    try { win.opener = null; } catch { /* binding still checks the original opener */ }
    let received = false;
    port.onmessage = async (e) => {
      if (received || finished) return;
      received = true;
      try {
        if (e.data?.type !== 'backup' || !(e.data.bytes instanceof Uint8Array) || e.data.bytes.byteLength > MAX_BACKUP_BYTES) throw new Error('payload');
        const { project } = await decode(e.data.bytes);
        const started = Date.now();
        while (!win.EM3D?.loadProject || !win.EM3D?.getState?.().ready) {
          if (finished || Date.now() - started > 20000) throw new Error('editor');
          await new Promise((resolve) => win.setTimeout(resolve, 50));
        }
        if (finished) return;
        await win.EM3D.loadProject(project);
        await win.EM3D.layersReady?.();
        if (finished) return;
        markLocalRestoreReady(); finished = true; win.clearTimeout(timer);
        onReady(); status('Backup opened as a new unsaved figure.'); port.postMessage({ type: 'opened' }); port.close();
      } catch { fail(); }
    };
    try { port.start?.(); port.postMessage({ type: 'bound' }); } catch { fail(); }
  };
  const timer = win.setTimeout(fail, timeout);
  win.addEventListener('message', bind);
  try { opener.postMessage({ type: READY, nonce }, origin); } catch { fail(); }
}
