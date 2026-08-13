import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

// Two ways an admin RPC breaks silently, both of which happened in one edit.
//
// 1. A RENAMED ARGUMENT. PostgREST binds RPC arguments BY NAME. Renaming
//    p_start/p_end to p_from/p_to made the dashboard's call a
//    function-not-found, and its batch loader substitutes an empty array on
//    error — so the report vanished rather than erroring visibly. Nothing in
//    SQL or JS alone reveals that; only the two together do.
//
// 2. A DROPPED GATE. `security definer` plus `grant execute to authenticated`
//    and no is_admin() check turns an admin report into a public endpoint. The
//    admin PAGE checking who you are protects nothing: anyone with a session
//    can call PostgREST directly.
//
// These read the CURRENT definition of each admin RPC — the newest migration
// that defines it — because an older migration's correct version says nothing
// about what is deployed now.

const MIGRATIONS = 'supabase/migrations';

function migrationFiles() {
  return readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort();
}

// The last migration to define this function is the one in effect.
function currentDefinition(fnName) {
  let latest = null;
  for (const file of migrationFiles()) {
    const sql = readFileSync(path.join(MIGRATIONS, file), 'utf8');
    const re = new RegExp(`create (or replace )?function\\s+public\\.${fnName}\\s*\\(`, 'i');
    if (re.test(sql)) latest = { file, sql };
  }
  return latest;
}

function bodyOf(sql, fnName) {
  const start = sql.search(new RegExp(`create (or replace )?function\\s+public\\.${fnName}`, 'i'));
  const end = sql.indexOf('$$;', start);
  return sql.slice(start, end === -1 ? undefined : end);
}

describe('admin_get_search_dropoff', () => {
  const def = currentDefinition('admin_get_search_dropoff');

  it('is defined by some migration', () => {
    expect(def, 'no migration defines admin_get_search_dropoff').toBeTruthy();
  });

  it('keeps the argument names the dashboard sends', () => {
    // AdminPage calls this with { p_start, p_end }. Renaming them does not
    // fail loudly — it empties the report.
    const body = bodyOf(def.sql, 'admin_get_search_dropoff');
    expect(body, `${def.file} renamed the range arguments`).toMatch(/p_start\s+timestamptz/);
    expect(body, `${def.file} renamed the range arguments`).toMatch(/p_end\s+timestamptz/);

    const caller = readFileSync('src/components/AdminPage.jsx', 'utf8');
    expect(caller).toContain('p_start');
    expect(caller).toContain('p_end');
  });

  it('gates on is_admin(), because it is security definer and granted to authenticated', () => {
    const body = bodyOf(def.sql, 'admin_get_search_dropoff');
    expect(body).toMatch(/security\s+definer/i);
    expect(body, `${def.file} drops the admin check on a definer function`).toMatch(/is_admin\(\)/);
  });

  it('is never granted to anon or public', () => {
    expect(def.sql).toMatch(/revoke\s+all\s+on\s+function\s+public\.admin_get_search_dropoff/i);
    expect(def.sql).not.toMatch(/grant\s+execute[^;]*admin_get_search_dropoff[^;]*\b(anon|public)\b/i);
  });

  it('scopes the window half-open, so a midnight event lands on one day only', () => {
    // AdminPage sends start = <day>T00:00Z and end = start + 24h, so p_end is
    // exclusive by construction. `> p_start` / `<= p_end` drops a search at the
    // selected day's midnight and counts one at the following midnight — the
    // event lands on the wrong day, and is double-counted across two views.
    const body = bodyOf(def.sql, 'admin_get_search_dropoff');
    expect(body, 'lower bound must be inclusive').toMatch(/created_at\s*>=\s*coalesce\(p_start/);
    expect(body, 'upper bound must be exclusive').toMatch(/created_at\s*<\s*coalesce\(p_end/);
    expect(body).not.toMatch(/created_at\s*>\s+coalesce\(p_start/);
    expect(body).not.toMatch(/created_at\s*<=\s*coalesce\(p_end/);
  });

  it('matches the half-open convention every other range RPC uses', () => {
    const v2 = readFileSync(path.join(MIGRATIONS, '20260713000001_admin_dashboard_v2.sql'), 'utf8');
    // Sanity: the convention is real and near-universal, not a lone example.
    expect((v2.match(/created_at >= p_start/g) || []).length).toBeGreaterThan(5);
    expect(v2).not.toMatch(/created_at <= p_end/);
  });

  it('does not resolve names through a caller-writable temp schema', () => {
    // A security-definer function searching pg_temp can be made to run the
    // caller's objects instead of the intended ones.
    const body = bodyOf(def.sql, 'admin_get_search_dropoff');
    expect(body).toMatch(/set\s+search_path/i);
    expect(body, 'pg_temp in a definer search_path').not.toMatch(/search_path\s*=\s*[^\n]*pg_temp/i);
  });
});

describe('admin_get_overview feed fix', () => {
  // This one is applied by rewriting the DEPLOYED definition rather than
  // restating ~200 lines of plpgsql, so what needs pinning is not the SQL but
  // the property that makes that safe: it must fail loudly rather than quietly
  // do nothing if the text it expects is not there.
  const file = 'supabase/migrations/20260813000006_fix_admin_overview_feed_ordering.sql';
  const sql = readFileSync(file, 'utf8');

  it('refuses to no-op when the fragment it patches is missing', () => {
    // Without this, a future edit to admin_get_overview would make the
    // migration silently skip, and the Overview tab would break again with a
    // green migration history.
    expect(sql).toMatch(/if\s+patched\s*=\s*def\s+then/i);
    expect(sql).toMatch(/raise\s+exception/i);
  });

  it('errors rather than continuing if the function is absent', () => {
    expect(sql).toMatch(/if\s+def\s+is\s+null\s+then/i);
  });

  it('moves the limit inside the derived table rather than deleting it', () => {
    // The outer LIMIT 50 never limited the feed — the outer query returns one
    // aggregate row. Dropping it entirely would have been a silent behaviour
    // change; it belongs inside, where it selects the newest 50 before
    // aggregation.
    expect(sql).toMatch(/order by 1 desc/i);
    expect(sql).toMatch(/limit 50/i);
  });
});

describe('every admin_ RPC', () => {
  // The rule this class of bug breaks, applied to all of them rather than only
  // the one that was caught.
  const names = new Set();
  for (const file of migrationFiles()) {
    const sql = readFileSync(path.join(MIGRATIONS, file), 'utf8');
    for (const m of sql.matchAll(/create (?:or replace )?function\s+public\.(admin_[a-z0-9_]+)\s*\(/gi)) {
      names.add(m[1]);
    }
  }

  it('finds admin RPCs to check', () => {
    expect(names.size).toBeGreaterThan(0);
  });

  // A security-definer function runs as its owner, so it must either check who
  // is asking or be unreachable by a signed-in user. Either is sufficient;
  // neither is not.
  //
  // Stating it as "must gate" would have been wrong: admin_session_ids is an
  // internal helper called only from other gated RPCs, and the right fix there
  // was to revoke the grant rather than add a redundant check that would make
  // it silently return nothing if reused elsewhere.
  function reachableByAuthenticated(fn) {
    // STARTS TRUE. This project carries a bootstrap default privilege —
    // `alter default privileges in schema public grant execute on functions to
    // anon, authenticated, service_role` — so every function is created with an
    // explicit authenticated grant already in its ACL. See the note in
    // 20260801000005_tenure_grant_hardening.sql.
    //
    // Assuming the opposite is how this check would have gone blind: a future
    // ungated `security definer admin_*` function written with no GRANT line at
    // all is reachable by every signed-in user, and a scanner that only counts
    // explicit grants would call it unreachable and pass it.
    //
    // Only a statement NAMING the role moves the needle. `revoke ... from
    // public` does not clear an explicit role grant — the same migration note
    // records that this is exactly why the Supabase advisor kept reporting
    // these functions as anon-executable.
    let reachable = true;
    for (const file of migrationFiles()) {
      const sql = readFileSync(path.join(MIGRATIONS, file), 'utf8');
      const re = new RegExp(`\\b(grant|revoke)\\b[^;]*\\b${fn}\\s*\\([^;]*;`, 'gis');
      for (const m of sql.matchAll(re)) {
        const stmt = m[0];
        if (!/\bauthenticated\b/i.test(stmt)) continue;
        reachable = /^\s*grant/i.test(stmt);
      }
    }
    return reachable;
  }

  it.each([...names])('%s is gated or unreachable — %s', (fn) => {
    const def = currentDefinition(fn);
    const body = bodyOf(def.sql, fn);
    if (!/security\s+definer/i.test(body)) return; // invoker rights: RLS applies
    const gated = /is_admin\(\)/.test(body);
    const reachable = reachableByAuthenticated(fn);
    expect(
      gated || !reachable,
      `${fn} is security definer in ${def.file}, callable by any signed-in user, `
      + 'and does not check is_admin()',
    ).toBe(true);
  });
});
