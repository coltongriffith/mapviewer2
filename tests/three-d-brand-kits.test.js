import { describe, it, expect, vi } from 'vitest';
import { readOwnedBrandKits } from '../src/three-d/brand-kit-access.js';
import { createBrandKitPicker } from '../src/three-d/brand-kits.js';

const row = { id: 'kit-a', user_id: 'owner-a', name: '<My kit>', config: { titleBgColor: '#123456', accentColor: '#abcdef' }, created_at: '2026-10-01' };
function backend({ users = ['owner-a', 'owner-a'], data = [row], error = null } = {}) {
  const calls = [], listeners = [];let index = 0;
  const sb = { auth: {
    getUser: vi.fn(async () => ({ data: { user: users[Math.min(index++, users.length - 1)] ? { id: users[Math.min(index - 1, users.length - 1)] } : null }, error: null })),
    onAuthStateChange: vi.fn((f) => { listeners.push(f); return { data: { subscription: { unsubscribe() {} } } }; }),
  }, from: vi.fn((table) => {
    calls.push(['from', table]);const query = {
      select(v) { calls.push(['select', v]);return this; }, eq(k,v) { calls.push(['eq',k,v]);return this; },
      order(k,v) { calls.push(['order',k,v]);return this; }, then(ok) { return Promise.resolve({ data, error }).then(ok); },
    };return query;
  }) };
  return { sb, calls, change: () => listeners.forEach((f) => f('SIGNED_OUT', null)) };
}

describe('read-only verified owned brand kits', () => {
  it('filters the database read and rejects foreign rows even if returned', async () => {
    const b=backend({data:[row,{...row,id:'foreign',user_id:'owner-b'}]});
    const result=await readOwnedBrandKits(b.sb);
    expect(result.kits.map(r=>r.id)).toEqual(['kit-a']);expect(b.calls).toContainEqual(['eq','user_id','owner-a']);
    expect(b.sb.auth.getUser).toHaveBeenCalledTimes(2);
    result.kits[0].config.titleBgColor='#ffffff';expect(row.config.titleBgColor).toBe('#123456');
  });
  it('requires a verified user before reading rows', async () => {
    const b=backend({users:[null]});await expect(readOwnedBrandKits(b.sb)).rejects.toMatchObject({code:'SIGNED_OUT'});expect(b.sb.from).not.toHaveBeenCalled();
  });
  it('rejects account changes and superseded requests', async () => {
    const b=backend({users:['owner-a','owner-b']});await expect(readOwnedBrandKits(b.sb)).rejects.toMatchObject({code:'STALE'});
    const c=backend();await expect(readOwnedBrandKits(c.sb,{isCurrent:()=>false})).rejects.toMatchObject({code:'STALE'});expect(c.sb.from).not.toHaveBeenCalled();
  });
  it('reads the selected kit again with both identity and owner filters', async () => {
    const b=backend();await readOwnedBrandKits(b.sb,{id:'kit-a'});expect(b.calls).toContainEqual(['eq','id','kit-a']);
    expect((await readOwnedBrandKits(b.sb,{id:'deleted'})).kits).toEqual([]);
  });
  it('does not turn missing schema or malformed responses into empty success', async () => {
    await expect(readOwnedBrandKits(backend({error:{code:'42P01'}}).sb)).rejects.toMatchObject({code:'42P01'});
    await expect(readOwnedBrandKits(backend({data:{}}).sb)).rejects.toMatchObject({code:'INVALID_RESPONSE'});
  });
});

function ui(b) {
  document.body.innerHTML='<button id="brand-kits-load"></button><div id="brand-kits-choices" hidden><select id="brand-kits-select"></select><button id="brand-kits-apply" disabled></button></div><p id="brand-kits-note"></p>';
  let figure={settings:{bins:[0.1,0.5],title:'QA'},files:[]};
  const api={getProject:()=>structuredClone(figure),filesDigest:()=> 'files',setFigureStyle:vi.fn(async()=>{})};
  const picker=createBrandKitPicker({getClient:async()=>b.sb,api,doc:document});
  return {picker,api,replace:()=>{figure={...figure,settings:{title:'Replacement'}};},note:()=>document.getElementById('brand-kits-note').textContent};
}
describe('explicit brand picker', () => {
  it('loads safely named options without auto-application and applies only presentation fields', async () => {
    const b=backend(),u=ui(b);await u.picker.refresh();expect(u.api.setFigureStyle).not.toHaveBeenCalled();
    expect(document.querySelector('option').textContent).toBe('<My kit>');expect(document.querySelector('option').children).toHaveLength(0);
    document.getElementById('brand-kits-apply').click();await vi.waitFor(()=>expect(u.api.setFigureStyle).toHaveBeenCalledTimes(1));
    const [style,meta]=u.api.setFigureStyle.mock.calls[0];expect(style.colours.primary).toBe('#123456');expect(meta.brandKitId).toBe('kit-a');expect(meta.isCurrent()).toBe(true);
    expect(u.api.getProject().settings.bins).toEqual([0.1,0.5]);
  });
  it('clears selections on sign-out and rejects a replacement figure during reads', async () => {
    const b=backend(),u=ui(b);await u.picker.refresh();b.change();expect(document.querySelectorAll('option')).toHaveLength(0);expect(document.getElementById('brand-kits-choices').hidden).toBe(true);
    await u.picker.refresh();let finish;
    b.sb.auth.getUser.mockImplementationOnce(()=>new Promise(r=>{finish=r;}));
    document.getElementById('brand-kits-apply').click();await vi.waitFor(()=>expect(finish).toBeTypeOf('function'));u.replace();finish({data:{user:{id:'owner-a'}}});
    await vi.waitFor(()=>expect(u.note()).toContain('changed'));expect(u.api.setFigureStyle).not.toHaveBeenCalled();
  });
  it('invalidates pending asset application on account change', async () => {
    const b=backend(),u=ui(b);await u.picker.refresh();let finish,guard;
    u.api.setFigureStyle.mockImplementation((style,meta)=>{guard=meta.isCurrent;return new Promise(r=>{finish=r;});});
    document.getElementById('brand-kits-apply').click();await vi.waitFor(()=>expect(guard).toBeTypeOf('function'));expect(guard()).toBe(true);b.change();expect(guard()).toBe(false);
    expect(document.getElementById('brand-kits-select').disabled).toBe(false);finish();
    await vi.waitFor(()=>expect(document.getElementById('brand-kits-select').disabled).toBe(false));
  });
  it('cancels a pending apply even when an identical figure is opened', async () => {
    const b=backend(),u=ui(b);await u.picker.refresh();let finish;
    b.sb.auth.getUser.mockImplementationOnce(()=>new Promise(r=>{finish=r;}));
    document.getElementById('brand-kits-apply').click();await vi.waitFor(()=>expect(finish).toBeTypeOf('function'));
    window.dispatchEvent(new Event('em3d:figure-loading'));finish({data:{user:{id:'owner-a'}}});
    await vi.waitFor(()=>expect(u.note()).toContain('figure changed'));expect(u.api.setFigureStyle).not.toHaveBeenCalled();
    expect(document.getElementById('brand-kits-choices').hidden).toBe(true);
  });
  it('shows missing-schema fallback without touching the figure', async () => {
    const u=ui(backend({error:{code:'PGRST205'}}));await u.picker.refresh();expect(u.note()).toContain('not available');expect(u.api.setFigureStyle).not.toHaveBeenCalled();
  });
  it('keeps the local figure usable when account configuration is absent', async () => {
    const b=backend(),u=ui(b);b.sb.auth.getUser.mockRejectedValue({code:'NOT_CONFIGURED'});
    await u.picker.refresh();expect(u.note()).toContain('not available');expect(u.api.setFigureStyle).not.toHaveBeenCalled();
  });
});
