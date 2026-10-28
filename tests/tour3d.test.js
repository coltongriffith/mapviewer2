import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildTourPackage } from '../src/features/tour3d/build';
import { studioInput, tourSetup } from '../src/features/tour3d/studioInput';
import { exportTourHtml } from '../src/features/tour3d/export';
import { tourScriptHashes } from '../scripts/tour-csp.mjs';
import proj4 from 'proj4';
import { parseCRS } from '../src/three-d/terrain';
import { modelSnapshot } from '../src/features/tour3d/modelSnapshot';
import { packageFromModel } from '../src/features/tour3d/packageFromModel';

const claims = {type:'FeatureCollection',features:[{type:'Feature',properties:{},geometry:{type:'Polygon',coordinates:[
  [[-129.01,55],[-129,55],[-129,55.01],[-129.01,55.01],[-129.01,55]],
]}}]};
const input = () => ({title:'Test project',crs:'EPSG:4326',claims:structuredClone(claims),collars:[
  {holeId:'H1',x:-129.005,y:55.005,z:1000,azimuth:0,dip:-90,depth:100},
],assays:[{holeId:'H1',from:0,to:10,values:{Cu_pct:0.5}},{holeId:'H1',from:10.2,to:20,values:{Cu_pct:0.6}}],
grade:{field:'Cu_pct',unit:'%',bins:[0.1,0.2,0.5,1]}});
const snapshot = () => ({ state:{title:'Saved project',crs:'EPSG:4326',valueCol:'Cu_pct',bins:[0.1,0.2,0.5,1],
  overlays:[{role:'claims',crs:'EPSG:4326',data:{features:[{g:'A',p:{number:'1'},c:claims.features[0].geometry.coordinates}]}}]},
  project:{posDown:false,latlon:true},
  files:[
    {role:'collar',header:['Hole','Lon','Lat','Elev','Az','Dip','Depth'],cols:{hole:0,lon:1,lat:2,elev:3,az:4,dip:5,depth:6},rows:[['H1','-129.005','55.005','1000','0','0','100']]},
    {role:'assay',header:['Hole','From','To','Cu_pct','Cu_ppm'],cols:{hole:0,from:1,to:2},grades:[{name:'Cu_pct',i:3},{name:'Cu_ppm',i:4}],rows:[['H1','0','10','<0.01','5000'],['H1','10','20','0.5','5000']]},
  ]});

describe('3D Tour project adapter',()=>{
  it('uses existing mappings, keeps units distinct and excludes censored values',()=>{
    const source=snapshot(), before=JSON.stringify(source), result=studioInput(source);
    expect(result.fields).toEqual(['Cu_pct','Cu_ppm']);
    expect(result.assays[0].values).toEqual({Cu_pct:null,Cu_ppm:5000});
    expect(result.collars[0].dip).toBe(0);
    expect(result.warnings[0]).toContain('censored');
    expect(JSON.stringify(source)).toBe(before);
  });
  it('blocks missing CRS and preserves missing positions instead of inventing coordinates',()=>{
    const s=snapshot();s.state.crs=null;expect(()=>studioInput(s)).toThrow('coordinate system');
    s.state.crs='EPSG:4326';s.state.overlays=[];expect(studioInput(s).claims.features).toEqual([]);
    s.state.overlays=snapshot().state.overlays;s.files[0].rows[0][1]='';
    expect(Number.isNaN(studioInput(s).collars[0].x)).toBe(true);
  });
  it('merges exact matching intervals across fields but rejects conflicting values',()=>{
    const s=snapshot();s.files.push({...s.files[1],grades:[{name:'Au_gpt',i:4}]});
    expect(studioInput(s).assays).toHaveLength(2);
    expect(studioInput(s).assays[0].values.Au_gpt).toBe(5000);
    s.files.push({...s.files[1],rows:[['H1','10','20','0.9','9000']]});
    expect(()=>studioInput(s)).toThrow('conflicting assays');
  });
});
describe('3D Tour builder',()=>{
  it('invalidates equivalent previews after recipe changes even while a raw grade is selected',()=>{
    const state={valueCol:'Cu_pct',eq:{basePrice:4,baseRecovery:90,baseUnit:'%'},shell:{enabled:false}},equivalentInfo={name:'CuEq_calc',note:'CuEq formula and assumptions'};
    const old=modelSnapshot({project:{},state,equivalentInfo});
    expect(old.appearance.equivalent).toEqual({field:'CuEq_calc',unit:'%',note:equivalentInfo.note});
    state.eq.basePrice=4.001;
    expect(modelSnapshot({project:{},state,equivalentInfo}).modelKey).not.toBe(old.modelKey);
    const second=modelSnapshot({project:{},state,equivalentInfo});state.eq.baseRecovery=89.999;
    expect(modelSnapshot({project:{},state,equivalentInfo}).modelKey).not.toBe(second.modelKey);
  });
  it('keeps equivalent units and assumptions when selected inside a raw-grade tour',()=>{
    const s=snapshot(),note='CuEq = Cu + 0.2 Au. Prices Cu $4; Au $2000. Recoveries 90%.';
    s.project.cols=['CuEq_calc'];s.project.holes=[{id:'H1',ints:[{from:0,to:10,vals:{CuEq_calc:.77}}]}];
    s.appearance={equivalent:{field:'CuEq_calc',unit:'%',note}};
    expect(tourSetup(s).units.CuEq_calc).toBe('%');
    const result=packageFromModel(s,{grade:{field:'CuEq_calc',unit:'%',bins:[.1,.2,.5,1]}});
    expect(result.meta.warnings).toContain(note);
    expect(packageFromModel(s).meta.warnings).not.toContain(note);
  });
  it('matches all five maker grade colours and its display cutoff without changing measured values',()=>{
    const x=input();x.grade.colors=['#a3abaf','#e2dc4f','#ff9a1f','#ef3b2c','#e93ad1'];x.grade.includeBelow=true;
    x.assays[0].values.Cu_pct=.05;x.assays[1].values.Cu_pct=.5;
    const p=buildTourPackage(x);expect(p.config.bins.map(b=>b[1])).toEqual(x.grade.colors);
    expect(p.runs.map(r=>r[2])).toEqual([0,3]);
    x.grade.displayCutoff=.1;expect(buildTourPackage(x).runs.map(r=>r[2])).toEqual([3]);
    expect(x.assays[0].values.Cu_pct).toBe(.05);
  });
  it('uses existing model envelopes with their colours/opacity and no new interpolation',()=>{
    const source={project:{meshF:[{name:'Existing OBJ',mesh:{v:[[500000,6094791,950],[500010,6094791,950],[500000,6094801,900]],f:[0,1,2]}}]},state:{meshes:{'Existing OBJ':{show:true,color:'#123456',opacity:.35}},shell:{enabled:false}},binColors:[]};
    const snap=modelSnapshot(source),x=input();x.crs='EPSG:26909';x.collars=[{...x.collars[0],x:500000,y:6094791}];
    const s=snapshot();s.project={...source.project};s.state={...s.state,crs:x.crs};s.files[0].cols={...s.files[0].cols,east:1,north:2};s.files[0].rows[0][1]='500000';s.files[0].rows[0][2]='6094791';
    const adapted=studioInput({...s,...snap});x.envelopes=adapted.envelopes;x.includeEnvelopes=true;
    const p=buildTourPackage(x),e=p.envelopes[0];expect(e.color).toBe('#123456');expect(e.opacity).toBe(.35);expect(e.indices).toEqual([0,1,2]);
    expect(e.vertices[3]-e.vertices[0]).toBe(10);expect(e.vertices[8]-e.vertices[2]).toBe(-10);
    x.includeEnvelopes=false;expect(buildTourPackage(x).envelopes).toEqual([]);
    x.includeEnvelopes=true;x.envelopes[0].indices=[99,1,2];expect(()=>buildTourPackage(x)).toThrow('invalid geometry');
  });
  it('reuses computed grade values and ready nested envelope surfaces from the model',()=>{
    const s=snapshot();s.project.cols=['CuEq'];s.project.holes=[{id:'H1',ints:[{from:0,to:10,vals:{CuEq:.77}}]}];s.state.valueCol='CuEq';s.state.valueLabel='CuEq %';
    expect(studioInput(s).assays.find(a=>a.from===0).values.CuEq).toBe(.77);expect(studioInput(s).grade.unit).toBe('%');
    const m=modelSnapshot({project:{},state:{valueCol:'CuEq',shell:{enabled:true,opacity:.6}},shell:{origin:[1,2,3],parts:[{positions:[0,0,0,1,0,0,0,1,0],indices:[0,1,2]}]},shells:[{cutoff:.5,color:'#abcdef'}],opacities:[.42]});
    expect(m.envelopeSources[0]).toMatchObject({origin:[1,2,3],opacity:.42,color:'#abcdef',kind:'estimated'});
  });
  it('keeps form choices available before CRS setup and builds without inventing claim boundaries',()=>{
    const s=snapshot();s.state.crs=null;s.state.overlays=[];
    expect(tourSetup(s).fields).toEqual(['Cu_pct','Cu_ppm']);
    expect(tourSetup(s).title).toBe('Saved project');
    expect(()=>studioInput(s)).toThrow('coordinate system');
    const x=input();x.claims.features=[];
    const p=buildTourPackage(x);
    expect(p.claims).toEqual([]);expect(p.holes).toHaveLength(1);
    expect(p.terrain.utm.every(Number.isFinite)).toBe(true);
  });
  it.each(['EPSG:26709','EPSG:28355','+proj=utm +zone=9 +datum=WGS84 +units=m +no_defs'])('uses the maker definition for %s', crs=>{
    const x=input();x.crs=crs;
    const def=parseCRS(crs,{}).def;
    const ll=proj4(def,'EPSG:4326',[500000,6094791]);
    x.collars=[{...x.collars[0],x:500000,y:6094791}];
    x.claims.features[0].geometry.coordinates=[[[ll[0]-.001,ll[1]-.001],[ll[0]+.001,ll[1]-.001],[ll[0]+.001,ll[1]+.001],[ll[0]-.001,ll[1]-.001]]];
    const pkg=buildTourPackage(x);
    expect(pkg.meta.crs).toBe(crs);
    expect(pkg.holes).toHaveLength(1);
    expect(pkg.holes[0].p.every(Number.isFinite)).toBe(true);
    expect(proj4(crs,'EPSG:4326',[500000,6094791])).toEqual(ll);
  });
  it('accepts missing collar orientation only with a complete validated figure path',()=>{
    const x=input();x.collars[0].azimuth=NaN;x.collars[0].dip=NaN;
    expect(()=>buildTourPackage(x)).toThrow('azimuth and dip');
    x.paths={H1:[{depth:0,x:-129.005,y:55.005,z:1000},{depth:100,x:-129.004,y:55.005,z:920}]};
    expect(buildTourPackage(x).holes).toHaveLength(1);
    x.paths.H1[1].depth=99;expect(()=>buildTourPackage(x)).toThrow('path');
    x.paths.H1[1].depth=100;x.paths.H1[1].z=NaN;expect(()=>buildTourPackage(x)).toThrow('path');
  });
  it('handles geographic collars in the correct UTM zone, equal scale and explicit straight-hole warnings',()=>{
    const pkg=buildTourPackage(input());
    expect(pkg.meta.crs).toBe('EPSG:32609');
    expect(pkg.holes).toHaveLength(1);
    const p=pkg.holes[0].p;
    expect(p[1]-p.at(-2)).toBeCloseTo(100,1);
    expect(pkg.fpoly).toEqual([]);
    expect(pkg.runs).toHaveLength(2); // 0.2 m sampling gap is not silently bridged
    expect(pkg.meta.warnings.some(w=>w.includes('no downhole survey'))).toBe(true);
    expect(pkg.config.tag).toBe('Drilling');
  });
  it('handles projected collars, horizontal zero dip, survey stations beyond end of hole and azimuth wrap',()=>{
    const x=input();x.crs='EPSG:26909';x.collars=[{...x.collars[0],x:500000,y:6094791,dip:0,azimuth:359}];
    x.surveys=[{holeId:'H1',depth:50,azimuth:1,dip:0},{holeId:'H1',depth:200,azimuth:1,dip:0}];
    const p=buildTourPackage(x).holes[0].p;
    expect(p.at(-2)).toBe(p[1]);
    expect(Math.hypot(p.at(-3)-p[0],p.at(-1)-p[2])).toBeCloseTo(100,0);
  });
  it('rejects duplicates, invalid geometry/intervals/bins and targets without collars',()=>{
    const d=input();d.collars.push({...d.collars[0]});expect(()=>buildTourPackage(d)).toThrow('unique');
    const o=input();o.assays[1].from=5;expect(()=>buildTourPackage(o)).toThrow('overlapping');
    const b=input();b.grade.bins=[0.2,0.1];expect(()=>buildTourPackage(b)).toThrow('increasing');
    const t=input();t.mainTarget='Missing';expect(()=>buildTourPackage(t)).toThrow('no mapped collars');
    const c=input();c.claims.features[0].geometry.type='Point';expect(()=>buildTourPackage(c)).toThrow('polygons');
  });
  it('does not infer grade units or turn an unknown field into copper',()=>{
    const g=input();g.grade.field='Unknown';expect(()=>buildTourPackage(g)).toThrow('no measured');
  });
  it('uses a supplied figure path instead of recomputing a different survey shape',()=>{
    const x=input();x.crs='EPSG:26909';x.collars=[{...x.collars[0],x:500000,y:6094791}];
    x.paths={H1:[{depth:0,x:500000,y:6094791,z:1000},{depth:50,x:500020,y:6094800,z:960},{depth:100,x:500035,y:6094810,z:920}]};
    const p=buildTourPackage(x).holes[0].p;
    expect(p.at(-3)-p[0]).toBeCloseTo(35,1);
    expect(p.at(-2)-p[1]).toBeCloseTo(-80,1);
    x.paths.H1[1].depth=0;expect(()=>buildTourPackage(x)).toThrow('path');
  });
});
describe('3D Tour HTML and preview CSP',()=>{
  it('escapes project strings against script injection and keeps static executable scripts trusted',()=>{
    const p=buildTourPackage({...input(),title:'</script><script>bad()</script>'});
    const template=readFileSync('src/features/tour3d/tour-template.html','utf8');
    const three=readFileSync('node_modules/three/build/three.min.js','utf8');
    const html=exportTourHtml(p,template,three);
    expect(html).not.toContain('<script>bad()');
    expect(html).not.toContain('Star Project');
    expect(html).not.toContain('__DATA__');
    const config=JSON.parse(readFileSync('vercel.json','utf8'));
    for(const source of ['/3d','/3d/','/3d/index.html']){
      const csp=config.headers.find(r=>r.source===source).headers[0].value;
      for(const hash of tourScriptHashes())expect(csp).toContain(hash);
      expect(csp.split(';').find(p=>p.includes('script-src'))).not.toContain('unsafe-inline');
    }
  });
});
