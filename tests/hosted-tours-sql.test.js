// @vitest-environment node
import {beforeAll,afterAll,it,expect} from 'vitest';
import {createWorkspaceDb,readMigration} from './fixtures/workspace-db';
const A='00000000-0000-4000-8000-0000000000a1',E='00000000-0000-4000-8000-0000000000e1',X='00000000-0000-4000-8000-0000000000f1';
let db,val,su,as,org;
const pkg={v:1,holes:[],runs:[],claims:[],fpoly:[],collars:[],terrain:{},config:{title:'v1'},meta:{}};
const publish=(u,p,data=pkg,revision=null)=>val(u,'select public.publish_3d_tour($1,$2::jsonb,$3)',[p,JSON.stringify(data),revision]);
const read=id=>val(null,'select public.get_3d_tour($1)',[id]);
const project=async(company=false)=>(await su('insert into public.three_d_projects(user_id,org_id,name,settings) values($1,$2,$3,$4) returning id',[A,company?org:null,'Test','{}']))[0].id;
const age=id=>su("update public.three_d_tours set updated_at=now()-interval '1 minute' where id=$1",[id]);
beforeAll(async()=>{
  const migration=readMigration('20261104120000_hosted_3d_tours.sql');
  ({db,val,su,as}=await createWorkspaceDb({emails:{[A]:'owner@test.test',[E]:'editor@test.test',[X]:'other@test.test'},migrations:[readMigration('20261023100000_workspaces_properties.sql'),migration,migration]}));
  org=(await val(A,"select public.create_organization('Test Company')")).id;
  await su("insert into public.organization_members(org_id,user_id,role) values($1,$2,'editor')",[org,E]);
},120000);
afterAll(()=>db?.close());
it('publishes only saved figures the caller currently owns or edits, with no direct table grants',async()=>{
  const p=await project();
  await expect(publish(null,p)).rejects.toThrow(/permission denied|authenticated/);
  await expect(publish(X,p)).rejects.toThrow('TOUR_NOT_FOUND');
  const id=await publish(A,p);expect(id).toMatch(/^[a-f0-9]{32}$/);expect(await read(id)).toEqual(pkg);
  await expect(as(A,'select * from public.three_d_tours')).rejects.toThrow(/permission denied/);
  await expect(as(null,'select * from public.three_d_tours')).rejects.toThrow(/permission denied/);
  await expect(val(X,'select public.revoke_3d_tour($1)',[p])).rejects.toThrow('TOUR_NOT_FOUND');
  await expect(val(null,'select public.get_3d_tour_info($1)',[p])).rejects.toThrow(/permission denied/);
  expect(await val(X,'select public.get_3d_tour_info($1)',[p])).toBeNull();
  expect(await read('not-a-real-link')).toBeNull();
});
it('atomically replaces one link and rejects stale writers and rapid republishes',async()=>{
  const p=await project(),id=await publish(A,p);
  await expect(publish(A,p,pkg,1)).rejects.toThrow('TOUR_RATE_LIMIT');await age(id);
  await expect(publish(A,p,pkg,null)).rejects.toThrow('TOUR_STALE');
  const next={...pkg,config:{title:'v2'}};expect(await publish(A,p,next,1)).toBe(id);
  expect(await read(id)).toEqual(next);await age(id);
  await expect(publish(A,p,pkg,1)).rejects.toThrow('TOUR_STALE');
  expect((await val(A,'select public.get_3d_tour_info($1)',[p])).revision).toBe(2);
});
it('removes a departed publisher rights while current company editors can revoke',async()=>{
  const p=await project(true),id=await publish(E,p);
  await su('delete from public.organization_members where org_id=$1 and user_id=$2',[org,E]);
  await expect(publish(E,p,pkg,1)).rejects.toThrow('TOUR_NOT_FOUND');
  await expect(val(E,'select public.revoke_3d_tour($1)',[p])).rejects.toThrow('TOUR_NOT_FOUND');
  expect(await val(E,'select public.get_3d_tour_info($1)',[p])).toBeNull();
  expect(await val(A,'select public.revoke_3d_tour($1)',[p])).toBe(true);expect(await read(id)).toBeNull();
  expect((await su('select package from public.three_d_tours where id=$1',[id]))[0].package).toBeNull();
  expect(await publish(A,p)).not.toBe(id);
});
it('does not publish for viewers or accept malformed payloads',async()=>{
  await su("insert into public.organization_members(org_id,user_id,role) values($1,$2,'viewer')",[org,E]);
  const p=await project(true);await expect(publish(E,p)).rejects.toThrow('TOUR_NOT_FOUND');
  await expect(publish(A,p,{v:1,html:'<script>bad()</script>'})).rejects.toThrow('TOUR_INVALID');
  await expect(publish(A,p,{...pkg,v:2})).rejects.toThrow('TOUR_INVALID');
  await expect(val(A,"select public.publish_3d_tour($1,jsonb_set($2::jsonb,'{config,title}',to_jsonb(repeat('x',8388609))),null)",[p,JSON.stringify(pkg)])).rejects.toThrow('TOUR_TOO_LARGE');
});
it('withdraws data on soft deletion, ownership change and permanent deletion',async()=>{
  const p=await project(),id=await publish(A,p);
  await su('update public.three_d_projects set deleted_at=now() where id=$1',[p]);expect(await read(id)).toBeNull();
  await su('update public.three_d_projects set deleted_at=null where id=$1',[p]);expect(await read(id)).toBeNull();
  const second=await publish(A,p);await su('update public.three_d_projects set user_id=$2 where id=$1',[p,X]);expect(await read(second)).toBeNull();
  const third=await publish(X,p);await su('delete from public.three_d_projects where id=$1',[p]);expect(await read(third)).toBeNull();
  expect((await su('select count(*)::int n from public.three_d_tours where project_id=$1',[p]))[0].n).toBe(0);
});
