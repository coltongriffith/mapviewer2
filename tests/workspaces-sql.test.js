// @vitest-environment node
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

// Company workspaces (20261023100000): roles, invites, activity, properties,
// and the org extension of maps, 3D figures, their files and claim
// portfolios. The tables it extends are rebuilt here as production has them
// (including the legacy "own projects" / "own orgs" policies that exist only
// in production), the earlier migrations it redefines are applied for real,
// and the migration itself is applied twice.
//
// Tests run in order and share state: each describe builds on the last.
let db;
const read = (f) => readFileSync(`supabase/migrations/${f}`, 'utf8');
const MIGRATION = read('20261023100000_workspaces_properties.sql');

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const O = id(1); // owner
const A = id(2); // admin
const E = id(3); // editor
const V = id(4); // viewer
const X = id(5); // outsider (owns another company)
const L = id(6); // joins, then leaves
const U = id(7); // unconfirmed email
const P = id(8); // pro user, for personal-quota checks
const EMAIL = { [O]: 'owner@star.test', [A]: 'admin@star.test', [E]: 'Geo@Star.test', [V]: 'investor@fund.test', [X]: 'rival@rival.test', [L]: 'leaver@star.test', [U]: 'unconfirmed@star.test', [P]: 'pro@star.test' };

beforeAll(async () => {
  db = await PGlite.create({ extensions: { pgcrypto } });
  const users = Object.entries(EMAIL).map(([u, e]) => `('${u}', '${e}', ${u === U ? 'null' : 'now()'})`).join(',');
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema extensions; create extension pgcrypto schema extensions;
    create schema auth;
    create table auth.users (id uuid primary key, email text, email_confirmed_at timestamptz);
    insert into auth.users values ${users};
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to authenticated, anon;
    create schema storage;
    create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint);
    create table storage.objects (id uuid default gen_random_uuid(), bucket_id text, name text);
    alter table storage.objects enable row level security;
    create function storage.foldername(name text) returns text[] language sql immutable as $$
      select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
    grant usage on schema storage to authenticated;
    grant select, insert, update, delete on storage.objects to authenticated;
    create schema vault;
    create table vault.decrypted_secrets (name text, decrypted_secret text);
    insert into vault.decrypted_secrets values ('resend_api_key', 'k');
    create schema net;
    create table net.calls (url text, body jsonb);
    create function net.http_post(url text, headers jsonb, body jsonb) returns bigint language sql as $$ insert into net.calls values (url, body); select 1::bigint $$;
    create table public.user_plans (user_id uuid primary key, plan text, source text);
    insert into public.user_plans values ('${P}', 'pro', 'stripe');

    -- Baseline tables, constraints, policies and grants, as in production.
    create table public.organizations (id uuid primary key default gen_random_uuid(), name text not null,
      owner_id uuid not null references auth.users(id) on delete cascade, created_at timestamptz default now());
    create table public.organization_members (id uuid primary key default gen_random_uuid(),
      org_id uuid not null references public.organizations(id) on delete cascade,
      user_id uuid not null references auth.users(id) on delete cascade,
      role text not null default 'member', joined_at timestamptz default now(),
      constraint organization_members_org_id_user_id_key unique (org_id, user_id),
      constraint organization_members_role_check check (role = any (array['owner'::text, 'admin'::text, 'member'::text])));
    create table public.projects (id uuid primary key default gen_random_uuid(),
      user_id uuid not null references auth.users(id) on delete cascade,
      org_id uuid references public.organizations(id) on delete set null,
      name text not null default 'Untitled map', payload jsonb not null default '{}'::jsonb, template_id uuid,
      created_at timestamptz not null default now(), updated_at timestamptz default now(), thumbnail text);
    alter table public.organizations enable row level security;
    alter table public.organization_members enable row level security;
    alter table public.projects enable row level security;
    create policy "own orgs" on public.organizations for all using (auth.uid() = owner_id);
    create policy "own memberships" on public.organization_members for all using (auth.uid() = user_id);
    create policy "own projects" on public.projects for all using (auth.uid() = user_id);
    create policy "users select own projects" on public.projects for select to authenticated using (auth.uid() = user_id);
    create policy "users insert own projects" on public.projects for insert to authenticated with check (auth.uid() = user_id);
    create policy "users update own projects" on public.projects for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
    create policy "users delete own projects" on public.projects for delete to authenticated using (auth.uid() = user_id);
    grant select, update, delete on public.projects to authenticated;
    grant select, insert, update, delete on public.organizations, public.organization_members to authenticated;

    -- Tenure Monitor tables the migration links to (only the columns used).
    create table public.tenures (id uuid primary key default gen_random_uuid(), tenure_number text, tenure_name text,
      status text, good_to_date date, area_hectares numeric);
    create table public.monitored_portfolios (id uuid primary key default gen_random_uuid(),
      user_id uuid not null references auth.users(id) on delete cascade, org_id uuid,
      name text not null default 'My B.C. claims', jurisdiction text not null default 'BC',
      created_at timestamptz not null default now(), updated_at timestamptz not null default now());
    create table public.monitored_portfolio_tenures (id uuid primary key default gen_random_uuid(),
      portfolio_id uuid not null references public.monitored_portfolios(id) on delete cascade,
      tenure_id uuid not null references public.tenures(id) on delete cascade,
      maintenance_decision text not null default 'UNDECIDED', added_at timestamptz not null default now(), removed_at timestamptz);
    alter table public.monitored_portfolios enable row level security;
    create policy portfolios_select_own on public.monitored_portfolios for select to authenticated using (user_id = auth.uid());
    create policy portfolios_update_own on public.monitored_portfolios for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
    grant select, update, delete on public.monitored_portfolios to authenticated;
  `);
  await db.exec(read('20260728000006_project_revisions_and_trash.sql'));
  await db.exec(read('20261022100000_three_d_projects.sql'));
  await db.exec(MIGRATION);
  await db.exec(MIGRATION);
}, 120_000); // a fresh PGlite with pgcrypto, under a parallel suite, can take a while
afterAll(async () => db?.close());

// Run one statement as a signed-in user (or anon), as PostgREST would.
async function as(uid, q, params) {
  await db.exec('reset role');
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [uid || '']);
  await db.exec(`set role ${uid ? 'authenticated' : 'anon'}`);
  try { return await db.query(q, params); } finally { await db.exec('reset role'); }
}
const one = async (uid, q, params) => (await as(uid, q, params)).rows[0];
const val = async (uid, q, params) => Object.values((await as(uid, q, params)).rows[0] || {})[0];
const su = async (q, params) => (await db.query(q, params)).rows;

const S = {}; // ids created along the way

describe('migration', () => {
  it('pins search_path on every new function and keeps them away from anon', async () => {
    const fns = await su(`select p.proname, p.proconfig, has_function_privilege('anon', p.oid, 'execute') as anon
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and (p.proname like 'ws\\_%' or p.proname in ('org_role', 'has_org_role', 'log_org_activity',
        'create_org_invite', 'accept_org_invite', 'revoke_org_invite', 'list_org_invites', 'create_organization',
        'update_organization', 'get_my_workspaces', 'list_org_members', 'set_member_role', 'remove_member',
        'get_org_activity', 'get_property_claims', 'move_to_property', 'move_to_personal', 'create_org_project',
        'create_cloud_project', 'save_cloud_project', 'trash_cloud_project', 'restore_cloud_project',
        'send_org_invite_email', 'org_map_limit', 'properties_guard', 'org_activity_immutable'))`);
    expect(fns.length).toBeGreaterThan(40);
    for (const f of fns) {
      expect(f.proconfig, f.proname).toEqual(['search_path=""']);
      expect(f.anon, f.proname).toBe(false);
    }
    const internal = await su(`select proname, has_function_privilege('authenticated', oid, 'execute') as ok from pg_proc
      where proname in ('log_org_activity', 'send_org_invite_email', 'ws_rebase_figure_files', 'ws_user_email', 'ws_personal_map_limit')`);
    expect(internal.every((f) => f.ok === false)).toBe(true);
  });

  it('applies twice without duplicating policies or triggers', async () => {
    const pol = await su(`select tablename, policyname, count(*)::int as n from pg_policies group by 1, 2 having count(*) > 1`);
    expect(pol).toEqual([]);
    const trg = (await su(`select count(*)::int as n from pg_trigger where tgname in ('ws_activity', 'ws_a_guard_ownership', 'ws_b_property_link', 'properties_guard', 'org_activity_immutable')`))[0].n;
    expect(trg).toBe(14);
  });

  it('replaces the open legacy organization policies and the role check', async () => {
    const pol = (await su(`select policyname from pg_policies where tablename in ('organizations', 'organization_members') order by 1`)).map((r) => r.policyname);
    expect(pol).toEqual(['Members read memberships', 'Members read their organizations']);
    const def = (await su(`select pg_get_constraintdef(oid) as d from pg_constraint where conname = 'organization_members_role_check'`))[0].d;
    expect(def).toMatch(/viewer/);
    expect(def).not.toMatch(/'member'/);
    // Every personal-map policy, including production's legacy ones, now excludes org rows.
    const qual = await su(`select policyname, coalesce(qual, '') || coalesce(with_check, '') as q from pg_policies
      where tablename in ('projects', 'three_d_projects') and policyname ~* '^(own|users|owners)'`);
    expect(qual.length).toBe(9);
    for (const p of qual) expect(p.q, p.policyname).toMatch(/org_id IS NULL/);
  });
});

describe('workspaces and members', () => {
  it('creates a workspace with its creator as owner', async () => {
    const r = await val(O, `select public.create_organization('Star Copper Corp.') as r`);
    expect(r).toMatchObject({ name: 'Star Copper Corp.', slug: 'star-copper-corp', role: 'owner' });
    S.org = r.id;
    const b = await val(X, `select public.create_organization('Star Copper Corp.') as r`);
    expect(b.slug).toMatch(/^star-copper-corp-[0-9a-f]{6}$/);
    S.orgB = b.id;
    expect(await val(O, `select public.org_role($1)`, [S.org])).toBe('owner');
    expect(await val(O, `select public.has_org_role($1, 'admin')`, [S.org])).toBe(true);
  });

  it('shows a workspace only to its members, without billing fields', async () => {
    expect((await as(O, `select name from public.organizations`)).rows).toEqual([{ name: 'Star Copper Corp.' }]);
    expect((await as(X, `select id from public.organizations`)).rows).toEqual([{ id: S.orgB }]);
    expect((await as(V, `select id from public.organizations`)).rows).toEqual([]);
    await expect(as(O, `select billing_customer_id from public.organizations`)).rejects.toThrow(/permission denied/);
    expect((await as(X, `select * from public.organization_members where org_id = $1`, [S.org])).rows).toEqual([]);
    const mine = await val(O, `select public.get_my_workspaces()`);
    expect(mine).toEqual([expect.objectContaining({ id: S.org, role: 'owner', member_count: 1, property_count: 0 })]);
  });

  it('refuses every direct write to organizations and memberships', async () => {
    await expect(as(X, `insert into public.organization_members (org_id, user_id, role) values ($1, $2, 'owner')`, [S.org, X])).rejects.toThrow(/permission denied/);
    await expect(as(O, `update public.organizations set plan = 'enterprise' where id = $1`, [S.org])).rejects.toThrow(/permission denied/);
    await expect(as(O, `update public.organization_members set role = 'viewer'`)).rejects.toThrow(/permission denied/);
    await expect(as(O, `delete from public.organization_members`)).rejects.toThrow(/permission denied/);
    await expect(as(O, `insert into public.organizations (name, owner_id) values ('x', $1)`, [O])).rejects.toThrow(/permission denied/);
    await expect(as(null, `select public.create_organization('anon co')`)).rejects.toThrow(/permission denied/);
  });
});

async function invite(by, org, email, role) {
  return val(by, `select public.create_org_invite($1, $2, $3)`, [org, email, role]);
}

describe('invites', () => {
  it('lets an owner invite, stores only a hash and emails the link', async () => {
    const r = await invite(O, S.org, 'Admin@Star.test ', 'admin');
    expect(r.token).toMatch(/^[0-9a-f]{64}$/);
    expect(r.link).toBe(`https://www.explorationmaps.com/invite?token=${r.token}`);
    expect(r.email).toBe('admin@star.test');
    const row = (await su(`select * from public.org_invites where id = $1`, [r.id]))[0];
    expect(row.token_hash).not.toContain(r.token);
    expect(row.token_hash).toBe((await su(`select encode(sha256(convert_to($1, 'UTF8')), 'hex') as h`, [r.token]))[0].h);
    expect(new Date(row.expires_at) - new Date(row.created_at)).toBeGreaterThan(13.9 * 86400e3);
    const mail = (await su(`select body from net.calls order by ctid desc limit 1`))[0].body;
    expect(mail.to).toBe('admin@star.test');
    expect(mail.text).toContain(r.link);
    expect(mail.subject).toBe('owner@star.test invited you to Star Copper Corp. on Exploration Maps');
    S.adminToken = r.token;
  });

  it('never fails the invite when the email does', async () => {
    await db.exec(`create or replace function net.http_post(url text, headers jsonb, body jsonb) returns bigint language plpgsql as $$ begin raise exception 'resend down'; end $$`);
    const r = await invite(O, S.org, 'leaver@star.test', 'viewer');
    expect(r.token).toMatch(/^[0-9a-f]{64}$/);
    S.leaverToken = r.token;
    await db.exec(`create or replace function net.http_post(url text, headers jsonb, body jsonb) returns bigint language sql as $$ insert into net.calls values (url, body); select 1::bigint $$`);
  });

  it('rejects an invite token used by the wrong account, then accepts the right one', async () => {
    await expect(as(X, `select public.accept_org_invite($1)`, [S.adminToken])).rejects.toThrow(/INVITE_EMAIL_MISMATCH/);
    const r = await val(A, `select public.accept_org_invite($1)`, [S.adminToken]);
    expect(r).toMatchObject({ org_id: S.org, role: 'admin', name: 'Star Copper Corp.' });
    await expect(as(A, `select public.accept_org_invite($1)`, [S.adminToken])).rejects.toThrow(/INVITE_USED/);
    await expect(as(A, `select public.accept_org_invite('nope')`)).rejects.toThrow(/INVITE_INVALID/);
    await expect(as(A, `select public.accept_org_invite($1)`, ['0'.repeat(64)])).rejects.toThrow(/INVITE_INVALID/);
    await expect(as(null, `select public.accept_org_invite($1)`, [S.adminToken])).rejects.toThrow(/permission denied/);
  });

  it('matches the email case-insensitively and requires a confirmed address', async () => {
    const e = await invite(A, S.org, 'geo@star.test', 'editor');
    expect((await val(E, `select public.accept_org_invite($1)`, [e.token])).role).toBe('editor');
    const v = await invite(A, S.org, 'investor@fund.test', 'viewer');
    expect((await val(V, `select public.accept_org_invite($1)`, [v.token])).role).toBe('viewer');
    const u = await invite(A, S.org, 'unconfirmed@star.test', 'editor');
    await expect(as(U, `select public.accept_org_invite($1)`, [u.token])).rejects.toThrow(/INVITE_EMAIL_MISMATCH/);
    S.unconfirmedInvite = u.id;
  });

  it('rejects expired and cancelled invites, and replaces a re-sent one', async () => {
    const r = await invite(A, S.org, 'pro@star.test', 'viewer');
    await su(`update public.org_invites set expires_at = now() - interval '1 minute' where id = $1`, [r.id]);
    await expect(as(P, `select public.accept_org_invite($1)`, [r.token])).rejects.toThrow(/INVITE_EXPIRED/);
    const again = await invite(A, S.org, 'pro@star.test', 'viewer');
    expect((await su(`select revoked_at from public.org_invites where id = $1`, [r.id]))[0].revoked_at).not.toBeNull();
    expect(await val(A, `select public.revoke_org_invite($1)`, [again.id])).toBe(true);
    await expect(as(P, `select public.accept_org_invite($1)`, [again.token])).rejects.toThrow(/INVITE_INVALID/);
  });

  it('keeps invites to admins and up, owner invites to owners', async () => {
    await expect(invite(E, S.org, 'new@star.test', 'viewer')).rejects.toThrow(/forbidden/);
    await expect(invite(V, S.org, 'new@star.test', 'viewer')).rejects.toThrow(/forbidden/);
    await expect(invite(X, S.org, 'new@star.test', 'viewer')).rejects.toThrow(/forbidden/);
    await expect(invite(A, S.org, 'new@star.test', 'owner')).rejects.toThrow(/only an owner/);
    await expect(invite(A, S.org, 'not-an-email', 'viewer')).rejects.toThrow(/INVALID_EMAIL/);
    await expect(invite(A, S.org, 'new@star.test', 'superuser')).rejects.toThrow(/invalid role/);
    await expect(invite(A, S.org, 'GEO@star.test', 'viewer')).rejects.toThrow(/ALREADY_MEMBER/);
    await expect(as(E, `select public.revoke_org_invite($1)`, [S.unconfirmedInvite])).rejects.toThrow(/forbidden/);
    await expect(as(X, `select public.list_org_invites($1)`, [S.org])).rejects.toThrow(/forbidden/);
    const pending = await val(A, `select public.list_org_invites($1)`, [S.org]);
    expect(pending.map((i) => i.email).sort()).toEqual(['leaver@star.test', 'unconfirmed@star.test']);
    expect(JSON.stringify(pending)).not.toMatch(/token/);
    await expect(as(O, `select * from public.org_invites`)).rejects.toThrow(/permission denied/);
  });

  it('limits a workspace to 50 invites a day', async () => {
    await su(`insert into public.org_invites (org_id, email, role, token_hash, invited_by)
      select $1, 'bulk' || g || '@rival.test', 'viewer', md5(g::text) || md5((g + 1000)::text), $2 from generate_series(1, 50) g`, [S.orgB, X]);
    await expect(invite(X, S.orgB, 'one-more@rival.test', 'viewer')).rejects.toThrow(/INVITE_RATE_LIMIT/);
  });
});

describe('roles', () => {
  it('lists members with emails to members only', async () => {
    const m = await val(V, `select public.list_org_members($1)`, [S.org]);
    expect(m.map((x) => [x.email, x.role])).toEqual([
      ['owner@star.test', 'owner'], ['admin@star.test', 'admin'], ['Geo@Star.test', 'editor'], ['investor@fund.test', 'viewer'],
    ]);
    await expect(as(X, `select public.list_org_members($1)`, [S.org])).rejects.toThrow(/forbidden/);
  });

  it('stops editors and viewers changing roles, and admins touching owners', async () => {
    await expect(as(E, `select public.set_member_role($1, $2, 'admin')`, [S.org, E])).rejects.toThrow(/forbidden/);
    await expect(as(V, `select public.set_member_role($1, $2, 'editor')`, [S.org, V])).rejects.toThrow(/forbidden/);
    await expect(as(A, `select public.set_member_role($1, $2, 'admin')`, [S.org, O])).rejects.toThrow(/only an owner/);
    await expect(as(A, `select public.set_member_role($1, $2, 'owner')`, [S.org, A])).rejects.toThrow(/only an owner/);
    await expect(as(A, `select public.remove_member($1, $2)`, [S.org, O])).rejects.toThrow(/only an owner/);
    await expect(as(E, `select public.remove_member($1, $2)`, [S.org, V])).rejects.toThrow(/forbidden/);
    await expect(as(X, `select public.set_member_role($1, $2, 'owner')`, [S.org, X])).rejects.toThrow(/forbidden/);
  });

  it('always keeps one owner', async () => {
    await expect(as(O, `select public.set_member_role($1, $2, 'admin')`, [S.org, O])).rejects.toThrow(/LAST_OWNER/);
    await expect(as(O, `select public.remove_member($1, $2)`, [S.org, O])).rejects.toThrow(/LAST_OWNER/);
    // A second owner makes it possible, then the first can step down.
    await as(O, `select public.set_member_role($1, $2, 'owner')`, [S.org, A]);
    expect((await val(O, `select public.set_member_role($1, $2, 'admin')`, [S.org, O])).role).toBe('admin');
    await expect(as(A, `select public.set_member_role($1, $2, 'admin')`, [S.org, A])).rejects.toThrow(/LAST_OWNER/);
    // Swap back: O owner, A admin.
    await as(A, `select public.set_member_role($1, $2, 'owner')`, [S.org, O]);
    await as(O, `select public.set_member_role($1, $2, 'admin')`, [S.org, A]);
    expect(await val(A, `select public.org_role($1)`, [S.org])).toBe('admin');
  });

  it('voids an invite whose sender has since lost the right to send it', async () => {
    const r = await invite(A, S.org, 'pro@star.test', 'editor');
    await as(O, `select public.set_member_role($1, $2, 'editor')`, [S.org, A]);
    await expect(as(P, `select public.accept_org_invite($1)`, [r.token])).rejects.toThrow(/INVITE_INVALID/);
    await as(O, `select public.set_member_role($1, $2, 'admin')`, [S.org, A]);
    await as(A, `select public.revoke_org_invite($1)`, [r.id]);
  });

  it('lets anyone leave, and admins remove editors and viewers', async () => {
    await val(L, `select public.accept_org_invite($1)`, [S.leaverToken]);
    expect(await val(L, `select public.remove_member($1, $2)`, [S.org, L])).toBe(true);
    expect(await val(L, `select public.org_role($1)`, [S.org])).toBeNull();
    await expect(as(L, `select public.remove_member($1, $2)`, [S.org, L])).rejects.toThrow(/NOT_A_MEMBER/);
  });
});

describe('properties', () => {
  it('lets editors create, with a generated unique slug', async () => {
    await expect(as(V, `insert into public.properties (org_id, name) values ($1, 'Viewer claim')`, [S.org])).rejects.toThrow(/row-level security/);
    await expect(as(X, `insert into public.properties (org_id, name) values ($1, 'Hostile')`, [S.org])).rejects.toThrow(/row-level security/);
    const p = await one(E, `insert into public.properties (org_id, name, jurisdiction, commodities, status, slug, created_by)
      values ($1, ' Rails Copper-Gold ', 'bc', '{Cu,Au}', 'active', null, $2) returning id, slug, name, created_by`, [S.org, A]);
    expect(p).toMatchObject({ slug: 'rails-copper-gold', name: 'Rails Copper-Gold', created_by: E });
    S.prop = p.id;
    const twin = await one(E, `insert into public.properties (org_id, name) values ($1, 'Rails copper gold') returning id, slug`, [S.org]);
    expect(twin.slug).toBe('rails-copper-gold-2');
    S.prop2 = twin.id;
    expect((await one(E, `insert into public.properties (org_id, name, slug) values ($1, 'Named', 'Rails North!') returning slug`, [S.org])).slug).toBe('rails-north');
    await expect(as(E, `insert into public.properties (org_id, name, status) values ($1, 'x', 'mined out')`, [S.org])).rejects.toThrow(/check constraint/);
    await expect(as(E, `insert into public.properties (org_id, name, jurisdiction) values ($1, 'x', 'British Columbia')`, [S.org])).rejects.toThrow(/check constraint/);
  });

  it('shows properties to members only', async () => {
    expect((await as(V, `select name from public.properties order by slug`)).rows.map((r) => r.name)).toEqual(['Rails Copper-Gold', 'Rails copper gold', 'Named']);
    expect((await as(X, `select name from public.properties`)).rows).toEqual([]);
    expect((await as(null, `select 1 from public.properties`).catch((e) => e.message))).toMatch(/permission denied/);
  });

  it('lets editors edit but not move, rename the slug or delete', async () => {
    expect((await as(E, `update public.properties set status = 'option', description = 'Porphyry' where id = $1`, [S.prop])).affectedRows).toBe(1);
    expect((await as(A, `update public.properties set crs = 'EPSG:26910', centroid_lon = -121.5, centroid_lat = 50.2 where id = $1`, [S.prop])).affectedRows).toBe(1);
    await expect(as(A, `update public.properties set crs = 'utm' where id = $1`, [S.prop])).rejects.toThrow(/check constraint/);
    expect((await as(V, `update public.properties set status = 'sold' where id = $1`, [S.prop])).affectedRows).toBe(0);
    expect((await as(X, `update public.properties set status = 'sold' where id = $1`, [S.prop])).affectedRows).toBe(0);
    await expect(as(E, `update public.properties set slug = 'other' where id = $1`, [S.prop])).rejects.toThrow(/PROPERTY_IMMUTABLE/);
    await expect(as(E, `update public.properties set org_id = $2 where id = $1`, [S.prop, S.orgB])).rejects.toThrow(/PROPERTY_IMMUTABLE|row-level/);
    await expect(as(E, `update public.properties set deleted_at = now() where id = $1`, [S.prop2])).rejects.toThrow(/only an admin/);
    await expect(as(E, `delete from public.properties where id = $1`, [S.prop2])).rejects.toThrow(/permission denied/);
  });

  it('lets an admin soft-delete an empty property', async () => {
    expect((await as(A, `update public.properties set deleted_at = now() where id = $1`, [S.prop2])).affectedRows).toBe(1);
    expect((await as(E, `select id from public.properties where id = $1`, [S.prop2])).rows).toEqual([]);
    expect((await as(A, `select id from public.properties where id = $1`, [S.prop2])).rows).toEqual([{ id: S.prop2 }]);
  });
});

describe('maps', () => {
  it('creates maps in a property for editors only, outside any personal quota', async () => {
    await expect(as(V, `select public.create_org_project($1, 'Viewer map', '{}')`, [S.prop])).rejects.toThrow(/ORG_READ_ONLY/);
    await expect(as(X, `select public.create_org_project($1, 'Hostile map', '{}')`, [S.prop])).rejects.toThrow(/PROPERTY_NOT_FOUND/);
    await expect(as(E, `select public.create_org_project($1, 'Dead property', '{}')`, [S.prop2])).rejects.toThrow(/PROPERTY_NOT_FOUND/);
    S.map = await val(E, `select public.create_org_project($1, 'Rails claims', '{"v":1}')`, [S.prop]);
    await val(E, `select public.create_org_project($1, 'Rails drilling', '{"v":1}')`, [S.prop]);
    await val(E, `select public.create_org_project($1, 'Rails sections', '{"v":1}')`, [S.prop]);
    // E (free plan) still has both personal slots.
    S.personal1 = await val(E, `select public.create_cloud_project('Personal one', '{}')`);
    S.personal2 = await val(E, `select public.create_cloud_project('Personal two', '{}')`);
    await expect(as(E, `select public.create_cloud_project('Personal three', '{}')`)).rejects.toThrow(/PROJECT_LIMIT/);
  });

  it('reads org maps for every member and nobody else', async () => {
    for (const u of [O, A, E, V]) expect((await as(u, `select name from public.projects where id = $1`, [S.map])).rows).toEqual([{ name: 'Rails claims' }]);
    expect((await as(X, `select name from public.projects where id = $1`, [S.map])).rows).toEqual([]);
    expect((await as(L, `select name from public.projects where id = $1`, [S.map])).rows).toEqual([]);
  });

  it('saves for editors; viewers get ORG_READ_ONLY; others NOT_FOUND', async () => {
    expect(await val(E, `select public.save_cloud_project($1, 'Rails claims', '{"v":2}', 1)`, [S.map])).toBe(2);
    expect(await val(A, `select public.save_cloud_project($1, 'Rails claims', '{"v":3}', 2)`, [S.map])).toBe(3);
    await expect(as(V, `select public.save_cloud_project($1, 'x', '{}', null)`, [S.map])).rejects.toThrow(/ORG_READ_ONLY/);
    await expect(as(X, `select public.save_cloud_project($1, 'x', '{}', null)`, [S.map])).rejects.toThrow(/PROJECT_NOT_FOUND/);
    await expect(as(E, `select public.save_cloud_project($1, 'x', '{}', 1)`, [S.map])).rejects.toThrow(/SAVE_CONFLICT/);
    expect((await as(V, `update public.projects set name = 'viewer rename' where id = $1`, [S.map])).affectedRows).toBe(0);
    expect((await as(V, `delete from public.projects where id = $1`, [S.map])).affectedRows).toBe(0);
    expect((await as(E, `delete from public.projects where id = $1`, [S.map])).affectedRows).toBe(0);
    expect(await val(V, `select public.trash_cloud_project($1)`, [S.map])).toBe(false);
    expect((await as(E, `update public.projects set thumbnail = 'data:x' where id = $1`, [S.map])).affectedRows).toBe(1);
  });

  it('never moves a map through a plain update', async () => {
    await expect(as(E, `update public.projects set org_id = null where id = $1`, [S.map])).rejects.toThrow(/OWNERSHIP_CHANGE/);
    await expect(as(E, `update public.projects set org_id = $2 where id = $1`, [S.personal1, S.org])).rejects.toThrow(/OWNERSHIP_CHANGE|row-level/);
    await expect(as(E, `update public.projects set user_id = $2 where id = $1`, [S.map, V])).rejects.toThrow(/OWNERSHIP_CHANGE/);
    await expect(as(E, `update public.projects set property_id = $2 where id = $1`, [S.map, S.prop2])).rejects.toThrow(/OWNERSHIP_CHANGE/);
  });

  it('keeps personal maps exactly as before', async () => {
    expect((await as(E, `select name from public.projects where org_id is null order by name`)).rows.map((r) => r.name)).toEqual(['Personal one', 'Personal two']);
    for (const u of [O, A, V, X]) expect((await as(u, `select id from public.projects where id = $1`, [S.personal1])).rows).toEqual([]);
    expect(await val(E, `select public.save_cloud_project($1, 'Personal one', '{"v":2}', 1)`, [S.personal1])).toBe(2);
    await expect(as(O, `select public.save_cloud_project($1, 'x', '{}', null)`, [S.personal1])).rejects.toThrow(/PROJECT_NOT_FOUND/);
    expect(await val(E, `select public.trash_cloud_project($1)`, [S.personal2])).toBe(true);
    expect(await val(E, `select public.restore_cloud_project($1)`, [S.personal2])).toBe(true);
    expect((await as(E, `update public.projects set name = 'Renamed' where id = $1`, [S.personal2])).affectedRows).toBe(1);
    await expect(as(E, `insert into public.projects (user_id, name) values ($1, 'direct')`, [E])).rejects.toThrow(/permission denied/);
    // The pro account is unlimited, as before.
    for (let i = 0; i < 3; i++) await val(P, `select public.create_cloud_project($1, '{}')`, [`Pro ${i}`]);
  });

  it('moves a personal map into a property and back out', async () => {
    await expect(as(V, `select public.move_to_property('map', $1, $2)`, [S.personal1, S.prop])).rejects.toThrow(/forbidden/);
    await expect(as(O, `select public.move_to_property('map', $1, $2)`, [S.personal1, S.prop])).rejects.toThrow(/NOT_FOUND/);
    await expect(as(X, `select public.move_to_property('map', $1, $2)`, [S.personal1, S.prop])).rejects.toThrow(/PROPERTY_NOT_FOUND/);
    await expect(as(E, `select public.move_to_property('map', $1, $2)`, [S.personal1, S.prop2])).rejects.toThrow(/PROPERTY_NOT_FOUND/);
    await val(E, `select public.move_to_property('map', $1, $2)`, [S.personal1, S.prop]);
    expect(await one(V, `select org_id, property_id from public.projects where id = $1`, [S.personal1])).toEqual({ org_id: S.org, property_id: S.prop });
    // E's personal slot is free again.
    S.personal3 = await val(E, `select public.create_cloud_project('Personal three', '{}')`);
    // Out again: owners and admins only, into their own personal maps.
    await expect(as(E, `select public.move_to_personal('map', $1)`, [S.personal1])).rejects.toThrow(/forbidden/);
    await expect(as(X, `select public.move_to_personal('map', $1)`, [S.personal1])).rejects.toThrow(/NOT_FOUND/);
    await val(A, `select public.move_to_personal('map', $1)`, [S.personal1]);
    expect(await one(A, `select user_id, org_id, property_id from public.projects where id = $1`, [S.personal1])).toEqual({ user_id: A, org_id: null, property_id: null });
    expect((await as(E, `select id from public.projects where id = $1`, [S.personal1])).rows).toEqual([]);
  });

  it('applies the personal quota when moving out, and the org quota moving in', async () => {
    await val(A, `select public.create_cloud_project('Admin second', '{}')`);
    const m = await val(E, `select public.create_org_project($1, 'Third out', '{}')`, [S.prop]);
    await expect(as(A, `select public.move_to_personal('map', $1)`, [m])).rejects.toThrow(/PROJECT_LIMIT/);
    await su(`insert into public.projects (user_id, org_id, property_id, name) select $1, $2, $3, 'filler ' || g from generate_series(1, 25) g`, [E, S.org, S.prop]);
    await expect(as(E, `select public.create_org_project($1, 'Over', '{}')`, [S.prop])).rejects.toThrow(/ORG_PROJECT_LIMIT/);
    await expect(as(E, `select public.move_to_property('map', $1, $2)`, [S.personal3, S.prop])).rejects.toThrow(/ORG_PROJECT_LIMIT/);
    await db.exec(`update public.projects set deleted_at = now() where name like 'filler %'`);
  });
});

describe('3D figures and their files', () => {
  const ins = `insert into storage.objects (bucket_id, name) values ('three-d-files', $1)`;

  it('lets editors create org figures; members read them', async () => {
    await expect(as(V, `insert into public.three_d_projects (name, settings, org_id, property_id) values ('v', '{}', $1, $2)`, [S.org, S.prop])).rejects.toThrow(/row-level security/);
    await expect(as(X, `insert into public.three_d_projects (name, settings, org_id, property_id) values ('x', '{}', $1, $2)`, [S.org, S.prop])).rejects.toThrow(/row-level security|PROPERTY_ORG_MISMATCH/);
    await expect(as(E, `insert into public.three_d_projects (name, settings, org_id, property_id) values ('x', '{}', $1, $2)`, [S.orgB, S.prop])).rejects.toThrow(/row-level security|PROPERTY_ORG_MISMATCH/);
    const f = await one(E, `insert into public.three_d_projects (name, settings, org_id, property_id) values ('Rails 3D', '{}', $1, $2) returning id, user_id`, [S.org, S.prop]);
    expect(f.user_id).toBe(E);
    S.fig = f.id;
    expect((await as(V, `select name from public.three_d_projects where id = $1`, [S.fig])).rows).toEqual([{ name: 'Rails 3D' }]);
    expect((await as(X, `select name from public.three_d_projects where id = $1`, [S.fig])).rows).toEqual([]);
    expect((await as(V, `update public.three_d_projects set name = 'v' where id = $1`, [S.fig])).affectedRows).toBe(0);
    // The 3D maker saves with an upsert that repeats the ownership columns.
    expect((await as(A, `insert into public.three_d_projects (id, name, settings, org_id, property_id) values ($1, 'Rails 3D v2', '{}', $2, $3)
      on conflict (id) do update set name = excluded.name, settings = excluded.settings, org_id = excluded.org_id, property_id = excluded.property_id`, [S.fig, S.org, S.prop])).affectedRows).toBe(1);
    await expect(as(V, `insert into public.three_d_projects (id, name, settings, org_id, property_id) values ($1, 'x', '{}', $2, $3)
      on conflict (id) do update set name = excluded.name`, [S.fig, S.org, S.prop])).rejects.toThrow(/row-level security/);
    await expect(as(E, `update public.three_d_projects set org_id = null where id = $1`, [S.fig])).rejects.toThrow(/OWNERSHIP_CHANGE/);
  });

  it('keeps org/<org>/ files to members, writable by editors only', async () => {
    const path = `org/${S.org}/${S.fig}/r1/collars.csv`;
    await as(E, ins, [path]);
    await expect(as(V, ins, [`org/${S.org}/${S.fig}/r1/x.csv`])).rejects.toThrow(/row-level security/);
    await expect(as(X, ins, [`org/${S.org}/${S.fig}/r1/x.csv`])).rejects.toThrow(/row-level security/);
    await expect(as(E, ins, [`org/${S.orgB}/${S.fig}/r1/x.csv`])).rejects.toThrow(/row-level security/);
    await expect(as(E, ins, [`org/${S.org}/../${X}/x.csv`])).rejects.toThrow(/row-level security/);
    await expect(as(E, ins, [`org/${S.org}/x.csv`])).rejects.toThrow(/row-level security/);
    await expect(as(E, ins, [`org/not-a-uuid/${S.fig}/x.csv`])).rejects.toThrow(/row-level security/);
    for (const u of [O, A, E, V]) expect((await as(u, `select name from storage.objects where name = $1`, [path])).rows).toHaveLength(1);
    expect((await as(X, `select name from storage.objects where name = $1`, [path])).rows).toEqual([]);
    expect((await as(V, `delete from storage.objects where name = $1`, [path])).affectedRows).toBe(0);
    // Personal folders are unchanged.
    await as(E, ins, [`${E}/p1/a.csv`]);
    await expect(as(E, ins, [`${V}/p1/a.csv`])).rejects.toThrow(/row-level security/);
    expect((await as(V, `select name from storage.objects where name like $1`, [`${E}/%`])).rows).toEqual([]);
  });

  it('moves a personal figure in only once its files are copied', async () => {
    const f = await one(E, `insert into public.three_d_projects (name, settings, file_paths) values ('Personal 3D', '{}', $1) returning id`,
      [JSON.stringify([{ name: 'c.csv', path: `${E}/__ID__/r1/c.csv` }])]);
    await su(`update public.three_d_projects set file_paths = replace(file_paths::text, '__ID__', id::text)::jsonb where id = $1`, [f.id]);
    await as(E, ins, [`${E}/${f.id}/r1/c.csv`]);
    await expect(as(E, `select public.move_to_property('figure', $1, $2)`, [f.id, S.prop])).rejects.toThrow(/FILES_NOT_COPIED/);
    await expect(as(V, `select public.move_to_property('figure', $1, $2)`, [f.id, S.prop])).rejects.toThrow(/forbidden/);
    await as(E, ins, [`org/${S.org}/${f.id}/r1/c.csv`]);
    await val(E, `select public.move_to_property('figure', $1, $2)`, [f.id, S.prop]);
    const row = await one(V, `select org_id, property_id, file_paths from public.three_d_projects where id = $1`, [f.id]);
    expect(row).toEqual({ org_id: S.org, property_id: S.prop, file_paths: [{ name: 'c.csv', path: `org/${S.org}/${f.id}/r1/c.csv` }] });
    // And back to an admin's own folder.
    await expect(as(A, `select public.move_to_personal('figure', $1)`, [f.id])).rejects.toThrow(/FILES_NOT_COPIED/);
    await as(A, ins, [`${A}/${f.id}/r1/c.csv`]);
    await val(A, `select public.move_to_personal('figure', $1)`, [f.id]);
    expect(await one(A, `select user_id, org_id, file_paths from public.three_d_projects where id = $1`, [f.id]))
      .toEqual({ user_id: A, org_id: null, file_paths: [{ name: 'c.csv', path: `${A}/${f.id}/r1/c.csv` }] });
  });

  it('refuses to move a figure whose files point outside its folder', async () => {
    const f = await one(E, `insert into public.three_d_projects (name, settings, file_paths) values ('Odd', '{}', $1) returning id`,
      [JSON.stringify([{ name: 'c.csv', path: `${V}/elsewhere/c.csv` }])]);
    await expect(as(E, `select public.move_to_property('figure', $1, $2)`, [f.id, S.prop])).rejects.toThrow(/FILE_PATH_UNEXPECTED/);
  });
});

describe('claim portfolios', () => {
  it('links an owner\'s portfolio to a property without changing the Tenure Monitor', async () => {
    const t = (await su(`insert into public.tenures (tenure_number, tenure_name, status, good_to_date, area_hectares)
      values ('1012345', 'RAILS 1', 'GOOD', current_date + 40, 512.3) returning id`))[0].id;
    S.portfolio = (await su(`insert into public.monitored_portfolios (user_id, name) values ($1, 'Rails claims') returning id`, [E]))[0].id;
    await su(`insert into public.monitored_portfolio_tenures (portfolio_id, tenure_id) values ($1, $2)`, [S.portfolio, t]);
    await expect(as(V, `select public.move_to_property('portfolio', $1, $2)`, [S.portfolio, S.prop])).rejects.toThrow(/forbidden/);
    await expect(as(A, `select public.move_to_property('portfolio', $1, $2)`, [S.portfolio, S.prop])).rejects.toThrow(/NOT_FOUND/);
    await val(E, `select public.move_to_property('portfolio', $1, $2)`, [S.portfolio, S.prop]);
    // Members read it through the property; their own monitor is untouched.
    const claims = await val(V, `select public.get_property_claims($1)`, [S.prop]);
    expect(claims).toEqual([expect.objectContaining({ id: S.portfolio, name: 'Rails claims', is_mine: false, owner_email: 'Geo@Star.test', tenure_count: 1 })]);
    expect(claims[0].tenures[0]).toMatchObject({ tenure_number: '1012345', status: 'GOOD' });
    expect((await as(V, `select id from public.monitored_portfolios`)).rows).toEqual([]);
    expect((await as(E, `select id from public.monitored_portfolios`)).rows).toEqual([{ id: S.portfolio }]);
    await expect(as(X, `select public.get_property_claims($1)`, [S.prop])).rejects.toThrow(/forbidden/);
    // The owner can still rename it, but not relink it by hand.
    expect((await as(E, `update public.monitored_portfolios set name = 'Rails BC claims' where id = $1`, [S.portfolio])).affectedRows).toBe(1);
    await expect(as(E, `update public.monitored_portfolios set property_id = null where id = $1`, [S.portfolio])).rejects.toThrow(/OWNERSHIP_CHANGE/);
  });

  it('will not delete a property that still holds work', async () => {
    await expect(as(A, `update public.properties set deleted_at = now() where id = $1`, [S.prop])).rejects.toThrow(/PROPERTY_NOT_EMPTY/);
  });
});

describe('activity log', () => {
  it('records what happened, by whom, debouncing autosaves', async () => {
    const rows = await su(`select action, entity_type, summary, actor from public.org_activity where org_id = $1 order by created_at, id`, [S.org]);
    if (process.env.DEBUG_WS) console.log(rows.map((r) => `${r.action} ${r.entity_type} ${r.summary}`).join('\n'));
    const has = (action, entity, re) => rows.some((r) => r.action === action && r.entity_type === entity && re.test(r.summary));
    expect(has('created', 'organization', /Star Copper Corp/)).toBe(true);
    expect(has('invited', 'invite', /admin@star\.test as admin/)).toBe(true);
    expect(has('joined', 'member', /admin@star\.test joined as admin/)).toBe(true);
    expect(has('role_changed', 'member', /admin → owner/)).toBe(true);
    expect(has('removed', 'member', /leaver@star\.test left/)).toBe(true);
    expect(has('deleted', 'invite', /pro@star\.test/)).toBe(true);
    expect(has('created', 'property', /Rails Copper-Gold/)).toBe(true);
    expect(has('updated', 'property', /Rails Copper-Gold/)).toBe(true);
    expect(has('deleted', 'property', /Rails copper gold/)).toBe(true);
    expect(has('created', 'map', /Rails claims/)).toBe(true);
    expect(has('moved', 'map', /into the workspace/)).toBe(true);
    expect(has('moved', 'map', /out of the workspace/)).toBe(true);
    expect(has('created', 'figure', /Rails 3D/)).toBe(true);
    expect(has('moved', 'portfolio', /Rails claims/)).toBe(true);
    // Two saves and a thumbnail by E (one "created" row covers them), one by A.
    const edits = rows.filter((r) => r.entity_type === 'map' && /Rails claims/.test(r.summary) && r.action === 'updated');
    expect(edits.map((r) => r.actor)).toEqual([A]);
    // Personal work never appears.
    expect(rows.some((r) => /Personal (two|three)|Renamed/.test(r.summary))).toBe(false);
  });

  it('is readable by members, filterable by property, and not by others', async () => {
    const all = await val(V, `select public.get_org_activity($1, null, 200)`, [S.org]);
    expect(all.length).toBeGreaterThan(10);
    expect(all[0].actor_email).toBeTruthy();
    const prop = await val(V, `select public.get_org_activity($1, $2, 5)`, [S.org, S.prop]);
    expect(prop).toHaveLength(5);
    expect(prop.every((r) => r.property_id === S.prop && r.property_name === 'Rails Copper-Gold')).toBe(true);
    const older = await val(V, `select public.get_org_activity($1, null, 3, $2::timestamptz)`, [S.org, all[2].created_at]);
    expect(older.every((r) => new Date(r.created_at) < new Date(all[2].created_at))).toBe(true);
    await expect(as(X, `select public.get_org_activity($1)`, [S.org])).rejects.toThrow(/forbidden/);
    expect((await as(X, `select id from public.org_activity where org_id = $1`, [S.org])).rows).toEqual([]);
    expect((await as(V, `select count(*)::int as n from public.org_activity`)).rows[0].n).toBe(all.length);
  });

  it('cannot be written, changed or removed directly, even by the table owner', async () => {
    await expect(as(O, `insert into public.org_activity (org_id, action, entity_type, summary) values ($1, 'created', 'map', 'fake')`, [S.org])).rejects.toThrow(/permission denied/);
    await expect(as(O, `update public.org_activity set summary = 'x'`)).rejects.toThrow(/permission denied/);
    await expect(as(O, `delete from public.org_activity`)).rejects.toThrow(/permission denied/);
    await expect(as(O, `select public.log_org_activity($1, null, 'created', 'map', null, 'fake')`, [S.org])).rejects.toThrow(/permission denied/);
    await expect(su(`update public.org_activity set summary = 'rewritten'`)).rejects.toThrow(/append-only/);
    await expect(su(`delete from public.org_activity`)).rejects.toThrow(/append-only/);
  });
});

describe('leaving the company', () => {
  it('takes away access to the company\'s work, including what you created', async () => {
    expect(await val(A, `select public.remove_member($1, $2)`, [S.org, E])).toBe(true);
    expect((await as(E, `select id from public.projects where id = $1`, [S.map])).rows).toEqual([]);
    expect((await as(E, `select id from public.three_d_projects where id = $1`, [S.fig])).rows).toEqual([]);
    expect((await as(E, `select id from public.properties`)).rows).toEqual([]);
    await expect(as(E, `select public.save_cloud_project($1, 'x', '{}', null)`, [S.map])).rejects.toThrow(/PROJECT_NOT_FOUND/);
    expect((await as(E, `select name from storage.objects where name like 'org/%'`)).rows).toEqual([]);
    // Their personal maps are theirs as before.
    expect((await as(E, `select name from public.projects order by name`)).rows.map((r) => r.name)).toEqual(['Personal three', 'Renamed']);
    // And the claim portfolio they linked is still theirs to take back.
    await val(E, `select public.move_to_personal('portfolio', $1)`, [S.portfolio]);
    expect(await one(E, `select org_id, property_id from public.monitored_portfolios where id = $1`, [S.portfolio])).toEqual({ org_id: null, property_id: null });
    expect(await val(V, `select public.get_property_claims($1)`, [S.prop])).toEqual([]);
  });

  it('keeps one company out of another', async () => {
    const pb = await one(X, `insert into public.properties (org_id, name) values ($1, 'Rival') returning id`, [S.orgB]);
    expect((await as(O, `select id from public.properties where id = $1`, [pb.id])).rows).toEqual([]);
    await expect(as(O, `select public.move_to_property('map', $1, $2)`, [S.map, pb.id])).rejects.toThrow(/PROPERTY_NOT_FOUND/);
    await expect(as(X, `select public.move_to_property('map', $1, $2)`, [S.map, pb.id])).rejects.toThrow(/NOT_FOUND/);
    await expect(as(X, `select public.create_org_project($1, 'x', '{}')`, [S.prop])).rejects.toThrow(/PROPERTY_NOT_FOUND/);
    expect(await val(X, `select public.has_org_role($1, 'viewer')`, [S.org])).toBe(false);
    S.propB = pb.id;
  });

  it('takes work to another company only on an admin\'s say-so', async () => {
    // A is in both companies: an admin here, an editor at the rival.
    await su(`delete from public.org_invites where org_id = $1`, [S.orgB]);
    const r = await invite(X, S.orgB, 'admin@star.test', 'editor');
    await val(A, `select public.accept_org_invite($1)`, [r.token]);
    await as(O, `select public.set_member_role($1, $2, 'editor')`, [S.org, A]);
    await expect(as(A, `select public.move_to_property('map', $1, $2)`, [S.map, S.propB])).rejects.toThrow(/NOT_FOUND/);
    await as(O, `select public.set_member_role($1, $2, 'admin')`, [S.org, A]);
    await val(A, `select public.move_to_property('map', $1, $2)`, [S.map, S.propB]);
    expect((await as(O, `select id from public.projects where id = $1`, [S.map])).rows).toEqual([]);
    expect(await one(X, `select org_id, property_id from public.projects where id = $1`, [S.map])).toEqual({ org_id: S.orgB, property_id: S.propB });
  });
});
