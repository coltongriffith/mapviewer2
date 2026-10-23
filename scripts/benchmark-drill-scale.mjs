// Local-only P2-9 baseline. No URL, credential or persistent database is accepted.
// Run from the repository root: node scripts/benchmark-drill-scale.mjs [--smoke] [--out=report.json]
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { cpus, platform, arch } from 'node:os';
import { performance } from 'node:perf_hooks';
import { createWorkspaceDb, readMigration } from '../tests/fixtures/workspace-db.js';
import { pull } from '../src/three-d/property-data.js';
import { computeResults, defaultRecipe } from '../shared/drillResults.js';

const args = process.argv.slice(2);
assert(args.every((a) => a === '--smoke' || a.startsWith('--out=')), 'Only --smoke and --out=report.json are supported; remote connections are not supported.');
const holes = args.includes('--smoke') ? 20 : 2000;
const out = args.find((a) => a.startsWith('--out='))?.slice(6);
const OWNER = '00000000-0000-4000-8000-000000000001';
const EDITOR = '00000000-0000-4000-8000-000000000002';
const holeId = (n) => `SYNTHETIC-${String(n + 1).padStart(4, '0')}`;
const measurements = [];
const report = {
  schemaVersion: 1, startedAt: new Date().toISOString(), synthetic: true,
  runtime: { node: process.version, platform: platform(), arch: arch(), cpu: cpus()[0]?.model },
  engine: 'in-memory PGlite, authenticated editor role, existing repository migrations',
  limits: { importBatchRows: 20000, importReferenceMs: 8000 },
  scope: 'SQL import/summary, actual paginated property loader and CSV conversion, Node intercept calculation',
  limitations: ['PGlite wall times are not hosted Postgres or network timings.', 'The 8-second comparison is a diagnostic reference, not enforcement of a server timeout.', 'Does not measure browser parsing, desurvey, WebGL rendering or device responsiveness.'],
  expected: { collars: holes, surveys: holes * 10, assays: holes * 100 }, measurements,
};
async function timed(stage, run, detail = {}) {
  const start = performance.now();
  const result = await run();
  const ms = Math.round((performance.now() - start) * 100) / 100;
  measurements.push({ stage, ...detail, ms });
  console.log(JSON.stringify({ stage, ...detail, ms }));
  return result;
}

// A narrow PostgREST-shaped adapter lets the real property loader read PGlite
// in its normal 1,000-row pages. SQL is parameterized and identifiers allowlisted.
function localClient(as) {
  const fields = {
    drill_import_batches: ['id', 'kind', 'summary', 'mapping', 'created_at', 'rolled_back_at'],
    drill_collars: ['hole_id', 'x', 'y', 'z', 'crs', 'azimuth', 'dip', 'depth', 'status', 'planned'],
    drill_surveys: ['hole_id', 'depth_m', 'azimuth', 'dip'],
    drill_assays: ['hole_id', 'from_m', 'to_m', 'values', 'bdl', 'units'],
    drill_lithology: ['hole_id', 'from_m', 'to_m', 'code', 'description'],
  };
  let queue = Promise.resolve();
  const requests = [];
  return { requests, from(table) {
    assert(fields[table], `Unexpected table: ${table}`);
    let selected, property, current = false, offset = 0, limit = 1000;
    const order = [];
    const quote = (f) => { assert(fields[table].includes(f), `Unexpected field: ${f}`); return `"${f}"`; };
    const api = {
      select(s) { selected = s.split(',').map(quote).join(','); return api; },
      eq(k, v) { assert.equal(k, 'property_id'); property = v; return api; },
      is(k, v) { assert.equal(k, 'superseded_by_batch'); assert.equal(v, null); current = true; return api; },
      order(k, options) { order.push(`${quote(k)} ${options?.ascending === false ? 'desc' : 'asc'}`); return api; },
      limit(n) { limit = n; return api; },
      range(a, b) { offset = a; limit = b - a + 1; return api; },
      then(resolve, reject) {
        assert(property && selected && order.length);
        assert(Number.isInteger(offset) && offset >= 0 && Number.isInteger(limit) && limit > 0);
        // The test fixture switches connection roles per query. Serialize that
        // shared connection; hosted PostgREST would use independent connections.
        const task = queue.then(async () => {
          const start = performance.now();
          const result = await as(EDITOR, `select ${selected} from public.${table} where property_id=$1 ${current ? 'and superseded_by_batch is null' : ''} order by ${order.join(',')} limit $2 offset $3`, [property, limit, offset]);
          requests.push({ table, offset, rows: result.rows.length, ms: Math.round((performance.now() - start) * 100) / 100 });
          return { data: result.rows, error: null };
        });
        queue = task.catch(() => {});
        return task.then(resolve, reject);
      },
    };
    return api;
  } };
}

let fixture;
try {
  fixture = await timed('database_setup', () => createWorkspaceDb({
    emails: { [OWNER]: 'owner@synthetic.test', [EDITOR]: 'editor@synthetic.test' },
    migrations: ['20261023100000_workspaces_properties.sql', '20261025100000_property_files.sql', '20261027100000_drill_database.sql'].map(readMigration),
  }));
  const { db, val, one, su, as } = fixture;
  const org = (await val(OWNER, "select public.create_organization('SYNTHETIC scale benchmark')")).id;
  await su("insert into public.organization_members (org_id,user_id,role) values ($1,$2,'editor')", [org, EDITOR]);
  const property = (await one(EDITOR, "insert into public.properties (org_id,name) values ($1,'SYNTHETIC positions - not exploration data') returning id", [org])).id;
  const make = {
    collars: (i) => ({ hole_id: holeId(i), x: 500000 + (i % 50) * 20, y: 5500000 + Math.floor(i / 50) * 20, z: 1000, crs: 'EPSG:32610', azimuth: 90, dip: -60, depth: 200 }),
    surveys: (i) => ({ hole_id: holeId(Math.floor(i / 10)), depth_m: (i % 10) * 20, azimuth: 90 + (i % 10), dip: -60 }),
    assays: (i) => ({ hole_id: holeId(Math.floor(i / 100)), from_m: (i % 100) * 2, to_m: (i % 100) * 2 + 2, values: { Au: ((i % 10) + 1) / 10 }, units: { Au: 'g/t' }, sample_id: `SYN-${i}` }),
  };
  for (const [kind, count] of Object.entries(report.expected)) {
    for (let start = 0; start < count; start += 20000) {
      const size = Math.min(20000, count - start);
      const rows = JSON.stringify(Array.from({ length: size }, (_, j) => make[kind](start + j)));
      const result = await timed('import', () => val(EDITOR, 'select public.drill_import_batch($1,$2,$3::jsonb,$4::jsonb,$5,$6,$7)',
        [property, kind, rows, '{}', `SYNTHETIC-${kind}-${start}.csv`, false, null]), { kind, offset: start, rows: size });
      assert.equal(result.committed, true); assert.equal(result.rows_written, size); assert.equal(result.new, size);
    }
  }
  await db.exec('analyze public.drill_collars; analyze public.drill_surveys; analyze public.drill_assays;');
  report.summary = await timed('summary', () => val(EDITOR, 'select public.drill_property_summary($1)', [property]));
  for (const [kind, count] of Object.entries(report.expected)) assert.equal(report.summary[kind], count);
  const client = localClient(as);
  const loaded = await timed('property_pull_and_csv', () => pull(client, { id: property, name: 'SYNTHETIC benchmark' }));
  for (const [kind, count] of Object.entries(report.expected)) assert.equal(loaded.rows[kind].length, count);
  assert.equal(new Set(loaded.rows.assays.map((r) => `${r.hole_id}:${r.from_m}:${r.to_m}`)).size, holes * 100);
  report.reads = client.requests;
  report.files = loaded.files.map((f) => ({ name: f.name, bytes: Buffer.byteLength(f.text) }));
  const recipe = { ...defaultRecipe(['Au'], { Au: 'g/t' }), inclCutoff: null };
  const computed = await timed('intercepts', () => computeResults(loaded.rows.assays, recipe));
  assert.deepEqual(computed.problems, []);
  assert.equal(new Set(computed.results.map((r) => r.holeId)).size, holes);
  report.resultCount = computed.results.length;
  report.lastAssayPagePlan = (await as(EDITOR, 'explain (analyze, buffers, format json) select hole_id,from_m,to_m,"values",units from public.drill_assays where property_id=$1 and superseded_by_batch is null order by hole_id,from_m,to_m limit 1000 offset $2', [property, Math.max(0, holes * 100 - 1000)])).rows;
  report.importReferenceExceeded = measurements.filter((m) => m.stage === 'import' && m.ms >= 8000);
  report.status = report.importReferenceExceeded.length ? 'local-import-reference-exceeded' : 'local-checks-passed';
  if (report.importReferenceExceeded.length) process.exitCode = 2;
} catch (error) {
  report.status = 'failed'; report.error = error.stack; process.exitCode = 1;
} finally {
  await fixture?.db.close();
  report.finishedAt = new Date().toISOString();
  if (out) await writeFile(out, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ status: report.status, expected: report.expected, resultCount: report.resultCount, error: report.error, report: out || null }));
}
