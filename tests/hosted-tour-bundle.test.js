// @vitest-environment node
import {describe,it,expect} from 'vitest';
import {readFileSync,mkdtempSync,mkdirSync,copyFileSync,writeFileSync,rmSync} from 'node:fs';
import {join,relative,isAbsolute} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {build} from 'esbuild';
import {buildTourPackage} from '../src/features/tour3d/build';

const config=JSON.parse(readFileSync('vercel.json','utf8'));
describe('hosted tour deployment routes and trusted assets',()=>{
  it('keeps the normal site framing policy except for exact tour/embed routes',()=>{
    expect(config.rewrites.find(r=>r.source==='/tour/:id')).toEqual({source:'/tour/:id',destination:'/api/tour?id=:id'});
    const global=config.headers.find(r=>r.headers.some(h=>h.key==='X-Frame-Options'));
    const matches=new RegExp('^'+global.source+'$');
    for(const path of ['/tour/'+ 'a'.repeat(32),'/api/tour','/api/tour/','/3d/embed/id','/embed/map/id'])expect(matches.test(path)).toBe(false);
    for(const path of ['/','/3d','/account','/api/tour-other','/tour/id/extra','/tourism/id'])expect(matches.test(path)).toBe(true);
    expect(global.headers.find(h=>h.key==='X-Frame-Options').value).toBe('DENY');
  });
  it('renders from a relocated server bundle with only the explicitly included assets',async()=>{
    const files=config.functions['api/tour.ts'].includeFiles.slice(1,-1).split(',');
    expect(files).toEqual(['src/features/tour3d/tour-template.html','node_modules/three/build/three.min.js']);
    const dir=mkdtempSync(join(tmpdir(),'tour-bundle-'));
    try{
      for(const file of files){const dest=join(dir,file);mkdirSync(join(dest,'..'),{recursive:true});copyFileSync(file,dest);}
      await build({entryPoints:['api/_lib/tour-render.ts'],outfile:join(dir,'relocated-renderer.mjs'),bundle:true,platform:'node',format:'esm',logLevel:'silent'});
      const pkg=buildTourPackage({title:'Bundled tour',crs:'EPSG:4326',claims:{features:[]},collars:[{holeId:'H1',x:-129,y:55,z:1000,azimuth:0,dip:-60,depth:100}],assays:[{holeId:'H1',from:0,to:10,values:{Cu:.5}}],grade:{field:'Cu',bins:[.1,.2,.5,1]}});
      writeFileSync(join(dir,'fixture.json'),JSON.stringify(pkg));
      const output=execFileSync(process.execPath,['--input-type=module','-e',`import {readFileSync} from 'node:fs';import {renderHostedTour} from './relocated-renderer.mjs';const r=renderHostedTour(readFileSync('fixture.json','utf8'));console.log(JSON.stringify({valid:r.html.includes('Bundled tour'),csp:r.headers['Content-Security-Policy'],bytes:Buffer.byteLength(r.html)}));`],{cwd:dir,encoding:'utf8'});
      const result=JSON.parse(output);expect(result.valid).toBe(true);expect(result.bytes).toBeLessThan(4000000);expect(result.csp).toContain("script-src 'sha256-");expect(result.csp).toContain('sandbox allow-scripts');
    }finally{
      const target=relative(tmpdir(),dir);
      if(isAbsolute(target)||target.startsWith('..')||!target.startsWith('tour-bundle-'))throw new Error('Unexpected temporary bundle path');
      rmSync(dir,{recursive:true,force:true});
    }
  });
});
