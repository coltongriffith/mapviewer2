// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';

const rpc = vi.fn();
vi.mock('../src/lib/supabase', () => ({ supabase: { rpc: (...a) => rpc(...a) } }));

const { stashSignupHandoff, handoffRedirectPath, captureHandoffToken, takePendingHandoff, claimSignupHandoff } = await import('../src/utils/signupHandoff.js');

const TOKEN = '0be0f3d7-150d-48b6-b764-800b16ea7d9b';
const map = { layers: [{ id: 'claims' }], layout: { title: 'Zamida claim' } };

// Production, 24 Nov 2026: a visitor signed up from the export gate, the link
// opened in another browser, and the account started empty. The map now
// travels with the link.
describe('signup map handoff', () => {
  beforeEach(() => { rpc.mockReset(); localStorage.clear(); sessionStorage.clear(); });

  it('puts the stashed map token in the sign-in link', async () => {
    rpc.mockResolvedValue({ data: TOKEN, error: null });
    const token = await stashSignupHandoff({ email: 'a@b.co', payload: map, projectName: 'Zamida claim' });
    expect(rpc).toHaveBeenCalledWith('stash_signup_handoff', expect.objectContaining({ p_email: 'a@b.co', p_payload: map }));
    expect(handoffRedirectPath(token)).toBe(`/?intent=resume&handoff=${TOKEN}`);
  });

  it('sends a plain link when there is no map or the stash fails', async () => {
    expect(await stashSignupHandoff({ email: 'a@b.co', payload: { layers: [] } })).toBeNull();
    expect(rpc).not.toHaveBeenCalled();
    rpc.mockResolvedValue({ data: null, error: { message: 'try again later' } });
    expect(await stashSignupHandoff({ email: 'a@b.co', payload: map })).toBeNull();
    expect(handoffRedirectPath(null)).toBe('/?intent=resume');
  });

  it('imports only when the link opens in a different browser', async () => {
    rpc.mockResolvedValue({ data: TOKEN, error: null });
    await stashSignupHandoff({ email: 'a@b.co', payload: map });
    captureHandoffToken(new URLSearchParams(`intent=resume&handoff=${TOKEN}`));
    expect(takePendingHandoff()).toEqual({ token: TOKEN, sameBrowser: true });
    expect(takePendingHandoff()).toBeNull();

    localStorage.clear();
    captureHandoffToken(new URLSearchParams(`handoff=${TOKEN}`));
    expect(takePendingHandoff()).toEqual({ token: TOKEN, sameBrowser: false });
  });

  it('ignores a token that is not a uuid', () => {
    captureHandoffToken(new URLSearchParams("handoff=x');drop"));
    expect(takePendingHandoff()).toBeNull();
  });

  it('returns the claimed map, or null when the account may not have it', async () => {
    rpc.mockResolvedValue({ data: { payload: map, project_name: 'Zamida claim', extras: { fullResPx: 2666 } }, error: null });
    expect(await claimSignupHandoff(TOKEN)).toEqual({ payload: map, projectName: 'Zamida claim', extras: { fullResPx: 2666 } });
    rpc.mockResolvedValue({ data: null, error: null });
    expect(await claimSignupHandoff(TOKEN)).toBeNull();
  });
});
