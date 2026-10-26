import { describe, it, expect } from 'vitest';
import { releasePackDb } from '../src/utils/releasePackDb.js';
import { packSourceKey } from '../shared/releasePack.js';

function client(rows, error = null) {
  const calls = [];
  return { calls, from() {
    let cursor = null, cap;
    const q = { select: () => q, eq: () => q, is: () => q, order: () => q,
      limit(n) { cap = n; return q; }, gt(k, value) { cursor = value; return q; },
      then(resolve) { calls.push(cursor); return Promise.resolve({ data: rows.filter(r => !cursor || r.id > cursor).slice(0, cap), error }).then(resolve); } };
    return q;
  } };
}
const batch = i => ({ id: String(i).padStart(6, '0'), kind: 'assays', summary: {}, rolled_back_at: null });
describe('complete release-pack import snapshot', () => {
  it('reads beyond 50 and beyond a REST page with bounded keyset requests', async () => {
    const rows = Array.from({ length: 1207 }, (_, i) => batch(i + 1));
    const sb = client(rows);
    expect(await releasePackDb(sb).liveBatches('p')).toEqual(rows);
    expect(sb.calls).toEqual([null, '000500', '001000']);
  });
  it('fails closed on query errors and excessive history', async () => {
    await expect(releasePackDb(client([], { message: 'network unavailable' })).liveBatches('p')).rejects.toThrow('network unavailable');
    await expect(releasePackDb(client(Array.from({ length: 20001 }, (_, i) => batch(i + 1)))).liveBatches('p')).rejects.toThrow('too many imports');
  });
  it('rejects a repeated cursor instead of looping or approving duplicate identities', async () => {
    const sb = client(Array.from({ length: 500 }, () => batch(1)));
    await expect(releasePackDb(sb).liveBatches('p')).rejects.toThrow('complete import history');
    expect(sb.calls).toHaveLength(1);
  });
});
describe('source snapshot identity', () => {
  const data = { pack: { id: 'p', items: [{ kind: 'figure_3d', ref: 'f' }, { kind: 'results_table', ref: 'Default' }] }, approvals: [{ id: 'a' }],
    batches: [batch(1), batch(2)], approvedBatches: [batch(1)], figures: { f: { versionId: 'v1', savedAt: 'yesterday' } }, recipes: { Default: { id: 'r1' } } };
  it('ignores batch order but detects older rollback, recipe, figure-save, pack and approval changes', () => {
    expect(packSourceKey({ ...data, batches: [...data.batches].reverse() })).toBe(packSourceKey(data));
    for (const patch of [
      { batches: [batch(2)] }, { approvedBatches: [{ ...batch(1), rolled_back_at: 'now' }] },
      { recipes: { Default: { id: 'r2' } } }, { figures: { f: { versionId: 'v1', savedAt: 'now' } } },
      { pack: { ...data.pack, items: data.pack.items.slice(0, 1) } }, { approvals: [{ id: 'a2' }] },
    ]) expect(packSourceKey({ ...data, ...patch })).not.toBe(packSourceKey(data));
  });
});
