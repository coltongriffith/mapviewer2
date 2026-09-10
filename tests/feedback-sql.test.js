// @vitest-environment node
import { beforeAll, beforeEach, afterAll, describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

// Run the feedback migration in an isolated PostgreSQL engine and check the
// shape the Feedback tab renders (src/components/admin/FeedbackTab.jsx), the
// triage RPC, the admin gate, and — the important one — that the owner
// notification trigger can never make an insert fail.
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
  const sql = readFileSync('supabase/migrations/20260910000001_user_feedback.sql', 'utf8');
  await db.exec(sql);
  // Idempotent: re-applying to a database that already has it is a no-op.
  await db.exec(sql);
}, 30000);
afterAll(async () => { await db?.close(); });
beforeEach(async () => {
  await db.exec("reset role; set test.admin = 'yes'; truncate auth.users, public.feedback;");
});

const list = async (status = null, limit = 100) => (await db.query('select public.admin_get_feedback($1, $2) as d', [status, limit])).rows[0].d;
const insert = (fields = {}) => db.query(
  'insert into public.feedback (kind, message, email, path, release, user_id, context, created_at) values ($1,$2,$3,$4,$5,$6,$7,$8) returning id',
  [fields.kind ?? 'bug', fields.message ?? 'export broke', fields.email ?? null, fields.path ?? '/', fields.release ?? '1.0.0',
    fields.user ?? null, fields.context ?? null, fields.at ?? new Date().toISOString()],
);

describe('feedback SQL', () => {
  it('returns the empty shape the Feedback tab expects', async () => {
    expect(await list()).toEqual({ open_count: 0, items: [] });
  });

  it('inserts succeed even though the notification trigger cannot reach Vault or pg_net here', async () => {
    // No vault schema, no net schema in this engine — exactly the failure
    // modes the trigger must swallow. The row is the record; the email is
    // only the nudge.
    const { rows } = await insert({ message: 'hello' });
    expect(rows[0].id).toBeTruthy();
    expect((await list()).open_count).toBe(1);
  });

  it('lists newest first with the submitter email joined from auth.users', async () => {
    await db.query('insert into auth.users values ($1,$2)', [uid(1), 'a@example.test']);
    await insert({ message: 'older', at: '2026-09-08T10:00:00Z', email: 'anon@example.test' });
    await insert({ message: 'newer', at: '2026-09-08T11:00:00Z', user: uid(1), kind: 'idea', context: { viewport: '1280x720' } });
    const d = await list();
    expect(d.open_count).toBe(2);
    expect(d.items.map(i => i.message)).toEqual(['newer', 'older']);
    expect(d.items[0]).toMatchObject({ kind: 'idea', user_email: 'a@example.test', email: null, status: 'new', context: { viewport: '1280x720' } });
    expect(d.items[1]).toMatchObject({ kind: 'bug', user_email: null, email: 'anon@example.test' });
  });

  it('filters by status and counts only new reports as open', async () => {
    const { rows } = await insert({ message: 'one' });
    await insert({ message: 'two' });
    const set = await db.query('select public.admin_set_feedback_status($1, $2) as d', [rows[0].id, 'resolved']);
    expect(set.rows[0].d).toMatchObject({ id: rows[0].id, status: 'resolved' });
    expect(set.rows[0].d.status_at).toBeTruthy();
    const open = await list('new');
    expect(open.open_count).toBe(1);
    expect(open.items.map(i => i.message)).toEqual(['two']);
    expect((await list()).items).toHaveLength(2);
    // Reopening clears status_at.
    const reopen = await db.query('select public.admin_set_feedback_status($1, $2) as d', [rows[0].id, 'new']);
    expect(reopen.rows[0].d.status_at).toBeNull();
  });

  it('rejects an unknown status and an unknown id', async () => {
    const { rows } = await insert();
    await expect(db.query('select public.admin_set_feedback_status($1, $2)', [rows[0].id, 'ignored'])).rejects.toThrow(/invalid status/);
    await expect(db.query('select public.admin_set_feedback_status($1, $2)', [uid(9), 'resolved'])).rejects.toThrow(/not found/);
  });

  it('enforces the column constraints the API relies on', async () => {
    await expect(insert({ kind: 'rant' })).rejects.toThrow();
    await expect(insert({ message: '' })).rejects.toThrow();
    await expect(insert({ message: 'x'.repeat(4001) })).rejects.toThrow();
  });

  it('refuses non-admins and keeps the table off limits to client roles', async () => {
    await db.exec("set test.admin = 'no'");
    await expect(list()).rejects.toThrow(/forbidden/);
    await expect(db.query('select public.admin_set_feedback_status($1, $2)', [uid(1), 'resolved'])).rejects.toThrow(/forbidden/);
    const priv = async (role, table, mode) => (await db.query(
      'select has_table_privilege($1, $2, $3) as ok', [role, table, mode])).rows[0].ok;
    expect(await priv('anon', 'public.feedback', 'SELECT')).toBe(false);
    expect(await priv('authenticated', 'public.feedback', 'SELECT')).toBe(false);
    expect(await priv('authenticated', 'public.feedback', 'INSERT')).toBe(false);
    expect(await priv('service_role', 'public.feedback', 'INSERT')).toBe(true);
    const fnPriv = async (role, fn) => (await db.query('select has_function_privilege($1, $2, $3) as ok', [role, fn, 'EXECUTE'])).rows[0].ok;
    expect(await fnPriv('anon', 'public.admin_get_feedback(text, integer)')).toBe(false);
    expect(await fnPriv('authenticated', 'public.send_feedback_notification(uuid, text, text, text, text, uuid)')).toBe(false);
  });
});
