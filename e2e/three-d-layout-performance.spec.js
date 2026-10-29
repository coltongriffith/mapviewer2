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
  const idlePaints=await page.evaluate(async()=>{
    for(let i=0;i<8;i++)await new Promise(requestAnimationFrame);
    const before=window.__layoutWork.previewPaints;
    for(let i=0;i<8;i++)await new Promise(requestAnimationFrame);
    return window.__layoutWork.previewPaints-before;
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
  console.log(JSON.stringify({idlePaints,chooserMs,presetMs:result.presetMs,editMs:result.editMs,deletedBuffers:result.deletedBuffers,uploadedTextures:result.uploadedTextures}));
  expect(idlePaints).toBeLessThanOrEqual(3);expect(result.deletedBuffers).toBe(0);expect(result.after).toBe(result.before);
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
