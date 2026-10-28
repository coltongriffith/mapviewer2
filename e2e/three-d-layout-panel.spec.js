import {test,expect} from '@playwright/test';

for(const [name,width,height] of [['desktop',1280,900],['mobile',390,844]]){
  test('Layout groups disclose controls without changing the figure: '+name,async({page})=>{
    test.setTimeout(120000);await page.setViewportSize({width,height});
    await page.route('**/api/track',r=>r.fulfill({status:204}));
    await page.goto('/3d');await page.waitForFunction(()=>window.EM3D?.getState().ready);await page.evaluate(()=>window.EM3D.layersReady());
    await page.getByRole('tab',{name:'3 Layout',exact:true}).click();
    const pane=page.locator('#pane-layout'),groups=pane.locator(':scope > details.layout-group');
    await expect(groups).toHaveCount(4);
    expect(await groups.locator(':scope > summary').allTextContents()).toEqual(['View and terrain','Grades and envelopes','Labels and callouts','Sections and map layers']);
    const original=await page.evaluate(()=>({png:window.EM3D.exportPNG({view:'3d'}),settings:window.EM3D.getProject().settings}));
    const view=groups.filter({has:page.locator('summary',{hasText:'View and terrain'})});
    await view.locator(':scope > summary').focus();await page.keyboard.press('Enter');
    await expect(view).not.toHaveAttribute('open','');await expect(page.locator('#cam-az')).toBeHidden();
    await page.keyboard.press('Enter');await expect(page.locator('#cam-az')).toBeVisible();
    await page.getByRole('tab',{name:'4 Export',exact:true}).click();await page.getByRole('tab',{name:'3 Layout',exact:true}).click();
    await expect(view).toHaveAttribute('open','');
    const callouts=pane.getByText('Edit individual callouts',{exact:true});
    await expect(page.locator('#callout-editor')).toBeHidden();await callouts.click();await expect(page.locator('#callout-editor')).toBeVisible();await callouts.click();
    const same=await page.evaluate(before=>({png:window.EM3D.exportPNG({view:'3d'})===before.png,settings:JSON.stringify(window.EM3D.getProject().settings)===JSON.stringify(before.settings)}),original);
    expect(same).toEqual({png:true,settings:true});
    await expect(page.locator('#shell-controls')).toBeHidden();
    // Programmatic settings and restored projects must reveal controls too,
    // without needing the checkbox's DOM change event.
    await page.evaluate(()=>{window.EM3D.setShell({enabled:true}).catch(()=>{});});
    await expect(page.locator('#shell-controls')).toBeVisible();await expect(page.locator('#shell-on')).toBeChecked();
    await page.locator('#shell-on').uncheck();await expect(page.locator('#shell-controls')).toBeHidden();
    await page.screenshot({path:test.info().outputPath(`layout-${name}.png`)});
  });
}
