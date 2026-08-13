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

  it('does not resolve names through a caller-writable temp schema', () => {
    // A security-definer function searching pg_temp can be made to run the
    // caller's objects instead of the intended ones.
    const body = bodyOf(def.sql, 'admin_get_search_dropoff');
    expect(body).toMatch(/set\s+search_path/i);
    expect(body, 'pg_temp in a definer search_path').not.toMatch(/search_path\s*=\s*[^\n]*pg_temp/i);
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
  function laterGrantsToAuthenticated(fn) {
    // The LAST grant/revoke wins, so scan every migration in order.
    let granted = false;
    for (const file of migrationFiles()) {
      const sql = readFileSync(path.join(MIGRATIONS, file), 'utf8');
      const re = new RegExp(`(grant|revoke)[^;]*\\b${fn}\\s*\\([^;]*?\\bauthenticated\\b[^;]*;`, 'gis');
      for (const m of sql.matchAll(re)) {
        granted = /^grant/i.test(m[0].trim());
      }
    }
    return granted;
  }

  it.each([...names])('%s is gated or unreachable — %s', (fn) => {
    const def = currentDefinition(fn);
    const body = bodyOf(def.sql, fn);
    if (!/security\s+definer/i.test(body)) return; // invoker rights: RLS applies
    const gated = /is_admin\(\)/.test(body);
    const reachable = laterGrantsToAuthenticated(fn);
    expect(
      gated || !reachable,
      `${fn} is security definer in ${def.file}, callable by any signed-in user, `
      + 'and does not check is_admin()',
    ).toBe(true);
  });
});
