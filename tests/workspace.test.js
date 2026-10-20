import { describe, it, expect, vi, beforeEach } from 'vitest';

// src/utils/workspace.js: the role rules the UI follows (mirroring the SQL),
// the 3D file-path mapping the move RPC checks, error wording, and the calls
// it makes to Supabase.

const calls = [];
const rpcResults = {};
const tableRows = {};
function query(table) {
  const q = { table, filters: [] };
  const chain = new Proxy(q, {
    get(target, prop) {
      if (prop === 'then') return (res, rej) => Promise.resolve({ data: tableRows[table] ?? [], error: null }).then(res, rej);
      if (prop === 'maybeSingle') return async () => ({ data: (tableRows[table] ?? [])[0] ?? null, error: null });
      return (...args) => { target.filters.push([prop, ...args]); return chain; };
    },
  });
  calls.push(q);
  return chain;
}
vi.mock('../src/lib/supabase', () => ({
  supabase: {
    rpc: vi.fn(async (fn, args) => {
      calls.push({ rpc: fn, args });
      const r = rpcResults[fn];
      return r instanceof Error ? { data: null, error: { message: r.message } } : { data: r ?? null, error: null };
    }),
    from: vi.fn((t) => query(t)),
    storage: { from: () => ({ copy: vi.fn(async (a, b) => { calls.push({ copy: [a, b] }); return { error: null }; }), remove: vi.fn(async () => ({ error: null })) }) },
  },
}));

const ws = await import('../src/utils/workspace.js');

beforeEach(() => {
  calls.length = 0;
  for (const k of Object.keys(rpcResults)) delete rpcResults[k];
  for (const k of Object.keys(tableRows)) delete tableRows[k];
  localStorage.clear();
  ws.forgetWorkspaces();
});

describe('roles', () => {
  it('ranks viewer < editor < admin < owner', () => {
    expect(ws.hasRole('viewer', 'viewer')).toBe(true);
    expect(ws.hasRole('viewer', 'editor')).toBe(false);
    expect(ws.hasRole('owner', 'admin')).toBe(true);
    expect(ws.hasRole(null, 'viewer')).toBe(false);
    expect(ws.hasRole('owner', 'superuser')).toBe(false);
  });

  it('offers each role only what the database allows', () => {
    expect(ws.permissions('viewer')).toMatchObject({ read: true, edit: false, invite: false, deleteProperty: false });
    expect(ws.permissions('editor')).toMatchObject({ edit: true, invite: false, moveOut: false });
    expect(ws.permissions('admin')).toMatchObject({ invite: true, deleteProperty: true, moveOut: true, manageOwners: false });
    expect(ws.permissions('owner').manageOwners).toBe(true);
    expect(ws.assignableRoles('admin')).toEqual(['admin', 'editor', 'viewer']);
    expect(ws.assignableRoles('editor')).toEqual([]);
    expect(ws.canManageMember('admin', 'owner')).toBe(false);
    expect(ws.canManageMember('admin', 'editor')).toBe(true);
    expect(ws.canManageMember('owner', 'owner')).toBe(true);
    expect(ws.canManageMember('editor', 'viewer')).toBe(false);
  });
});

describe('text helpers', () => {
  it('slugifies like the database', () => {
    expect(ws.slugify(' Rails Copper-Gold! ')).toBe('rails-copper-gold');
    expect(ws.slugify('Éclat')).toBe('clat');
  });
  it('parses a commodity list without duplicates', () => {
    expect(ws.parseCommodities('Cu, Au; cu / Mo  Ag')).toEqual(['Cu', 'Au', 'Mo', 'Ag']);
    expect(ws.parseCommodities('')).toEqual([]);
  });
  it('builds the invite link on the canonical host', () => {
    expect(ws.inviteLink('ab'.repeat(32))).toBe(`https://www.explorationmaps.com/invite?token=${'ab'.repeat(32)}`);
  });
  it('turns database errors into sentences', () => {
    expect(ws.workspaceError({ message: 'LAST_OWNER: a workspace needs at least one owner' }).message).toMatch(/at least one owner/);
    expect(ws.workspaceError({ message: 'INVITE_EMAIL_MISMATCH: x' }).message).toMatch(/different email address/);
    expect(ws.workspaceError({ message: 'new row violates row-level security policy' }).message).toMatch(/permission/);
    expect(ws.workspaceError({ message: 'ORG_PROJECT_LIMIT: 25' }).message).toMatch(/map limit/);
    expect(ws.workspaceError({ message: 'PROJECT_LIMIT: free plan' }).message).toMatch(/personal plan/);
    expect(ws.workspaceError({ message: 'something odd' }).message).toBe('something odd');
  });
});

describe('3D figure folders', () => {
  const org = '00000000-0000-4000-8000-0000000000aa';
  const uid = '00000000-0000-4000-8000-0000000000bb';
  const id = '00000000-0000-4000-8000-0000000000cc';
  it('match public.ws_figure_root', () => {
    expect(ws.figureRoot({ orgId: org, id })).toBe(`org/${org}/${id}/`);
    expect(ws.figureRoot({ ownerId: uid, id })).toBe(`${uid}/${id}/`);
  });
  it('rebase a path, and refuse one outside the folder', () => {
    expect(ws.rebaseFigurePath(`${uid}/${id}/r1/c.csv`, `${uid}/${id}/`, `org/${org}/${id}/`)).toBe(`org/${org}/${id}/r1/c.csv`);
    expect(() => ws.rebaseFigurePath(`other/${id}/c.csv`, `${uid}/${id}/`, 'x/')).toThrow(/outside/);
    expect(() => ws.rebaseFigurePath(`${uid}/${id}/../c.csv`, `${uid}/${id}/`, 'x/')).toThrow(/outside/);
  });
  it('copies the files, then moves the row, then tidies', async () => {
    tableRows.three_d_projects = [{ id, user_id: uid, org_id: null, file_paths: [{ path: `${uid}/${id}/r1/c.csv` }] }];
    rpcResults.move_to_property = { id };
    await ws.moveFigureToProperty(id, { id: 'p1', org_id: org });
    const copy = calls.find((c) => c.copy);
    const move = calls.findIndex((c) => c.rpc === 'move_to_property');
    expect(copy.copy).toEqual([`${uid}/${id}/r1/c.csv`, `org/${org}/${id}/r1/c.csv`]);
    expect(calls.indexOf(copy)).toBeLessThan(move);
    expect(calls[move].args).toEqual({ p_kind: 'figure', p_id: id, p_property: 'p1' });
  });
});

describe('calls', () => {
  it('creates a workspace and makes it active', async () => {
    rpcResults.create_organization = { id: 'org1', name: 'Star', slug: 'star', role: 'owner' };
    const r = await ws.createWorkspace('  Star ');
    expect(r.id).toBe('org1');
    expect(calls[0]).toEqual({ rpc: 'create_organization', args: { p_name: 'Star' } });
    expect(ws.getActiveWorkspaceId()).toBe('org1');
  });

  it('caches the workspace list briefly', async () => {
    rpcResults.get_my_workspaces = [{ id: 'a', name: 'A', role: 'viewer' }];
    await ws.listMyWorkspaces();
    await ws.listMyWorkspaces();
    expect(calls.filter((c) => c.rpc === 'get_my_workspaces')).toHaveLength(1);
    await ws.listMyWorkspaces({ fresh: true });
    expect(calls.filter((c) => c.rpc === 'get_my_workspaces')).toHaveLength(2);
  });

  it('picks the active workspace, or the first, or personal', () => {
    const list = [{ id: 'a' }, { id: 'b' }];
    expect(ws.pickActive(list, 'b').id).toBe('b');
    expect(ws.pickActive(list, 'gone').id).toBe('a');
    expect(ws.pickActive(list, 'personal')).toBeNull();
    expect(ws.pickActive([], 'a')).toBeNull();
  });

  it('describes where a company map lives, and asks nothing for users with no workspace', async () => {
    rpcResults.get_my_workspaces = [];
    expect(await ws.getProjectHome('m1')).toBeNull();
    expect(calls.some((c) => c.table === 'projects')).toBe(false);
    ws.forgetWorkspaces();
    rpcResults.get_my_workspaces = [{ id: 'org1', name: 'Star', role: 'viewer' }];
    tableRows.projects = [{ org_id: 'org1', property_id: 'p1' }];
    tableRows.properties = [{ id: 'p1', name: 'Rails', slug: 'rails' }];
    expect(await ws.getProjectHome('m1')).toEqual({
      orgId: 'org1', orgName: 'Star', role: 'viewer', readOnly: true, propertyId: 'p1', propertyName: 'Rails', propertySlug: 'rails',
    });
  });

  it('surfaces a refused invite in plain words', async () => {
    rpcResults.accept_org_invite = new Error('INVITE_EXPIRED: this invite has expired');
    await expect(ws.acceptInvite('t')).rejects.toThrow(/expired/);
  });

  it('keeps an invite token across sign-in, for 14 days', () => {
    ws.rememberInviteToken('tok');
    expect(ws.pendingInviteToken()).toBe('tok');
    localStorage.setItem('em.pendingInvite.v1', JSON.stringify({ token: 'old', at: Date.now() - 15 * 864e5 }));
    expect(ws.pendingInviteToken()).toBeNull();
    ws.clearInviteToken();
    expect(ws.pendingInviteToken()).toBeNull();
  });
});
