import { describe, it, expect, vi, beforeEach } from 'vitest';

// /3d's usage events (src/three-d/track.js): the app's /api/track sender with the token read from storage, the
// allowlist, once-per-tab events, and never a throw.
const fetchMock = vi.fn(() => Promise.resolve({ ok: true, status: 204 }));
vi.stubGlobal('fetch', fetchMock);
const { track, storedToken, EVENTS } = await import('../src/three-d/track.js');
const bodies = () => fetchMock.mock.calls.map(([url, o]) => ({ url, auth: o.headers.Authorization, ...JSON.parse(o.body) }));
const session = (exp) => JSON.stringify({ access_token: 'tok-123', expires_at: exp, user: { id: 'u1' } });

beforeEach(() => { fetchMock.mockClear(); localStorage.clear(); sessionStorage.clear(); });

describe('3D usage events', () => {
  it('posts an allowlisted event to /api/track with the tab session id', async () => {
    expect(await track('three_d_export_completed', { kind: 'png' })).toBe(true);
    const [b] = bodies();
    expect(b).toMatchObject({ url: '/api/track', kind: 'event', event: 'three_d_export_completed', props: { kind: 'png' } });
    expect(b.session_id).toBe(sessionStorage.getItem('em_live_sid'));
    expect(b.auth).toBeUndefined();
  });

  it('drops names the server would refuse, like the gtag-only share events', async () => {
    expect(await track('three_d_share_updated')).toBe(false);
    expect(await track('three_d_share_download')).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    expect([...EVENTS]).toContain('three_d_share_forked');
  });

  it('sends a signed-in visitor\'s stored token, and not an expired one', async () => {
    localStorage.setItem('sb-example-auth-token', session(Math.floor(Date.now() / 1000) + 3600));
    expect(storedToken()).toBe('tok-123');
    await track('three_d_project_saved', { project: 'p1' });
    expect(bodies()[0].auth).toBe('Bearer tok-123');
    localStorage.setItem('sb-example-auth-token', session(Math.floor(Date.now() / 1000) - 60));
    expect(storedToken()).toBeNull();
    localStorage.setItem('sb-example-auth-token', '{not json');
    expect(storedToken()).toBeNull();
  });

  it('sends a deduped event once per tab (kept in sessionStorage, so a reload does not repeat it)', async () => {
    await track('three_d_opened', { entry: 'new' }, 'tab');
    await track('three_d_opened', { entry: 'new' }, 'tab');
    await track('three_d_data_added', { kind: 'collar' }, 'collar');
    await track('three_d_data_added', { kind: 'assay' }, 'assay');
    await track('three_d_data_added', { kind: 'collar' }, 'collar');
    expect(bodies().map((b) => [b.event, b.props?.kind ?? b.props?.entry])).toEqual([
      ['three_d_opened', 'new'], ['three_d_data_added', 'collar'], ['three_d_data_added', 'assay'],
    ]);
    expect(sessionStorage.getItem('em3d_track:three_d_opened:tab')).toBe('1');
  });

  it('never throws or rejects when the network or storage fails', async () => {
    fetchMock.mockImplementationOnce(() => Promise.reject(new Error('offline')));
    await expect(track('three_d_share_viewed', { embed: false })).resolves.toBe(false);
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    try {
      expect(storedToken()).toBeNull();
      await expect(track('three_d_share_created', { signed_in: false })).resolves.toBeTypeOf('boolean');
    } finally { get.mockRestore(); }
  });
});
