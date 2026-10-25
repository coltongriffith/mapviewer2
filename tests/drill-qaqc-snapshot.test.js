import { describe, expect, it } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { discoverDuplicateGroups, loadDuplicateSnapshot, QAQC_SNAPSHOT_MAX_BYTES } from '../src/utils/drillQaqcSnapshot.js';

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const scope = { propertyId: id(1), batchId: id(2), sampleType: 'field_dup', labId: 'L', labBatchId: 'J', element: 'Au', unit: 'g/t' };
const sample = (n, overrides = {}) => ({ id: id(100 + n), property_id: scope.propertyId, batch_id: scope.batchId,
  source_row: n, superseded_by_batch: id(999), parent_version_id: id(10000 + n),
  record: { sample_id: `D${n}`, parent_sample_id: `P${n}`, sample_type: 'field_dup', lab_id: 'L', lab_batch_id: 'J', values: { Au: n }, units: { Au: 'g/t' }, raw_values: { Au: String(n) }, bdl: {} }, ...overrides });
function fixture({ count = 3, cap = 2, mutate = () => {}, ignoreCursor = false } = {}) {
  const samples = Array.from({ length: count }, (_, i) => sample(i + 1));
  const parents = samples.map((r) => ({ ...r, id: r.parent_version_id, batch_id: id(3), parent_version_id: null, record: { ...r.record, sample_type: 'routine', sample_id: r.record.parent_sample_id } }));
  const batch = { id: scope.batchId, property_id: scope.propertyId, kind: 'samples', request_hash: 'hash', provenance: { filename: 'synthetic.csv' },
    row_count: count, rows_written: count, created_at: '2026-10-23T10:00:00Z', rolled_back_at: null };
  const calls = [];
  const client = createClient('https://example.supabase.co', 'placeholder', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: async (input, init) => {
      const url = new URL(input), table = url.pathname.split('/').at(-1), q = url.searchParams;
      calls.push({ table, q, signal: init.signal });
      const fault = mutate({ table, q, calls, batch, samples, parents });
      if (fault) return new Response(JSON.stringify(fault.body || { message: 'denied' }), { status: fault.status || 403 });
      expect(q.get('property_id')).toBe(`eq.${scope.propertyId}`);
      expect(q.has('superseded_by_batch')).toBe(false);
      expect(q.has('offset')).toBe(false);
      let rows;
      if (table === 'drill_qaqc_batches') {
        expect(q.get('id')).toBe(`eq.${scope.batchId}`);
        rows = [batch];
      } else if (q.has('batch_id')) {
        expect(q.get('batch_id')).toBe(`eq.${scope.batchId}`);
        expect(q.get('order')).toBe('source_row.asc,id.asc');
        expect(q.get('limit')).toBe('250');
        rows = [...samples].sort((a, b) => a.source_row - b.source_row || a.id.localeCompare(b.id));
        if (q.has('or') && ignoreCursor !== true) {
          // Parse the wire expression independently; reject malformed quoted literals.
          const match = q.get('or').match(/^\(source_row\.gt\.(\d+),and\(source_row\.eq\.(\d+),id\.gt\."([a-f0-9-]{36})"\)\)$/);
          expect(match).not.toBeNull(); expect(match[1]).toBe(match[2]);
          rows = rows.filter((r) => r.source_row > Number(match[1]) || (r.source_row === Number(match[1]) && r.id > match[3]));
        }
      } else {
        expect(q.get('order')).toBe('id.asc'); expect(q.get('limit')).toBe('100');
        const ids = q.getAll('id').find((v) => v.startsWith('in.'))?.match(/^in\.\((.*)\)$/)?.[1].split(',');
        expect(ids?.length).toBeGreaterThan(0); expect(ids.length).toBeLessThanOrEqual(100);
        rows = parents.filter((r) => ids.includes(r.id)).sort((a, b) => a.id.localeCompare(b.id));
        const after = q.getAll('id').find((v) => v.startsWith('gt.'))?.slice(3);
        if (after && !ignoreCursor) rows = rows.filter((r) => r.id > after);
      }
      rows = rows.slice(0, table === 'drill_qaqc_batches' ? 2 : Math.min(cap, Number(q.get('limit'))));
      return new Response(JSON.stringify(rows), { headers: { 'Content-Type': 'application/json' } });
    } },
  });
  return { client, calls, batch, samples, parents };
}

describe('bounded historical duplicate snapshot through the real Supabase client', () => {
  it('discovers actual exact groups from the selected import only without reading parents', async () => {
    const f = fixture({ count: 4 });
    f.samples[1].record.units.Au = 'ppm'; f.samples[2].record.lab_id = 'Other lab';
    f.samples[3].record.sample_type = 'routine';
    const result = await discoverDuplicateGroups(f.client, { propertyId: scope.propertyId, batchId: scope.batchId });
    expect(result.complete).toBe(true); expect(result.groups).toHaveLength(3);
    expect(result.groups).toContainEqual(scope);
    expect(result.groups).toContainEqual({ ...scope, unit: 'ppm' });
    expect(result.groups).toContainEqual({ ...scope, labId: 'Other lab' });
    expect(result.parents).toEqual([]); expect(result.manifest.referenceReadsComplete).toBe(false);
    expect(f.calls.every(call => call.table === 'drill_qaqc_batches' || call.q.has('batch_id'))).toBe(true);
  });

  it('does not offer groups from an incomplete or invalid discovery read', async () => {
    const f = fixture({ mutate: ({ q }) => q.has('or') ? {} : null });
    expect(await discoverDuplicateGroups(f.client, scope)).toMatchObject({ complete: false, groups: [] });
    const g = fixture(); g.samples[0].record.units.Au = '';
    expect(await discoverDuplicateGroups(g.client, scope)).toMatchObject({ complete: false, groups: [], issues: [{ code: 'invalid_group' }] });
  });

  it('bounds populated group choices before returning an unmanageable selector', async () => {
    const f = fixture({ count: 65, cap: 250 });
    for (const [index, row] of f.samples.entries()) {
      row.record.lab_id = `Lab-${index}`;
      row.record.values = Object.fromEntries(Array.from({ length: 64 }, (_, element) => [`E${element}`, 1]));
      row.record.units = Object.fromEntries(Object.keys(row.record.values).map(element => [element, 'ppm']));
    }
    expect(await discoverDuplicateGroups(f.client, scope)).toMatchObject({ complete: false, groups: [], issues: [{ code: 'group_limit' }] });
    expect(f.calls.every(call => call.table === 'drill_qaqc_batches' || call.q.has('batch_id'))).toBe(true);
  });
  it('reads every written row and exact superseded parent despite smaller server caps and tied keys', async () => {
    const f = fixture(); f.samples[1].source_row = 1;
    const progress = [];
    const result = await loadDuplicateSnapshot(f.client, scope, { onProgress: (p) => progress.push(p) });
    expect(result.complete).toBe(true); expect(result.records).toEqual(f.samples); expect(result.parents).toEqual(f.parents);
    expect(result.manifest).toMatchObject({ population: 'written_import_rows', currentStateClaimed: false, statusRefreshed: true,
      submittedCount: 3, expectedWrittenCount: 3, loadedWrittenCount: 3, selectedCount: 3, requestHash: 'hash', provenance: { filename: 'synthetic.csv' } });
    expect(result.manifest.recordIds).toEqual(f.samples.map((r) => r.id));
    expect(result.manifest.retrievedAt).toMatch(/^\d{4}-/); expect(progress.at(-1)).toEqual({ phase: 'parents', loaded: 3, expected: 3 });
    expect(f.calls.filter((c) => c.q.has('batch_id'))).toHaveLength(3);
    expect(f.calls.filter((c) => c.table === 'drill_qaqc_batches')).toHaveLength(2);
  });

  it('allows source-row gaps and explicitly distinguishes submitted rows from written changes', async () => {
    const f = fixture({ count: 1 }); f.batch.row_count = 5; f.samples[0].source_row = 5;
    const result = await loadDuplicateSnapshot(f.client, scope);
    expect(result.complete).toBe(true); expect(result.manifest).toMatchObject({ submittedCount: 5, expectedWrittenCount: 1 });
  });

  it('chunks only the chosen group references and includes missing-element rows for scientific exclusions', async () => {
    const f = fixture({ count: 105, cap: 41 });
    f.samples[0].record.values = {}; f.samples[1].record.lab_batch_id = 'other'; f.samples[2].record.sample_type = 'pulp_dup';
    f.samples[3].parent_version_id = f.samples[4].parent_version_id;
    const result = await loadDuplicateSnapshot(f.client, scope);
    expect(result.complete).toBe(true); expect(result.records).toHaveLength(105); expect(result.parents).toHaveLength(102);
    const refs = f.calls.filter((c) => c.table === 'drill_qaqc_samples' && !c.q.has('batch_id'));
    expect(new Set(refs.map((c) => c.q.getAll('id').find((v) => v.startsWith('in.')))).size).toBe(2);
    expect(result.parents.some((r) => r.id === f.samples[0].parent_version_id)).toBe(true);
    expect(result.parents.some((r) => r.id === f.samples[1].parent_version_id)).toBe(false);
  });

  it('records absent pinned parents without substituting a newer parent with the same sample ID', async () => {
    const f = fixture(); const missing = f.parents[0].id; f.parents[0].id = id(99999);
    const result = await loadDuplicateSnapshot(f.client, scope);
    expect(result.complete).toBe(true); expect(result.missingParentIds).toEqual([missing]);
    expect(result.parents).toHaveLength(2); expect(result.parents.some((r) => r.id === id(99999))).toBe(false);
  });

  it('does not confuse a reference read denial with a scientific missing-parent exclusion', async () => {
    const f = fixture({ mutate: ({ table, q }) => table === 'drill_qaqc_samples' && !q.has('batch_id') ? {} : null });
    const result = await loadDuplicateSnapshot(f.client, scope);
    expect(result.complete).toBe(false); expect(result.issues[0].code).toBe('read_failed'); expect(result.manifest.statusRefreshed).toBe(false);
    expect(result.missingParentIds).toEqual([]); expect(result.manifest.referenceReadsComplete).toBe(false);
  });

  it.each([2, 4])('rejects written-row count mismatch %s', async (written) => {
    const f = fixture(); f.batch.rows_written = written; f.batch.row_count = 4;
    const result = await loadDuplicateSnapshot(f.client, scope);
    expect(result.complete).toBe(false); expect(result.issues[0].code).toBe('count_mismatch');
  });

  it.each([0, 5001])('refuses out-of-bounds batch %s before any row scan', async (count) => {
    const f = fixture(); f.batch.row_count = count; f.batch.rows_written = count;
    const result = await loadDuplicateSnapshot(f.client, scope);
    expect(result.issues[0].code).toBe('invalid_batch'); expect(f.calls).toHaveLength(1);
  });

  it('finishes a full 5,000-row batch including a terminal empty page', async () => {
    const f = fixture({ count: 5000, cap: 250 }); f.samples.forEach((r) => { r.record.sample_type = 'routine'; });
    const result = await loadDuplicateSnapshot(f.client, scope);
    expect(result.complete).toBe(true); expect(result.records).toHaveLength(5000); expect(result.parents).toEqual([]);
    expect(f.calls.filter((c) => c.q.has('batch_id'))).toHaveLength(21);
  });

  it('does not loop when the server repeats a page', async () => {
    const f = fixture({ ignoreCursor: true }); const result = await loadDuplicateSnapshot(f.client, scope);
    expect(result.complete).toBe(false); expect(result.issues[0].code).toBe('invalid_cursor'); expect(f.calls).toHaveLength(3);
  });

  it.each(['property_id', 'batch_id', 'source_row'])('refuses invalid returned %s without retaining that row', async (field) => {
    const f = fixture(); f.samples[0][field] = field === 'source_row' ? null : id(99998);
    const result = await loadDuplicateSnapshot(f.client, scope);
    expect(result.complete).toBe(false); expect(result.issues[0].code).toBe('invalid_cursor');
    expect(result.records.some((r) => r[field] === f.samples[0][field])).toBe(false);
  });

  it('rejects repeated IDs even across different source rows', async () => {
    const f = fixture(); f.samples[1].id = f.samples[0].id;
    const result = await loadDuplicateSnapshot(f.client, scope); expect(result.issues[0].code).toBe('invalid_cursor');
  });

  it('refuses malformed UUID cursors and repeated parent pages', async () => {
    const f = fixture(); f.samples[0].id = 'bad),id.gt.injected';
    expect((await loadDuplicateSnapshot(f.client, scope)).issues[0].code).toBe('invalid_cursor');
    const g = fixture({ ignoreCursor: 'parents' });
    expect((await loadDuplicateSnapshot(g.client, scope)).issues[0].code).toBe('invalid_reference');
    expect(g.calls.length).toBeLessThan(10);
  });

  it('keeps partial row failures incomplete and does not request parents', async () => {
    const f = fixture({ mutate: ({ q }) => q.has('or') ? {} : null });
    const result = await loadDuplicateSnapshot(f.client, scope);
    expect(result.complete).toBe(false); expect(result.issues[0].code).toBe('read_failed');
    expect(result.records).toHaveLength(2); expect(result.parents).toEqual([]); expect(f.calls).toHaveLength(3);
  });

  it('requests no references for an unselected group or malformed/null pin', async () => {
    const f = fixture(); f.samples[0].parent_version_id = null; f.samples[1].parent_version_id = 'malformed';
    f.samples[2].record.lab_id = 'other';
    const result = await loadDuplicateSnapshot(f.client, scope);
    expect(result.complete).toBe(true); expect(result.parents).toEqual([]); expect(result.manifest.selectedCount).toBe(2);
    expect(f.calls.every((c) => c.table === 'drill_qaqc_batches' || c.q.has('batch_id'))).toBe(true);
  });

  it('does not cache a previous authenticated load', async () => {
    let deny = false; const f = fixture({ mutate: () => deny ? {} : null });
    expect((await loadDuplicateSnapshot(f.client, scope)).complete).toBe(true);
    deny = true;
    const result = await loadDuplicateSnapshot(f.client, scope);
    expect(result.complete).toBe(false); expect(result.records).toEqual([]); expect(result.parents).toEqual([]);
  });

  it('does not return a foreign-property reference', async () => {
    const f = fixture(); f.parents[0].property_id = id(999);
    const result = await loadDuplicateSnapshot(f.client, scope);
    expect(result.complete).toBe(false); expect(result.issues[0].code).toBe('invalid_reference'); expect(result.parents).toEqual([]);
  });

  it('caps aggregate payload bytes and refuses unsafe options', async () => {
    const f = fixture(); const result = await loadDuplicateSnapshot(f.client, scope, { maxBytes: 1000 });
    expect(result.complete).toBe(false); expect(result.issues[0].code).toBe('byte_limit');
    await expect(loadDuplicateSnapshot(f.client, scope, { maxBytes: QAQC_SNAPSHOT_MAX_BYTES + 1 })).rejects.toThrow('byte limit');
  });

  it('refreshes rollback status without pretending the immutable rows are current', async () => {
    const f = fixture({ mutate: ({ table, calls, batch }) => {
      if (table === 'drill_qaqc_batches' && calls.length > 1) batch.rolled_back_at = '2026-10-23T11:00:00Z';
    } });
    const result = await loadDuplicateSnapshot(f.client, scope);
    expect(result.complete).toBe(true); expect(result.manifest).toMatchObject({ statusRefreshed: true, currentStateClaimed: false, rolledBackAt: '2026-10-23T11:00:00Z' });
  });

  it('rejects immutable batch changes and a failed final status refresh', async () => {
    for (const deny of [false, true]) {
      const f = fixture({ mutate: ({ table, calls, batch }) => {
        if (table === 'drill_qaqc_batches' && calls.length > 1) { batch.request_hash = 'changed'; if (deny) return {}; }
      } });
      const result = await loadDuplicateSnapshot(f.client, scope);
      expect(result.complete).toBe(false); expect(result.issues[0].code).toBe(deny ? 'read_failed' : 'batch_changed');
    }
  });

  it('reports an undeployed migration and an unavailable selected batch', async () => {
    const f = fixture({ mutate: () => ({ body: { code: '42P01' } }) });
    expect((await loadDuplicateSnapshot(f.client, scope)).issues[0].code).toBe('unavailable');
    const g = fixture({ mutate: () => ({ body: [], status: 200 }) });
    expect((await loadDuplicateSnapshot(g.client, scope)).issues[0].code).toBe('batch_unavailable');
  });

  it('aborts before/during requests and ignores a stale selection response', async () => {
    const ac = new AbortController(); ac.abort(); const f = fixture();
    await expect(loadDuplicateSnapshot(f.client, scope, { signal: ac.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(f.calls).toHaveLength(0);
    const active = new AbortController(); const g = fixture({ mutate: ({ calls }) => { if (calls.length === 2) active.abort(); } });
    await expect(loadDuplicateSnapshot(g.client, scope, { signal: active.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(g.calls.every((c) => c.signal === active.signal)).toBe(true);
    let current = true; const h = fixture({ mutate: ({ calls }) => { if (calls.length === 2) current = false; } });
    await expect(loadDuplicateSnapshot(h.client, scope, { isCurrent: () => current })).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('rejects invalid or missing selection before querying and snapshots caller selection', async () => {
    const f = fixture();
    await expect(loadDuplicateSnapshot(f.client, { ...scope, batchId: 'x),id.gt.y' })).rejects.toThrow('Choose one');
    await expect(loadDuplicateSnapshot(f.client, { ...scope, unit: '' })).rejects.toThrow('Choose one');
    expect(f.calls).toHaveLength(0);
    const chosen = { ...scope };
    const result = await loadDuplicateSnapshot(f.client, chosen, { onProgress: () => { chosen.labId = 'other'; } });
    expect(result.scope).toEqual(scope); expect(result.manifest.selectedCount).toBe(3);
  });
});
