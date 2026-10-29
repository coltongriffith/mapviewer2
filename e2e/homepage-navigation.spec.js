import {test,expect} from '@playwright/test';

for(const width of [1280,768,390,320]){
  test('homepage navigation is clear and reachable at '+width+'px',async({page})=>{
    await page.setViewportSize({width,height:900});await page.route('**/api/track',r=>r.fulfill({status:204}));
    await page.goto('/');await page.locator('.lm-nav').waitFor();
    const compact=width<=1040,nav=page.getByRole('navigation',{name:compact?'Mobile main':'Main',exact:true});
    if(compact){await expect(nav).toBeHidden();await page.locator('.lm-nav-menu summary').focus();await page.keyboard.press('Enter');}
    await expect(nav).toBeVisible();
    const bounds=await nav.boundingBox();expect(bounds.x).toBeGreaterThanOrEqual(0);expect(bounds.x+bounds.width).toBeLessThanOrEqual(width);
    expect((await nav.locator('button,a').allTextContents()).slice(0,5)).toEqual(['Examples','3D','Features','Pricing','Teams']);
    await expect(nav.getByRole('link',{name:'3D',exact:true})).toHaveAttribute('href','/3d');
    await expect(nav.getByRole('link',{name:'Teams',exact:true})).toHaveAttribute('href','/teams/');
    await expect(nav.getByText('Use Cases',{exact:true})).toHaveCount(0);await expect(nav.getByText('For teams',{exact:true})).toHaveCount(0);
    expect(await page.locator('.lm-nav-inner').evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
    await expect(page.locator('.lm-nav-cta')).toBeVisible();
    await page.screenshot({path:test.info().outputPath(`header-${width}.png`)});
    await nav.getByRole('button',{name:'Examples',exact:true}).click();
    if(compact)await expect(nav).toBeHidden();
    await expect(page.locator('#examples')).toBeInViewport();
  });
}
