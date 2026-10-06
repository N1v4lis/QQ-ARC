import {chromium} from 'playwright';
import {writeFile} from 'node:fs/promises';
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--enable-unsafe-swiftshader','--use-angle=swiftshader','--disable-gpu-sandbox']});
const page=await browser.newPage({viewport:{width:1365,height:900}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.goto('http://127.0.0.1:8765',{waitUntil:'networkidle'});await page.waitForFunction(()=>window.foxState?.().loaded);
const initial=await page.evaluate(()=>window.foxState());
function check(s,mode){if(s.expression!==mode||s.expressionMeshes.some((o,i)=>o.visible!==(i===mode)))throw new Error(JSON.stringify(s));}
check(initial,0);
for(let mode=0;mode<7;mode++){
  await page.selectOption('#expression-select',String(mode));
  for(const name of initial.animations){await page.selectOption('#animation-select',name);await page.waitForTimeout(20);check(await page.evaluate(()=>window.foxState()),mode);}
  await page.selectOption('#animation-select','gui');await page.getByRole('button',{name:'暂停',exact:true}).click();await page.screenshot({path:`qa/expression-${mode}.png`});
}
await page.getByRole('button',{name:'雪狐',exact:true}).click();await page.waitForFunction(()=>window.foxState().variant==='snowfox'&&window.foxState().loaded);if(await page.locator('#expression-control').isVisible())throw new Error('Wine-only control shown for Snow');
await page.getByRole('button',{name:'酒狐',exact:true}).click();await page.waitForFunction(()=>window.foxState().variant==='winefox'&&window.foxState().loaded);check(await page.evaluate(()=>window.foxState()),6);
await page.setViewportSize({width:390,height:844});if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw new Error('Mobile overflow');
if(errors.length)throw new Error(errors.join('\n'));await writeFile('qa/expression-verification.json',JSON.stringify({animations:44,expressions:7,exclusive:true,errors},null,2));console.log('44 animations x 7 mutually exclusive expressions passed');await browser.close();
