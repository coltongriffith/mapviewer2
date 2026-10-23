// @vitest-environment node
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { createWorkspaceDb, readMigration } from './fixtures/workspace-db.js';

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const O = id(1), E = id(2), V = id(3), X = id(4);
const migration = readMigration('20261101110000_drill_qaqc_foundation.sql');
let db, as, one, val, su, org, prop, other;
const crm = { crm_id: 'CRM-A', revision: 'certificate-2025', element: 'Au', unit: 'g/t', expected: 1.01, sd: 0.04, source: 'Synthetic test certificate' };
const sample = { lab_id: 'Lab-A', lab_batch_id: 'JOB-1', sample_id: '00001', sample_type: 'routine',
  values: { Au: 1 }, units: { Au: 'g/t' }, raw_values: { Au: '1.000' }, bdl: {} };
const imp = (uid, kind, rows, { dry = false, batch = null, property = prop, provenance = {} } = {}) =>
  val(uid, 'select public.drill_qaqc_import($1,$2,$3::jsonb,$4::jsonb,$5,$6)', [property, kind, JSON.stringify(rows), JSON.stringify(provenance), dry, batch]);
const roll = (uid, batch) => val(uid, 'select public.drill_qaqc_rollback($1)', [batch]);
const current = table => su(`select * from public.${table} where property_id=$1 and superseded_by_batch is null order by record_key`, [prop]);

beforeAll(async () => {
  ({ db, as, one, val, su } = await createWorkspaceDb({ emails: {
    [O]: 'owner@test.example', [E]: 'editor@test.example', [V]: 'viewer@test.example', [X]: 'rival@test.example',
  }, migrations: ['20261023100000_workspaces_properties.sql', '20261025100000_property_files.sql', '20261027100000_drill_database.sql'].map(readMigration).concat([migration, migration]) }));
  org = (await val(O, "select public.create_organization('Our company')")).id;
  const org2 = (await val(X, "select public.create_organization('Other company')")).id;
  await su("insert into public.organization_members(org_id,user_id,role) values($1,$2,'editor'),($1,$3,'viewer')", [org, E, V]);
  prop = (await one(E, "insert into public.properties(org_id,name) values($1,'Test') returning id", [org])).id;
  other = (await one(X, "insert into public.properties(org_id,name) values($1,'Other') returning id", [org2])).id;
}, 120000);
afterAll(async () => db?.close());

describe('QA/QC register foundation', () => {
  it('applies twice, exposes only authenticated RPCs, read-only RLS tables and private validators', async () => {
    const f = await su("select proname,proconfig,has_function_privilege('anon',oid,'execute') anon,has_function_privilege('authenticated',oid,'execute') auth from pg_proc where proname like 'drill_qaqc_%'");
    expect(f).toHaveLength(4);
    for (const fn of f) {
      expect(fn.proconfig[0]).toBe('search_path=""');
      expect(fn.anon).toBe(false);
      expect(fn.auth).toBe(['drill_qaqc_import', 'drill_qaqc_rollback'].includes(fn.proname));
    }
    for (const table of ['drill_qaqc_batches', 'drill_qaqc_samples', 'drill_crm_values']) {
      expect(await val(V, `select count(*)::int from public.${table}`)).toBe(0);
      await expect(as(E, `delete from public.${table}`)).rejects.toThrow(/permission denied/);
      await expect(as(E, `update public.${table} set org_id=$1`, [org])).rejects.toThrow(/permission denied/);
      await expect(as(E, `insert into public.${table}(org_id,property_id) values($1,$2)`, [org, prop])).rejects.toThrow(/permission denied/);
      await expect(as(null, `select * from public.${table}`)).rejects.toThrow(/permission denied/);
    }
    await expect(imp(V, 'samples', [sample])).rejects.toThrow(/ORG_READ_ONLY/);
    await expect(imp(X, 'samples', [sample])).rejects.toThrow(/PROPERTY_NOT_FOUND/);
    await expect(imp(E, 'samples', [sample], { property: other })).rejects.toThrow(/PROPERTY_NOT_FOUND/);
    await expect(imp(null, 'samples', [sample])).rejects.toThrow(/permission denied/);
  });

  it('validates all rows atomically and enforces limits, types, source and explicit units/BDL', async () => {
    for (const rows of [[], Array(5001).fill(sample)]) await expect(imp(E, 'samples', rows)).rejects.toThrow(/BATCH_TOO_LARGE_OR_EMPTY/);
    await expect(imp(E, 'samples', [{ ...sample, raw_values: { Au: 'x'.repeat(4000001) } }])).rejects.toThrow(/BATCH_TOO_LARGE_OR_EMPTY/);
    await expect(imp(E, 'samples', [sample], { provenance: { x: 'x'.repeat(17000) } })).rejects.toThrow(/INVALID_PROVENANCE/);
    await expect(imp(E, 'samples', [sample, sample])).rejects.toThrow(/DUPLICATE_KEY/);
    for (const bad of [
      { ...sample, sample_id: 1 }, { ...sample, sample_type: 'guess' }, { ...sample, values: { Au: '1' } },
      { ...sample, values: { Au: -1 } }, { ...sample, values: { Au: null } }, { ...sample, bdl: { Au: 0 } },
      { ...sample, units: {} }, { ...sample, raw_values: {} }, { ...sample, bdl: { Cu: true } },
      { ...sample, from_m: 0, to_m: 1 }, { ...sample, hole_id: 'H', from_m: 2, to_m: 1 },
      { ...sample, sample_type: 'standard' }, { ...sample, sample_type: 'field_dup', parent_sample_id: '00001' },
      { ...sample, arbitrary_field: true },
    ]) await expect(imp(E, 'samples', [{ ...sample, sample_id: 'atomic-good' }, bad])).rejects.toThrow(/INVALID_ROW 2/);
    await expect(imp(E, 'crms', [{ ...crm, sd: 0 }])).rejects.toThrow(/sd/);
    await expect(imp(E, 'crms', [{ ...crm, source: '' }])).rejects.toThrow(/source/);
    expect(await current('drill_qaqc_samples')).toEqual([]);
    expect(await su('select count(*)::int n from public.drill_qaqc_batches')).toEqual([{ n: 0 }]);
  });

  let parentBatch, crmBatch, standardBatch, duplicateBatch;
  it('previews then imports real sample identities without inventing hole/depth; retries are content checked', async () => {
    expect(await imp(E, 'samples', [sample], { dry: true })).toMatchObject({ new: 1, changed: 0, dry_run: true });
    expect(await current('drill_qaqc_samples')).toHaveLength(0);
    parentBatch = id(101);
    expect(await imp(E, 'samples', [sample], { batch: parentBatch, provenance: { filename: 'lab.csv', bdl_policy: 'flag only' } })).toMatchObject({ committed: true, rows_written: 1 });
    expect(await imp(E, 'samples', [sample], { batch: parentBatch, provenance: { filename: 'lab.csv', bdl_policy: 'flag only' } })).toMatchObject({ replayed: true });
    await expect(imp(E, 'samples', [{ ...sample, values: { Au: 2 } }], { batch: parentBatch })).rejects.toThrow(/BATCH_ID_REUSED/);
    expect(await imp(E, 'samples', [sample])).toMatchObject({ unchanged: 1, nothing_to_do: true });
    const rows = await current('drill_qaqc_samples');
    expect(rows[0].record).toEqual(sample);
    expect(rows[0].sample_id).toBe('00001');
    expect(rows[0].source_row).toBe(1);
    expect((await as(V, 'select id from public.drill_qaqc_samples')).rows).toHaveLength(1);
    expect((await as(X, 'select id from public.drill_qaqc_samples')).rows).toHaveLength(0);
    expect((await as(X, 'select id from public.drill_qaqc_batches')).rows).toHaveLength(0);
    await expect(roll(V, parentBatch)).rejects.toThrow(/ORG_READ_ONLY/);
    await expect(roll(X, parentBatch)).rejects.toThrow(/BATCH_NOT_FOUND/);
    await expect(imp(X, 'samples', [sample], { property: other, batch: parentBatch })).rejects.toThrow(/BATCH_NOT_FOUND/);
    expect(await val(E, 'select public.ws_property_has_content($1)', [prop])).toBe(true);
    expect(await su('select count(*)::int n from public.drill_assays')).toEqual([{ n: 0 }]);
    await su('update public.drill_qaqc_batches set rows_written=200000 where id=$1', [parentBatch]);
    await expect(imp(E, 'samples', [{ ...sample, sample_id: 'over-cap' }])).rejects.toThrow(/QAQC_PROPERTY_FULL/);
    await su('update public.drill_qaqc_batches set rows_written=1 where id=$1', [parentBatch]);
  });

  it('keeps identical sample IDs separate across labs and jobs and preserves blank detection limits', async () => {
    const rows = [{ ...sample, lab_id: 'Lab-B' }, { ...sample, lab_batch_id: 'JOB-2' }, {
      ...sample, sample_id: 'BLANK-1', sample_type: 'blank', values: { Au: null }, raw_values: { Au: '<0.005' }, bdl: { Au: 0.005 },
    }];
    const b = await imp(E, 'samples', rows);
    expect(b).toMatchObject({ new: 3 });
    expect((await current('drill_qaqc_samples')).map(s => s.record)).toContainEqual(rows[2]);
    expect((await current('drill_qaqc_samples')).find(s => s.sample_id === 'BLANK-1').source_row).toBe(3);
    expect((await su('select sample_id from public.drill_qaqc_samples where batch_id=$1 order by source_row', [b.batch_id])).map(s => s.sample_id))
      .toEqual(['00001', '00001', 'BLANK-1']);
    await roll(E, b.batch_id);
    const ordered = await imp(E, 'samples', ['Z-9', 'A-2', 'M-1'].map(sample_id => ({ ...sample, sample_id })));
    expect((await su('select sample_id from public.drill_qaqc_samples where batch_id=$1 order by source_row', [ordered.batch_id])).map(s => s.sample_id))
      .toEqual(['Z-9', 'A-2', 'M-1']);
    await roll(E, ordered.batch_id);
  });

  it('requires exact CRM revision/element/unit; persists immutable definitions and their version IDs', async () => {
    const standard = { ...sample, sample_id: 'STD-1', sample_type: 'standard', crm_id: crm.crm_id, crm_revision: crm.revision };
    await expect(imp(E, 'samples', [standard])).rejects.toThrow(/CRM_NOT_FOUND/);
    crmBatch = (await imp(E, 'crms', [crm])).batch_id;
    expect((await as(X, 'select id from public.drill_crm_values')).rows).toEqual([]);
    expect((await as(V, 'select id from public.drill_crm_values')).rows).toHaveLength(1);
    await expect(imp(E, 'crms', [{ ...crm, expected: 1.5 }])).rejects.toThrow(/CRM_REVISION_IMMUTABLE/);
    await expect(imp(E, 'samples', [{ ...standard, units: { Au: 'ppm' } }])).rejects.toThrow(/CRM_NOT_FOUND/);
    standardBatch = (await imp(E, 'samples', [standard])).batch_id;
    const c = (await current('drill_crm_values'))[0];
    const s = (await current('drill_qaqc_samples')).find(x => x.sample_id === 'STD-1');
    expect(s.crm_version_ids).toEqual([c.id]);
    await expect(roll(E, crmBatch)).rejects.toThrow(/BATCH_DEPENDENCY/);
    const next = (await imp(E, 'crms', [{ ...crm, revision: 'certificate-2026', expected: 1.2 }])).batch_id;
    expect((await current('drill_qaqc_samples')).find(x => x.sample_id === 'STD-1').crm_version_ids).toEqual([c.id]);
    await roll(E, next);
  });

  it('pins duplicate parent versions, refuses missing/circular parents and protects rollback', async () => {
    const duplicate = { ...sample, sample_id: 'DUP-1', sample_type: 'field_dup', parent_sample_id: '00001' };
    await expect(imp(E, 'samples', [{ ...duplicate, parent_sample_id: 'absent' }])).rejects.toThrow(/PARENT_NOT_FOUND/);
    await expect(imp(E, 'samples', [sample, duplicate])).rejects.toThrow(/PARENT_IN_SAME_IMPORT/);
    duplicateBatch = (await imp(E, 'samples', [duplicate])).batch_id;
    const rows = await current('drill_qaqc_samples');
    const originalId = rows.find(s => s.sample_id === '00001').id;
    expect(rows.find(s => s.sample_id === 'DUP-1').parent_version_id).toBe(originalId);
    await expect(roll(E, parentBatch)).rejects.toThrow(/BATCH_DEPENDENCY/);
    const change = await imp(E, 'samples', [{ ...sample, values: { Au: 2 }, raw_values: { Au: '2.00' } }]);
    expect(change).toMatchObject({ changed: 1, rows_written: 1 });
    expect((await current('drill_qaqc_samples')).find(s => s.sample_id === 'DUP-1').parent_version_id).toBe(originalId);
    await expect(roll(E, parentBatch)).rejects.toThrow(/BATCH_DEPENDENCY/);
    expect(await roll(E, change.batch_id)).toMatchObject({ restored: 1, withdrawn: 1 });
    expect((await current('drill_qaqc_samples')).find(s => s.sample_id === '00001').id).toBe(originalId);
  });

  it('does not attach a mixed import to the current parent of an unchanged duplicate', async () => {
    const property = (await one(E, "insert into public.properties(org_id,name) values($1,'Duplicate dependency regression') returning id", [org])).id;
    const duplicate = { ...sample, sample_id: 'DUP-1', sample_type: 'field_dup', parent_sample_id: sample.sample_id };
    const blank = { ...sample, sample_id: 'BLANK-1', sample_type: 'blank' };
    const p = await imp(E, 'samples', [sample], { property });
    const d = await imp(E, 'samples', [duplicate], { property });
    const original = await one(E, 'select id,parent_version_id from public.drill_qaqc_samples where batch_id=$1', [d.batch_id]);
    const b = await imp(E, 'samples', [{ ...sample, values: { Au: 2 }, raw_values: { Au: '2.00' } }], { property });
    const c = await imp(E, 'samples', [duplicate, blank], { property });
    expect(c).toMatchObject({ new: 1, unchanged: 1, rows_written: 1 });
    expect(await one(E, 'select depends_on from public.drill_qaqc_batches where id=$1', [c.batch_id])).toEqual({ depends_on: [] });
    expect(await roll(E, b.batch_id)).toMatchObject({ restored: 1, withdrawn: 1 });
    expect(await one(E, 'select id,parent_version_id from public.drill_qaqc_samples where batch_id=$1', [d.batch_id])).toEqual(original);
    await expect(roll(E, p.batch_id)).rejects.toThrow(/BATCH_DEPENDENCY/);
    await roll(E, d.batch_id);
    await roll(E, p.batch_id);
    // The unrelated blank remains current while the parent and duplicate history stays intact.
    expect((await as(E, 'select sample_id from public.drill_qaqc_samples where property_id=$1 and superseded_by_batch is null', [property])).rows).toEqual([{ sample_id: 'BLANK-1' }]);
    await roll(E, c.batch_id);
  });

  it('does not copy an unchanged standard CRM dependency into a new blank import', async () => {
    const property = (await one(E, "insert into public.properties(org_id,name) values($1,'CRM dependency regression') returning id", [org])).id;
    const standard = { ...sample, sample_id: 'STD-1', sample_type: 'standard', crm_id: crm.crm_id, crm_revision: crm.revision };
    const crms = await imp(E, 'crms', [crm], { property });
    const standards = await imp(E, 'samples', [standard], { property });
    const original = await one(E, 'select id,crm_version_ids from public.drill_qaqc_samples where batch_id=$1', [standards.batch_id]);
    const mixed = await imp(E, 'samples', [standard, { ...sample, sample_id: 'BLANK-1', sample_type: 'blank' }], { property });
    expect(mixed).toMatchObject({ new: 1, unchanged: 1, rows_written: 1 });
    expect(await one(E, 'select depends_on from public.drill_qaqc_batches where id=$1', [mixed.batch_id])).toEqual({ depends_on: [] });
    expect(await one(E, 'select id,crm_version_ids from public.drill_qaqc_samples where batch_id=$1', [standards.batch_id])).toEqual(original);
    await expect(roll(E, crms.batch_id)).rejects.toThrow(/BATCH_DEPENDENCY/);
    await roll(E, standards.batch_id);
    expect(await roll(E, crms.batch_id)).toMatchObject({ withdrawn: 1 });
    expect((await as(E, 'select sample_id from public.drill_qaqc_samples where property_id=$1 and superseded_by_batch is null', [property])).rows).toEqual([{ sample_id: 'BLANK-1' }]);
    await roll(E, mixed.batch_id);
  });

  it('rolls back in dependency order, keeps history and refuses changed CRM revision after rollback', async () => {
    await roll(E, duplicateBatch);
    await roll(E, standardBatch);
    await roll(E, crmBatch);
    await roll(E, parentBatch);
    expect(await roll(E, parentBatch)).toMatchObject({ already: true });
    expect(await imp(E, 'samples', [sample], { batch: parentBatch, provenance: { filename: 'lab.csv', bdl_policy: 'flag only' } })).toMatchObject({ replayed: true, rolled_back: true });
    expect(await current('drill_qaqc_samples')).toEqual([]);
    expect(await current('drill_crm_values')).toEqual([]);
    expect((await su('select id from public.drill_qaqc_samples')).length).toBeGreaterThan(0);
    expect(await val(E, 'select public.ws_property_has_content($1)', [prop])).toBe(false);
    await expect(imp(E, 'crms', [{ ...crm, expected: 5 }])).rejects.toThrow(/CRM_REVISION_IMMUTABLE/);
    const activities = await su("select action from public.org_activity where entity_type='drill_batch'");
    expect(activities.some(x => x.action === 'imported')).toBe(true);
    expect(activities.some(x => x.action === 'rolled_back')).toBe(true);
  });
});
