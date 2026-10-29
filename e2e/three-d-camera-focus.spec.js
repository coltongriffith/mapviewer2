import { test, expect } from '@playwright/test';

test.use({ launchOptions: { args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] } });
for (const [name, width, height] of [['desktop',1280,900],['mobile',390,844]]) {
  test(`crew focus can return to drilling and choose another zoom centre: ${name}`, async ({ page }) => {
    test.setTimeout(120000);
    await page.setViewportSize({width,height});
    await page.emulateMedia({reducedMotion:'reduce'});
    await page.goto('/3d'); await page.waitForFunction(()=>window.EM3D?.getState().ready);
    await page.evaluate(async()=>{const E=window.EM3D;await E.layersReady();await E.setCrew({on:true,scale:'true',life:false,chatter:false});await E.zoomToCrew();});
    await page.waitForTimeout(1100);
    const close=await page.evaluate(()=>window.EM3D.getState().camera);
    expect(close.pan).toBeTruthy();expect(close.zoom).toBeGreaterThan(250);
    const original=await page.evaluate(()=>window.EM3D.getProject());
    await page.getByRole('button',{name:'Fit model',exact:true}).click();
    const fit=await page.evaluate(()=>window.EM3D.getState().camera);
    expect(fit.pan).toBeUndefined();expect(fit.zoom).toBe(100);
    expect(fit.azimuth).toBe(close.azimuth);expect(fit.plunge).toBe(close.plunge);
    await page.getByRole('button',{name:'Pick focus',exact:true}).click();
    await expect(page.locator('#camera-focus')).toHaveAttribute('aria-pressed','true');
    await page.keyboard.press('Escape');
    await expect(page.locator('#camera-focus')).toHaveAttribute('aria-pressed','false');
    await page.getByRole('button',{name:'Pick focus',exact:true}).click();
    // A blank corner must not invent a point or unexpectedly jump the camera.
    const box=await page.locator('#gl').boundingBox();
    await page.mouse.click(box.x+2,box.y+box.height-2);
    expect(await page.evaluate(()=>window.EM3D.getState().camera)).toEqual(fit);
    await expect(page.locator('#camera-focus')).toHaveAttribute('aria-pressed','true');
    // Pick a rendered block face, avoiding assumptions about sample world coordinates.
    for(const y of [0.5,0.6,0.7])for(const x of [0.4,0.5,0.6]){
      if(await page.locator('#camera-focus').getAttribute('aria-pressed')==='true')await page.mouse.click(box.x+box.width*x,box.y+box.height*y);
    }
    await expect(page.locator('#camera-focus')).toHaveAttribute('aria-pressed','false');
    const focused=await page.evaluate(()=>window.EM3D.getState().camera);
    expect(focused.pan).toBeTruthy();expect(focused.zoom).toBe(150);
    await page.mouse.wheel(0,-100);await page.waitForTimeout(250);
    const wheeled=await page.evaluate(()=>window.EM3D.getState().camera);
    expect(wheeled.zoom).toBeGreaterThan(focused.zoom);expect(wheeled.pan).toEqual(focused.pan);
    const saved=await page.evaluate(()=>window.EM3D.getProject());
    expect(saved.files).toEqual(original.files);
    for(const key of ['bins','valueCol','coCut','coIncl','vex','crew'])expect(saved.settings[key]).toEqual(original.settings[key]);
    await page.evaluate(async p=>{await window.EM3D.loadProject(p);await window.EM3D.layersReady();},saved);
    expect(await page.evaluate(()=>window.EM3D.getState().camera)).toEqual(wheeled);
    await page.getByRole('button',{name:'Fit model',exact:true}).click();
    expect((await page.evaluate(()=>window.EM3D.getState().camera)).pan).toBeUndefined();
    await page.locator('#lock-view').click();await page.locator('#camera-focus').click();
    await expect(page.locator('#camera-focus')).toHaveAttribute('aria-pressed','false');
    await page.locator('#lock-view').click();
    await page.locator('#camera-focus').click();await page.locator('#lock-view').click();
    await expect(page.locator('#camera-focus')).toHaveAttribute('aria-pressed','false');
    await page.locator('#lock-view').click();
    await page.locator('#camera-focus').click();await page.locator('#view-section').click();
    await expect(page.locator('#camera-focus')).toBeHidden();
    await page.locator('#view-3d').click();
    await expect(page.locator('#camera-focus')).toHaveAttribute('aria-pressed','false');
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  });
}
