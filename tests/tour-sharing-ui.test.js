import {describe,it,expect,vi,afterEach} from 'vitest';
import {mountTourSharing} from '../src/features/tour3d/sharingUI';
const project='11111111-1111-4111-8111-111111111111',id='a'.repeat(32);
function setup(){
  const host=document.createElement('section');document.body.append(host);
  let pkg={v:1},onAuth;
  const fetch=vi.fn(async()=>({ok:true,json:async()=>({tour:null})})),unsubscribe=vi.fn();
  const services=vi.fn(async()=>({getContext:()=>({project,epoch:1,readOnly:false}),getSession:async()=>({user:{id:'user'},access_token:'token'}),fetch,subscribe:cb=>{onAuth=cb;return {unsubscribe};}}));
  const ui=mountTourSharing(host,{getPackage:()=>pkg,services});
  const $=s=>host.querySelector(s),click=s=>$(s).click();
  const ready=async()=>{click('.tour-share-check');await vi.waitFor(()=>expect($('.tour-share-publish').disabled).toBe(false));};
  const consent=()=>{const e=$('input[type=checkbox]');e.checked=true;e.dispatchEvent(new Event('change'));};
  return {host,ui,$,click,fetch,services,unsubscribe,consent,ready,setPackage:v=>{pkg=v;ui.refresh();},auth:()=>onAuth()};
}
afterEach(()=>{document.body.replaceChildren();});
describe('hosted tour sharing controls',()=>{
  it('does not load an account or publish until the user explicitly checks and consents',async()=>{
    const h=setup();expect(h.services).not.toHaveBeenCalled();expect(h.$('.tour-share-publish').disabled).toBe(true);
    h.click('.tour-share-check');await vi.waitFor(()=>expect(h.$('[role=status]').textContent).toContain('No active link'));
    expect(h.$('.tour-share-publish').disabled).toBe(true);h.consent();expect(h.$('.tour-share-publish').disabled).toBe(false);
    h.setPackage(null);expect(h.$('.tour-share-publish').disabled).toBe(true);h.ui.close();
  });
  it('publishes only the current preview, displays a safe link/embed and revokes it',async()=>{
    const h=setup();h.consent();await h.ready();
    h.fetch.mockResolvedValue({ok:true,json:async()=>({id,revision:1})});h.click('.tour-share-publish');
    await vi.waitFor(()=>expect(h.$('[role=status]').textContent).toContain('Tour published'));
    expect(JSON.parse(h.fetch.mock.calls[1][1].body)).toEqual({action:'publish',project,revision:null,package:{v:1}});
    expect(h.$('a').href).toBe(`https://www.explorationmaps.com/tour/${id}`);expect(h.$('textarea').value).toContain('sandbox="allow-scripts"');
    expect(h.$('.tour-share-publish').disabled).toBe(true);
    h.fetch.mockResolvedValue({ok:true,json:async()=>({revoked:true})});h.click('.tour-share-revoke');
    await vi.waitFor(()=>expect(h.$('[role=status]').textContent).toContain('Link revoked'));
    expect(h.$('.tour-share-link').hidden).toBe(true);expect(h.$('textarea').value).toBe('');h.ui.close();expect(h.unsubscribe).toHaveBeenCalled();
  });
  it('requires refreshing a stale revision before another publish',async()=>{
    const h=setup();h.consent();await h.ready();h.fetch.mockResolvedValue({ok:false,status:409,json:async()=>({})});
    h.click('.tour-share-publish');await vi.waitFor(()=>expect(h.$('[role=status]').textContent).toContain('Refresh its status'));
    expect(h.$('.tour-share-publish').disabled).toBe(true);expect(h.$('.tour-share-check').disabled).toBe(false);h.ui.close();
  });
  it('shows optional-schema fallback without affecting the preview package',async()=>{
    const h=setup();h.fetch.mockResolvedValue({ok:false,status:503,json:async()=>({})});h.click('.tour-share-check');
    await vi.waitFor(()=>expect(h.$('[role=status]').textContent).toContain('HTML download still works'));
    expect(h.$('.tour-share-publish').disabled).toBe(true);h.ui.close();
  });
  it('clears displayed links on auth changes and never reuses that controller',async()=>{
    const h=setup();h.fetch.mockResolvedValue({ok:true,json:async()=>({tour:{id,revision:2,updated_at:'2026-10-28'}})});h.click('.tour-share-check');
    await vi.waitFor(()=>expect(h.$('.tour-share-link').hidden).toBe(false));h.auth();
    expect(h.$('.tour-share-link').hidden).toBe(true);expect(h.$('a').hasAttribute('href')).toBe(false);expect(h.$('.tour-share-check').disabled).toBe(true);h.ui.close();
  });
});
