import { test, expect } from '@playwright/test';

const POLICY = 'finite-decimal-v1';
const collars = { name:'synthetic-collars.csv', text:'HoleID,X,Y,Z,Length\nQA-A,500000,5500000,100,100\nQA-B,500100,5500100,100,100' };
const csv = { name:'synthetic-ip.csv', text:'X,Y,Z,Chargeability\n500000,5500000,100,10\n500010,5500010,90,12tail\n500020,5500020,80,"1,000"\n500030,5500030,70,<0.05\n500040,5500040,60,2e1' };
const xyz = { name:'synthetic-ip.xyz', text:'/ Synthetic QA only\n/ X Y Z CHG\nLine QA-1\n500000 5500000 100 30\n500010 5500010 90 *\n500020 5500020 80 >10\n500030 5500030 70 40' };

for (const [label,viewport] of [['desktop',{width:1280,height:900}],['mobile',{width:390,height:844}]]) {
  test(`new geophysics imports retain strict numbers and disclosed exclusions across restore (${label})`, async ({page}) => {
    test.setTimeout(180000);
    await page.setViewportSize(viewport);
    await page.route('**/api/track',r=>r.fulfill({status:204}));
    await page.goto('/3d');
    await page.waitForFunction(()=>window.EM3D?.getState().ready);
    await page.evaluate(async files=>{
      const E=window.EM3D; E.clearFiles(); E.addFiles(files); await E.layersReady();
      await E.setGeophys({mode:'curtain',lines:'section'}); await E.layersReady();
    },[collars,csv,xyz]);
    const before=await page.evaluate(()=>({state:window.EM3D.getState(),saved:window.EM3D.getProject()}));
    expect(before.state.geophys.diagnostics).toMatchObject({submitted:9,accepted:4,excluded:5,legacyFiles:0});
    for (const source of [csv,xyz]) expect(before.saved.files.find(f=>f.name===source.name)).toMatchObject({text:source.text,geophysNumericPolicy:POLICY});
    expect(before.state.geophys.diagnostics.files.map(f=>[f.name,f.accepted,f.excluded])).toEqual([[csv.name,2,3],[xyz.name,2,2]]);
    await page.getByRole('tab',{name:'3 Layout',exact:true}).click();
    await expect(page.locator('#gp-ui [role="status"]')).toContainText('4 of 9 points accepted; 5 excluded');
    await expect(page.locator('#gp-ui [role="status"]')).toContainText('Raw source rows are unchanged');
    await page.evaluate(async saved=>{await window.EM3D.loadProject(saved);await window.EM3D.layersReady();},before.saved);
    const restored=await page.evaluate(()=>({state:window.EM3D.getState(),saved:window.EM3D.getProject()}));
    expect(restored.saved.files).toEqual(before.saved.files);
    expect(restored.state.geophys.diagnostics).toEqual(before.state.geophys.diagnostics);
    expect(restored.state.geophys.minUsed).toBe(before.state.geophys.minUsed);
    expect(restored.state.geophys.maxUsed).toBe(before.state.geophys.maxUsed);
    await expect(page.locator('#gp-ui [role="status"]')).toContainText('4 of 9 points accepted; 5 excluded');
    await page.locator('#ext-geophys').screenshot({path:test.info().outputPath(`strict-geophys-${label}.png`)});
    // Same raw text and columns with a different policy must invalidate cached
    // points. Legacy saved files keep historical prefix interpretation.
    const legacy=structuredClone(before.saved); legacy.files.forEach(f=>{delete f.geophysNumericPolicy;});
    await page.evaluate(async saved=>{await window.EM3D.loadProject(saved);await window.EM3D.layersReady();},legacy);
    const old=await page.evaluate(()=>({state:window.EM3D.getState(),saved:window.EM3D.getProject()}));
    expect(old.state.geophys.diagnostics).toMatchObject({submitted:9,accepted:6,excluded:3,legacyFiles:2});
    expect(old.saved.files.every(f=>!Object.hasOwn(f,'geophysNumericPolicy'))).toBe(true);
    for (const source of [csv,xyz]) expect(old.saved.files.find(f=>f.name===source.name).text).toBe(source.text);
    await expect(page.locator('#gp-ui [role="status"]')).toContainText('Legacy numeric interpretation retained for 2 saved file(s)');
    const unsupported=structuredClone(before.saved); unsupported.files.find(f=>f.name===csv.name).geophysNumericPolicy='future-policy';
    await page.evaluate(async saved=>{await window.EM3D.loadProject(saved);await window.EM3D.layersReady();},unsupported);
    const unsupportedState=await page.evaluate(()=>window.EM3D.getState());
    expect(unsupportedState.geophys.diagnostics.files.find(f=>f.name===csv.name)).toMatchObject({policy:'unsupported',accepted:0,excluded:5,reasons:{'unsupported-policy':5}});
    await expect(page.locator('#gp-ui [role="status"]')).toContainText('unsupported numeric policy');
    await page.evaluate(async saved=>{await window.EM3D.loadProject(saved);await window.EM3D.layersReady();},before.saved);
    expect(await page.evaluate(()=>window.EM3D.getProject().files)).toEqual(before.saved.files);
  });
}

test('a freshly uploaded unrecognized file stays strict when manually mapped to geophysics',async({page})=>{
  test.setTimeout(120000);
  await page.route('**/api/track',r=>r.fulfill({status:204}));
  await page.goto('/3d'); await page.waitForFunction(()=>window.EM3D?.getState().ready);
  const source={name:'synthetic-remap.csv',text:'X,Y,Z,Other\n500000,5500000,100,12tail\n500010,5500010,90,<0.05'};
  await page.evaluate(async files=>{window.EM3D.clearFiles();window.EM3D.addFiles(files);await window.EM3D.layersReady();},[collars,source]);
  await page.getByRole('tab',{name:'1 Data',exact:true}).click();
  await page.getByRole('combobox',{name:`File type for ${source.name}`,exact:true}).selectOption('geophys');
  const file=page.locator('.file').filter({has:page.getByRole('combobox',{name:`File type for ${source.name}`,exact:true})});
  await file.getByLabel('Value',{exact:true}).selectOption('3');
  await page.evaluate(async()=>{await window.EM3D.setGeophys({mode:'curtain'});await window.EM3D.layersReady();});
  const result=await page.evaluate(()=>({state:window.EM3D.getState(),file:window.EM3D.getProject().files.find(f=>f.name==='synthetic-remap.csv')}));
  expect(result.file).toMatchObject({text:source.text,role:'geophys',geophysNumericPolicy:POLICY});
  expect(result.state.geophys.diagnostics).toMatchObject({submitted:2,accepted:0,excluded:2});
  await page.getByRole('tab',{name:'3 Layout',exact:true}).click();
  await expect(page.locator('#gp-ui [role="status"]')).toContainText('0 of 2 points accepted; 2 excluded');
});
