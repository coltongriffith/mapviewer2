import { describe, it, expect, vi } from 'vitest';
import { importQaqc, rollbackQaqc } from '../src/utils/drillQaqcDb.js';

describe('QA/QC client', () => {
  it('preserves lab IDs, raw below-detection text, units and provenance without conversion', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { ok: true } });
    const rows = [{ sample_id: '00012', values: { Au: null }, bdl: { Au: 0.005 }, units: { Au: 'g/t' }, raw_values: { Au: '<0.005' } }];
    expect(await importQaqc({ rpc }, 'property', 'samples', rows, { provenance: { filename: 'lab.csv' } })).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith('drill_qaqc_import', {
      p_property: 'property', p_kind: 'samples', p_rows: rows,
      p_provenance: { filename: 'lab.csv' }, p_dry_run: true, p_batch: null,
    });
    await expect(importQaqc({ rpc }, 'p', 'samples', rows, { dryRun: false })).rejects.toThrow(/stable batch ID/);
    await importQaqc({ rpc }, 'p', 'samples', rows, { dryRun: false, batchId: 'batch' });
    expect(rpc.mock.lastCall[1]).toMatchObject({ p_dry_run: false, p_batch: 'batch' });
  });
  it('refuses empty/oversize/wrong-kind requests and propagates database failures', async () => {
    const rpc = vi.fn().mockResolvedValue({ error: new Error('ORG_READ_ONLY') });
    await expect(importQaqc({ rpc }, 'p', 'assays', [{}])).rejects.toThrow(/samples or crms/);
    await expect(importQaqc({ rpc }, 'p', 'samples', [])).rejects.toThrow(/5,000/);
    await expect(importQaqc({ rpc }, 'p', 'samples', Array(5001).fill({}))).rejects.toThrow(/5,000/);
    expect(rpc).not.toHaveBeenCalled();
    await expect(importQaqc({ rpc }, 'p', 'samples', [{}])).rejects.toThrow('ORG_READ_ONLY');
    await expect(rollbackQaqc({ rpc }, 'batch')).rejects.toThrow('ORG_READ_ONLY');
    expect(rpc.mock.lastCall).toEqual(['drill_qaqc_rollback', { p_batch: 'batch' }]);
  });
});
