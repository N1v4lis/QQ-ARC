import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--enable-unsafe-swiftshader','--use-angle=swiftshader','--disable-gpu-sandbox']});
const page=await browser.newPage({viewport:{width:1365,height:1000}});const errors=[],report=[];
page.on('pageerror',e=>errors.push(e.message));
try{
    await page.goto('http://127.0.0.1:8777',{waitUntil:'networkidle'});
    await page.waitForFunction(()=>window.foxState?.().loaded,{timeout:60000});
    for(const variant of ['winefox','snowfox']){
        if(variant==='snowfox'){
            await page.locator('[data-variant="snowfox"]').click();
            await page.waitForFunction(()=>window.foxState().loaded&&window.foxState().variant==='snowfox',{timeout:60000});
        }
        await page.locator('#loop').uncheck();
        assert.equal((await page.evaluate(()=>window.foxState())).animations.length,46);
        for(const action of ['death','game_lost']){
            await page.selectOption('#animation-select',action);
            const duration=(await page.evaluate(()=>window.foxState())).durations.find(c=>c.name===action).seconds;
            for(const time of [0,duration/2,duration]){
                await page.locator('#timeline').evaluate((el,t)=>{el.value=t;el.dispatchEvent(new Event('input',{bubbles:true}));},time);
                for(const mode of [-1,0,1,2,3,4,5,6,-1]){
                    await page.selectOption('#expression-select',String(mode));
                    const state=await page.evaluate(()=>window.foxState());
                    const selected=mode<0?6:mode;
                    assert.equal(state.faceScales.find(b=>b.scale>.5)?.name,`FaceMode_${selected}`,`${variant}/${action}/${time}/${mode}`);
                    assert.equal(state.animation,action);
                }
            }
            await page.screenshot({path:`qa/${variant}-${action}-dazed.png`,fullPage:true});
            report.push({variant,action,seconds:duration,autoMode:6,manualOverride:true,restoreAuto:true});
        }
    }
    assert.deepEqual(errors,[]);
    await writeFile('qa/sad-expressions-results.json',JSON.stringify({report,errors},null,2));
    console.log('SAD_WEB_OK',JSON.stringify(report));
}finally{await browser.close();}
