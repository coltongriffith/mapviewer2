import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test.skip(!process.env.E2E_ADMIN, 'Configured client; all account and storage requests are synthetic and intercepted');
test.setTimeout(180000);
test.use({ launchOptions: {
  args: ['--no-sandbox','--disable-dev-shm-usage','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'],
  ...(process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath:process.env.PLAYWRIGHT_CHROMIUM_PATH } : {}),
} });
const uid='00000000-0000-4000-8000-00000000fa01', a='00000000-0000-4000-8000-00000000fa02', b='00000000-0000-4000-8000-00000000fa03';
const user={id:uid,email:'work-safety@example.test',role:'authenticated',aud:'authenticated',created_at:'2026-11-03T00:00:00Z',user_metadata:{},app_metadata:{}};
const b64=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
const session={user,access_token:`${b64({alg:'HS256',typ:'JWT'})}.${b64({sub:uid,role:'authenticated',exp:Math.floor(Date.now()/1000)+86400})}.synthetic`,refresh_token:'synthetic-safety-refresh',token_type:'bearer',expires_in:86400,expires_at:Math.floor(Date.now()/1000)+86400};
// Synthetic scientific strings, including BOM, CRLF and a qualified assay, must remain exact.
const files=[{name:'original-A-collars.csv',text:'\uFEFFHoleID,X,Y,Z,Length\r\nQA-A,500000,5500000,100,100\r\nQA-B,500100,5500100,100,100'},
  {name:'original-A-assays.csv',text:'HoleID,From,To,Au_gpt\r\nQA-A,0,10,0.5300000000000001\r\nQA-B,0,10,<0.05'}];
async function fixture(page,context){
  const origin=new URL(process.env.E2E_BASE_URL||'http://127.0.0.1:4173').origin;
  const f={rows:new Map(),writes:[],shares:[],requests:[],logoRequests:0,blockedLogoRequests:0,blockLogo:false,delayB:null};
  await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
  await context.route('**/api/**',route=>route.fulfill({status:204}));
  await context.route('https://example.supabase.co/**',async route=>{
    const req=route.request(),url=new URL(req.url()),path=url.pathname,method=req.method();f.requests.push({path,method});
    const json=(data,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
    if(path.startsWith('/auth/v1/'))return json(path.endsWith('/user')?user:path.endsWith('/token')?session:{});
    if(path==='/rest/v1/three_d_projects'){
      if(method!=='GET'){f.writes.push({method,body:req.postDataJSON()});return json({message:'Unexpected synthetic write refused'},403);}
      const id=url.searchParams.get('id')?.replace(/^eq\./,'');
      if(id===b&&f.delayB){f.delayB.waiting=true;await f.delayB.promise;}
      const rows=[...f.rows.values()].filter(row=>!id||row.id===id);
      return json((req.headers().accept||'').includes('vnd.pgrst.object')?rows[0]||null:rows);
    }
    if(path.includes('create_3d_share')||path.includes('update_3d_share'))f.shares.push(path);
    if(path.startsWith('/rest/v1/rpc/'))return json([]);
    if(path.startsWith('/storage/')){f.writes.push({method,path});return json({message:'Unexpected synthetic storage access refused'},403);}
    return json([]);
  });
  await page.addInitScript(value=>localStorage.setItem('sb-example-auth-token',JSON.stringify(value)),session);
  page.on('dialog',dialog=>dialog.type()==='beforeunload'?dialog.accept():dialog.dismiss());
  await page.goto('/3d/');await page.waitForFunction(()=>window.EM3D?.getState().ready);
  const logo=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=12;c.height=8;const x=c.getContext('2d');x.fillStyle='#164e63';x.fillRect(0,0,12,8);x.fillStyle='#f59e0b';x.fillRect(2,2,4,4);return c.toDataURL('image/png');});
  await page.route('**/qa-old-logo.png',route=>{f.logoRequests++;if(f.blockLogo){f.blockedLogoRequests++;return route.abort();}return route.fulfill({status:200,contentType:'image/png',body:Buffer.from(logo.split(',')[1],'base64')});});
  await page.evaluate(async({sources,logoURL})=>{
    const E=window.EM3D;E.clearFiles();E.addFiles(sources);E.setBrand({company:'Synthetic QA',title:'Original A',primary:'#164e63',accent:'#b45309'});
    await E.setLogo(logoURL,{autoColor:false});E.setCamera({azimuth:40,plunge:25,zoom:90});await E.layersReady();
  },{sources:files,logoURL:`${origin}/qa-old-logo.png`});
  const initial=await page.evaluate(()=>window.EM3D.getProject());
  f.rows.set(a,{id:a,name:'Original saved A',settings:initial,file_paths:[],deleted_at:null,updated_at:'2026-11-03T00:00:00Z'});
  await page.evaluate(id=>window.EM3D.account.openProject(id),a);
  await page.evaluate(()=>window.EM3D.history());
  await page.evaluate(()=>window.EM3D.setStyle({surface:.72}));
  await expect.poll(()=>page.evaluate(async()=>(await window.EM3D.history()).entries.length)).toBeGreaterThanOrEqual(2);
  await page.evaluate(()=>window.EM3D.setStyle({traceWidth:3}));
  await expect.poll(()=>page.evaluate(async()=>(await window.EM3D.history()).entries.length)).toBeGreaterThanOrEqual(3);
  await expect(page.locator('#acct-note')).toHaveText('Unsaved changes');
  f.before=await snapshot(page);expect(f.before.project.files.map(x=>x.text)).toEqual(files.map(x=>x.text));
  const candidate=structuredClone(f.before.project);candidate.settings.title='Candidate B';candidate.settings.logo=null;
  candidate.settings.geophys={...candidate.settings.geophys,mode:'curtain',lines:'section'};
  candidate.camera={...candidate.camera,pan:[100,0,0]};
  candidate.files=files.map(x=>({...x,name:x.name.replace('original-A','candidate-B'),
    text:x.name.includes('collars')?'HoleID,X,Y,Z,Length\r\nQA-A,500000,5500000,100,10000\r\nQA-B,510000,5520000,5000,15000':x.text}));
  candidate.files.push({name:'candidate-B-ip.csv',text:'X,Y,Z,Chargeability\n500000,5500000,100,10\n500010,5500010,90,20',role:'geophys',cols:{east:0,north:1,elev:2,value:3},geophysNumericPolicy:'finite-decimal-v1'});
  f.rows.set(b,{id:b,name:'Candidate B',settings:candidate,file_paths:[],deleted_at:null,updated_at:'2026-11-03T00:00:00Z'});
  return f;
}
async function snapshot(page){return page.evaluate(async()=>{
  const E=window.EM3D;await document.fonts.ready;await E.layersReady();await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);
  return{project:E.getProject(),target:await E.account.currentProject(),history:await E.history(),png:await E.exportPNG({view:'3d',width:400,background:'transparent'})};
});}
async function startOpenB(page){await page.evaluate(id=>{window.__openingResult=null;window.EM3D.account.openProject(id).then(()=>{window.__openingResult={ok:true};},e=>{window.__openingResult={ok:false,code:e.code,message:e.message};});},b);}
async function result(page){await expect.poll(()=>page.evaluate(()=>window.__openingResult)).not.toBeNull();return page.evaluate(()=>window.__openingResult);}
async function failLateChunk(page,f,{failOldPreview=false}={}){
  f.blockLogo=true;f.chunkRequests=0;f.committingFiles=[];
  if(failOldPreview)await page.evaluate(()=>{const draw=CanvasRenderingContext2D.prototype.drawImage;CanvasRenderingContext2D.prototype.drawImage=function(image,...args){if(window.__failOriginalLogo&&image instanceof HTMLImageElement&&new URL(image.src,location.href).pathname==='/qa-old-logo.png')throw new Error('Synthetic original preview renderer failure');return draw.call(this,image,...args);};});
  // This import is requested only after the native loader replaced files/settings.
  // The final build must retain this observed chunk pattern; zero hits fails proof.
  await page.route(/\/assets\/geophys-[^/]+\.js(?:\?|$)/,async route=>{
    f.chunkRequests++;f.committingFiles=await page.evaluate(fail=>{window.__failOriginalLogo=fail;return window.EM3D.getState().files.map(x=>x.name);},failOldPreview);await route.abort();
  });
  await startOpenB(page);const opened=await result(page);
  expect(f.chunkRequests).toBeGreaterThan(0);expect(f.committingFiles).toContain('candidate-B-ip.csv');expect(opened.ok).toBe(false);
  return opened;
}
test('a delayed saved B cannot replace edited A or clear A dirty target',async({page,context})=>{
  const f=await fixture(page,context);let release;f.delayB={waiting:false,promise:new Promise(resolve=>{release=resolve;})};
  await startOpenB(page);await expect.poll(()=>f.delayB.waiting).toBe(true);
  await page.evaluate(()=>window.EM3D.setBrand({subtitle:'Edit made while B was reading'}));
  await expect(page.locator('#acct-note')).toHaveText('Unsaved changes');
  // History records an edit after a 500 ms debounce: wait for it, or a fast run
  // snapshots A before its own edit is in the history and then sees it appear.
  await expect.poll(()=>page.evaluate(async()=>(await window.EM3D.history()).entries.at(-1)?.label)).toBe('Subtitle');
  const edited=await snapshot(page);
  release();const opened=await result(page);expect(opened.ok).toBe(false);expect(opened.message).toMatch(/changed|current figure/i);
  expect(await snapshot(page)).toEqual(edited);expect(edited.target.id).toBe(a);expect(f.writes).toEqual([]);
});
test('a late native chunk failure restores exact A source, decoded logo, history and PNG without refetch',async({page,context})=>{
  const f=await fixture(page,context);const opened=await failLateChunk(page,f);
  expect(opened.message).toContain('Your previous figure is unchanged.');
  expect(await snapshot(page)).toEqual(f.before);expect(f.blockedLogoRequests).toBe(0);expect(f.writes).toEqual([]);
  await expect(page.locator('#acct-note')).toHaveText('Unsaved changes');await expect(page.getByRole('button',{name:'Download recovery data',exact:true})).toHaveCount(0);
  await page.locator('#stage').screenshot({path:test.info().outputPath('native-A-restored-exact.png')});
});
test('a failed old preview remains explicitly paused with exact downloadable original A data',async({page,context})=>{
  const f=await fixture(page,context);const opened=await failLateChunk(page,f,{failOldPreview:true});
  expect(opened.message).toContain('could not be fully restored');expect(opened.message).toContain('Saving is paused');
  const kept=await page.evaluate(async()=>({project:window.EM3D.getProject(),recovery:window.EM3D.getRecoveryProject(),pending:window.EM3D.isProjectRecoveryPending(),target:await window.EM3D.account.currentProject()}));
  expect(kept.project).toEqual(f.before.project);expect(kept.recovery).toEqual(f.before.project);expect(kept.pending).toBe(true);expect(kept.target).toEqual(f.before.target);
  const refusals=await page.evaluate(async()=>{
    const error=async(fn)=>{try{await fn();return null;}catch(e){return e.message;}};
    return{save:await error(()=>window.EM3D.account.saveProject('Unsafe save')),share:await error(()=>window.EM3D.share.create())};
  });
  expect(refusals.save).toMatch(/restored|recovery|paused/i);expect(refusals.share).toMatch(/restored|recovery|paused/i);
  const downloading=page.waitForEvent('download');await page.getByRole('button',{name:'Download recovery data',exact:true}).click();
  const download=await downloading;expect(download.suggestedFilename()).toBe('original-3d-recovery.json');
  const raw=await readFile(await download.path(),'utf8');expect(raw).toBe(JSON.stringify(f.before.project));expect(JSON.parse(raw)).toEqual(f.before.project);
  expect(f.writes).toEqual([]);expect(f.shares).toEqual([]);expect(f.blockedLogoRequests).toBe(0);
  await page.locator('#acct-note').screenshot({path:test.info().outputPath('native-preview-recovery-paused.png')});
});
