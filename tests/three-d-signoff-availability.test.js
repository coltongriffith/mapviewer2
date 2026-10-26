import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { waitFor } from '@testing-library/dom';

let versions, signoffResult, sb, host, row;
beforeEach(async () => {
  vi.resetModules();
  document.body.innerHTML = '<div class="toolbar"></div>';
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
  row = { id: 'v-id', figure_id: 'fig-1', version: 2, label: 'Published results', name: 'Rails',
    content_hash: 'a'.repeat(64), created_at: '2026-10-21T10:00:00Z',
    snapshot: { kind: 'figure', settings: { files: [], settings: { title: 'Original title' } } } };
  signoffResult = () => Promise.reject(new TypeError('Failed to fetch'));
  sb = {
    rpc: vi.fn(async () => ({ data: [row] })),
    from: vi.fn((table) => {
      const q = { select: () => q, in: () => q, eq: () => q,
        is: () => signoffResult(), maybeSingle: async () => ({ data: row }) };
      if (table !== 'figure_versions' && table !== 'figure_version_signoffs') throw new Error(`Unexpected table ${table}`);
      return q;
    }),
  };
  host = { client: async () => sb, current: () => ({ id: 'fig-1', name: 'Rails' }),
    dirty: () => false, frozen: () => null, canPublish: () => true, setFrozen: vi.fn(), say: vi.fn() };
  window.EM3D = { getProject: () => ({ settings: {} }), loadProject: vi.fn(async () => {}),
    getState: () => ({ view: 'plan' }), exportPNG: vi.fn(async () => 'data:image/png;base64,') };
  versions = await import('../src/three-d/versions.js');
  versions.init(host);
});
afterEach(() => {
  vi.restoreAllMocks();
  delete HTMLDialogElement.prototype.showModal;
  delete HTMLDialogElement.prototype.close;
  document.documentElement.classList.remove('em3d-version');
  document.body.innerHTML = '';
  delete window.EM3D;
});

it.each(['rejected request', 'permission error'])('keeps published versions and their identity after a sign-off %s', async (failure) => {
  if (failure === 'permission error') signoffResult = async () => ({ error: { code: '42501', message: 'permission denied' } });
  const listed = await versions.list();
  expect(listed).toHaveLength(1);
  expect(listed[0]).toMatchObject({ id: row.id, version: row.version, contentHash: row.content_hash, signoffUnavailable: true });
  expect(listed[0].signoff).toBeUndefined(); // unknown is not a verified absence of a signature
  expect(listed.signoffs).toBe(false);
  expect(listed.signoffError).toMatch(/status could not be loaded/);
});

it('shows unavailable status, keeps Open/Copy link, and recovers sign-off controls only after a successful retry', async () => {
  await versions.openDialog();
  const dialog = document.getElementById('ver-dialog');
  expect(dialog.textContent).toContain('Published results');
  expect(dialog.textContent).toMatch(/QP sign-off status could not be loaded/);
  expect(dialog.textContent).not.toMatch(/not available on this site yet/);
  expect(dialog.querySelector('[data-ver="2"]')).not.toBeNull();
  expect(dialog.querySelector('[data-link="2"]')).not.toBeNull();
  expect(dialog.querySelector('[data-sign], [data-so]')).toBeNull();
  signoffResult = async () => ({ data: [{ id: 's1', version_id: row.id, qp_name: 'A. Person', qp_credentials: 'P.Geo.', signed_on: '2026-10-21' }] });
  dialog.querySelector('[data-refresh]').click();
  await waitFor(() => expect(dialog.textContent).toContain('Signed off by A. Person'));
  expect(dialog.querySelector('[data-sign="2"]').textContent).toBe('Retract sign-off');
  expect(dialog.textContent).not.toContain('status could not be loaded');
  // A later failed read must not reuse a previously verified sign-off.
  signoffResult = async () => { throw new TypeError('Failed to fetch'); };
  await versions.openDialog();
  expect(dialog.textContent).not.toContain('Signed off by');
  expect(dialog.querySelector('[data-sign], [data-so]')).toBeNull();
});

it('opens the original snapshot and downloads its ordinary PNG with unknown sign-off status', async () => {
  await versions.openDialog();
  document.querySelector('[data-ver="2"]').click();
  await waitFor(() => expect(document.getElementById('ver-banner')).not.toBeNull());
  expect(window.EM3D.loadProject).toHaveBeenCalledWith(row.snapshot.settings);
  expect(host.setFrozen).toHaveBeenCalledWith(expect.objectContaining({ id: row.id, version: 2, signoffUnavailable: true }));
  expect(document.getElementById('ver-banner').textContent).toMatch(/QP sign-off status could not be loaded/);
  expect(document.getElementById('ver-inc-signoff')).toBeNull();
  [...document.querySelectorAll('#ver-bar button')].find((b) => b.textContent === 'Download PNG').click();
  await waitFor(() => expect(window.EM3D.exportPNG).toHaveBeenCalledWith({ view: 'plan', download: true }));
  expect(host.say).not.toHaveBeenCalled();
});

it('keeps a base version-list failure actionable instead of treating it as an optional lookup failure', async () => {
  sb.rpc.mockResolvedValue({ error: { message: 'database unavailable' } });
  await expect(versions.list()).rejects.toThrow(/load the published versions/);
  expect(sb.from).not.toHaveBeenCalled();
});
