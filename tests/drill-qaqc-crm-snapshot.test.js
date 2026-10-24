import { describe, expect, it } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { discoverCrmGroups, loadCrmSnapshot, QAQC_SNAPSHOT_MAX_BYTES } from '../src/utils/drillQaqcSnapshot.js';

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const scope = { propertyId: id(1), batchId: id(2), labId: 'L', labBatchId: 'J', crmId: 'CRM-1', crmRevision: 'R1', element: 'Au', unit: 'g/t' };
const sample = n => ({ id: id(100 + n), property_id: scope.propertyId, batch_id: scope.batchId, source_row: n,
  superseded_by_batch: id(999), parent_version_id: null, crm_version_ids: [id(10000 + n)],
  record: { sample_id: `S${n}`, sample_type: 'standard', lab_id: 'L', lab_batch_id: 'J', crm_id: 'CRM-1', crm_revision: 'R1',
    values: { Au: n }, units: { Au: 'g/t' }, raw_values: { Au: String(n) }, bdl: {} } });
const crm = n => ({ id: id(10000 + n), property_id: scope.propertyId, batch_id: id(3), source_row: n,
  superseded_by_batch: id(999), record: { crm_id: 'CRM-1', revision: 'R1', element: 'Au', unit: 'g/t', expected: 1, sd: 0.1, source: 'Synthetic' } });
function fixture({ count = 3, cap = 2, mutate = () => {}, ignoreCursor = false } = {}) {
  const samples = Array.from({ length: count }, (_, i) => sample(i + 1)), crms = samples.map((_, i) => crm(i + 1));
  const batch = { id: scope.batchId, property_id: scope.propertyId, kind: 'samples', request_hash: 'hash', provenance: { filename: 'synthetic.csv' },
    row_count: count, rows_written: count, created_at: '2026-10-23T10:00:00Z', rolled_back_at: null };
  const calls = [];
  const client = createClient('https://example.supabase.co', 'placeholder', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: async (input, init) => {
      const url = new URL(input), table = url.pathname.split('/').at(-1), q = url.searchParams;
      calls.push({ table, q, signal: init.signal });
      const fault = mutate({ table, q, calls, batch, samples, crms });
      if (fault) return new Response(JSON.stringify(fault.body || { message: 'denied' }), { status: fault.status || 403 });
      expect(q.get('property_id')).toBe(`eq.${scope.propertyId}`);
      expect(q.has('superseded_by_batch')).toBe(false); expect(q.has('offset')).toBe(false);
      let rows;
      if (table === 'drill_qaqc_batches') {
        expect(q.get('id')).toBe(`eq.${scope.batchId}`); rows = [batch];
      } else if (table === 'drill_qaqc_samples') {
        expect(q.get('batch_id')).toBe(`eq.${scope.batchId}`); expect(q.get('select')).toContain('crm_version_ids');
        expect(q.get('order')).toBe('source_row.asc,id.asc'); expect(q.get('limit')).toBe('250');
        rows = [...samples].sort((a, b) => a.source_row - b.source_row || a.id.localeCompare(b.id));
        if (q.has('or') && !ignoreCursor) {
          const match = q.get('or').match(/^\(source_row\.gt\.(\d+),and\(source_row\.eq\.(\d+),id\.gt\."([a-f0-9-]{36})"\)\)$/);
          expect(match).not.toBeNull(); expect(match[1]).toBe(match[2]);
          rows = rows.filter(row => row.source_row > +match[1] || (row.source_row === +match[1] && row.id > match[3]));
        }
      } else {
        expect(table).toBe('drill_crm_values'); expect(q.get('order')).toBe('id.asc'); expect(q.get('limit')).toBe('100');
        const ids = q.getAll('id').find(value => value.startsWith('in.'))?.match(/^in\.\((.*)\)$/)?.[1].split(',');
        expect(ids?.length).toBeGreaterThan(0); expect(ids.length).toBeLessThanOrEqual(100);
        rows = crms.filter(row => ids.includes(row.id));
        for (const [field, key] of [['crm_id', 'crmId'], ['revision', 'crmRevision'], ['element', 'element'], ['unit', 'unit']]) {
          const filter = q.get(`record->>${field}`); expect(filter).toMatch(/^eq\./);
          const value = filter.slice(3); expect(typeof scope[key]).toBe('string');
          rows = rows.filter(row => row.record[field] === value);
        }
        rows.sort((a, b) => a.id.localeCompare(b.id));
        const after = q.getAll('id').find(value => value.startsWith('gt.'))?.slice(3);
        if (after && !ignoreCursor) rows = rows.filter(row => row.id > after);
      }
      rows = rows.slice(0, table === 'drill_qaqc_batches' ? 2 : Math.min(cap, Number(q.get('limit'))));
      return new Response(JSON.stringify(rows), { headers: { 'Content-Type': 'application/json' } });
    } },
  });
  return { client, calls, batch, samples, crms };
}

describe('bounded CRM evidence through the real Supabase HTTP client', () => {
  it('discovers exact populated standard groups without reference reads', async () => {
    const f = fixture({ count: 5 });
    f.samples[1].record.crm_revision = 'R2'; f.samples[2].record.units.Au = 'ppm';
    f.samples[3].record.crm_id = 'Other'; f.samples[4].record.sample_type = 'blank';
    const out = await discoverCrmGroups(f.client, scope);
    expect(out.complete).toBe(true); expect(out.groups).toHaveLength(4); expect(out.groups).toContainEqual(scope);
    expect(out.crms).toEqual([]); expect(out.manifest.referenceReadsComplete).toBe(false);
    expect(f.calls.some(call => call.table === 'drill_crm_values')).toBe(false);
  });

  it('resolves pinned historical definitions across capped sample/reference pages and source gaps', async () => {
    const f = fixture(); f.samples[1].source_row = 1; f.samples[2].source_row = 8; f.batch.row_count = 8;
    const progress = [];
    const out = await loadCrmSnapshot(f.client, scope, { onProgress: value => progress.push(value) });
    expect(out.complete).toBe(true); expect(out.records).toEqual(f.samples); expect(out.crms).toEqual(f.crms);
    expect(out.manifest).toMatchObject({ population: 'written_import_rows', currentStateClaimed: false,
      submittedCount: 8, loadedWrittenCount: 3, selectedCount: 3, referenceReadsComplete: true, requestHash: 'hash' });
    expect(out.manifest.requestedCrmIds).toEqual(f.crms.map(row => row.id));
    expect(out.manifest.crmIds).toEqual(f.crms.map(row => row.id)); expect(out.manifest.unresolvedCandidateIds).toEqual([]);
    expect(progress.at(-1)).toEqual({ phase: 'crms', loaded: 3, expected: 3 });
    expect(f.calls.filter(call => call.table === 'drill_qaqc_batches')).toHaveLength(2);
  });

  it('queries every candidate ID regardless of array order, retaining ambiguous matching pins', async () => {
    const f = fixture({ count: 2, cap: 1 });
    f.crms.push({ ...crm(3), record: { ...crm(3).record, element: 'Cu', unit: '%' } });
    f.samples[0].crm_version_ids = [f.crms[2].id, f.crms[1].id, f.crms[0].id];
    f.samples[1].crm_version_ids = [f.crms[1].id, f.crms[0].id, f.crms[2].id];
    const out = await loadCrmSnapshot(f.client, scope);
    expect(out.complete).toBe(true); expect(out.crms).toEqual(f.crms.slice(0, 2));
    expect(out.manifest.requestedCrmIds).toHaveLength(3);
    expect(out.manifest.unresolvedCandidateIds).toEqual([f.crms[2].id]); // Not claimed missing: it is another element.
  });

  it('never substitutes current definitions or other revisions/units for missing pins', async () => {
    const f = fixture(); const original = f.crms[0].id;
    f.crms[0].id = id(99999); f.crms[0].superseded_by_batch = null;
    f.crms[1].record.revision = 'R2'; f.crms[2].record.unit = 'ppm';
    const out = await loadCrmSnapshot(f.client, scope);
    expect(out.complete).toBe(true); expect(out.crms).toEqual([]);
    expect(out.manifest.requestedCrmIds).toContain(original); expect(out.manifest.requestedCrmIds).not.toContain(id(99999));
  });

  it('fetches only selected lab/job/CRM/revision candidates and retains missing-element/unit exclusions', async () => {
    const f = fixture({ count: 8, cap: 250 });
    f.samples[0].record.values = {}; f.samples[1].record.units.Au = 'ppm';
    f.samples[2].record.lab_id = 'Other'; f.samples[3].record.lab_batch_id = 'Other';
    f.samples[4].record.crm_id = 'Other'; f.samples[5].record.crm_revision = 'Other'; f.samples[6].record.sample_type = 'routine';
    const out = await loadCrmSnapshot(f.client, scope);
    expect(out.complete).toBe(true); expect(out.records).toHaveLength(8); expect(out.manifest.selectedCount).toBe(3);
    expect(out.manifest.requestedCrmIds).toEqual([f.crms[0].id, f.crms[1].id, f.crms[7].id]);
  });

  it('uses bounded100-ID chunks and completes later chunks even after finding a match', async () => {
    const refs = Array.from({ length: 105 }, (_, i) => crm(i + 1));
    const g = fixture({ count: 2, cap: 41 }); g.crms.splice(0, 2, ...refs);
    g.samples[0].crm_version_ids = refs.slice(0, 64).map(row => row.id);
    g.samples[1].crm_version_ids = refs.slice(64).map(row => row.id);
    const out = await loadCrmSnapshot(g.client, scope);
    expect(out.complete).toBe(true); expect(out.crms).toHaveLength(105);
    expect(new Set(g.calls.filter(call => call.table === 'drill_crm_values').map(call => call.q.getAll('id').find(v => v.startsWith('in.')))).size).toBe(2);
  });

  it('bounds candidate union independently from the5000-sample limit before reference reads', async () => {
    const f = fixture({ count: 79, cap: 250 });
    f.samples.forEach((row, n) => { row.crm_version_ids = Array.from({ length: 64 }, (_, j) => id(20000 + n * 64 + j)); });
    const out = await loadCrmSnapshot(f.client, scope);
    expect(out.complete).toBe(false); expect(out.issues[0].code).toBe('pin_limit');
    expect(out.manifest.referenceReadsComplete).toBe(false); expect(f.calls.some(call => call.table === 'drill_crm_values')).toBe(false);
  });

  it('accepts exactly5000 candidate pins and completes all50 chunks', async () => {
    const f = fixture({ count: 79, cap: 250 });
    f.samples.forEach((row, n) => { row.crm_version_ids = Array.from({ length: Math.min(64, 5000 - n * 64) }, (_, j) => id(20000 + n * 64 + j)); });
    const out = await loadCrmSnapshot(f.client, scope);
    expect(out.complete).toBe(true); expect(out.manifest.requestedCrmIds).toHaveLength(5000); expect(out.crms).toEqual([]);
    expect(f.calls.filter(call => call.table === 'drill_crm_values')).toHaveLength(50);
  });

  it('fails closed on CRM read denial instead of reporting unavailable individual definitions', async () => {
    const f = fixture({ mutate: ({ table }) => table === 'drill_crm_values' ? {} : null });
    const out = await loadCrmSnapshot(f.client, scope);
    expect(out.complete).toBe(false); expect(out.issues[0].code).toBe('read_failed');
    expect(out.manifest.referenceReadsComplete).toBe(false); expect(out.manifest.unresolvedCandidateIds).toEqual([]);
  });

  it.each(['property_id', 'id', 'crm_id', 'revision', 'element', 'unit'])('fails closed on returned reference scope violation %s', async field => {
    const wrong = crm(1);
    if (field === 'id' || field === 'property_id') wrong[field] = id(99998); else wrong.record[field] = 'Wrong';
    const f = fixture({ mutate: ({ table }) => table === 'drill_crm_values' ? { status: 200, body: [wrong] } : null });
    const out = await loadCrmSnapshot(f.client, scope);
    expect(out.complete).toBe(false); expect(out.issues[0].code).toBe('invalid_reference'); expect(out.crms).toEqual([]);
  });

  it('does not loop on repeated reference pages', async () => {
    const f = fixture({ count: 1, cap: 1, mutate: ({ table }) => table === 'drill_crm_values' ? { status: 200, body: [crm(1)] } : null });
    const out = await loadCrmSnapshot(f.client, scope);
    expect(out.complete).toBe(false); expect(out.issues[0].code).toBe('invalid_reference');
    expect(f.calls.filter(call => call.table === 'drill_crm_values')).toHaveLength(2);
  });

  it.each([2, 4])('rejects written count mismatch %s', async written => {
    const f = fixture(); f.batch.row_count = 4; f.batch.rows_written = written;
    expect(await loadCrmSnapshot(f.client, scope)).toMatchObject({ complete: false, issues: [{ code: 'count_mismatch' }] });
  });

  it('enforces shared byte bounds and rejects oversize options before reading', async () => {
    const f = fixture();
    expect(await loadCrmSnapshot(f.client, scope, { maxBytes: 100 })).toMatchObject({ complete: false, issues: [{ code: 'byte_limit' }] });
    await expect(loadCrmSnapshot(f.client, scope, { maxBytes: QAQC_SNAPSHOT_MAX_BYTES + 1 })).rejects.toThrow('Invalid snapshot byte limit');
  });

  it('captures refreshed rollback status but rejects changes to immutable batch evidence', async () => {
    const f = fixture({ mutate: ({ table, calls, batch }) => {
      if (table === 'drill_qaqc_batches' && calls.filter(call => call.table === table).length === 2) batch.rolled_back_at = '2026-10-23T12:00:00Z';
    } });
    expect((await loadCrmSnapshot(f.client, scope)).manifest.rolledBackAt).toBe('2026-10-23T12:00:00Z');
    const g = fixture({ mutate: ({ table, calls, batch }) => {
      if (table === 'drill_qaqc_batches' && calls.filter(call => call.table === table).length === 2) batch.request_hash = 'changed';
    } });
    expect(await loadCrmSnapshot(g.client, scope)).toMatchObject({ complete: false, issues: [{ code: 'batch_changed' }] });
  });

  it('cancels mid-read on signal or stale selection without retaining a report', async () => {
    const controller = new AbortController();
    const f = fixture({ mutate: ({ table }) => { if (table === 'drill_crm_values') controller.abort(); } });
    await expect(loadCrmSnapshot(f.client, scope, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    let current = true;
    const g = fixture({ mutate: ({ table }) => { if (table === 'drill_qaqc_samples') current = false; } });
    await expect(loadCrmSnapshot(g.client, scope, { isCurrent: () => current })).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('validates explicit scope, incomplete discovery, missing schema and malformed group metadata', async () => {
    const f = fixture();
    await expect(loadCrmSnapshot(f.client, { ...scope, crmRevision: '' })).rejects.toThrow(/CRM/); expect(f.calls).toEqual([]);
    f.samples[0].record.crm_revision = '';
    expect(await discoverCrmGroups(f.client, scope)).toMatchObject({ complete: false, groups: [], issues: [{ code: 'invalid_group' }] });
    const g = fixture({ mutate: () => ({ body: { code: 'PGRST205', message: 'missing' } }) });
    expect(await discoverCrmGroups(g.client, scope)).toMatchObject({ complete: false, groups: [], issues: [{ code: 'unavailable' }] });
  });

  it('bounds discovered CRM groups independently from written row count', async () => {
    const f = fixture({ count: 65, cap: 250 });
    for (const [index, row] of f.samples.entries()) {
      row.record.lab_id = `Lab-${index}`;
      row.record.values = Object.fromEntries(Array.from({ length: 64 }, (_, i) => [`E${i}`, 1]));
      row.record.units = Object.fromEntries(Object.keys(row.record.values).map(element => [element, 'ppm']));
    }
    expect(await discoverCrmGroups(f.client, scope)).toMatchObject({ complete: false, groups: [], issues: [{ code: 'group_limit' }] });
    expect(f.calls.some(call => call.table === 'drill_crm_values')).toBe(false);
  });

  it('filters exact source strings safely without interpreting punctuation as query grammar', async () => {
    const f = fixture({ count: 1 }); const crmId = 'CRM,"(strange)\\name'; const revision = 'R.1,(source)';
    f.samples[0].record.crm_id = f.crms[0].record.crm_id = crmId;
    f.samples[0].record.crm_revision = f.crms[0].record.revision = revision;
    const out = await loadCrmSnapshot(f.client, { ...scope, crmId, crmRevision: revision });
    expect(out.complete).toBe(true); expect(out.crms).toHaveLength(1);
    const q = f.calls.find(call => call.table === 'drill_crm_values').q;
    expect(q.get('record->>crm_id')).toBe(`eq.${crmId}`); expect(q.get('record->>revision')).toBe(`eq.${revision}`);
  });
});
