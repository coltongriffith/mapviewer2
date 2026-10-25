// P2-9 drill database scale test. Local only: never run against a hosted database, and not part of CI.
//
//   node scripts/drill-scale-test.mjs                    a local Postgres server (PGHOST/PGPORT/PGUSER or --host/--port/--user)
//   node scripts/drill-scale-test.mjs --pglite           in-process PGlite instead (timings are pessimistic; see docs/drill-scale-test.md)
//   options: --holes=2000  --timeout (enforce the 8 s authenticated statement timeout on every request)
//            --explain (EXPLAIN ANALYZE the slow reads)  --migration=<file in supabase/migrations> (apply one more, to compare)
//            --extra-assays=800000 (then bulk-add current assays to the property in SQL and re-measure an import and the summary)
//            --keep (keep the local database afterwards)  --out=report.json
//
// It creates a throwaway database (dropped at the end), applies the repository's migrations over the SQL test fixture's
// auth stubs, then seeds one property as an editor through the real client code (drillDb.buildImport and the
// drill_import_batch RPC, 20,000-row batches): 2,000 collars, 20,000 survey stations, 200,000 multi-element assays
// (some below detection), 20,000 lithology and 20,000 alteration intervals. It then measures the summary, a replacement
// import and rollbacks, the /3d and 2D drill plan loader (property-data.pull), the Results panel reader
// (drillResultsDb.assays) and the intercept calculation (shared/drillResults.js) in Node. Only loopback hosts or a
// Unix socket are accepted; DATABASE_URL and other connection strings are ignored.
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { cpus, totalmem, platform, arch, loadavg } from 'node:os';
import { performance } from 'node:perf_hooks';
import { randomUUID } from 'node:crypto';
import { register } from 'node:module';
import { createWorkspaceDb, readMigration, baselineSql, BASELINE_MIGRATIONS } from '../tests/fixtures/workspace-db.js';
import { parseDrillFilter, drillFilterSql } from '../tests/fixtures/drill-filter.js';
import { autoMapping, buildImport, drillDb, MAX_ROWS } from '../src/utils/drillDb.js';
import { pull } from '../src/three-d/property-data.js';
import { computeResults, defaultRecipe } from '../shared/drillResults.js';

// Vite resolves the app's extensionless relative imports ('./drillDb'); Node needs a hint.
register(`data:text/javascript,${encodeURIComponent(`export async function resolve(s, c, next) {
  try { return await next(s, c); } catch (e) { if (e.code === 'ERR_MODULE_NOT_FOUND' && s.startsWith('.') && !/\\.[cm]?jsx?$/.test(s)) return next(s + '.js', c); throw e; } }`)}`);
const { drillResultsDb } = await import('../src/utils/drillResultsDb.js');
const { pullPropertyResults } = await import('../src/utils/propertyResults.js');

const KNOWN = ['--pglite', '--timeout', '--explain', '--keep'];
const args = process.argv.slice(2);
const opt = (name) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
assert(args.every((a) => KNOWN.includes(a) || /^--(holes|out|host|port|user|migration|extra-assays)=/.test(a)), `Unknown option. Supported: ${KNOWN.join(' ')} --holes= --migration= --extra-assays= --out= --host= --port= --user=`);
const HOLES = Number(opt('holes') || 2000);
assert(Number.isInteger(HOLES) && HOLES > 0 && HOLES <= 2000, '--holes must be 1 to 2000');
const BUDGET_MS = 8000; // the authenticated role's statement timeout (20260807000003_service_role_statement_timeout.sql)
const OWNER = '00000000-0000-4000-8000-000000000001', EDITOR = '00000000-0000-4000-8000-000000000002';
const MIGRATIONS = ['20261023100000_workspaces_properties.sql', '20261025100000_property_files.sql', '20261027100000_drill_database.sql',
  '20261028100000_drill_intercepts.sql', '20261101100000_drill_batch_certificates.sql', '20261101110000_drill_qaqc_foundation.sql',
  '20261101120000_drill_alteration.sql'];
if (opt('migration')) {
  assert(/^\d{14}_[a-z0-9_]+\.sql$/.test(opt('migration')) && existsSync(`supabase/migrations/${opt('migration')}`), '--migration names a file in supabase/migrations');
  MIGRATIONS.push(opt('migration'));
}
const EXTRA = Number(opt('extra-assays') || 0);
assert(Number.isInteger(EXTRA) && EXTRA >= 0 && EXTRA <= 1800000, '--extra-assays must be 0 to 1,800,000 (the property limit is 2,000,000 rows)');
const round = (ms) => Math.round(ms * 10) / 10;

// ── Engines: a local Postgres server, or PGlite ─────────────────────────────
// tx(uid, fn) runs fn(query) in one transaction as PostgREST would: the JWT subject, then `authenticated`.
async function postgres() {
  const host = opt('host') || process.env.PGHOST || 'localhost', port = Number(opt('port') || process.env.PGPORT || 5432);
  const user = opt('user') || process.env.PGUSER || 'postgres';
  assert(['localhost', '127.0.0.1', '::1'].includes(host) || host.startsWith('/'), `Refusing non-local host "${host}": this test only runs on a local server.`);
  const { default: pg } = await import('pg');
  // As PostgREST sends them: timestamps as ISO text, bigint/numeric as numbers.
  pg.types.setTypeParser(1184, (v) => new Date(v).toISOString());
  pg.types.setTypeParser(20, Number); pg.types.setTypeParser(1700, Number);
  const base = { host, port, user, password: process.env.PGPASSWORD };
  const admin = new pg.Client({ ...base, database: 'postgres' });
  await admin.connect();
  const name = `drill_scale_${Date.now()}`;
  await admin.query(`create database ${name}`);
  const pool = new pg.Pool({ ...base, database: name, max: 4 });
  const { rows: [{ version, shared_buffers: sb, work_mem: wm }] } = await pool.query("select version(), current_setting('shared_buffers') shared_buffers, current_setting('work_mem') work_mem");
  await pool.query(`do $$ begin
    if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
    if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
    if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if; end $$`);
  return {
    name: 'postgres', detail: `${version}; shared_buffers ${sb}, work_mem ${wm}`,
    exec: async (sql) => { await pool.query(sql); },
    async tx(uid, fn, { timeout = false, notices } = {}) {
      const c = await pool.connect(), onNotice = (n) => notices?.push(n.message);
      c.on('notice', onNotice);
      try {
        await c.query('begin');
        if (notices) await c.query("load 'auto_explain'; set local auto_explain.log_min_duration = 0; set local auto_explain.log_analyze = on; set local auto_explain.log_nested_statements = on; set local auto_explain.log_level = 'notice'");
        await c.query("select set_config('request.jwt.claim.sub', $1, true)", [uid]);
        await c.query('set local role authenticated');
        if (timeout) await c.query(`set local statement_timeout = '${BUDGET_MS}ms'`);
        const out = await fn((sql, params) => c.query(sql, params));
        await c.query('commit');
        return out;
      } catch (e) { await c.query('rollback').catch(() => {}); throw e; } finally { c.off('notice', onNotice); c.release(); }
    },
    async close() {
      await pool.end();
      if (args.includes('--keep')) console.log(`Kept database ${name} on ${host}:${port}; drop it with: dropdb -h ${host} -p ${port} -U ${user} ${name}`);
      else await admin.query(`drop database if exists ${name}`);
      await admin.end();
    },
  };
}

async function pglite(emails) {
  const { db } = await createWorkspaceDb({ emails, migrations: MIGRATIONS.map(readMigration) });
  let queue = Promise.resolve(); // one connection: requests run one at a time
  const serial = (fn) => { const t = queue.then(fn); queue = t.catch(() => {}); return t; };
  return {
    name: 'pglite', detail: `PGlite ${(await db.query('select version()')).rows[0].version} (in-process WebAssembly, single connection)`, ready: true,
    exec: (sql) => serial(() => db.exec(sql)),
    tx: (uid, fn, { timeout = false } = {}) => serial(() => db.transaction(async (t) => {
      await t.query("select set_config('request.jwt.claim.sub', $1, true)", [uid]);
      await t.exec('set local role authenticated');
      if (timeout) await t.exec(`set local statement_timeout = '${BUDGET_MS}ms'`);
      return fn((sql, params) => t.query(sql, params));
    })),
    close: () => db.close(),
  };
}

// ── A PostgREST-shaped client for the application's own readers ────────────
// Only the calls the drill readers make; identifiers allowlisted, values bound.
const COLUMNS = {
  drill_import_batches: ['id', 'kind', 'summary', 'mapping', 'created_at', 'rolled_back_at', 'property_id'],
  drill_collars: ['hole_id', 'x', 'y', 'z', 'crs', 'azimuth', 'dip', 'depth', 'status', 'planned', 'property_id', 'superseded_by_batch'],
  drill_surveys: ['hole_id', 'depth_m', 'azimuth', 'dip', 'property_id', 'superseded_by_batch'],
  drill_assays: ['hole_id', 'from_m', 'to_m', 'values', 'bdl', 'units', 'property_id', 'superseded_by_batch'],
  drill_lithology: ['hole_id', 'from_m', 'to_m', 'code', 'description', 'property_id', 'superseded_by_batch'],
  drill_alteration: ['hole_id', 'from_m', 'to_m', 'code', 'description', 'intensity', 'property_id', 'superseded_by_batch'],
};
const iso = (row) => { for (const k in row) if (row[k] instanceof Date) row[k] = row[k].toISOString(); return row; };
function localClient(engine, uid, { timeout }) {
  const requests = [], signatures = new Map();
  const record = (what, t0, rows, sql, params) => { const r = { what, ms: round(performance.now() - t0), rows, sql, params }; requests.push(r); return r; };
  return {
    requests,
    from(table) {
      assert(COLUMNS[table], `Unexpected table ${table}`);
      const q = (f) => { assert(COLUMNS[table].includes(f), `Unexpected column ${table}.${f}`); return `"${f}"`; };
      const where = [], params = [], order = [];
      let select, limit = null, offset = 0;
      const api = {
        select(s) { select = s.split(',').map(q).join(','); return api; },
        eq(k, v) { params.push(v); where.push(`${q(k)} = $${params.length}`); return api; },
        is(k, v) { assert.equal(v, null); where.push(`${q(k)} is null`); return api; },
        gt(k, v) { where.push(drillFilterSql(parseDrillFilter(`${k}.gt.${v}`), params)); return api; },
        gte(k, v) { where.push(drillFilterSql(parseDrillFilter(`${k}.gte.${v}`), params)); return api; },
        or(v) { where.push(drillFilterSql(parseDrillFilter(`or(${v})`), params)); return api; },
        order(k, o) { order.push(`${q(k)} ${o?.ascending === false ? 'desc' : 'asc'}`); return api; },
        limit(n) { limit = n; return api; },
        range(a, b) { offset = a; limit = b - a + 1; return api; },
        then(resolve, reject) {
          const sql = `select ${select} from public.${table}${where.length ? ` where ${where.join(' and ')}` : ''}${order.length ? ` order by ${order.join(', ')}` : ''}${limit ? ` limit ${limit}` : ''}${offset ? ` offset ${offset}` : ''}`;
          const t0 = performance.now();
          return engine.tx(uid, (query) => query(sql, params), { timeout })
            .then((r) => { record(table, t0, r.rows.length, sql, [...params]); return { data: r.rows.map(iso), error: null }; },
              (e) => { record(table, t0, 0, sql, [...params]).error = e.message; return { data: null, error: { message: e.message, code: e.code } }; })
            .then(resolve, reject);
        },
      };
      return api;
    },
    async rpc(fn, a = {}) {
      assert(/^drill_[a-z_]+$/.test(fn), `Unexpected function ${fn}`);
      const t0 = performance.now();
      try {
        const out = await engine.tx(uid, async (query) => {
          if (!signatures.has(fn)) {
            const { rows: [s] } = await query(`select p.proargnames as names, array(select format_type(t, null) from unnest(p.proargtypes::oid[]) with ordinality u(t, i) order by i) as types
              from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = $1`, [fn]);
            assert(s, `No function ${fn}`);
            signatures.set(fn, Object.fromEntries(s.names.map((n, i) => [n, s.types[i]])));
          }
          const types = signatures.get(fn), names = Object.keys(a);
          names.forEach((n) => assert(types[n], `${fn} has no argument ${n}`));
          const values = names.map((n) => (a[n] !== null && /^jsonb?$/.test(types[n]) ? JSON.stringify(a[n]) : a[n]));
          return (await query(`select public.${fn}(${names.map((n, i) => `${n} => $${i + 1}::${types[n]}`).join(', ')}) as r`, values)).rows[0].r;
        }, { timeout });
        record(fn, t0, 1);
        return { data: out, error: null };
      } catch (e) {
        record(fn, t0, 0).error = e.message;
        return { data: null, error: { message: e.message, code: e.code } };
      }
    },
  };
}

// ── Synthetic data, as the parsed CSV files an importer would choose ───────
// Deterministic invented values; not exploration data.
const rand = (...k) => { let h = 2166136261; for (const n of k) h = Math.imul(h ^ n, 16777619) ^ (h >>> 13); return ((h >>> 0) % 1e6) / 1e6; };
const hole = (h) => `SYN-${String(h + 1).padStart(4, '0')}`;
const FILES = {
  collars: { header: ['HoleID', 'Easting', 'Northing', 'Elevation', 'Azimuth', 'Dip', 'Depth'], perHole: 1,
    row: (h) => [hole(h), String(500000 + (h % 50) * 40), String(5500000 + Math.floor(h / 50) * 40), '1000', String(Math.round(rand(h, 1) * 359)), '-60', '200'] },
  surveys: { header: ['HoleID', 'Depth', 'Azimuth', 'Dip'], perHole: 10,
    row: (h, k) => [hole(h), String(k * 20), (90 + rand(h, k, 2) * 4).toFixed(1), (-60 + rand(h, k, 3) * 2).toFixed(1)] },
  assays: { header: ['HoleID', 'SampleID', 'From', 'To', 'Cu_pct', 'Au_gpt', 'Ag_gpt', 'Mo_ppm'], perHole: 100,
    row: (h, k) => {
      const zone = k >= 30 && k < 70, r = (s) => rand(h, k, s);
      const au = r(5) < 0.06 ? '<0.005' : (zone ? 0.2 + r(6) * 1.5 : r(6) * 0.08).toFixed(3);
      const ag = r(7) < 0.02 ? '-0.5' : (zone ? 1 + r(8) * 12 : r(8) * 1.5).toFixed(2);
      const mo = r(9) < 0.03 ? 'BDL' : String(Math.round(zone ? 40 + r(10) * 300 : r(10) * 20));
      return [hole(h), `S${h * 100 + k}`, String(k * 2), String(k * 2 + 2), (zone ? 0.15 + r(4) * 0.9 : r(4) * 0.12).toFixed(3), au, ag, mo];
    } },
  lithology: { header: ['HoleID', 'From', 'To', 'Lith', 'Description'], perHole: 10,
    row: (h, k) => { const c = ['AND', 'QMD', 'DIO', 'BX', 'FP'][Math.floor(rand(h, k, 11) * 5)]; return [hole(h), String(k * 20), String(k * 20 + 20), c, `${c} synthetic interval`]; } },
  alteration: { header: ['HoleID', 'From', 'To', 'Alteration', 'Intensity'], perHole: 10,
    row: (h, k) => [hole(h), String(k * 20), String(k * 20 + 20), ['POT', 'PHY', 'PRO', 'ARG', 'SER'][Math.floor(rand(h, k, 12) * 5)], ['weak', 'moderate', 'strong'][Math.floor(rand(h, k, 13) * 3)]] },
};
// One file's rows for holes [from, to), through the importer's own mapping and checks.
function importRows(kind, from, to, tweak = (r) => r) {
  const f = FILES[kind], rows = [];
  for (let h = from; h < to; h++) for (let k = 0; k < f.perHole; k++) rows.push(tweak(f.row(h, k)));
  const table = { header: f.header, rows }, mapping = autoMapping(kind, f.header, rows, { crs: 'EPSG:32610' });
  const built = buildImport(kind, table, mapping);
  assert.equal(built.errorCount, 0, `${kind}: ${JSON.stringify(built.errors.slice(0, 3))}`);
  return { rows: built.rows, mapping };
}

// ── The run ─────────────────────────────────────────────────────────────────
const results = [];
const report = { startedAt: new Date().toISOString(), holes: HOLES, options: args, runtime: { node: process.version, platform: platform(), arch: arch(), cpu: cpus()[0]?.model, cpus: cpus().length, memoryGb: Math.round(totalmem() / 2 ** 30) }, results };
function note(stage, ms, { budget = BUDGET_MS, ...detail } = {}) {
  const r = { stage, ms: round(ms), budgetMs: budget, pass: budget == null ? null : !detail.error && ms < budget, ...detail };
  results.push(r);
  console.log(`${stage.padEnd(44)} ${String(r.ms).padStart(10)} ms  ${budget == null ? '' : r.pass ? 'pass' : 'OVER BUDGET'}${detail.note ? `  ${detail.note}` : ''}`);
  return r;
}
async function timed(stage, run, options) { const t0 = performance.now(); const out = await run(); note(stage, performance.now() - t0, options); return out; }
// The same, recording a failure (such as the statement timeout) instead of stopping the run.
async function attempt(stage, run, options) {
  const t0 = performance.now();
  try { return await timed(stage, run, options); } catch (e) { note(stage, performance.now() - t0, { ...options, error: e.message, note: e.message }); return null; }
}
const reads = (requests, what) => requests.filter((r) => what.includes(r.what));
const slowest = (list) => list.reduce((m, r) => (r.ms > (m?.ms ?? -1) ? r : m), null);

let engine;
try {
  const emails = { [OWNER]: 'owner@synthetic.test', [EDITOR]: 'editor@synthetic.test' };
  const t0 = performance.now();
  if (args.includes('--pglite')) engine = await pglite(emails);
  else {
    engine = await postgres();
    await engine.exec(baselineSql({ emails }));
    for (const m of [...BASELINE_MIGRATIONS, ...MIGRATIONS]) await engine.exec(readMigration(m));
  }
  report.engine = engine.detail;
  report.loadBefore = loadavg().map((n) => round(n));
  console.log(`Engine: ${engine.detail}\nMigrations: ${MIGRATIONS.join(', ')}\nLoad average: ${report.loadBefore.join(', ')} on ${cpus().length} CPUs (other work on the machine slows every timing)\n`);
  note('setup', performance.now() - t0, { budget: null });
  const timeout = args.includes('--timeout');
  const asUser = (uid) => localClient(engine, uid, { timeout });
  const editor = asUser(EDITOR), db = drillDb(editor);
  const org = (await engine.tx(OWNER, async (q) => (await q("select public.create_organization('SYNTHETIC scale test') as o")).rows[0].o)).id;
  await engine.exec(`insert into public.organization_members (org_id, user_id, role) values ('${org}', '${EDITOR}', 'editor')`);
  const property = await engine.tx(EDITOR, async (q) => (await q("insert into public.properties (org_id, name) values ($1, 'SYNTHETIC scale test') returning id", [org])).rows[0].id);
  const prop = { id: property, name: 'SYNTHETIC scale test' };

  // Seed: every batch dry-run, then committed, as the import dialog does.
  const batches = {};
  const importBatch = async (label, kind, rows, mapping, expect) => {
    const args = { propertyId: property, kind, rows, mapping, filename: `${label}.csv` };
    const dry = await timed(`${label} dry run`, () => db.dryRun(args), { rows: rows.length });
    assert.equal(dry.ok, true, JSON.stringify(dry.errors));
    const batchId = randomUUID();
    const done = await timed(`${label} commit`, () => db.commit({ ...args, batchId }), { rows: rows.length });
    assert.equal(done.committed, true);
    if (expect) assert.equal(done[expect[0]], expect[1]);
    return { batchId, dry, done };
  };
  for (const kind of ['collars', 'surveys', 'assays', 'lithology', 'alteration']) {
    const per = Math.floor(MAX_ROWS / FILES[kind].perHole);
    for (let h = 0, n = 1; h < HOLES; h += per, n++) {
      const { rows, mapping } = importRows(kind, h, Math.min(HOLES, h + per));
      batches[`${kind}-${n}`] = await importBatch(`${kind} batch ${n}`, kind, rows, mapping, ['rows_written', rows.length]);
    }
  }

  // Re-imports on the full property: unchanged, then the last assay file with changed grades (supersedes 20,000 rows).
  const lastN = Math.ceil(HOLES / 200), lastFrom = (lastN - 1) * 200;
  const last = importRows('assays', lastFrom, HOLES);
  const same = await timed('assays re-import, all unchanged (dry run)', () => db.dryRun({ propertyId: property, kind: 'assays', rows: last.rows, mapping: last.mapping }), { rows: last.rows.length });
  assert.equal(same.unchanged, last.rows.length);
  const changed = importRows('assays', lastFrom, HOLES, (r) => { r[4] = (Number(r[4]) + 0.0011).toFixed(4); return r; });
  const replacement = await importBatch('assays replacement (changed)', 'assays', changed.rows, changed.mapping, ['changed', changed.rows.length]);

  // Rollbacks: the replacement (withdraws and restores 20,000), the original batch, then import it again.
  const rb1 = await timed('rollback replacement batch', () => db.rollback(replacement.batchId), { rows: changed.rows.length });
  assert.equal(rb1.restored, changed.rows.length);
  const rb2 = await timed('rollback original assay batch', () => db.rollback(batches[`assays-${lastN}`].batchId), { rows: last.rows.length });
  assert.equal(rb2.withdrawn, last.rows.length);
  await importBatch('assays re-import after rollback', 'assays', last.rows, last.mapping, ['new', last.rows.length]);

  const counts = { collars: HOLES, surveys: HOLES * 10, assays: HOLES * 100, lithology: HOLES * 10, alteration: HOLES * 10 };
  const summary = await timed('drill_property_summary (before analyze)', () => db.summary(property));
  for (const [k, n] of Object.entries(counts)) assert.equal(summary[k], n, `summary ${k}`);
  assert.equal(summary.holes, HOLES);
  // Autovacuum analyzes tables after bulk loads; measure reads on settled statistics.
  await engine.exec('analyze');
  await timed('drill_property_summary', () => db.summary(property));

  // The /3d and 2D drill plan loader: batches, then every table in 1,000-row keyset pages, four at a time.
  const rawReader = asUser(EDITOR);
  const loaded = await timed('pull() lithology: /3d + 2D plan load', () => pull(rawReader, prop), { budget: null });
  for (const k of ['collars', 'surveys', 'assays', 'lithology']) assert.equal(loaded.rows[k].length, counts[k], `pull ${k}`);
  const page = slowest(reads(rawReader.requests, Object.keys(COLUMNS)));
  note('  slowest single page request', page.ms, { note: page.what });
  note('  drill_import_batches list', reads(rawReader.requests, ['drill_import_batches'])[0].ms);
  const altReader = asUser(EDITOR);
  const alt = await timed('pull() alteration source', () => pull(altReader, prop, () => {}, 2, { geologySource: 'alteration' }), { budget: null });
  assert.equal(alt.rows.alteration.length, counts.alteration);

  // With a saved recipe: as /3d and the 2D plan load calculated results.
  const recipe = { ...defaultRecipe(['Cu', 'Au', 'Ag', 'Mo'], { Cu: '%', Au: 'g/t', Ag: 'g/t', Mo: 'ppm' }), bdl: 'half' };
  const saved = await drillResultsDb(editor).save(property, 'SYNTHETIC CuEq', recipe, 0);
  assert.ok(saved);
  const recipeReader = asUser(EDITOR);
  const withResults = await timed('pullPropertyResults() with recipe', () => pullPropertyResults(recipeReader, prop, { recipeName: 'SYNTHETIC CuEq' }), { budget: null });
  assert.ok(withResults.resultCount > 0);
  note('  drill_property_recipes', slowest(reads(recipeReader.requests, ['drill_property_recipes'])).ms);

  // The Results panel's reader: 1,000-row pages by offset.
  const offsetReader = asUser(EDITOR);
  const panel = await timed('Results panel assays (offset pages)', () => drillResultsDb(offsetReader).assays(property), { budget: null });
  assert.equal(panel.rows.length, counts.assays);
  const deepest = slowest(offsetReader.requests);
  note('  slowest offset page', deepest.ms, { note: deepest.sql.match(/offset \d+/)?.[0] || 'first page' });

  // The intercept calculation in Node on the 200,000 assays.
  const multi = await timed('computeResults CuEq (Cu, Au, Ag, Mo) + incl.', () => computeResults(loaded.rows.assays, recipe), { budget: null });
  assert.deepEqual(multi.problems, []);
  const au = { ...defaultRecipe(['Au'], { Au: 'g/t' }), inclCutoff: null };
  const single = await timed('computeResults Au only', () => computeResults(loaded.rows.assays, au), { budget: null });
  report.intercepts = { cuEq: multi.results.length, cuEqIncl: multi.results.reduce((n, r) => n + r.incl.length, 0), au: single.results.length };
  console.log(`  ${multi.results.length} CuEq intercepts (${report.intercepts.cuEqIncl} incl.), ${single.results.length} Au intercepts`);

  if (args.includes('--explain')) {
    const explain = async (label, sql, params) => {
      const { rows } = await engine.tx(EDITOR, (q) => q(`explain (analyze, buffers) ${sql}`, params));
      const plan = rows.map((r) => r['QUERY PLAN']).join('\n');
      (report.plans ||= {})[label] = plan;
      console.log(`\n── EXPLAIN ANALYZE ${label}\n${plan}`);
    };
    await explain('deepest offset page', deepest.sql, deepest.params);
    const lastKeyset = reads(rawReader.requests, ['drill_assays']).filter((r) => r.rows).at(-1);
    await explain('last keyset assay page', lastKeyset.sql, lastKeyset.params);
    const cur = 'property_id = $1 and superseded_by_batch is null';
    await explain('summary: holes', `select count(*) from (select hole_id from public.drill_collars where ${cur} union select hole_id from public.drill_surveys where ${cur}
      union select hole_id from public.drill_assays where ${cur} union select hole_id from public.drill_lithology where ${cur} union select hole_id from public.drill_alteration where ${cur}) h`, [property]);
    await explain('summary: elements', `select distinct k from public.drill_assays a, jsonb_object_keys(a."values") k where a.${cur}`, [property]);
    if (engine.name === 'postgres') {
      // The import function's own statements, through auto_explain (statements over 100 ms; per-node timing inflates them).
      const notices = [];
      await engine.tx(EDITOR, (q) => q('select public.drill_import_batch($1, $2, $3::jsonb, $4::jsonb, $5, true, null)',
        [property, 'assays', JSON.stringify(changed.rows), JSON.stringify(changed.mapping), 'explain.csv']), { notices });
      report.plans['assay dry run (auto_explain)'] = notices.join('\n\n');
      console.log(`\n── auto_explain: assay dry run on the full property\n${notices.filter((n) => +(n.match(/duration: ([\d.]+)/)?.[1] || 0) > 100).join('\n\n')}`);
    }
  }
  if (EXTRA) {
    // Toward the 2,000,000-row property limit: bulk-add current assays for other holes in SQL (not an import,
    // unbudgeted), then import one more 20,000-row file through the RPC and read the summary.
    const grow = randomUUID();
    await timed(`bulk-add ${EXTRA.toLocaleString('en-US')} current assays in SQL`, async () => {
      await engine.exec(`insert into public.drill_import_batches (id, org_id, property_id, kind, row_count, rows_written, created_by)
          values ('${grow}', '${org}', '${property}', 'assays', 20000, ${EXTRA}, '${EDITOR}');
        insert into public.drill_assays (org_id, property_id, batch_id, hole_id, from_m, to_m, sample_id, "values", bdl, units)
          select '${org}', '${property}', '${grow}', 'GROW-' || lpad((g / 100)::text, 5, '0'), (g % 100) * 2, (g % 100) * 2 + 2, 'G' || g,
            jsonb_build_object('Cu', round((g % 997) / 1000.0, 3), 'Au', round((g % 89) / 50.0, 3)), '{}', '{"Cu": "%", "Au": "g/t"}'
          from generate_series(0, ${EXTRA - 1}) g`);
      await engine.exec('vacuum analyze public.drill_assays');
    }, { budget: null });
    const total = (counts.assays + EXTRA).toLocaleString('en-US');
    const next = importRows('assays', 0, 200, (r) => { r[0] = r[0].replace('SYN-', 'NEXT-'); return r; });
    const nextArgs = { propertyId: property, kind: 'assays', rows: next.rows, mapping: next.mapping, filename: 'next.csv' };
    await attempt(`assays dry run on ${total} current`, () => db.dryRun(nextArgs), { rows: next.rows.length });
    await attempt(`assays commit on ${total} current`, () => db.commit({ ...nextArgs, batchId: randomUUID() }), { rows: next.rows.length });
    await attempt(`drill_property_summary on ${total} assays`, () => db.summary(property));
  }
  report.loadAfter = loadavg().map((n) => round(n));
  console.log(`\nLoad average at the end: ${report.loadAfter.join(', ')}`);
  const over = results.filter((r) => r.pass === false);
  report.status = over.length ? 'over-budget' : 'pass';
  console.log(`\n${over.length ? `${over.length} measurement(s) over the ${BUDGET_MS} ms budget: ${over.map((r) => r.stage).join('; ')}` : `Every budgeted measurement is under ${BUDGET_MS} ms.`}`);
  if (engine.name === 'pglite') console.log('PGlite: single-connection WebAssembly Postgres. Its timings are pessimistic and not representative of hosted Postgres.');
  if (over.length) process.exitCode = 2;
} catch (error) {
  report.status = 'failed'; report.error = error.stack; process.exitCode = 1;
  console.error(error);
} finally {
  await engine?.close();
  report.finishedAt = new Date().toISOString();
  const out = opt('out');
  if (out) await writeFile(out, `${JSON.stringify(report, null, 2)}\n`);
}
