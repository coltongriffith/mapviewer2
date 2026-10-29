import { test, expect } from '@playwright/test';
test.skip(!process.env.E2E_ADMIN, 'Requires the configured client build with isolated auth fixtures');
test.use({launchOptions:{args:['--no-sandbox','--disable-dev-shm-usage','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist']}});
test.beforeEach(({page})=>page.on('dialog',d=>d.type()==='beforeunload'?d.accept():d.dismiss()));
const uid='00000000-0000-4000-8000-0000000003d1';
const user={id:uid,email:'brand-qa@example.test',role:'authenticated',aud:'authenticated',created_at:'2026-10-01T00:00:00Z',app_metadata:{},user_metadata:{}};
const encode=o=>Buffer.from(JSON.stringify(o)).toString('base64url');
const access=`${encode({alg:'HS256',typ:'JWT'})}.${encode({sub:uid,role:'authenticated',exp:Math.floor(Date.now()/1000)+86400})}.synthetic`;
async function setup(page,{signedIn=true,missing=false}={}){
  const state={queries:[],writes:[],owner:user,missing,hold:null,kit:{id:'kit-own',user_id:uid,name:'My <literal> kit',created_at:'2026-10-01',updated_at:'2026-10-29',config:{titleBgColor:'#123456',accentColor:'#ab6512',fonts:{label:'Source Sans 3'},template:'must-not-apply',displayCutoff:99,bins:[99]}}};
  await page.addInitScript(({signedIn,user,access})=>{
    if(signedIn)localStorage.setItem('sb-example-auth-token',JSON.stringify({user,access_token:access,refresh_token:'synthetic',expires_in:86400,expires_at:Math.floor(Date.now()/1000)+86400,token_type:'bearer'}));
  },{signedIn,user,access});
  await page.route('https://example.supabase.co/**',async route=>{
    const req=route.request(),url=new URL(req.url()),path=url.pathname;
    const json=(data,status=200)=>route.fulfill({status,json:data});
    if(path==='/auth/v1/user')return state.owner?json(state.owner):json({message:'signed out'},401);
    if(path==='/auth/v1/logout'){state.owner=null;return json({});}
    if(path==='/rest/v1/templates'){
      state.queries.push(url.searchParams.get('user_id'));if(req.method()!=='GET'){state.writes.push(req.method());return json({},403);}
      if(state.hold)await state.hold;
      if(state.missing)return json({code:'PGRST205',message:'schema unavailable'},404);
      if(url.searchParams.get('user_id')!==`eq.${uid}`)return json({},403);
      return json([state.kit,{...state.kit,id:'foreign',user_id:'other-owner',name:'Not mine'}]);
    }
    return json([]);
  });
  await page.goto('/3d');await page.waitForFunction(()=>window.EM3D?.getState().ready);
  await page.evaluate(()=>window.EM3D.showStep('brand'));return state;
}
for(const [name,width,height] of [['desktop',1280,900],['mobile',390,844]]){
  test(`explicit owned brand-kit apply preserves data and saved exports: ${name}`,async({page})=>{
    test.setTimeout(120000);await page.setViewportSize({width,height});const state=await setup(page);
    const logo=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=c.height=8;const g=c.getContext('2d');g.fillStyle='#123456';g.fillRect(0,0,8,8);return c.toDataURL('image/png');});state.kit.config.logo=logo;
    const before=await page.evaluate(()=>window.EM3D.getProject());
    await page.getByRole('button',{name:'Load my brand kits',exact:true}).click();
    await expect(page.getByRole('combobox',{name:'My brand kits',exact:true}).locator('option')).toHaveCount(1);
    await expect(page.getByRole('combobox',{name:'My brand kits',exact:true})).toContainText('My <literal> kit');
    expect(await page.evaluate(()=>window.EM3D.getProject())).toEqual(before);
    state.kit.config.titleBgColor='#246824';state.kit.updated_at='2026-10-30';
    await page.getByRole('button',{name:'Apply brand kit',exact:true}).click();
    await expect(page.locator('#brand-kits-note')).toContainText('Applied');
    const applied=await page.evaluate(()=>window.EM3D.getProject());
    expect(applied.settings.primary).toBe('#246824');expect(applied.settings.accent).toBe('#ab6512');
    expect(applied.settings.logo.$image).toBe(logo);expect(applied.settings.brandStyle).toMatchObject({brandKitId:'kit-own',brandRevision:'2026-10-30'});
    expect(applied.files).toEqual(before.files);
    for(const key of ['bins','valueCol','coCut','coIncl','vex','camera','format','crs','company','title','section','shell'])expect(applied.settings[key],key).toEqual(before.settings[key]);
    const png=await page.evaluate(()=>window.EM3D.exportPNG({view:'3d',width:500}));
    state.kit.config.titleBgColor='#ff0000';
    await page.evaluate(async p=>{await window.EM3D.loadProject(p);await window.EM3D.layersReady();},applied);
    expect(await page.evaluate(()=>window.EM3D.exportPNG({view:'3d',width:500}))).toBe(png);
    expect(state.queries).toEqual([`eq.${uid}`,`eq.${uid}`]);expect(state.writes).toEqual([]);
    await page.evaluate(()=>window.EM3D.account.signOut());
    await expect(page.locator('#brand-kits-choices')).toBeHidden();await expect(page.locator('#brand-kits-select option')).toHaveCount(0);
    expect(await page.evaluate(()=>window.EM3D.getProject())).toEqual(applied);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  });
}
test('anonymous startup and signed-out loads leave the current figure untouched',async({page})=>{
  test.setTimeout(120000);const state=await setup(page,{signedIn:false});
  expect(await page.evaluate(()=>performance.getEntriesByType('resource').some(r=>r.name.includes('brand-kits-')))).toBe(false);
  const before=await page.evaluate(()=>window.EM3D.getProject());
  await page.getByRole('button',{name:'Load my brand kits',exact:true}).click();await expect(page.locator('#brand-kits-note')).toContainText('Sign in');
  expect(state.queries).toHaveLength(0);expect(await page.evaluate(()=>window.EM3D.getProject())).toEqual(before);
  await page.close();
});
test('missing optional templates schema and a sign-out during load fail safely',async({page})=>{
  test.setTimeout(120000);const state=await setup(page,{missing:true});const before=await page.evaluate(()=>window.EM3D.getProject());
  await page.getByRole('button',{name:'Load my brand kits',exact:true}).click();await expect(page.locator('#brand-kits-note')).toContainText('not available');
  expect(await page.evaluate(()=>window.EM3D.getProject())).toEqual(before);
  state.missing=false;let release;state.hold=new Promise(r=>{release=r;});
  await page.getByRole('button',{name:'Load my brand kits',exact:true}).click();await expect.poll(()=>state.queries.length).toBe(2);
  await page.evaluate(()=>window.EM3D.account.signOut());release();
  await expect(page.locator('#brand-kits-choices')).toBeHidden();await expect(page.locator('#brand-kits-select option')).toHaveCount(0);
  expect(await page.evaluate(()=>window.EM3D.getProject())).toEqual(before);expect(state.writes).toEqual([]);
});


