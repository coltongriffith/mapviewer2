import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const sql = fs.readFileSync(path.join(process.cwd(), 'supabase/migrations/20260918223000_agent_api_foundation.sql'), 'utf8');

describe('agent API migration security contract', () => {
  it('keeps API credentials and run logs behind RLS', () => {
    expect(sql).toMatch(/alter table public\.agent_api_keys enable row level security/i);
    expect(sql).toMatch(/alter table public\.agent_runs enable row level security/i);
    expect(sql).toMatch(/revoke all on table public\.agent_api_keys from anon, authenticated/i);
  });

  it('restricts agent creation RPCs to service_role', () => {
    expect(sql).toMatch(/grant execute on function public\.create_agent_project_and_share\([^)]+\) to service_role/i);
    expect(sql).toMatch(/revoke execute on function public\.create_agent_project_and_share\([^)]+\) from anon, authenticated/i);
  });

  it('stores token hashes rather than plaintext API keys', () => {
    expect(sql).toMatch(/token_hash text not null unique/i);
    expect(sql).not.toMatch(/token_secret|plaintext_token/i);
  });
});
