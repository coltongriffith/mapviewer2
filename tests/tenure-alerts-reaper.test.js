import { describe, it, expect } from 'vitest';
import { reapStuckSends } from '../scripts/tenure-alerts/run.mjs';

// docs/state-machines.md, TEN-10: an alert left in 'sending' is retired as
// failed after an hour, never sent back to pending (it may have been sent).
describe('reapStuckSends', () => {
  it('moves rows stuck in sending for over an hour to failed', async () => {
    const now = new Date('2026-11-06T12:00:00Z');
    let update, filters = [];
    const sb = { from: () => {
      const api = {
        update: (v) => { update = v; return api; },
        eq: (k, v) => { filters.push(['eq', k, v]); return api; },
        lt: (k, v) => { filters.push(['lt', k, v]); return api; },
        select: async () => ({ data: [{ id: 'a1' }], error: null }),
      };
      return api;
    } };
    expect(await reapStuckSends(sb, now)).toBe(1);
    expect(update.status).toBe('failed');
    expect(filters).toContainEqual(['eq', 'status', 'sending']);
    expect(filters).toContainEqual(['lt', 'last_attempt_at', '2026-11-06T11:00:00.000Z']);
  });
});
