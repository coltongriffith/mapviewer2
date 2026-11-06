import {test,expect} from '@playwright/test';

test('block presentation edits keep scene resources and drill output stable',async({page})=>{
  test.setTimeout(240000);
  await page.route('**/api/track',r=>r.fulfill({status:204}));
  await page.addInitScript(()=>{
    window.__layoutWork={deletedBuffers:0,uploadedTextures:0,previewPaints:0};
    const clear=CanvasRenderingContext2D.prototype.clearRect;
    CanvasRenderingContext2D.prototype.clearRect=function(...args){if(this.canvas.id==='ov')window.__layoutWork.previewPaints++;return clear.apply(this,args);};
    for(const name of ['WebGLRenderingContext','WebGL2RenderingContext']){
      const proto=window[name]?.prototype;if(!proto)continue;
      for(const [method,key] of [['deleteBuffer','deletedBuffers'],['texImage2D','uploadedTextures']]){
        const original=proto[method];proto[method]=function(...args){window.__layoutWork[key]++;return original.apply(this,args);};
      }
    }
  });
  await page.goto('/3d');await page.waitForFunction(()=>window.EM3D?.getState().ready);await page.evaluate(()=>window.EM3D.layersReady());
  // A clearly synthetic loaded-project fixture: three ID-renamed copies of
  // the bundled fictional sample. Never touches an account or real project.
  await page.evaluate(async()=>{
    const E=window.EM3D,p=E.getProject();p.settings.title='Synthetic performance QA';
    p.files=p.files.map(f=>{
      if(!['collar','survey','assay'].includes(f.role))return f;
      const [header,...rows]=f.text.trim().split(/\r?\n/);
      return {...f,text:[header,...[1,2,3].flatMap(i=>rows.map(row=>`QA${i}-${row}`))].join('\n')};
    });
    await E.loadProject(p);await E.layersReady();await document.fonts.ready;
  });
  const idle=await page.evaluate(async()=>{
    for(let i=0;i<8;i++)await new Promise(requestAnimationFrame);
    const before=window.__layoutWork.previewPaints,start=performance.now();
    for(let i=0;i<8;i++)await new Promise(requestAnimationFrame);
    return {paints:window.__layoutWork.previewPaints-before,elapsedMs:performance.now()-start};
  });
  await page.getByRole('tab',{name:'3 Layout',exact:true}).click();
  const start=Date.now();await page.getByRole('button',{name:'Choose the holes shown',exact:true}).click();
  await expect(page.locator('[data-hs]')).toHaveCount(102);const chooserMs=Date.now()-start;
  const result=await page.evaluate(async()=>{
    const E=window.EM3D,t0=performance.now();await E.applyPreset('blockSection');
    const presetMs=performance.now()-t0;
    E.setCamera(E.getState().camera);const before=E.exportPNG({view:'3d',width:600});
    const resources={...window.__layoutWork},t1=performance.now();await E.setBlock({info:'QA info'});
    const editMs=performance.now()-t1,after=E.exportPNG({view:'3d',width:600});
    return {presetMs,editMs,before,after,deletedBuffers:window.__layoutWork.deletedBuffers-resources.deletedBuffers,uploadedTextures:window.__layoutWork.uploadedTextures-resources.uploadedTextures};
  });
  console.log(JSON.stringify({idlePaints:idle.paints,idleElapsedMs:idle.elapsedMs,chooserMs,presetMs:result.presetMs,editMs:result.editMs,deletedBuffers:result.deletedBuffers,uploadedTextures:result.uploadedTextures}));
  // studio.loop deliberately refreshes once per second for arriving textures.
  // Eight software-rendered CI frames can span several seconds. Retain the
  // original two incidental-paint allowance plus the actual elapsed watchdog
  // intervals, rather than mistaking those scheduled paints for a 60fps loop.
  expect(idle.paints).toBeLessThanOrEqual(2+Math.ceil(idle.elapsedMs/1000));expect(result.deletedBuffers).toBe(0);expect(result.after).toBe(result.before);
  await page.evaluate(async()=>{
    const E=window.EM3D,ids=E.getProject().settings.holesShown;
    await E.setHolesShown(null);await E.setHolesShown(ids);
  });
  expect(await page.evaluate(()=>window.EM3D.exportPNG({view:'3d',width:600}))).toBe(result.after);
  await page.evaluate(()=>window.EM3D.setBlock({traces:'tubes'}));
  const tubes=await page.evaluate(()=>window.EM3D.exportPNG({view:'3d',width:600}));expect(tubes).not.toBe(result.after);
  await page.evaluate(()=>window.EM3D.setBlock({traces:'overlay'}));
  expect(await page.evaluate(()=>window.EM3D.exportPNG({view:'3d',width:600}))).toBe(result.after);
  const paints=await page.evaluate(()=>window.__layoutWork.previewPaints);
  await page.locator('#cam-az').focus();await page.locator('#cam-az').press('Home');await page.locator('#cam-az').press('ArrowRight');
  await expect.poll(()=>page.evaluate(()=>window.__layoutWork.previewPaints)).toBeGreaterThan(paints);
  expect((await page.evaluate(()=>window.EM3D.getState().camera)).azimuth).toBeCloseTo(1,4);
  const orbitBefore=await page.evaluate(()=>({az:window.EM3D.getState().camera.azimuth,paints:window.__layoutWork.previewPaints}));
  const box=await page.locator('#gl').boundingBox();
  await page.mouse.move(box.x+box.width*0.75,box.y+box.height*0.4);await page.mouse.down();
  await page.waitForTimeout(180); // the viewer deliberately treats presses under150ms as clicks
  await page.mouse.move(box.x+box.width*0.75+60,box.y+box.height*0.4+20,{steps:4});await page.mouse.up();
  await expect.poll(()=>page.evaluate(()=>Math.abs(window.EM3D.getState().camera.azimuth)),{timeout:15000}).not.toBeCloseTo(orbitBefore.az,1);
  await expect.poll(()=>page.evaluate(()=>window.__layoutWork.previewPaints)).toBeGreaterThan(orbitBefore.paints);
  const resizePaints=await page.evaluate(()=>window.__layoutWork.previewPaints);
  await page.setViewportSize({width:900,height:700});
  await expect.poll(()=>page.evaluate(()=>window.__layoutWork.previewPaints)).toBeGreaterThan(resizePaints);
  const labelPaints=await page.evaluate(()=>window.__layoutWork.previewPaints);
  const id=await page.evaluate(()=>window.EM3D.addLabel({text:'QA draggable',x:0.2,y:0.25}));
  await expect.poll(()=>page.evaluate(()=>window.__layoutWork.previewPaints)).toBeGreaterThan(labelPaints);
  const dragBox=await page.locator('#gl').boundingBox(),livePaints=await page.evaluate(()=>window.__layoutWork.previewPaints);
  await page.mouse.move(dragBox.x+dragBox.width*0.2,dragBox.y+dragBox.height*0.25);await page.mouse.down();
  await page.mouse.move(dragBox.x+dragBox.width*0.2+40,dragBox.y+dragBox.height*0.25+20,{steps:3});
  await page.evaluate(()=>new Promise(requestAnimationFrame));
  expect(await page.evaluate(key=>window.EM3D.getProject().settings.labels.find(l=>l.id===key).x,id)).toBeGreaterThan(0.2);
  expect(await page.evaluate(()=>window.__layoutWork.previewPaints)).toBeGreaterThan(livePaints);
  await page.mouse.up();
});


// Count actual live-canvas work; off-screen PNG exports are deliberately excluded.
async function instrumentLiveWork(page) {
  await page.addInitScript(()=>{
    window.__pfWork={gl:0,overlay:0};
    const clear=CanvasRenderingContext2D.prototype.clearRect;
    CanvasRenderingContext2D.prototype.clearRect=function(...args){if(this.canvas.id==='ov')window.__pfWork.overlay++;return clear.apply(this,args);};
    const seen=new WeakSet();
    for(const name of ['WebGLRenderingContext','WebGL2RenderingContext']){
      const proto=window[name]?.prototype;if(!proto)continue;
      for(const key of ['drawElements','drawArrays','drawElementsInstanced','drawArraysInstanced']){
        const draw=proto[key];if(typeof draw!=='function')continue;
        proto[key]=function(...args){if(this.canvas?.id==='gl')window.__pfWork.gl++;return draw.apply(this,args);};
      }
      const getExtension=proto.getExtension;
      proto.getExtension=function(...args){
        const extension=getExtension.apply(this,args);
        if(extension&&!seen.has(extension)&&args[0]==='ANGLE_instanced_arrays'){
          seen.add(extension);const canvas=this.canvas;
          for(const key of ['drawElementsInstancedANGLE','drawArraysInstancedANGLE']){
            const draw=extension[key];if(typeof draw==='function')extension[key]=function(...values){if(canvas?.id==='gl')window.__pfWork.gl++;return draw.apply(this,values);};
          }
        }
        return extension;
      };
    }
    window.__pfQuiet=async()=>{
      let last=JSON.stringify(window.__pfWork),since=performance.now(),start=since;
      while(performance.now()-since<300){
        await new Promise(requestAnimationFrame);const now=JSON.stringify(window.__pfWork);
        if(now!==last){last=now;since=performance.now();}
        if(performance.now()-start>15000)throw new Error('The native preview never became idle');
      }
      return {...window.__pfWork};
    };
    window.__pfIdle=async()=>{
      const before=await window.__pfQuiet(),start=performance.now();
      await new Promise(resolve=>setTimeout(resolve,1400));
      await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);
      return{before,after:{...window.__pfWork},elapsed:performance.now()-start};
    };
  });
}
test('static native preview and legend edits stay idle while a late face image explicitly repaints',async({page})=>{
  test.setTimeout(180000);
  await page.setViewportSize({width:1280,height:900});
  await page.route('**/api/track',route=>route.fulfill({status:204}));await instrumentLiveWork(page);
  await page.goto('/3d/');await page.waitForFunction(()=>window.EM3D?.getState().ready);
  await page.evaluate(async()=>{const E=window.EM3D;await E.layersReady();await document.fonts.ready;E.setCamera({azimuth:40,plunge:25,zoom:90});await E.layersReady();await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);});
  const source=await page.evaluate(()=>window.EM3D.getProject().files);
  const idle=await page.evaluate(()=>window.__pfIdle());expect(idle.elapsed).toBeGreaterThan(1300);expect(idle.after).toEqual(idle.before);expect(idle.before.gl).toBeGreaterThan(0);
  const legend=await page.evaluate(async()=>{
    const E=window.EM3D,before=await window.__pfQuiet();
    E.setStyle({legend:{pos:{main:{x:.13,y:.18}}}});
    await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);await window.__pfQuiet();
    return{before,after:{...window.__pfWork},project:E.getProject(),state:E.getState()};
  });
  expect(legend.after.gl).toBe(legend.before.gl);expect(legend.after.overlay).toBeGreaterThan(legend.before.overlay);
  expect(legend.project.settings.legend.pos.main).toEqual({x:.13,y:.18});expect(legend.state.display.legend.pos.main).toEqual({x:.13,y:.18});expect(legend.project.files).toEqual(source);
  const baseline=await page.evaluate(async()=>{
    const E=window.EM3D;await E.setGeology({enabled:true,faces:'all'});await E.layersReady();await document.fonts.ready;await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);
    const png=await E.exportPNG({view:'3d',width:400,background:'transparent'});
    const c=document.createElement('canvas');c.width=32;c.height=32;const x=c.getContext('2d');x.fillStyle='#e87924';x.fillRect(0,0,32,16);x.fillStyle='#4ade80';x.fillRect(0,16,32,16);
    return{png,image:c.toDataURL('image/png')};
  });
  let release;const gate=new Promise(resolve=>{release=resolve;});let requested=false;
  await page.route('**/qa-late-face.png',async route=>{requested=true;await gate;await route.fulfill({status:200,contentType:'image/png',body:Buffer.from(baseline.image.split(',')[1],'base64')});});
  // The public face API accepts data images only. Rewrite this one synthetic
  // Image source at the browser boundary to delay its real onload via a route.
  await page.evaluate(source=>{
    const descriptor=Object.getOwnPropertyDescriptor(HTMLImageElement.prototype,'src');
    Object.defineProperty(HTMLImageElement.prototype,'src',{...descriptor,set(value){descriptor.set.call(this,value===source?new URL('/qa-late-face.png',location.href).href:value);}});
    window.__lateFaceDone=false;window.__lateFaceError=null;
    window.EM3D.setFaceImage('S',source).then(()=>{window.__lateFaceDone=true;},error=>{window.__lateFaceError=error.message;});
  },baseline.image);
  await expect.poll(()=>requested).toBe(true);expect(await page.evaluate(()=>window.__lateFaceDone)).toBe(false);
  const pending=await page.evaluate(()=>window.__pfIdle());expect(pending.elapsed).toBeGreaterThan(1300);expect(pending.after).toEqual(pending.before);
  // No export/layersReady call while held: those correctly await the image.
  const beforeRelease=await page.evaluate(()=>({...window.__pfWork}));release();
  await page.waitForFunction(()=>window.__lateFaceDone||window.__lateFaceError);expect(await page.evaluate(()=>window.__lateFaceError)).toBeNull();
  await expect.poll(()=>page.evaluate(()=>window.__pfWork.gl)).toBeGreaterThan(beforeRelease.gl);
  const after=await page.evaluate(async()=>{const E=window.EM3D;await E.layersReady();await document.fonts.ready;await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);return{project:E.getProject(),png:await E.exportPNG({view:'3d',width:400,background:'transparent'})};});
  expect(after.project.files).toEqual(source);expect(after.project.settings.geology.images.S).toBe(baseline.image);expect(after.png).not.toBe(baseline.png);
  await page.locator('#stage').screenshot({path:test.info().outputPath('native-late-face-repaint.png')});
  const finalIdle=await page.evaluate(()=>window.__pfIdle());expect(finalIdle.after).toEqual(finalIdle.before);
});
