import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

// The session timeline is only as good as the tables it unions.
//
// It shipped without product_events — the table recording what somebody
// actually did in the editor — so every session read as emptier than it was,
// and the Timeline buttons on the dashboard-v2 feeds (which are BUILT from
// product_events) opened a view that could not contain the row clicked.
// Nothing failed: the modal rendered "No tracked events for this session",
// which is what a genuinely idle session looks like.
//
// These tests derive the expected table list from the INGEST side rather than
// restating it, so a new session-scoped analytics table has to be added to the
// timeline or this fails.

const MIGRATIONS = 'supabase/migrations';
const FN = 'admin_get_session_timeline';

function currentDefinition() {
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort();
  let latest = null;
  for (const file of files) {
    const sql = readFileSync(path.join(MIGRATIONS, file), 'utf8');
    if (new RegExp(`create (or replace )?function\\s+public\\.${FN}\\s*\\(`, 'i').test(sql)) {
      latest = { file, sql };
    }
  }
  return latest;
}

function bodyOf(sql) {
  const start = sql.search(new RegExp(`create (or replace )?function\\s+public\\.${FN}`, 'i'));
  const end = sql.indexOf('$$;', start);
  return sql.slice(start, end === -1 ? undefined : end);
}

// Tables /api/track writes a session_id into. live_pings is excluded: it is a
// presence heartbeat upserted every ~25s, one row per session, and belongs in
// the duration column rather than as hundreds of timeline entries.
function sessionScopedTables() {
  const src = readFileSync('api/track.js', 'utf8');
  const tables = new Set();
  for (const m of src.matchAll(/\.from\('([a-z_]+)'\)\s*\.(insert|upsert)/g)) tables.add(m[1]);
  tables.delete('live_pings');
  // Written straight from the client, not through /api/track.
  tables.add('export_events');
  return [...tables];
}

describe('admin_get_session_timeline', () => {
  const def = currentDefinition();

  it('is defined by a migration, not only by the hand-run setup script', () => {
    expect(def, `no migration defines ${FN}`).toBeTruthy();
  });

  it.each(sessionScopedTables())('reads %s', (table) => {
    const body = bodyOf(def.sql);
    expect(
      body.includes(`public.${table}`),
      `${table} carries session_id but the timeline never reads it — sessions will under-report`,
    ).toBe(true);
  });

  it('renders every kind it emits', () => {
    // A kind with no EVENT_KIND_META entry falls back to a bullet and the raw
    // string, which reads as a bug rather than an event.
    const kinds = [...bodyOf(def.sql).matchAll(/'([a-z_]+)'::text/g)].map((m) => m[1]);
    expect(kinds.length).toBeGreaterThan(4);
    const page = readFileSync('src/components/AdminPage.jsx', 'utf8');
    const meta = page.slice(page.indexOf('const EVENT_KIND_META'), page.indexOf('function fmtDuration'));
    for (const kind of kinds) {
      expect(meta, `EVENT_KIND_META has no entry for '${kind}'`).toMatch(new RegExp(`\\b${kind}:`));
    }
  });

  it('keeps the argument name the dashboard sends', () => {
    // PostgREST binds RPC arguments by name; a rename empties the modal.
    expect(bodyOf(def.sql)).toMatch(/p_session_id\s+text/);
    expect(readFileSync('src/components/AdminPage.jsx', 'utf8')).toContain('p_session_id');
  });

  it('gates on is_admin() and does not resolve names through pg_temp', () => {
    const body = bodyOf(def.sql);
    expect(body).toMatch(/security\s+definer/i);
    expect(body).toMatch(/is_admin\(\)/);
    expect(body).toMatch(/set\s+search_path/i);
    expect(body).not.toMatch(/search_path\s*=\s*[^\n]*pg_temp/i);
  });

  it('never lets one null column blank out a whole row', () => {
    // detail is built by concatenation, and `null || 'x'` is null — a row with
    // a null format used to render as a label followed by nothing.
    const body = bodyOf(def.sql);
    expect(body).toMatch(/coalesce\(upper\(ee\.format\)/);
  });
});

describe('the timeline modal', () => {
  const page = readFileSync('src/components/AdminPage.jsx', 'utf8');

  it('distinguishes a failed load from an empty session', () => {
    // `.then(({ data }) => setSessionTimeline(data || []))` turned an RPC error
    // into "No tracked events for this session" — the same thing an idle
    // session shows, which is how a broken timeline stays unreported.
    expect(page).toMatch(/setSessionTimelineError/);
    const openFn = page.slice(page.indexOf('function openSession'), page.indexOf('function openSession') + 900);
    expect(openFn).toMatch(/if \(error\)/);
    expect(openFn).toMatch(/\.catch\(/);
  });
});
