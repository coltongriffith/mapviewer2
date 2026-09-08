// @vitest-environment node
import { beforeAll, beforeEach, afterAll, describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

// Run the error-sink migration in an isolated PostgreSQL engine and check the
// shape the Health tab renders (src/components/admin/HealthTab.jsx), the
// grouping api/client-error.js relies on, and the admin gate.
let db;
const uid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

beforeAll(async () => {
  db = await PGlite.create();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth;
    create table auth.users (id uuid primary key, email text);
    create function public.is_admin() returns boolean language sql as $$ select current_setting('test.admin', true) = 'yes' $$;
    alter default privileges in schema public grant execute on functions to anon, authenticated;
  `);
  const sql = readFileSync('supabase/migrations/20260729000003_error_events.sql', 'utf8');
  await db.exec(sql);
  // Idempotent: re-applying to a database that already has it is a no-op.
  await db.exec(sql);
}, 30000);
afterAll(async () => { await db?.close(); });
beforeEach(async () => {
  await db.exec("reset role; set test.admin = 'yes'; truncate auth.users, public.error_events;");
});

const summary = async (hours = 24) => (await db.query('select public.admin_get_error_summary($1) as d', [hours])).rows[0].d;
const row = (fields) => db.query(
  'insert into public.error_events (occurred_at, source, kind, message, stack, path, release, user_id, fingerprint, seen_count) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
  [fields.at ?? new Date().toISOString(), fields.source ?? 'client', fields.kind ?? 'error', fields.message ?? 'boom',
    fields.stack ?? null, fields.path ?? '/', fields.release ?? '1.0.0', fields.user ?? null, fields.fp ?? 'fp-a', fields.seen ?? 1],
);

describe('error summary SQL', () => {
  it('returns the empty shape the Health tab expects', async () => {
    expect(await summary()).toEqual({ window_hours: 24, total: 0, groups: [] });
  });

  it('groups by fingerprint, sums collapsed repeats and counts distinct users', async () => {
    await db.query('insert into auth.users values ($1,$2),($3,$4)', [uid(1), 'a@example.test', uid(2), 'b@example.test']);
    await row({ fp: 'fp-a', seen: 3, user: uid(1), at: '2026-09-08T10:00:00Z', stack: 'older stack' });
    await row({ fp: 'fp-a', seen: 2, user: uid(2), at: '2026-09-08T11:00:00Z', stack: 'newest stack' });
    await row({ fp: 'fp-a', seen: 1, user: uid(2), at: '2026-09-08T10:30:00Z' });
    await row({ fp: 'fp-b', kind: 'api', source: 'api', message: 'stripe failed', at: '2026-09-08T09:00:00Z' });
    const d = await summary(24 * 365 * 10);
    expect(d.total).toBe(7);
    expect(d.groups.map(g => g.fingerprint)).toEqual(['fp-a', 'fp-b']); // newest first
    const a = d.groups[0];
    expect(a).toMatchObject({ count: 6, users: 2, kind: 'error', source: 'client', release: '1.0.0', sample_stack: 'newest stack' });
    expect(a.last_seen.startsWith('2026-09-08T11:00:00')).toBe(true);
    expect(d.groups[1]).toMatchObject({ count: 1, users: 0, kind: 'api', message: 'stripe failed' });
  });

  it('only counts the requested window', async () => {
    await row({ fp: 'old', at: new Date(Date.now() - 30 * 3600_000).toISOString() });
    await row({ fp: 'new', at: new Date(Date.now() - 3600_000).toISOString() });
    const d = await summary(24);
    expect(d.total).toBe(1);
    expect(d.groups.map(g => g.fingerprint)).toEqual(['new']);
  });

  it('refuses non-admins and keeps the table off limits to client roles', async () => {
    await db.exec("set test.admin = 'no'");
    await expect(summary()).rejects.toThrow(/forbidden/);
    const priv = async (role, table) => (await db.query(
      'select has_table_privilege($1, $2, $3) as ok', [role, table, 'SELECT'])).rows[0].ok;
    expect(await priv('anon', 'public.error_events')).toBe(false);
    expect(await priv('authenticated', 'public.error_events')).toBe(false);
    expect(await priv('service_role', 'public.error_events')).toBe(true);
    const fn = async (role) => (await db.query(
      "select has_function_privilege($1, 'public.admin_get_error_summary(integer)', 'EXECUTE') as ok", [role])).rows[0].ok;
    expect(await fn('anon')).toBe(false);
    expect(await fn('authenticated')).toBe(true);
  });
});
