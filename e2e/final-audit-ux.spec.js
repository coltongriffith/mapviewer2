import { test, expect } from '@playwright/test';
const geometry=(i)=>({type:'FeatureCollection',features:[{type:'Feature',id:`synthetic-${i}`,properties:{name:`Synthetic ${i}`,assay_text:'<0.05',Au_gpt:2.5+i},geometry:{type:'Point',coordinates:[-120+i*.01,50]}}]});
const payload=(name,data)=>({name,mimeType:'application/geo+json',buffer:Buffer.from(JSON.stringify(data))});
async function start(page,mobile){
  await page.setViewportSize(mobile?{width:390,height:844}:{width:1280,height:900});
  await page.route('**/api/track',route=>route.fulfill({status:204}));
  await page.goto('/'); await page.getByRole('button',{name:'Start a map',exact:true}).first().click();
  await expect(page.getByRole('dialog',{name:'Add Claims'})).toBeVisible(); await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();
  const edit=page.getByRole('button',{name:'Edit',exact:true});if(await edit.isVisible()&&await edit.getAttribute('aria-expanded')!=='true')await edit.click();
  await page.getByRole('tab',{name:'Data',exact:true}).click();
}
async function select(page,files){
  const chooser=page.waitForEvent('filechooser');
  await page.getByRole('button',{name:'Upload shapefile, GeoJSON, KML, CSV or georeferenced image',exact:true}).click();
  await(await chooser).setFiles(files);
}
const layers=page=>page.evaluate(()=>window.EMAP.getProject().layers);
for(const mobile of [false,true]){
  test(`all five independent selected files survive Data to Style transition (${mobile?'mobile':'desktop'})`,async({page})=>{
    await start(page,mobile);const inputs=Array.from({length:5},(_,i)=>payload(`synthetic-${i}.geojson`,geometry(i)));
    await select(page,inputs);await expect.poll(async()=>(await layers(page)).length).toBe(5);
    const imported=await layers(page);expect(new Set(imported.map(l=>l.id)).size).toBe(5);
    expect(imported.map(l=>l.sourceName)).toEqual(inputs.map(f=>f.name));
    imported.forEach((l,i)=>{expect(l.geojson).toEqual(geometry(i));expect(l.style).toBeTruthy();});
    await expect(page.getByRole('tab',{name:'Style',exact:true})).toHaveAttribute('aria-selected','true');
  });
  test(`CSV confirmation pauses a batch and cancel keeps earlier data (${mobile?'mobile':'desktop'})`,async({page})=>{
    await start(page,mobile);
    const csv={name:'synthetic-manual.csv',mimeType:'text/csv',buffer:Buffer.from('first,second,label\n-120,50,QA')};
    await select(page,[payload('before.geojson',geometry(0)),csv,payload('after.geojson',geometry(2))]);
    const dialog=page.getByRole('dialog').filter({hasText:'Map CSV columns'});await expect(dialog).toBeVisible();
    expect((await layers(page)).map(l=>l.sourceName)).toEqual(['before.geojson']);
    await dialog.getByRole('button',{name:'Cancel',exact:true}).click();await expect(dialog).toBeHidden();
    await page.getByRole('tab',{name:'Data',exact:true}).click();
    await expect(page.getByText(/Import cancelled.*1 earlier import was kept/)).toBeVisible();
    expect((await layers(page)).map(l=>l.sourceName)).toEqual(['before.geojson']);
    await select(page,[csv,payload('after.geojson',geometry(2))]);await expect(dialog).toBeVisible();
    const selects=dialog.locator('select');await selects.nth(0).selectOption('x');await selects.nth(1).selectOption('y');
    await dialog.getByRole('button',{name:'Import drillholes',exact:true}).click();
    await expect.poll(async()=>(await layers(page)).length).toBe(3);
    expect((await layers(page)).map(l=>l.sourceName)).toEqual(['before.geojson','synthetic-manual.csv','after.geojson']);
    expect((await layers(page))[0].geojson).toEqual(geometry(0));expect((await layers(page))[2].geojson).toEqual(geometry(2));
  });
}
test('native 3D ranges have names and backup Escape returns visible focus',async({page})=>{
  await page.route('**/api/track',route=>route.fulfill({status:204}));await page.goto('/3d/');await page.waitForFunction(()=>window.EM3D?.getState().ready);
  for(const id of ['cam-az','cam-pl','cam-zoom','vex','trace-w','surf','sec-az'])expect(await page.locator(`#${id}`).evaluate(input=>input.labels?.[0]?.control===input)).toBe(true);
  const before=await page.evaluate(()=>window.EM3D.getProject());
  await page.getByRole('button',{name:'My 3D maps',exact:true}).click();const downloading=page.waitForEvent('download');await page.getByRole('button',{name:'Download project backup',exact:true}).click();
  const download=await downloading;await page.locator('#backup-file').setInputFiles(await download.path());
  await expect(page.getByRole('dialog',{name:'Open project backup'})).toBeVisible();await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog',{name:'Open project backup'})).toBeHidden();await expect(page.getByRole('button',{name:'My 3D maps',exact:true})).toBeFocused();
  expect(await page.evaluate(()=>window.EM3D.getProject())).toEqual(before);
});
