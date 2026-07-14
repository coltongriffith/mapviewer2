import { describe, it, expect, vi, beforeEach } from 'vitest';

// Capture the outgoing /api/track posts by stubbing fetch.
const fetchMock = vi.fn(() => Promise.resolve({ ok: true, status: 204 }));
vi.stubGlobal('fetch', fetchMock);

// Supabase getSession is called inside post() to attach a token — stub it away.
vi.mock('../src/lib/supabase', () => ({
  supabase: { auth: { getSession: () => Promise.resolve({ data: { session: null } }) } },
}));
vi.mock('../src/utils/session', () => ({ getSessionId: () => 'sess_test_123' }));

import { trackEvent, trackEventOnce } from '../src/utils/track';

function bodiesFor() {
  return fetchMock.mock.calls.map(([, opts]) => JSON.parse(opts.body));
}

beforeEach(() => { fetchMock.mockClear(); });

describe('trackEventOnce', () => {
  it('fires once per (event, dedupeKey) within the module-session', async () => {
    trackEventOnce('project_saved', 'proj-1', { project_id: 'proj-1' });
    trackEventOnce('project_saved', 'proj-1', { project_id: 'proj-1' });
    trackEventOnce('project_saved', 'proj-1', { project_id: 'proj-1' });
    await Promise.resolve();
    const saves = bodiesFor().filter((b) => b.event === 'project_saved');
    expect(saves).toHaveLength(1);
  });

  it('distinct dedupe keys fire independently', async () => {
    trackEventOnce('element_added', 'callout', { type: 'callout' });
    trackEventOnce('element_added', 'marker', { type: 'marker' });
    trackEventOnce('element_added', 'callout', { type: 'callout' }); // dup
    await Promise.resolve();
    const els = bodiesFor().filter((b) => b.event === 'element_added');
    expect(els.map((e) => e.props.type).sort()).toEqual(['callout', 'marker']);
  });

  it('no-ops on an empty event name', async () => {
    trackEventOnce('', 'x');
    await Promise.resolve();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('trackEvent', () => {
  it('posts a well-formed event body with the session id', async () => {
    trackEvent('export_failed', { format: 'pdf', message: 'boom' });
    await Promise.resolve();
    const body = bodiesFor().at(-1);
    expect(body).toMatchObject({ kind: 'event', event: 'export_failed', session_id: 'sess_test_123' });
    expect(body.props).toEqual({ format: 'pdf', message: 'boom' });
  });

  it('no-ops on an empty event name', async () => {
    trackEvent('');
    await Promise.resolve();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
