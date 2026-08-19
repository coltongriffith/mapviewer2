import { chromium } from '@playwright/test';
import fs from 'node:fs/promises';

const OUT = 'aurora-tutorial-output';
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
await fs.mkdir(OUT, { recursive: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, recordVideo: { dir: OUT, size: { width: 1440, height: 900 } } });
const page = await context.newPage(); page.setDefaultTimeout(30000); const video = page.video(); const cues=[]; let start;
const pause=(n)=>page.waitForTimeout(n);
async function overlay(){await page.evaluate(()=>{document.head.insertAdjacentHTML('beforeend','<style>#tutorial-caption{position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:2147483646;background:rgba(12,26,53,.95);color:#fff;padding:14px 24px;border-radius:12px;font:600 22px Inter,Arial,sans-serif;box-shadow:0 8px 28px rgba(0,0,0,.28);pointer-events:none;max-width:940px;text-align:center;line-height:1.25}#tutorial-cursor{position:fixed;left:707px;top:437px;z-index:2147483647;width:26px;height:26px;border:4px solid #fff;background:#2563eb;border-radius:50%;box-shadow:0 2px 10px rgba(0,0,0,.55);pointer-events:none;transition:left .65s ease,top .65s ease,transform .15s ease}</style><div id="tutorial-caption"></div><div id="tutorial-cursor"></div>')})}
async function caption(text, hold=6000){const n=Date.now(); if(!start)start=n; cues.push({text,spokenText:text,atMs:n-start+350});await page.evaluate(t=>document.querySelector('#tutorial-caption').textContent=t,text);await pause(hold)}
async function move(l){await l.scrollIntoViewIfNeeded();const b=await l.boundingBox();if(!b)throw Error('missing target');await page.evaluate(({x,y})=>{const c=document.querySelector('#tutorial-cursor');c.style.left=`${x-13}px`;c.style.top=`${y-13}px`},{x:b.x+b.width/2,y:b.y+b.height/2});await pause(700)}
async function click(l){await move(l);await l.click();await pause(700)}
try {
 await page.goto('https://www.explorationmaps.com/',{waitUntil:'domcontentloaded'});await page.getByRole('button',{name:'Start Mapping'}).first().waitFor();await overlay();
 await caption('How to create an investor-ready exploration map from scratch.',4800);
 await caption('Start with the claims and drill target map. It gives us the right project structure, then we will make it our own.',7600);
 await click(page.getByRole('button',{name:'Claims & drill target map'}));await page.getByRole('textbox',{name:'Title',exact:true}).waitFor();await pause(1500);
 await caption('This starter includes claims, target areas, drill collars, a legend, a location inset, and a title block.',7600);
 const title=page.getByRole('textbox',{name:'Title',exact:true}); await caption('First, replace the title and subtitle with the project story.',6200);await move(title);await title.fill('Aurora Ridge Project');await page.getByRole('textbox',{name:'Subtitle'}).fill('Target Generation | British Columbia');await pause(900);
 await caption('Upload the company logo to make the map immediately presentation-ready.',6200);await click(page.getByRole('button',{name:'Replace'}));const files=page.locator('input[type=file]');const logo=Buffer.from((await fs.readFile('scripts/tutorial-assets/aurora-ridge-logo.b64','utf8')).trim(),'base64');await files.nth(1).setInputFiles({name:'aurora-ridge-minerals.png',mimeType:'image/png',buffer:logo});await pause(1700);
 await caption('Choose a basemap that supports the story. Terrain works well when topography and access matter.',6800);await click(page.getByRole('button',{name:'Terrain Terrain'}));
 await caption('Select each layer to set its role, label, colour, and marker style. Keep the legend plain and easy to read.',7600);await click(page.getByRole('button',{name:/Drill Collars Drillholes/}).first());await page.getByRole('textbox',{name:'Display Label'}).fill('Drill Collars');await pause(700);
 await caption('Use callouts to bring the highest-priority targets and results forward.',6200);await move(page.getByRole('button',{name:'Add From Selected Layer'}));await pause(1000);
 await caption('Turn on the title, north arrow, scale bar, legend, footer, and inset map. These are the details that make a map ready for investors.',8800);await move(page.getByRole('checkbox',{name:'Inset Map'}));
 await caption('Choose the project mode and design theme, then use Improve Map to refine the framing and layout.',7200);await page.getByRole('combobox',{name:'Mode'}).selectOption({label:'Target Generation Map'});await page.getByRole('combobox',{name:'Design Theme'}).selectOption({label:'Technical'});await click(page.getByRole('button',{name:'Improve Map'}));await pause(1600);
 await caption('Before export, check the title, legend, scale bar, and map framing one final time.',6200);await click(page.getByRole('button',{name:'Export'}));
 await caption('Choose a landscape format and set a clear filename. PNG is ideal for decks, websites, and investor updates.',7600);await click(page.getByRole('button',{name:'Landscape 16:9'}));const filename=page.getByRole('textbox',{name:'Filename'});await filename.fill('aurora-ridge-project-map');await move(filename);
 await caption('Your Aurora Ridge project map is ready to download and use.',5800);
} finally {await fs.writeFile(`${OUT}/narration-cues.json`,JSON.stringify(cues,null,2));await context.close();}
await video.saveAs(`${OUT}/aurora-ridge-project-map-tutorial.webm`);await browser.close();
