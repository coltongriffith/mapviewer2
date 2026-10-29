import {test,expect} from '@playwright/test';

for(const [name,width,height] of [['desktop',1280,900],['mobile',390,844]]){
  test('terrain palette changes presentation without changing the model: '+name,async({page})=>{
    test.setTimeout(120000);await page.setViewportSize({width,height});
    await page.route('**/api/track',r=>r.fulfill({status:204}));
    await page.goto('/3d');await page.waitForFunction(()=>window.EM3D?.getState().ready);await page.evaluate(()=>window.EM3D.layersReady());
    await page.getByRole('tab',{name:'3 Layout',exact:true}).click();
    const choices=page.getByRole('group',{name:'Quick terrain palettes'});
    const before=await page.evaluate(()=>({project:window.EM3D.getProject(),png:window.EM3D.exportPNG({view:'3d'})}));
    for(const [label,value] of [['Natural','natural'],['Light relief','light'],['Dark slate','dark']]){
      const button=choices.getByRole('button',{name:label,exact:true});await button.focus();await page.keyboard.press('Enter');
      await expect(button).toHaveAttribute('aria-pressed','true');await expect(choices.locator('[aria-pressed="true"]')).toHaveCount(1);
      await expect(page.locator('#terrain')).toHaveValue(value);
      const after=await page.evaluate(()=>window.EM3D.getProject());
      expect(after).toEqual({...before.project,settings:{...before.project.settings,terrain:value}});
    }
    await page.locator('#terrain').selectOption('relief');await expect(choices.locator('[aria-pressed="true"]')).toHaveCount(0);
    await page.evaluate(()=>window.EM3D.setStyle({terrain:'light'}));await expect(choices.getByRole('button',{name:'Light relief',exact:true})).toHaveAttribute('aria-pressed','true');
    await page.evaluate(async p=>{await window.EM3D.loadProject(p);await window.EM3D.layersReady();},before.project);
    await expect(choices.locator(`[data-terrain-choice="${before.project.settings.terrain}"]`)).toHaveAttribute('aria-pressed','true');
    expect(await page.evaluate(()=>window.EM3D.exportPNG({view:'3d'}))).toBe(before.png);
    await choices.scrollIntoViewIfNeeded();await page.screenshot({path:test.info().outputPath(`terrain-palettes-${name}.png`)});
  });
}
