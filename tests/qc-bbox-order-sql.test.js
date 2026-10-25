import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { beforeAll, afterAll, it, expect } from 'vitest';

// qc_claims_in_bbox stops at 2000 rows. Without an ORDER BY inside, which
// 2000 is up to the plan, and /api/claims pages it one call per page. PostGIS
// is not bundled in PGlite: geom is jsonb and && is stubbed to match all.

let db;
const setup = readFileSync('supabase-qc-claims-setup.sql', 'utf8');
const fn = (sql) => sql.slice(sql.indexOf('create or replace function public.qc_claims_in_bbox'), sql.indexOf('$$;', sql.indexOf('create or replace function public.qc_claims_in_bbox')) + 3);
const call = "select tag_number, owner_name from qc_claims_in_bbox(-80, 45, -60, 62)";

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create role anon; create role service_role;
    create function st_makeenvelope(float8,float8,float8,float8,integer) returns jsonb language sql immutable as $$select '{}'::jsonb$$;
    create function bbox_stub(jsonb, jsonb) returns boolean language sql immutable as $$select true$$;
    create operator && (leftarg = jsonb, rightarg = jsonb, function = bbox_stub);
    create table qc_claims (tag_number text, owner_name text, status text, good_to_date date, area_hectares numeric, title_type text, geometry jsonb, geom jsonb);
    insert into qc_claims select lpad((2500 - i)::text, 7, '0'), 'Owner ' || (i % 3), 'Actif', null, 52.6, 'CDC', null, '{}' from generate_series(1, 2500) i;
    insert into qc_claims select tag_number, 'Co-owner', status, good_to_date, area_hectares, title_type, geometry, geom from qc_claims where tag_number = '0000500';`);
  await db.exec(`${fn(setup)}
    grant execute on function public.qc_claims_in_bbox(double precision, double precision, double precision, double precision) to anon, service_role;`);
}, 60000);
afterAll(async () => { await db?.close(); });

it('keeps the 2000 lowest tag numbers, in order, and keeps the grants', async () => {
  expect((await db.query(call)).rows[0].tag_number).not.toBe('0000000');   // unordered: the plan picks
  await db.exec(readFileSync('supabase/migrations/20261103130000_qc_bbox_order.sql', 'utf8'));
  const { rows } = await db.query(call);
  expect(rows).toHaveLength(2000);
  const tags = rows.map((r) => r.tag_number);
  expect(tags).toEqual([...tags].sort());
  expect(tags[0]).toBe('0000000');
  expect(tags.at(-1)).toBe('0001998');
  expect(rows.filter((r) => r.tag_number === '0000500').map((r) => r.owner_name)).toEqual(['Co-owner', 'Owner 2']);
  expect((await db.query(call)).rows).toEqual(rows);
  const { rows: [g] } = await db.query("select has_function_privilege('anon', 'public.qc_claims_in_bbox(double precision, double precision, double precision, double precision)', 'execute') as ok");
  expect(g.ok).toBe(true);
});

it('is idempotent', async () => {
  await db.exec(readFileSync('supabase/migrations/20261103130000_qc_bbox_order.sql', 'utf8'));
  expect((await db.query(call)).rows).toHaveLength(2000);
});
