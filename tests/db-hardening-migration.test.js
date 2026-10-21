// @vitest-environment node
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

// DB hardening: RLS policies rewritten with (select auth.uid()), the legacy
// FOR ALL duplicates on projects/templates dropped, duplicate indexes dropped,
// unindexed foreign keys indexed. The policies below are production's as of
// 2026-10-21 (pg_policies), so the test proves each rewrite keeps the same
// roles, command and logic, and only wraps auth.uid().
const FILE = 'supabase/migrations/20261026100000_db_hardening_rls_initplan_indexes.sql';
const sql = readFileSync(FILE, 'utf8');
const code = sql.replace(/--[^\n]*/g, ''); // statements only, no comments

// [table, name, roles, cmd, qual, with_check] exactly as production stores them.
const PROD_POLICIES = [
  ['account_settings', 'users insert own settings', 'authenticated', 'INSERT', null, '(auth.uid() = user_id)'],
  ['account_settings', 'users select own settings', 'authenticated', 'SELECT', '(auth.uid() = user_id)', null],
  ['account_settings', 'users update own settings', 'authenticated', 'UPDATE', '(auth.uid() = user_id)', '(auth.uid() = user_id)'],
  ['custom_invoices', 'custom_invoices_select_own', 'authenticated', 'SELECT', '(auth.uid() = user_id)', null],
  ['export_events', 'users insert own export events', 'authenticated', 'INSERT', null, '(auth.uid() = user_id)'],
  ['monitored_portfolios', 'portfolios_delete_own', 'authenticated', 'DELETE', '(user_id = auth.uid())', null],
  ['monitored_portfolios', 'portfolios_select_own', 'authenticated', 'SELECT', '(user_id = auth.uid())', null],
  ['monitored_portfolios', 'portfolios_update_own', 'authenticated', 'UPDATE', '(user_id = auth.uid())', '(user_id = auth.uid())'],
  ['projects', 'own projects', 'public', 'ALL', '((auth.uid() = user_id) AND (org_id IS NULL))', '((auth.uid() = user_id) AND (org_id IS NULL))'],
  ['projects', 'users delete own projects', 'authenticated', 'DELETE', '((auth.uid() = user_id) AND (org_id IS NULL))', null],
  ['projects', 'users insert own projects', 'authenticated', 'INSERT', null, '((auth.uid() = user_id) AND (org_id IS NULL))'],
  ['projects', 'users select own projects', 'authenticated', 'SELECT', '((auth.uid() = user_id) AND (org_id IS NULL))', null],
  ['projects', 'users update own projects', 'authenticated', 'UPDATE', '((auth.uid() = user_id) AND (org_id IS NULL))', '((auth.uid() = user_id) AND (org_id IS NULL))'],
  ['templates', 'own templates', 'public', 'ALL', '(auth.uid() = user_id)', null],
  ['templates', 'users delete own templates', 'authenticated', 'DELETE', '(auth.uid() = user_id)', null],
  ['templates', 'users insert own templates', 'authenticated', 'INSERT', null, '(auth.uid() = user_id)'],
  ['templates', 'users select own templates', 'authenticated', 'SELECT', '(auth.uid() = user_id)', null],
  ['templates', 'users update own templates', 'authenticated', 'UPDATE', '(auth.uid() = user_id)', '(auth.uid() = user_id)'],
  ['tenure_alert_policies', 'alert_policies_own', 'authenticated', 'ALL', '(user_id = auth.uid())', '(user_id = auth.uid())'],
  ['tenure_alert_recipients', 'alert_recipients_own', 'authenticated', 'ALL',
    '(EXISTS ( SELECT 1\n   FROM tenure_alert_policies p\n  WHERE ((p.id = tenure_alert_recipients.policy_id) AND (p.user_id = auth.uid()))))',
    '(EXISTS ( SELECT 1\n   FROM tenure_alert_policies p\n  WHERE ((p.id = tenure_alert_recipients.policy_id) AND (p.user_id = auth.uid()))))'],
  ['user_plans', 'user_plans_select_own', 'authenticated', 'SELECT', '(auth.uid() = user_id)', null],
];

// Legacy FOR ALL policies dropped as duplicates, and the per-command policies
// that together cover them.
const LEGACY = {
  projects: { name: 'own projects', survivors: ['users select own projects', 'users insert own projects', 'users update own projects', 'users delete own projects'] },
  templates: { name: 'own templates', survivors: ['users select own templates', 'users insert own templates', 'users update own templates', 'users delete own templates'] },
};

// Production's foreign keys without a covering index (advisor 0001, pg_constraint).
const UNINDEXED_FKS = [
  ['agent_runs', 'share_id'], ['error_events', 'user_id'], ['export_events', 'user_id'], ['feedback', 'user_id'],
  ['monitored_portfolio_tenures', 'added_by_user_id'], ['monitored_portfolio_tenures', 'assigned_user_id'],
  ['monitored_portfolio_tenures', 'notes_updated_by'], ['monitored_portfolios', 'alert_policy_id'],
  ['monitored_portfolios', 'org_id'], ['org_activity', 'actor'], ['org_invites', 'accepted_by'],
  ['organizations', 'owner_id'], ['page_views', 'user_id'], ['projects', 'property_id'], ['projects', 'template_id'],
  ['properties', 'created_by'], ['property_file_versions', 'uploaded_by'], ['property_files', 'created_by'],
  ['templates', 'org_id'], ['templates', 'user_id'], ['tenure_alert_instances', 'acknowledged_by_user_id'],
  ['tenure_alert_instances', 'change_event_id'], ['tenure_alert_instances', 'recipient_id'],
  ['tenure_alert_recipients', 'user_id'], ['tenure_audit_log', 'user_id'], ['tenure_change_events', 'import_run_id'],
  ['tenure_snapshots', 'import_run_id'], ['tenure_system_notices', 'created_by'], ['tenures', 'last_import_run_id'],
  ['three_d_projects', 'property_id'], ['three_d_shares', 'project_id'],
];

const A = '00000000-0000-4000-8000-00000000000a';
const B = '00000000-0000-4000-8000-00000000000b';
const POLICY_SQL = `select tablename, policyname, permissive, array_to_string(roles, ',') as roles, cmd, qual, with_check
  from pg_policies where schemaname = 'public' order by tablename, policyname`;

let db;
let before;

beforeAll(async () => {
  db = await PGlite.create();
  // Stub tables: only the columns the policies and indexes touch.
  const cols = {};
  const add = (t, c, type = 'uuid') => { (cols[t] ||= { id: 'uuid primary key default gen_random_uuid()' })[c] = type; };
  for (const [t, , , , q, w] of PROD_POLICIES) {
    add(t, 'user_id');
    if (/org_id/.test(`${q}${w}`)) add(t, 'org_id');
    if (/policy_id/.test(`${q}${w}`)) add(t, 'policy_id');
  }
  for (const [t, c] of UNINDEXED_FKS) add(t, c);
  add('page_views', 'created_at', 'timestamptz');
  add('tenure_owners', 'normalized_owner_name', 'text');
  add('templates', 'name', 'text');
  add('projects', 'name', 'text');
  const tables = Object.entries(cols).map(([t, c]) =>
    `create table public.${t} (${Object.entries(c).map(([n, ty]) => `${n} ${ty}`).join(', ')});`).join('\n');
  const policies = PROD_POLICIES.map(([t, n, roles, cmd, q, w]) =>
    `create policy "${n}" on public.${t} for ${cmd.toLowerCase()} to ${roles}${q ? ` using ${q}` : ''}${w ? ` with check ${w}` : ''};`).join('\n');
  const rlsTables = [...new Set(PROD_POLICIES.map(([t]) => t))];
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth;
    create table auth.users (id uuid primary key);
    insert into auth.users values ('${A}'), ('${B}');
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to authenticated, anon;
    ${tables}
    ${rlsTables.map((t) => `alter table public.${t} enable row level security;`).join('\n')}
    ${policies}
    -- Production grants: no insert on projects (create_cloud_project RPC), nothing for anon.
    grant select, update, delete on public.projects to authenticated;
    grant select, insert, update, delete on public.templates to authenticated;
    create index idx_page_views_created on public.page_views (created_at);
    create index page_views_created_idx on public.page_views (created_at);
    -- Production's pair is gin (normalized_owner_name gin_trgm_ops); any identical pair exercises the guard.
    create index tenure_owners_name_trgm on public.tenure_owners (normalized_owner_name);
    create index tenure_owners_norm_trgm_idx on public.tenure_owners (normalized_owner_name);
  `);
  before = (await db.query(POLICY_SQL)).rows;
  await db.exec(sql);
  await db.exec(sql); // idempotent
}, 120_000); // a fresh PGlite, under a parallel suite, can take a while
afterAll(async () => db?.close());

async function as(uid, q, params) {
  await db.exec('reset role');
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [uid || '']);
  await db.exec(`set role ${uid ? 'authenticated' : 'anon'}`);
  try { return await db.query(q, params); } finally { await db.exec('reset role'); }
}

describe('db hardening migration: file safety', () => {
  it('drops no table, column, schema or data', () => {
    expect(code).not.toMatch(/\bdrop\s+(table|column|schema|view|function)\b/i);
    expect(code).not.toMatch(/\balter\s+table\b[^;]*\bdrop\b/i);
    expect(code).not.toMatch(/\b(truncate|delete\s+from)\b/i);
  });

  it('leaves the transaction to the apply workflow (psql --single-transaction)', () => {
    expect(code).not.toMatch(/^\s*(begin|commit|rollback|start\s+transaction)\s*;/im);
    expect(code).not.toMatch(/\bconcurrently\b/i);
  });

  it('gives every dropped policy a same-named replacement, except the declared legacy duplicates', () => {
    const drops = [...code.matchAll(/drop policy if exists "([^"]+)" on public\.(\w+)/gi)].map((m) => `${m[2]}.${m[1]}`);
    const creates = new Set([...code.matchAll(/create policy "([^"]+)" on public\.(\w+)/gi)].map((m) => `${m[2]}.${m[1]}`));
    expect(drops.length).toBeGreaterThan(0);
    for (const d of drops) expect(creates, d).toContain(d);
    // The only drops without a replacement are the legacy FOR ALL policies, and
    // every policy that covers them is recreated here.
    for (const [t, { survivors }] of Object.entries(LEGACY)) {
      for (const s of survivors) expect(creates).toContain(`${t}.${s}`);
    }
  });

  it('never uses a bare auth.uid() in a policy', () => {
    const policies = code.match(/create policy[\s\S]*?;/gi);
    expect(policies).toHaveLength(PROD_POLICIES.length - Object.keys(LEGACY).length);
    for (const p of policies) expect(p.replace(/\(select auth\.uid\(\)\)/gi, '')).not.toMatch(/auth\.uid\(\)/i);
  });
});

describe('db hardening migration: applied (twice) to a production-shaped database', () => {
  it('starts from production\'s exact policy definitions', () => {
    expect(before).toHaveLength(PROD_POLICIES.length);
    for (const [t, n, roles, cmd, q, w] of PROD_POLICIES) {
      expect(before.find((p) => p.tablename === t && p.policyname === n)).toEqual(
        { tablename: t, policyname: n, permissive: 'PERMISSIVE', roles, cmd, qual: q, with_check: w });
    }
  });

  it('keeps every other policy with the same roles, command and logic, only wrapping auth.uid()', async () => {
    const after = (await db.query(POLICY_SQL)).rows;
    const legacy = Object.entries(LEGACY).map(([t, { name }]) => `${t}.${name}`);
    const wrap = (s) => s && s.replaceAll('auth.uid()', '( SELECT auth.uid() AS uid)');
    const expected = before.filter((p) => !legacy.includes(`${p.tablename}.${p.policyname}`))
      .map((p) => ({ ...p, qual: wrap(p.qual), with_check: wrap(p.with_check) }));
    expect(after).toEqual(expected);
  });

  it('dropped only legacy policies whose per-command survivors cover the same logic', () => {
    for (const [t, { name, survivors }] of Object.entries(LEGACY)) {
      const legacy = before.find((p) => p.tablename === t && p.policyname === name);
      const using = legacy.qual;
      const check = legacy.with_check ?? legacy.qual; // FOR ALL: check defaults to using
      const s = Object.fromEntries(before.filter((p) => survivors.includes(p.policyname)).map((p) => [p.cmd, p]));
      expect(s.SELECT.qual).toBe(using);
      expect(s.DELETE.qual).toBe(using);
      expect(s.INSERT.with_check).toBe(check);
      expect([s.UPDATE.qual, s.UPDATE.with_check]).toEqual([using, check]);
    }
  });

  it('still lets a user reach only their own rows, and not anon', async () => {
    await as(A, `insert into public.templates (user_id, name) values ($1, 'A kit')`, [A]);
    await expect(as(B, `insert into public.templates (user_id, name) values ($1, 'forged')`, [A])).rejects.toThrow(/row-level security/);
    expect((await as(A, 'select name from public.templates')).rows).toEqual([{ name: 'A kit' }]);
    expect((await as(B, 'select name from public.templates')).rows).toEqual([]);
    expect((await as(B, `update public.templates set name = 'x'`)).affectedRows).toBe(0);
    await expect(as(null, 'select name from public.templates')).rejects.toThrow(/permission denied/);

    await db.exec(`insert into public.projects (user_id, org_id, name) values ('${A}', null, 'mine'), ('${A}', gen_random_uuid(), 'org map')`);
    expect((await as(A, 'select name from public.projects')).rows).toEqual([{ name: 'mine' }]);
    expect((await as(B, 'select name from public.projects')).rows).toEqual([]);
    expect((await as(A, `delete from public.projects where name = 'org map'`)).affectedRows).toBe(0);
    await expect(as(null, 'select name from public.projects')).rejects.toThrow(/permission denied/);
  });

  it('drops the duplicate indexes and keeps the copies the migrations create', async () => {
    const names = (await db.query(`select indexname from pg_indexes
      where schemaname = 'public' and tablename in ('page_views', 'tenure_owners')`)).rows.map((r) => r.indexname);
    expect(names).toContain('idx_page_views_created');
    expect(names).toContain('tenure_owners_name_trgm');
    expect(names).not.toContain('page_views_created_idx');
    expect(names).not.toContain('tenure_owners_norm_trgm_idx');
  });

  it('indexes every foreign key the advisor flagged', async () => {
    const { rows } = await db.query(`select t.relname as tbl, a.attname as col
      from pg_index x join pg_class t on t.oid = x.indrelid join pg_attribute a on a.attrelid = t.oid and a.attnum = x.indkey[0]
      where t.relnamespace = 'public'::regnamespace`);
    const leading = new Set(rows.map((r) => `${r.tbl}.${r.col}`));
    for (const [t, c] of UNINDEXED_FKS) expect(leading, `${t}.${c}`).toContain(`${t}.${c}`);
  });
});
