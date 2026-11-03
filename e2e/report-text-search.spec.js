import { test, expect } from '@playwright/test';
import { createHash } from 'node:crypto';

test.skip(!process.env.E2E_ADMIN, 'Uses the configured client with isolated private workspace fixtures');
const uid='00000000-0000-4000-8000-000000000001', org='00000000-0000-4000-8000-000000000002', property='00000000-0000-4000-8000-000000000003';
async function fixture(page) {
  const user={id:uid,email:'synthetic@example.test',role:'authenticated',aud:'authenticated',user_metadata:{},app_metadata:{}};
  const b64=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
  const session={user,access_token:`${b64({alg:'HS256',typ:'JWT'})}.${b64({sub:uid,role:'authenticated',exp:Math.floor(Date.now()/1000)+86400})}.test`,refresh_token:'synthetic',expires_at:Math.floor(Date.now()/1000)+86400,expires_in:86400,token_type:'bearer'};
  const db={bytes:Buffer.from('Synthetic QA report\nQA-17 supplied identifier.\n<img src=x onerror=alert(1)> QA-17\n'),mode:'normal',reads:0,signs:0};
  const row=()=>({id:'file-qa',name:'report.md',kind:'document',version:1,path:`${org}/${property}/file-qa/v1/report.md`,bytes:db.bytes.length,sha256:createHash('sha256').update(db.bytes).digest('hex'),uploaded_at:'2026-11-03T00:00:00Z'});
  let stale=false;
  await page.route('**/api/track',r=>r.fulfill({status:204}));
  await page.route('https://example.supabase.co/**',async route=>{
    const path=new URL(route.request().url()).pathname;
    const json=body=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
    if(path.endsWith('/auth/v1/user'))return json(user);
    if(path.endsWith('/auth/v1/token'))return json(session);
    if(path.endsWith('/rpc/get_my_workspaces'))return json([{id:org,name:'Synthetic company',slug:'synthetic',role:'viewer'}]);
    if(path.endsWith('/rpc/list_property_files'))return json(stale?[{...row(),version:2}]:[row(),{...row(),id:'pdf',name:'report.pdf'}]);
    if(route.request().method()==='POST'&&path.includes('/storage/v1/object/sign/')){db.signs++;return json({signedURL:'/object/sign/property-files/qa?token=synthetic-secret'});}
    if(path.startsWith('/storage/v1/object/sign/property-files/qa')){
      db.reads++;if(db.mode==='network')return route.abort('failed');
      if(db.mode==='stale')stale=true;
      return route.fulfill({status:200,contentType:'text/plain',body:db.bytes});
    }
    if(path.endsWith('/properties'))return json([{id:property,org_id:org,name:'Synthetic property',slug:'synthetic',status:'active',commodities:[]}]);
    if(path.endsWith('/user_plans'))return json([]);
    return json([]);
  });
  await page.addInitScript(({session})=>{localStorage.setItem('sb-example-auth-token',JSON.stringify(session));localStorage.setItem(`em_migration_v2_${session.user.id}`,JSON.stringify({done:true,projects:{}}));},{session});
  const open=async()=>{
    await page.goto('/workspace/synthetic/p/synthetic?tab=data');
    await page.getByRole('button',{name:'Find in report text: report.md',exact:true}).click();
    await expect(page.getByRole('form',{name:'Search report contents'})).toBeVisible();
  };
  const find=async query=>{await page.getByRole('searchbox',{name:'Text to find'}).fill(query);await page.getByRole('button',{name:'Find in text',exact:true}).click();};
  return {db,open,find};
}
test('viewer searches actual private text with inert content and version/hash provenance',async({page},info)=>{
  const f=await fixture(page);await f.open();expect(f.db.reads).toBe(0);expect(f.db.signs).toBe(0);
  expect(await page.getByRole('button',{name:'Find in report text: report.pdf',exact:true}).count()).toBe(0);
  await f.find('QA-17');await expect(page.getByRole('status')).toHaveText('2 matching lines.');
  const panel=page.getByRole('region',{name:'Find in report text: report.md',exact:true});
  await expect(panel).toContainText('Line 2:');await expect(panel).toContainText('Line 3:');await expect(panel).toContainText('<img src=x onerror=alert(1)>');
  expect(await panel.locator('img,script').count()).toBe(0);await expect(panel).toContainText('SHA-256');
  await expect(page.getByText('View only.',{exact:false})).toBeVisible();
  if(process.env.E2E_SHOT_DIR)await panel.screenshot({path:`${process.env.E2E_SHOT_DIR}/report-search-${info.project.name}.png`});
  await f.find('report.md');await expect(page.getByRole('status')).toHaveText('No matching lines in this report.');
});
test('private read errors, malformed bytes and a concurrent version change fail safely',async({page})=>{
  const f=await fixture(page);await f.open();f.db.mode='network';await f.find('QA-17');
  await expect(page.getByRole('alert')).toHaveText('The report could not be searched. Reopen its current version and try again.');
  await expect(page.locator('body')).not.toContainText('synthetic-secret');
  f.db.mode='normal';f.db.bytes=Buffer.from([0xc3,0x28]);await f.open();await f.find('QA-17');
  await expect(page.getByRole('alert')).toContainText('UTF-8 text report');
  f.db.bytes=Buffer.from('QA-17 synthetic');f.db.mode='stale';await f.open();await f.find('QA-17');
  await expect(page.getByRole('alert')).toHaveText('This file or account changed. Reopen the current file to search it.');
  expect(await page.getByRole('status').count()).toBe(0);
});
