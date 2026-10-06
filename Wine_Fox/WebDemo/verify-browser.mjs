import { chromium } from 'playwright';
import { mkdir,writeFile } from 'node:fs/promises';
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--enable-unsafe-swiftshader','--use-angle=swiftshader','--disable-gpu-sandbox']});
const page=await browser.newPage({viewport:{width:1365,height:900},deviceScaleFactor:1});
const errors=[];page.on('pageerror',error=>errors.push(error.message));
await mkdir('qa',{recursive:true});
await page.goto('http://127.0.0.1:8777',{waitUntil:'networkidle'});
await page.waitForFunction(()=>window.foxState?.().loaded,{timeout:45000});
let initial=await page.evaluate(()=>window.foxState());
if(initial.animations.length!==46||initial.rendererCalls===0)throw new Error('Expected a rendered model with 46 animations');
await page.screenshot({path:'qa/desktop.png',fullPage:true});
await page.selectOption('#animation-select','walk');
await page.waitForTimeout(150);
if((await page.evaluate(()=>window.foxState())).animation!=='walk')throw new Error('Manual animation selection failed');
await page.getByRole('button',{name:'暂停',exact:true}).click();
const paused=await page.evaluate(()=>window.foxState());await page.waitForTimeout(150);
const pausedLater=await page.evaluate(()=>window.foxState());
if(!paused.paused||Math.abs(paused.time-pausedLater.time)>.001)throw new Error('Pause failed');
await page.getByRole('button',{name:'继续',exact:true}).click();
await page.getByRole('button',{name:'随机动作',exact:false}).click();
if((await page.evaluate(()=>window.foxState())).animation==='walk')throw new Error('Random animation did not change');
await page.selectOption('#animation-select','idle');
await page.waitForTimeout(100);
const bounds=await page.locator('#canvas').boundingBox();
// The character is centered in the canvas. Find a visible body pixel by an actual click.
let point=null;
for(const offset of [0,-40,40,-80,80]){
  await page.selectOption('#animation-select','idle');
  await page.mouse.click(bounds.x+bounds.width/2+offset,bounds.y+bounds.height*.52);
  if((await page.evaluate(()=>window.foxState())).animation!=='idle'){
    point={x:bounds.x+bounds.width/2+offset,y:bounds.y+bounds.height*.52};break;
  }
}
if(!point)throw new Error('Click on model did not trigger an animation');
await page.selectOption('#animation-select','idle');
await page.waitForTimeout(100);
const beforeDrag=await page.evaluate(()=>window.foxState());
await page.mouse.move(point.x,point.y);await page.mouse.down();
await page.mouse.move(point.x+90,point.y-35,{steps:8});await page.mouse.up();
const afterDrag=await page.evaluate(()=>window.foxState());
if(afterDrag.position.every((v,i)=>Math.abs(v-beforeDrag.position[i])<.01))throw new Error('Dragging did not move character');
if(afterDrag.animation!=='idle')throw new Error('Dragging incorrectly triggered random animation');
await page.getByRole('button',{name:'回到中央',exact:true}).click();
if((await page.evaluate(()=>window.foxState())).position.some(v=>Math.abs(v)>.001))throw new Error('Reset failed');
await page.getByRole('button',{name:'雪狐',exact:true}).click();
await page.waitForFunction(()=>window.foxState().loaded&&window.foxState().variant==='snowfox');
await page.selectOption('#animation-select','fly');
await page.screenshot({path:'qa/snowfox.png',fullPage:true});
if((await page.evaluate(()=>window.foxState())).animations.some(n=>n==='ride_pig'||n==='ride'||/^(vehicle|tac|carryon)/.test(n)))throw new Error('Removed animations returned');
await page.setViewportSize({width:390,height:844});
await page.waitForTimeout(150);await page.screenshot({path:'qa/mobile.png',fullPage:true});
if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw new Error('Mobile horizontal overflow');
const result={animations:46,manualSelection:true,randomButton:true,characterClick:true,drag:true,dragDoesNotClick:true,pause:true,reset:true,snowfox:true,mobileNoOverflow:true,errors};
await writeFile('qa/results.json',JSON.stringify(result,null,2));
await browser.close();
if(errors.length)throw new Error(errors.join('\n'));
console.log(JSON.stringify(result));
