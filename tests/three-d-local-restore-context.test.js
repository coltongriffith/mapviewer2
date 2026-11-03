import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const nonce = 'a1'.repeat(16);
const load = () => import('../src/three-d/local-restore-context.js');
beforeEach(() => { vi.resetModules(); history.replaceState(null, '', '/3d/'); });
afterEach(() => { vi.restoreAllMocks(); history.replaceState(null, '', '/'); });

describe('immutable local restore document intent', () => {
  it('captures and removes the nonce, remaining isolated after address cleanup', async () => {
    history.replaceState(null, '', `/3d/#local-restore=${nonce}`);
    const context = await load();
    expect(context.localRestoreBoot).toBe(true);
    expect(context.localRestoreNonce).toBe(nonce);
    expect(location.hash).toBe('');
    expect(context.isLocalRestoreReady()).toBe(false);
    expect(context.markLocalRestoreReady()).toBe(true);
    expect(context.isLocalRestoreReady()).toBe(true);
    history.replaceState(null, '', '/3d?project=another');
    expect(context.localRestoreBoot).toBe(true);
  });

  it.each([
    '/3d/#local-restore', '/3d/#local-restore=bad', '/3d/?local-restore=bad',
    `/3d/?project=saved&version=2#local-restore=${nonce}`,
    `/3d/?property=private#local-restore=${nonce}`,
    `/3d/#local-restore=${nonce}&access_token=secret`,
    `/3d/#local-restore=${nonce}&local-restore=${nonce}`,
    `/3d/share/other#local-restore=${nonce}`,
  ])('fails closed without allowing normal account boot: %s', async (url) => {
    history.replaceState(null, '', url);
    const context = await load();
    expect(context.localRestoreBoot).toBe(true);
    expect(context.localRestoreNonce).toBeNull();
    expect(context.markLocalRestoreReady()).toBe(false);
    expect(context.isLocalRestoreReady()).toBe(false);
    expect(location.hash).toBe(''); expect(location.search).toBe('');
  });

  it('does not alter an ordinary saved figure URL or enable readiness', async () => {
    history.replaceState(null, '', '/3d?project=saved&version=2');
    const context = await load();
    expect(context.localRestoreBoot).toBe(false);
    expect(context.localRestoreNonce).toBeNull();
    expect(context.markLocalRestoreReady()).toBe(false);
    expect(location.search).toBe('?project=saved&version=2');
  });
});
