// @vitest-environment node
import {describe,it,expect,vi} from 'vitest';
import {createTourHandler} from '../api/_lib/tour';
import {renderHostedTour} from '../api/_lib/tour-render';
import {buildTourPackage} from '../src/features/tour3d/build';
import {MAX_TOUR_BYTES} from '../src/features/tour3d/package';

const project='11111111-1111-4111-8111-111111111111',id='a'.repeat(32);
const info={id,revision:2,updated_at:'2026-10-28T00:00:00Z'};
function harness({data=null,rpcError=null,authError=null,render=renderHostedTour}={}){
  const rpc=vi.fn(async()=>({data,error:rpcError}));
  const getUser=vi.fn(async()=>({data:{user:authError?null:{id:'verified-user'}},error:authError}));
  const clientForToken=vi.fn(()=>({rpc,auth:{getUser}}));
  const handler=createTourHandler({clientForToken,render});
  const call=async(overrides={})=>{
    const res={headers:{},code:null,body:null,setHeader(k,v){this.headers[k]=v;},status(n){this.code=n;return this;},json(b){this.body=b;return this;},send(b){this.body=b;return this;},end(){return this;}};
    await handler({method:'GET',query:{project},headers:{authorization:'Bearer actual-user-token'},...overrides},res);
    expect(res.headers['Cache-Control']).toBe('no-store');return res;
  };
  return {call,rpc,getUser,clientForToken};
}
const packageFixture=()=>buildTourPackage({title:'Safe tour',crs:'EPSG:4326',claims:{type:'FeatureCollection',features:[]},
  collars:[{holeId:'H1',x:-129.005,y:55.005,z:1000,azimuth:0,dip:-60,depth:100}],
  assays:[{holeId:'H1',from:0,to:10,values:{Cu:.5}}],grade:{field:'Cu',bins:[.1,.2,.5,1]}});
const post=(body)=>({method:'POST',query:{},body});

describe('hosted tour HTTP authorization and package boundary',()=>{
  it('renders a real validated public package using only the anonymous RPC',async()=>{
    const h=harness({data:packageFixture()}),r=await h.call({query:{id},headers:{}});
    expect(r.code).toBe(200);expect(r.body).toContain('Safe tour');
    expect(r.headers['Content-Security-Policy']).toContain('sandbox allow-scripts;');
    expect(h.clientForToken).toHaveBeenCalledWith();expect(h.getUser).not.toHaveBeenCalled();
    expect(h.rpc).toHaveBeenCalledWith('get_3d_tour',{p_id:id});
  });
  it('does not render revoked or invalid stored packages',async()=>{
    expect((await harness().call({query:{id}})).code).toBe(404);
    const r=await harness({data:{html:'<script>attack()</script>'}}).call({query:{id}});
    expect(r.code).toBe(503);expect(JSON.stringify(r.body)).not.toContain('attack');
  });
  it.each([{id:'bad'},{id:[id]},{id,project}])('rejects malformed public queries before touching the database: %j',async(query)=>{
    const h=harness();expect((await h.call({query})).code).toBe(400);expect(h.rpc).not.toHaveBeenCalled();
  });
  it('requires and verifies the actual bearer session for management',async()=>{
    const h=harness();expect((await h.call({headers:{}})).code).toBe(401);expect(h.rpc).not.toHaveBeenCalled();
    const invalid=harness({authError:{message:'secret token error'}});
    const r=await invalid.call();expect(r.code).toBe(401);expect(invalid.rpc).not.toHaveBeenCalled();
    expect(invalid.getUser).toHaveBeenCalledWith('actual-user-token');
    expect(invalid.clientForToken).toHaveBeenCalledWith('actual-user-token');
    expect(JSON.stringify(r.body)).not.toContain('secret');
  });
  it('retrieves current-editor metadata through the user-scoped RPC',async()=>{
    const h=harness({data:info}),r=await h.call();expect(r.code).toBe(200);expect(r.body).toEqual({tour:info});
    expect(h.rpc).toHaveBeenCalledWith('get_3d_tour_info',{p_project:project});
    expect(r.headers.Vary).toBe('Authorization');
    expect((await harness().call()).body).toEqual({tour:null});
  });
  it.each([{...info,id:[id]},{...info,revision:0},{...info,updated_at:123}])('rejects malformed metadata: %j',async(data)=>{
    expect((await harness({data}).call()).code).toBe(503);
  });
  it('validates and bounds the real package before persisting with the expected revision',async()=>{
    const pkg=packageFixture(),h=harness({data:id}),r=await h.call(post({action:'publish',project,package:pkg,revision:2,owner:'ignored'}));
    expect(r.code).toBe(200);expect(r.body).toEqual({id,revision:3});
    expect(h.rpc).toHaveBeenCalledWith('publish_3d_tour',{p_project:project,p_package:pkg,p_expected_revision:2});
    const bad=harness({data:id});expect((await bad.call(post({action:'publish',project,package:{html:'untrusted'},revision:null}))).code).toBe(400);
    expect(bad.rpc).not.toHaveBeenCalled();
    const oversized=harness({render:()=>{throw new Error('Hosted HTML is too large');}});
    expect((await oversized.call(post({action:'publish',project,package:pkg,revision:null}))).code).toBe(413);
    expect(oversized.rpc).not.toHaveBeenCalled();
  });
  it.each([
    {action:'publish',project:[project],revision:null},
    {action:'publish',project,revision:0},
    {action:'publish',project},
    {action:'arbitrary_rpc',project},
    'not json',
  ])('rejects malformed mutations without an RPC: %j',async(body)=>{
    const h=harness();expect((await h.call(post(body))).code).toBe(400);expect(h.rpc).not.toHaveBeenCalled();
  });
  it('bounds raw request bytes before parsing',async()=>{
    const h=harness(),r=await h.call(post(' '.repeat(MAX_TOUR_BYTES+2049)));
    expect(r.code).toBe(413);expect(h.rpc).not.toHaveBeenCalled();
  });
  it('revokes through current-user permissions and validates the result',async()=>{
    const h=harness({data:true}),r=await h.call(post({action:'revoke',project}));
    expect(r.body).toEqual({revoked:true});expect(h.rpc).toHaveBeenCalledWith('revoke_3d_tour',{p_project:project});
    expect((await harness({data:'true'}).call(post({action:'revoke',project}))).code).toBe(503);
  });
  it.each([
    ['PGRST202','missing function with internal SQL',503],['42501','secret permission detail',403],
    ['P0002','hidden project',404],['P0001','TOUR_STALE',409],['P0001','TOUR_RATE_LIMIT',429],
    ['unknown','private database failure',503],
  ])('maps %s/%s safely to %s',async(code,message,status)=>{
    const h=harness({rpcError:{code,message}}),r=await h.call();
    expect(r.code).toBe(status);expect(JSON.stringify(r.body)).not.toContain(message);
    if(status===429)expect(r.headers['Retry-After']).toBe('10');
  });
  it('handles network failures without exposing credentials or internals',async()=>{
    const h=harness();h.getUser.mockRejectedValue(new Error('actual-user-token private host'));
    const r=await h.call();expect(r.code).toBe(503);expect(JSON.stringify(r.body)).not.toMatch(/actual-user-token|private host/);
  });
  it('gates unsupported methods without creating a database client',async()=>{
    const h=harness();expect((await h.call({method:'DELETE'})).code).toBe(405);
    expect((await h.call({method:'OPTIONS'})).code).toBe(204);expect(h.clientForToken).not.toHaveBeenCalled();
  });
});
