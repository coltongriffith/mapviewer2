// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { beginRun } from '../api/_lib/agent/maps.js';
import { isOAuthClientToken } from '../api/_lib/agent/keys.js';

// docs/state-machines.md, WS-2 and WS-3.
function runsDb(row) {
  const db = { row: { ...row }, takeovers: 0 };
  db.sb = { from: () => {
    let update = null; const filters = [];
    const api = {
      select: () => api,
      update: (v) => { update = v; return api; },
      eq: (k, v) => { filters.push([k, v]); return api; },
      insert: () => api,
      maybeSingle: async () => {
        // Simulate two concurrent requests: both read before either writes.
        await Promise.resolve();
        if (!update) return { data: { ...db.row } };
        const matches = filters.every(([k, v]) => k === 'api_key_id' || k === 'idempotency_key' || db.row[k] === v);
        if (!matches) return { data: null, error: null };
        Object.assign(db.row, update);
        db.takeovers += 1;
        return { data: { ...db.row }, error: null };
      },
      single: async () => ({ data: null, error: { code: 'X' } }),
    };
    return api;
  } };
  return db;
}
const auth = { apiKey: { id: 'k1', userId: 'u1' } };

describe('agent run idempotency (WS-3)', () => {
  it('two concurrent retries of a failed run: only one takes it over', async () => {
    const db = runsDb({ id: 'r1', status: 'failed', created_at: '2026-11-06T10:00:00.000Z' });
    const [a, b] = await Promise.all([beginRun(db.sb, auth, 'idem', 'test'), beginRun(db.sb, auth, 'idem', 'test')]);
    expect(db.takeovers).toBe(1);
    expect([a.inProgress, b.inProgress].filter(Boolean)).toHaveLength(1);
  });

  it('a taken-over run gets a fresh start time, so it is not stale to the next retry', async () => {
    const db = runsDb({ id: 'r1', status: 'started', created_at: '2026-01-01T00:00:00.000Z' });
    const first = await beginRun(db.sb, auth, 'idem', 'test');
    expect(first.inProgress).toBeUndefined();
    expect(Date.now() - Date.parse(db.row.created_at)).toBeLessThan(60_000);
    expect((await beginRun(db.sb, auth, 'idem', 'test')).inProgress).toBe(true);
  });
});

describe('API key creation from connected apps (WS-2)', () => {
  const jwt = (claims) => `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.s`;
  it('recognises a token issued to an OAuth client', () => {
    expect(isOAuthClientToken({ headers: { authorization: `Bearer ${jwt({ sub: 'u1', client_id: 'mcp-client' })}` } })).toBe(true);
    expect(isOAuthClientToken({ headers: { authorization: `Bearer ${jwt({ sub: 'u1', session_id: 's' })}` } })).toBe(false);
    expect(isOAuthClientToken({ headers: { authorization: 'Bearer not-a-jwt' } })).toBe(false);
  });
});
