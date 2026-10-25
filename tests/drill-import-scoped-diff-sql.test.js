// @vitest-environment node
import { beforeAll, afterAll, it, expect } from 'vitest';
import { createWorkspaceDb, readMigration } from './fixtures/workspace-db.js';

// 20261102120000: drill_import_batch diffs against the current rows of the
// file's holes only. A property with rows on holes A and B, importing rows for
// A (and a new hole C), must give the same diff and write the same rows as the
// structure migration's whole-property diff did.
const scoped = readMigration('20261102120000_drill_import_scoped_diff.sql');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const O = id(1), E = id(2), V = id(3);
let db, val, su, org;
const imp = (prop, kind, rows, { dry = true, batch = null } = {}) =>
  val(E, 'select public.drill_import_batch($1,$2,$3::jsonb,$4::jsonb,$5,$6,$7)', [prop, kind, JSON.stringify(rows), '{}', `${kind}.csv`, dry, batch]);

const transform = { method: 'grid', grid: 'ca_nrc_ntv2_0_west.gsb', sha256: 'f064', library: 'proj4js 2.21.0' };
const collarA = { hole_id: 'A', x: 512267.1, y: 5432318.4, z: 1200, crs: 'EPSG:26910', x_src: 512345.678, y_src: 5432109.876, crs_src: 'EPSG:26710', transform };
const assay = (hole, from, to, cu) => ({ hole_id: hole, from_m: from, to_m: to, sample_id: `${hole}${from}`, values: { Cu: cu }, bdl: {}, units: { Cu: '%' } });
const SEED = {
  collars: [collarA, { hole_id: 'B', x: 513000, y: 5433000, crs: 'EPSG:26910' }],
  surveys: [{ hole_id: 'A', depth_m: 0, azimuth: 90, dip: -60 }, { hole_id: 'B', depth_m: 0, azimuth: 180, dip: -50 }],
  assays: [assay('A', 0, 1, 0.5), assay('A', 1, 2, 0.6), assay('A', 2, 3, 0.7), assay('B', 0, 1, 0.1), assay('B', 1, 2, 0.2), assay('B', 2.5, 3.5, 0.3)],
  lithology: [{ hole_id: 'A', from_m: 0, to_m: 2, code: 'QFP' }, { hole_id: 'B', from_m: 0, to_m: 2, code: 'AND' }],
  alteration: [{ hole_id: 'A', from_m: 0, to_m: 2, code: 'SER', intensity: 'strong' }, { hole_id: 'B', from_m: 0, to_m: 2, code: 'CHL' }],
  structure: [{ hole_id: 'A', depth_m: 5, type: 'vein', alpha: 45, beta: 210 }, { hole_id: 'B', depth_m: 5, type: 'fault', dip: 70, dip_direction: 135 }],
};
// Each probe touches hole A (unchanged, changed and new rows, an overlap) and
// a hole C with no rows or collar; B's rows must not show up anywhere.
const PROBES = [
  ['collars', [{ ...collarA, transform: { ...transform, library: 'proj4js 2.22.0' } }, { hole_id: 'C', x: 514000, y: 5434000, crs: 'EPSG:26910' }]],
  ['collars', [{ ...collarA, x_src: 512345.7 }]],
  ['surveys', [SEED.surveys[0], { hole_id: 'A', depth_m: 50, azimuth: 91, dip: -61 }, { hole_id: 'C', depth_m: 0, azimuth: 0, dip: -90 }]],
  ['assays', [assay('A', 0, 1, 0.5), assay('A', 1, 2, 0.65), assay('A', 2.5, 3.5, 0.9), assay('C', 0, 1, 1.1)]],
  ['lithology', [{ hole_id: 'A', from_m: 1, to_m: 3, code: 'QFP' }, { hole_id: 'C', from_m: 0, to_m: 1, code: 'OVB' }]],
  ['alteration', [SEED.alteration[0], { hole_id: 'A', from_m: 1.5, to_m: 4, code: 'POT' }]],
  ['structure', [{ ...SEED.structure[0], alpha: 50 }, { hole_id: 'C', depth_m: 1, description: 'Broken core' }]],
];
const tables = { collars: 'drill_collars', surveys: 'drill_surveys', assays: 'drill_assays', lithology: 'drill_lithology', alteration: 'drill_alteration', structure: 'drill_structure' };
// Current rows without ids, batches or timestamps, to compare two properties.
const currentRows = async (prop) => {
  const out = {};
  for (const [kind, t] of Object.entries(tables)) {
    out[kind] = (await su(`select to_jsonb(r) - 'id' - 'batch_id' - 'property_id' - 'created_at' - 'superseded_by_batch' as row
      from public.${t} r where property_id = $1 and superseded_by_batch is null`, [prop])).map(r => JSON.stringify(r.row)).sort();
  }
  return out;
};
const property = async (name) => {
  const p = (await su('insert into public.properties(org_id,name) values($1,$2) returning id', [org, name]))[0].id;
  for (const [kind, rows] of Object.entries(SEED)) expect(await imp(p, kind, rows, { dry: false })).toMatchObject({ committed: true, rows_written: rows.length });
  return p;
};
const probe = async (prop) => {
  const out = [];
  for (const [kind, rows] of PROBES) out.push(await imp(prop, kind, rows));
  return out;
};
const commitAll = async (prop) => {
  const out = [];
  for (const [kind, rows] of PROBES.filter((p, i) => i !== 1)) {
    const { batch_id: _b, ...r } = await imp(prop, kind, rows, { dry: false });
    out.push(r);
  }
  return out;
};
let before, committedBefore, wholeA, wholeB;

beforeAll(async () => {
  ({ db, val, su } = await createWorkspaceDb({ emails: { [O]: 'owner@test.example', [E]: 'editor@test.example', [V]: 'viewer@test.example' }, migrations: [
    readMigration('20261023100000_workspaces_properties.sql'), readMigration('20261025100000_property_files.sql'),
    readMigration('20261027100000_drill_database.sql'), readMigration('20261101110000_drill_qaqc_foundation.sql'),
    readMigration('20261101120000_drill_alteration.sql'), readMigration('20261102100000_drill_collar_source_coords.sql'),
    readMigration('20261102110000_drill_structure.sql'),
  ] }));
  org = (await val(O, "select public.create_organization('Scoped diff')")).id;
  await su("insert into public.organization_members(org_id,user_id,role) values($1,$2,'editor'),($1,$3,'viewer')", [org, E, V]);
  // Two identical properties: one committed with the whole-property diff, one after the migration.
  wholeA = await property('Before');
  wholeB = await property('After');
  before = await probe(wholeA);
  committedBefore = await commitAll(wholeA);
  await db.exec(scoped); await db.exec(scoped);
}, 60000);
afterAll(async () => { await db?.close(); });

it('reports exactly the whole-property diff for every kind', async () => {
  expect(await probe(wholeB)).toEqual(before);
  // The probes are meaningful: B's rows exist but stay out of every field.
  const [collarsRelabelled, collarsMoved, surveys, assays, lithology, alteration, structure] = before;
  expect(collarsRelabelled).toMatchObject({ ok: true, new: 1, changed: 0, unchanged: 1, holes: 2, new_holes: 1, source_coordinates: 1, missing_collars: 0 });
  expect(collarsMoved).toMatchObject({ changed: 1, changed_sample: [{ hole_id: 'A', before: { x_src: 512345.678 }, after: { x_src: 512345.7 } }] });
  expect(surveys).toMatchObject({ new: 2, unchanged: 1, holes: 2, new_holes: 1, missing_collars: 1, missing_collar_holes: ['C'] });
  expect(assays).toMatchObject({ new: 2, changed: 1, unchanged: 1, new_holes: 1, missing_collar_holes: ['C'], overlaps_existing: 1, overlap_holes: ['A'] });
  expect(assays.changed_sample).toEqual([{ hole_id: 'A', k1: 1, k2: 2, before: { sample_id: 'A1', values: { Cu: 0.6 }, bdl: {}, units: { Cu: '%' } },
    after: { sample_id: 'A1', values: { Cu: 0.65 }, bdl: {}, units: { Cu: '%' } } }]);
  expect(lithology).toMatchObject({ new: 2, overlaps_existing: 1, overlap_holes: ['A'], new_holes: 1 });
  // 1.5-4 overlaps 0-2, but the file restates 0-2, so it is not an overlap with a row it keeps.
  expect(alteration).toMatchObject({ new: 1, unchanged: 1, overlaps_existing: 0, new_holes: 0, missing_collars: 0 });
  expect(structure).toMatchObject({ new: 1, changed: 1, new_holes: 1, missing_collar_holes: ['C'] });
});

it('commits the same rows and summaries as the whole-property diff', async () => {
  expect(await commitAll(wholeB)).toEqual(committedBefore);
  expect(await currentRows(wholeB)).toEqual(await currentRows(wholeA));
  for (const prop of [wholeA, wholeB]) expect(await su("select x_src, crs_src, transform from public.drill_collars where property_id=$1 and hole_id='A' and superseded_by_batch is null", [prop]))
    .toEqual([{ x_src: 512345.678, crs_src: 'EPSG:26710', transform: { ...transform, library: 'proj4js 2.21.0' } }]);
  expect(await imp(wholeB, 'assays', PROBES[3][1], { dry: false })).toMatchObject({ nothing_to_do: true, unchanged: 4 });
});

it('reads only the listed holes and stays private to the import function', async () => {
  expect(await su("select hole_id, count(*)::int as n from public.drill_current_for_holes('assays', $1, array['A']) group by 1", [wholeB])).toEqual([{ hole_id: 'A', n: 4 }]);
  expect(await su("select count(*)::int as n from public.drill_current_for_holes('assays', $1, '{}')", [wholeB])).toEqual([{ n: 0 }]);
  for (const role of ['anon', 'authenticated']) expect(await su("select has_function_privilege($1, 'public.drill_current_for_holes(text,uuid,text[])', 'EXECUTE') as allowed", [role])).toEqual([{ allowed: false }]);
  expect(await su("select has_function_privilege('authenticated','public.drill_import_batch(uuid,text,jsonb,jsonb,text,boolean,uuid)','EXECUTE') as allowed")).toEqual([{ allowed: true }]);
  await expect(val(V, 'select public.drill_import_batch($1,$2,$3::jsonb)', [wholeB, 'assays', JSON.stringify(PROBES[3][1])])).rejects.toThrow(/ORG_READ_ONLY/);
});
