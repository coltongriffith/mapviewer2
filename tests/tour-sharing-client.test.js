import {describe,it,expect,vi} from 'vitest';
import {createTourSharingClient,hostedTourUrl} from '../src/features/tour3d/sharingClient';

const project='11111111-1111-4111-8111-111111111111',id='a'.repeat(32);
function setup(){
  let context={project,epoch:1,readOnly:false},session={user:{id:'user'},access_token:'secret'};
  const fetch=vi.fn(async()=>({ok:true,json:async()=>({tour:null})}));
  const getSession=vi.fn(async()=>session);
  const client=createTourSharingClient({getContext:()=>context,getSession,fetch});
  return {client,fetch,getSession,setContext:v=>{context={...context,...v};},setSession:v=>{session=v;}};
}
describe('tour sharing session and navigation guards',()=>{
  it('uses same-origin paths and a current token, without cookies or client-selected ownership',async()=>{
    const h=setup();expect(await h.client.status()).toBeNull();
    expect(h.fetch).toHaveBeenCalledWith(`/api/tour?project=${project}`,expect.objectContaining({credentials:'omit',cache:'no-store',headers:{Authorization:'Bearer secret'}}));
    h.fetch.mockResolvedValue({ok:true,json:async()=>({id,revision:1})});
    expect(await h.client.publish({v:1},null)).toEqual({id,revision:1});
    expect(JSON.parse(h.fetch.mock.calls[1][1].body)).toEqual({project,action:'publish',package:{v:1},revision:null});
    expect(hostedTourUrl(id)).toBe(`https://www.explorationmaps.com/tour/${id}`);
    expect(()=>hostedTourUrl('https://evil.test')).toThrow('Invalid tour link');
  });
  it.each([{readOnly:true},{project:null}])('does not send for unavailable context %j',async context=>{
    const h=setup();h.setContext(context);await expect(h.client.status()).rejects.toThrow();expect(h.fetch).not.toHaveBeenCalled();
  });
  it('refuses read-only versions and unsaved figures at construction context',async()=>{
    for(const context of [{project,epoch:1,readOnly:true},{project:null,epoch:1,readOnly:false}]){
      const fetch=vi.fn(),client=createTourSharingClient({getContext:()=>context,getSession:async()=>({}),fetch});
      await expect(client.status()).rejects.toThrow(context.readOnly?'read-only':'Save this');expect(fetch).not.toHaveBeenCalled();
    }
  });
  it('rejects navigation while resolving credentials before sending',async()=>{
    const h=setup();h.getSession.mockImplementation(async()=>{h.setContext({epoch:2});return {user:{id:'user'},access_token:'secret'};});
    await expect(h.client.status()).rejects.toMatchObject({code:'CONTEXT_CHANGED'});expect(h.fetch).not.toHaveBeenCalled();
  });
  it.each(['account','signout','figure'])('discards pending results after %s changes',async kind=>{
    const h=setup();h.fetch.mockImplementation(async()=>{
      if(kind==='account')h.setSession({user:{id:'other'},access_token:'other-token'});
      if(kind==='signout')h.setSession(null);
      if(kind==='figure')h.setContext({epoch:2});
      return {ok:true,json:async()=>({tour:{id,revision:1,updated_at:'2026-10-28'}})};
    });
    await expect(h.client.status()).rejects.toMatchObject({code:'CONTEXT_CHANGED'});
  });
  it('allows token refresh for the same user and aborts pending work on close',async()=>{
    const h=setup();await h.client.status();h.setSession({user:{id:'user'},access_token:'refreshed'});await h.client.status();
    expect(h.fetch.mock.calls[1][1].headers.Authorization).toBe('Bearer refreshed');
    h.fetch.mockImplementation(async(_url,options)=>{h.client.close();expect(options.signal.aborted).toBe(true);return {ok:true,json:async()=>({tour:null})};});
    await expect(h.client.status()).rejects.toMatchObject({code:'CONTEXT_CHANGED'});
  });
  it('keeps HTML downloads available when the optional schema is absent and ignores raw errors',async()=>{
    const h=setup();h.fetch.mockResolvedValue({ok:false,status:503,json:async()=>({error:'secret internal SQL'})});
    await expect(h.client.status()).rejects.toThrow('HTML download still works');
    h.fetch.mockResolvedValue({ok:true,json:async()=>({tour:{id:[id],revision:1,updated_at:'2026-10-28'}})});
    await expect(h.client.status()).rejects.toThrow('HTML download still works');
  });
  it('requires current revision and bounds package bytes before a network write',()=>{
    const h=setup();expect(()=>h.client.publish({},0)).toThrow('Refresh');
    expect(()=>h.client.publish({text:'x'.repeat(3*1024*1024)},null)).toThrow('too large');expect(h.fetch).not.toHaveBeenCalled();
  });
  it('handles stale updates and validates revocation results',async()=>{
    const h=setup();h.fetch.mockResolvedValue({ok:false,status:409,json:async()=>({})});await expect(h.client.publish({},1)).rejects.toMatchObject({status:409});
    h.fetch.mockResolvedValue({ok:true,json:async()=>({revoked:true})});expect(await h.client.revoke()).toEqual({revoked:true});
    h.fetch.mockResolvedValue({ok:true,json:async()=>({revoked:'true'})});await expect(h.client.revoke()).rejects.toThrow('unavailable');
  });
});
