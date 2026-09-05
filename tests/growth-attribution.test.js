import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';

const script = fs.readFileSync('public/acquisition.js', 'utf8');
const boot = () => window.eval(script);
beforeEach(() => {
  localStorage.clear(); sessionStorage.clear(); delete window.emAcquisition;
  document.body.innerHTML = '<div id="root"></div>';
  window.history.replaceState({}, '', '/');
  Object.defineProperty(document, 'referrer', { configurable: true, value: '' });
});
afterEach(() => { vi.restoreAllMocks(); });

describe('acquisition across the static site, app, and email', () => {
  it('keeps the first external source through an internal CTA and a new tab', () => {
    window.history.replaceState({}, '', '/blog/example/?utm_source=google&utm_medium=cpc&gclid=click-123');
    boot();
    const first = window.emAcquisition.get();
    expect(first.gclid).toBe('click-123');
    sessionStorage.clear(); delete window.emAcquisition;
    window.history.replaceState({}, '', '/?utm_source=blog&utm_campaign=example');
    boot();
    expect(window.emAcquisition.get()).toEqual(first);
  });
  it('expires attribution and strips unknown metadata fields', () => {
    localStorage.setItem('em_acquisition_v2', JSON.stringify({ expires: 1, data: { utm_source: 'old' } }));
    window.history.replaceState({}, '', '/?utm_source=partner'); boot();
    expect(window.emAcquisition.get().utm_source).toBe('partner');
    expect(window.emAcquisition.clean({ email: 'private@example.com', utm_source: 'partner' })).toEqual({ utm_source: 'partner' });
  });
  it('confirms a delayed signup and retries tracking after failure', async () => {
    boot();
    const { recordSignupOnce } = await import('../src/utils/attribution');
    const user = { id: 'delayed-user', created_at: '2026-07-01', user_metadata: { em_acquisition: { utm_source: 'partner' } } };
    const send = vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true);
    await recordSignupOnce(user, send);
    await recordSignupOnce(user, send);
    await recordSignupOnce(user, send);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenLastCalledWith('signup_completed', { utm_source: 'partner' });
  });
});
