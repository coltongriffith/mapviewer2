// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// docs/state-machines.md, WS-7: a per-session preview budget only counts for a
// session id this server issued, so random ids cannot mint fresh budgets.
describe('MCP session ids', () => {
  beforeEach(() => { vi.resetModules(); vi.stubEnv('MCP_SESSION_SECRET', 'test-secret'); });
  afterEach(() => vi.unstubAllEnvs());

  it('verifies an id it issued and rejects forged or altered ones', async () => {
    const { issueSessionId, verifiedSessionId } = await import('../api/mcp.js');
    const id = issueSessionId();
    expect(verifiedSessionId(id)).toBe(id);
    expect(verifiedSessionId(crypto.randomUUID())).toBeNull();
    expect(verifiedSessionId(`${crypto.randomUUID()}.${id.split('.')[1]}`)).toBeNull();
    expect(verifiedSessionId(`${id.slice(0, -1)}x`)).toBeNull();
  });

  it('a different secret does not verify', async () => {
    const { issueSessionId } = await import('../api/mcp.js');
    const id = issueSessionId();
    vi.resetModules();
    vi.stubEnv('MCP_SESSION_SECRET', 'other-secret');
    const { verifiedSessionId } = await import('../api/mcp.js');
    expect(verifiedSessionId(id)).toBeNull();
  });
});
