// Local-only P2-9 baseline. No URL, credential or persistent database is accepted.
// Run from the repository root: node scripts/benchmark-drill-scale.mjs [--smoke] [--out=report.json]
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { cpus, platform, arch } from 'node:os';
import { performance } from 'node:perf_hooks';
import { createWorkspaceDb, readMigration } from '../tests/fixtures/workspace-db.js';
import { pull } from '../src/three-d/property-data.js';
import { computeResults, defaultRecipe } from '../shared/drillResults.js';
import { scaleCounts, scaleRow } from './fixtures/drill-scale-data.mjs';
import { parseDrillFilter, drillFilterSql } from '../tests/fixtures/drill-filter.js';

const args = process.argv.slice(2);
assert(args.every((a) => a === '--smoke' || a === '--compare-pagination' || a.startsWith('--out=')), 'Only --smoke, --compare-pagination and --out=report.json are supported; remote connections are not supported.');
const holes = args.includes('--smoke') ? 20 : 2000;
const out = args.find((a) => a.startsWith('--out='))?.slice(6);
const OWNER = '00000000-0000-4000-8000-000000000001';
const EDITOR = '00000000-0000-4000-8000-000000000002';
const OUTSIDER = '00000000-0000-4000-8000-000000000003';
const measurements = [];
const report = {
  schemaVersion: 1, startedAt: new Date().toISOString(), synthetic: true, reader: 'bounded-keyset',
  runtime: { node: process.version, platform: platform(), arch: arch(), cpu: cpus()[0]?.model },
  engine: 'in-memory PGlite, authenticated editor role, existing repository migrations',
  limits: { importBatchRows: 20000, importReferenceMs: 8000 },
  scope: 'SQL import/summary, actual paginated property loader and CSV conversion, Node intercept calculation',
  limitations: ['PGlite wall times are not hosted Postgres or network timings.', 'The 8-second comparison is a diagnostic reference, not enforcement of a server timeout.', 'Does not measure browser parsing, desurvey, WebGL rendering or device responsiveness.'],
  expected: scaleCounts(holes), measurements,
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
  let queue = Promise.resolve(), lastAssayPage;
  const requests = [];
  return { requests, get lastAssayPage() { return lastAssayPage; }, from(table) {
    assert(fields[table], `Unexpected table: ${table}`);
    let selected, property, current = false, offset = 0, limit = 1000;
    const order = [], filters = [];
    const quote = (f) => { assert(fields[table].includes(f), `Unexpected field: ${f}`); return `"${f}"`; };
    const api = {
      select(s) { selected = s.split(',').map(quote).join(','); return api; },
      eq(k, v) { assert.equal(k, 'property_id'); property = v; return api; },
      is(k, v) { assert.equal(k, 'superseded_by_batch'); assert.equal(v, null); current = true; return api; },
      gt(k, v) { filters.push(parseDrillFilter(`${k}.gt.${v}`)); return api; },
      gte(k, v) { filters.push(parseDrillFilter(`${k}.gte.${v}`)); return api; },
      or(v) { filters.push(parseDrillFilter(`or(${v})`)); return api; },
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
          const params = [property, limit, offset], where = filters.map((f) => drillFilterSql(f, params));
          const sql = `select ${selected} from public.${table} where property_id=$1 ${current ? 'and superseded_by_batch is null' : ''} ${where.length ? `and ${where.join(' and ')}` : ''} order by ${order.join(',')} limit $2 offset $3`;
          const result = await as(EDITOR, sql, params);
          if (table === 'drill_assays' && result.rows.length) lastAssayPage = { sql, params };
          requests.push({ table, offset, cursor: filters.length > 0, rows: result.rows.length, ms: Math.round((performance.now() - start) * 100) / 100 });
          return { data: result.rows, error: null };
        });
        queue = task.catch(() => {});
        return task.then(resolve, reject);
      },
    };
    return api;
  } };
}

// SQL candidates only: this does not replace the application's reader or prove
// PostgREST filter serialization. All values remain bound parameters, including
// hole IDs containing punctuation. Keep the real current-row/RLS predicates.
const assaySelect = 'select hole_id,from_m,to_m,"values",units from public.drill_assays where property_id=$1 and superseded_by_batch is null';
const assayOrder = ' order by hole_id,from_m,to_m limit $2';
function cursorQuery(mode, property, size, cursor) {
  const parts = {
    tuple: '(hole_id,from_m,to_m) > ($3,$4,$5)',
    expanded_or: '(hole_id > $3 or (hole_id = $3 and from_m > $4) or (hole_id = $3 and from_m = $4 and to_m > $5))',
    bounded_or: 'hole_id >= $3 and (hole_id > $3 or (hole_id = $3 and from_m > $4) or (hole_id = $3 and from_m = $4 and to_m > $5))',
  };
  assert(parts[mode]);
  return { sql: assaySelect + (cursor ? ` and ${parts[mode]}` : '') + assayOrder,
    params: [property, size, ...(cursor ? [cursor.hole_id, cursor.from_m, cursor.to_m] : [])] };
}
async function compareCursor(as, property, expected, size = 1000) {
  const candidates = [];
  for (const mode of ['expanded_or', 'bounded_or', 'tuple']) {
    let cursor = null, offset = 0;
    const pages = [];
    for (;;) {
      const { sql, params } = cursorQuery(mode, property, size, cursor), start = performance.now();
      const { rows } = await as(EDITOR, sql, params);
      pages.push({ offset, rows: rows.length, ms: Math.round((performance.now() - start) * 100) / 100 });
      assert.deepEqual(rows, expected.slice(offset, offset + size), `${mode}: missing, duplicated or reordered rows at ${offset}`);
      offset += rows.length;
      if (rows.length < size) break;
      cursor = rows.at(-1);
    }
    assert.equal(offset, expected.length);
    const last = cursorQuery(mode, property, size, expected[Math.max(0, expected.length - size - 1)]);
    const plan = (await as(EDITOR, `explain (analyze, buffers, format json) ${last.sql}`, last.params)).rows;
    const denied = cursorQuery(mode, property, size, expected[0]);
    assert.deepEqual((await as(OUTSIDER, denied.sql, denied.params)).rows, [], `${mode}: outsider read`);
    const result = { mode, count: offset, queryMs: Math.round(pages.reduce((n, p) => n + p.ms, 0) * 100) / 100, pages, lastPagePlan: plan };
    candidates.push(result);
    console.log(JSON.stringify({ stage: 'pagination_candidate', mode, rows: offset, queryMs: result.queryMs }));
  }
  return candidates;
}

let fixture;
try {
  fixture = await timed('database_setup', () => createWorkspaceDb({
    emails: { [OWNER]: 'owner@synthetic.test', [EDITOR]: 'editor@synthetic.test', [OUTSIDER]: 'outsider@synthetic.test' },
    migrations: ['20261023100000_workspaces_properties.sql', '20261025100000_property_files.sql', '20261027100000_drill_database.sql'].map(readMigration),
  }));
  const { db, val, one, su, as } = fixture;
  const org = (await val(OWNER, "select public.create_organization('SYNTHETIC scale benchmark')")).id;
  await su("insert into public.organization_members (org_id,user_id,role) values ($1,$2,'editor')", [org, EDITOR]);
  const property = (await one(EDITOR, "insert into public.properties (org_id,name) values ($1,'SYNTHETIC positions - not exploration data') returning id", [org])).id;
  for (const [kind, count] of Object.entries(report.expected)) {
    for (let start = 0; start < count; start += 20000) {
      const size = Math.min(20000, count - start);
      const rows = JSON.stringify(Array.from({ length: size }, (_, j) => scaleRow[kind](start + j)));
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
  report.lastAssayPagePlan = (await as(EDITOR, `explain (analyze, buffers, format json) ${client.lastAssayPage.sql}`, client.lastAssayPage.params)).rows;
  if (args.includes('--compare-pagination')) {
    report.paginationCandidates = await compareCursor(as, property, loaded.rows.assays);
    // Tiny pages force ties on the first two keys across a page boundary.
    // A replacement import leaves a historical row that every cursor must omit.
    const edgeProperty = (await one(EDITOR, "insert into public.properties (org_id,name) values ($1,'SYNTHETIC cursor boundaries') returning id", [org])).id;
    const edgeRows = ['A,(x)."quoted"\\slash', 'A-10', 'A-2', 'É-1'].flatMap((hole_id) =>
      [[0, 1], [0, 2], [0, 3], [0.1, 0.2], [0.1, 0.3]].map(([from_m, to_m]) => ({ hole_id, from_m, to_m, values: { Au: 1 }, units: { Au: 'g/t' } })));
    const importEdges = (rows) => val(EDITOR, 'select public.drill_import_batch($1,$2,$3::jsonb,$4::jsonb,$5,$6,$7)', [edgeProperty, 'assays', JSON.stringify(rows), '{}', 'SYNTHETIC-boundaries.csv', false, null]);
    assert.equal((await importEdges(edgeRows)).rows_written, edgeRows.length);
    assert.equal((await importEdges([{ ...edgeRows[0], values: { Au: 9 } }])).changed, 1);
    const expectedEdges = (await as(EDITOR, `${assaySelect} order by hole_id,from_m,to_m`, [edgeProperty])).rows;
    assert.equal(expectedEdges.length, edgeRows.length);
    report.paginationBoundaries = await compareCursor(as, edgeProperty, expectedEdges, 2);
    const anonymous = cursorQuery('bounded_or', edgeProperty, 2, expectedEdges[0]);
    await assert.rejects(as(null, anonymous.sql, anonymous.params), /permission denied/);
    report.paginationLimitations = ['Candidates are SQL-only and run after the application reader in the same warm database.', 'These SQL candidate comparisons do not validate PostgREST serialization or concurrent-import retries; see the client tests.', 'The application reader uses bounded keyset pagination and retains its import-change retry.'];
  }
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
