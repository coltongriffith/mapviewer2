import {test,expect} from '@playwright/test';
import {createServer} from 'node:http';
import {build} from 'esbuild';
import {createTourHandler} from '../api/tour';
import {buildTourPackage} from '../src/features/tour3d/build';

const project='11111111-1111-4111-8111-111111111111',id='a'.repeat(32);
const packet=()=>buildTourPackage({title:'Hosted browser tour',crs:'EPSG:4326',claims:{type:'FeatureCollection',features:[]},
  collars:[{holeId:'H1',x:-129,y:55,z:1000,azimuth:0,dip:-60,depth:100}],assays:[{holeId:'H1',from:0,to:10,values:{Cu:.5}}],grade:{field:'Cu',bins:[.1,.2,.5,1]},
  includeEnvelopes:true,envelopes:[{name:'Existing shape',vertices:[-129,55,950,-128.999,55,950,-129,55.001,900],indices:[0,1,2],color:'#123456',opacity:.35,kind:'supplied'}],
});

for(const [name,width,height] of [['desktop',1280,900],['mobile',390,844]]){
  test('hosted tour HTTP publishing, sandboxed viewer and revocation: '+name,async({page,context})=>{
    test.setTimeout(120000);await page.setViewportSize({width,height});
    let active=null,revision=0,enabled=true;
    const pkg=packet();pkg.meta.warnings.push('</script><script>window.INJECTED=true</script>');
    const handler=createTourHandler({
      clientForToken:token=>({auth:{getUser:async()=>({data:{user:token==='browser-token'?{id:'user'}:null},error:null})},
        rpc:async(fn,args)=>{
          if(!enabled)return {error:{code:'PGRST202',message:'not installed'},data:null};
          if(fn==='get_3d_tour')return {data:args.p_id===id?active:null,error:null};
          if(token!=='browser-token')return {error:{code:'42501'},data:null};
          if(fn==='get_3d_tour_info')return {data:active?{id,revision,updated_at:new Date().toISOString()}:null,error:null};
          if(fn==='publish_3d_tour'){active=args.p_package;revision++;return {data:id,error:null};}
          if(fn==='revoke_3d_tour'){active=null;return {data:true,error:null};}
          return {error:{code:'42883'},data:null};
        }}),
      // Use the real trusted renderer/default template; only database/auth
      // transport is stubbed. SQL permissions are tested separately in PGlite.
      ...await import('../api/_lib/tour-render').then(m=>({render:m.renderHostedTour})),
    });
    const bundle=await build({entryPoints:['src/features/tour3d/sharingUI.js'],bundle:true,write:false,format:'esm',platform:'browser',external:['../../three-d/account-core'],logLevel:'silent'});
    const harness=`<!doctype html><meta name="viewport" content="width=device-width"><section id="sharing"></section><script type="module">${new TextDecoder().decode(bundle.outputFiles[0].contents).replace(/<\/script/gi,'<\\/script')}
      mountTourSharing(document.getElementById('sharing'),{getPackage:()=>(${JSON.stringify(pkg).replace(/</g,'\\u003c')}),services:async()=>({getContext:()=>({project:'${project}',epoch:1,readOnly:false}),getSession:async()=>({user:{id:'user'},access_token:'browser-token'})})});</script>`;
    const server=createServer(async(req,res)=>{
      if(req.url==='/'){res.setHeader('Content-Type','text/html');res.end(harness);return;}
      if(req.url==='/embed'){res.setHeader('Content-Type','text/html');res.end(`<iframe title="Hosted embed" sandbox="allow-scripts" src="https://hosted-tour.test/tour/${id}"></iframe>`);return;}
      const url=new URL(req.url,'http://local');
      req.query=Object.fromEntries(url.searchParams);if(url.pathname.startsWith('/tour/'))req.query.id=url.pathname.slice(6);
      let body='';for await(const chunk of req)body+=chunk;req.body=body||undefined;
      res.status=n=>{res.statusCode=n;return res;};res.json=b=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(b));};res.send=b=>res.end(b);
      await handler(req,res);
    });
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
    try{
      await context.route('https://s3.amazonaws.com/**',r=>r.abort());await context.route('https://server.arcgisonline.com/**',r=>r.abort());
      await page.goto(base);await expect(page.getByText('Share a hosted tour',{exact:true})).toBeVisible({timeout:10000});await page.getByText('Share a hosted tour',{exact:true}).click();
      await page.getByRole('button',{name:'Check sharing availability'}).click();await expect(page.getByRole('status')).toContainText('No active link');
      await page.getByRole('checkbox').check();await page.getByRole('button',{name:'Publish preview',exact:true}).click();await expect(page.getByRole('status')).toContainText('Tour published');
      await expect(page.getByLabel('Public tour link')).toHaveValue(`https://www.explorationmaps.com/tour/${id}`);
      const viewer=await context.newPage(),viewerErrors=[];viewer.on('pageerror',e=>viewerErrors.push(e.message));viewer.on('console',m=>{if(m.type()==='error')viewerErrors.push(m.text());});
      const response=await viewer.goto(`${base}/tour/${id}`);
      expect(response.headers()['cache-control']).toBe('no-store');expect(response.headers()['content-security-policy']).toContain('sandbox allow-scripts');
      try{await viewer.waitForFunction(()=>!!window.S3D,undefined,{timeout:20000});}catch(e){throw new Error(`${e.message}\nViewer errors: ${viewerErrors.join('\n')}`);}expect(await viewer.evaluate(()=>!!window.INJECTED)).toBe(false);
      await viewer.getByRole('button',{name:'Envelopes on',exact:true}).click();expect(await viewer.evaluate(()=>window.S3D.layers())).toMatchObject({envelopes:false,envelopeCount:1});
      // HTTPS parent/child aliases proxy the real HTTP handler response so the
      // browser enforces its actual CSP frame-ancestors and opaque sandbox.
      await context.route('https://hosted-tour.test/**',async route=>{
        const path=new URL(route.request().url()).pathname;
        const reply=await context.request.get(base+path);await route.fulfill({status:reply.status(),headers:reply.headers(),body:await reply.body()});
      });
      await viewer.goto('https://hosted-tour.test/embed');
      const frame=viewer.frameLocator('iframe[title="Hosted embed"]');await expect(frame.getByRole('button',{name:'Pause',exact:true})).toBeVisible();
      await expect.poll(()=>frame.locator('body').evaluate(()=>!!window.S3D)).toBe(true);
      expect(await frame.locator('body').evaluate(()=>{try{return !!parent.document;}catch{return false;}})).toBe(false);
      await page.getByRole('checkbox').check();await page.getByRole('button',{name:'Republish preview',exact:true}).click();await expect(page.getByRole('status')).toContainText('Tour published');expect(revision).toBe(2);
      await page.getByRole('button',{name:'Revoke link'}).click();await expect(page.getByRole('status')).toContainText('Link revoked');
      const removed=await context.request.get(`${base}/tour/${id}`);expect(removed.status()).toBe(404);expect(removed.headers()['cache-control']).toBe('no-store');
      expect(removed.headers()['content-security-policy']).toContain("frame-ancestors 'none'");
      enabled=false;await page.getByRole('button',{name:'Check sharing availability'}).click();await expect(page.getByRole('status')).toContainText('HTML download still works');
      await viewer.close();
    }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
  });
}
