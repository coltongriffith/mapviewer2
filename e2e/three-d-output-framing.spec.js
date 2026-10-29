import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';

for(const [name,width,height] of [['desktop',1280,900],['mobile',390,844]]){
  test('early framing stays synchronized and exports the selected preview: '+name,async({page})=>{
    test.setTimeout(150000);await page.setViewportSize({width,height});
    await page.route('**/api/track',r=>r.fulfill({status:204}));
    await page.goto('/3d');await page.waitForFunction(()=>window.EM3D?.getState().ready);await page.evaluate(()=>window.EM3D.layersReady());
    const original=await page.evaluate(()=>({project:window.EM3D.getProject(),camera:window.EM3D.getState().camera}));
    await page.getByRole('tab',{name:'3 Layout',exact:true}).click();
    await page.getByRole('combobox',{name:'Figure format',exact:true}).selectOption('square');
    const changed=await page.evaluate(()=>({project:window.EM3D.getProject(),camera:window.EM3D.getState().camera,size:window.EM3D.getState().figureSize}));
    expect(changed.size).toMatchObject({key:'square',width:2000,height:2000});
    const {format:oldFormat,...oldSettings}=original.project.settings,{format:newFormat,...newSettings}=changed.project.settings;
    expect(oldFormat).toBe('slide');expect(newFormat).toBe('square');expect(newSettings).toEqual(oldSettings);expect(changed.project.files).toEqual(original.project.files);
    expect(changed.camera.azimuth).toBeCloseTo(original.camera.azimuth,5);expect(changed.camera.plunge).toBeCloseTo(original.camera.plunge,5);
    await page.getByRole('tab',{name:'4 Export',exact:true}).click();await expect(page.locator('#sizes input[value=square]')).toBeChecked();
    await page.locator('#sizes input[value=release]').check();await page.getByRole('tab',{name:'3 Layout',exact:true}).click();await expect(page.getByRole('combobox',{name:'Figure format',exact:true})).toHaveValue('release');
    await page.evaluate(async()=>{const E=window.EM3D;E.setFigureSize('portrait');const p=E.getProject();E.setFigureSize('slide');await E.loadProject(p);await E.layersReady();});
    await expect(page.getByRole('combobox',{name:'Figure format',exact:true})).toHaveValue('portrait');
    await page.getByRole('tab',{name:'4 Export',exact:true}).click();await expect(page.locator('#sizes input[value=portrait]')).toBeChecked();
    await page.locator('#export-scale').selectOption('w');await page.locator('#export-width').fill('500');await page.locator('#export-bg').selectOption('transparent');
    for(const view of ['section','3d']){
      await page.locator('#view-'+view).click();await expect(page.locator('#export-current')).toContainText(view==='section'?'current section':'current 3D view');
      const pending=page.waitForEvent('download');await page.locator('#export-current').click();const download=await pending;
      expect(download.suggestedFilename()).toMatch(new RegExp(`-${view}-portrait\\.png$`));
      const actual=await readFile(await download.path());expect(actual.readUInt32BE(16)).toBe(500);expect(actual.readUInt32BE(20)).toBe(625);
      const expected=await page.evaluate(v=>window.EM3D.exportPNG({view:v,width:500,background:'transparent',shadow:window.EM3D.getState().display.dropShadow}),view);
      expect(actual.equals(Buffer.from(expected.split(',')[1],'base64'))).toBe(true);
    }
    await expect(page.locator('#export-3d')).toBeVisible();await expect(page.locator('#export-section')).toBeVisible();
    const beforeDisclosure=await page.evaluate(()=>({project:window.EM3D.getProject(),png:window.EM3D.exportPNG({view:'3d'})}));
    const service=page.getByText('Optional design service',{exact:true});
    await expect(page.locator('#desk-email')).toBeHidden();await service.focus();await page.keyboard.press('Enter');
    await expect(page.locator('#desk-email')).toBeVisible();await expect(page.locator('#desk-company')).toBeVisible();
    // Invalid input is handled locally, without contacting the design desk.
    await page.locator('#desk-send').click();await expect(page.locator('#desk-email')).toHaveAttribute('aria-invalid','true');
    await service.focus();await page.keyboard.press('Enter');await expect(page.locator('#desk-email')).toBeHidden();
    expect(await page.evaluate(()=>({project:window.EM3D.getProject(),png:window.EM3D.exportPNG({view:'3d'})}))).toEqual(beforeDisclosure);
  });
}
