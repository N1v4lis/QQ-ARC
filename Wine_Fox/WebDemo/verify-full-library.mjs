import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--enable-unsafe-swiftshader','--use-angle=swiftshader','--disable-gpu-sandbox']});
const page=await browser.newPage({viewport:{width:1440,height:1000}});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
const results=[];
await mkdir('qa',{recursive:true});
try {
  await page.goto('http://127.0.0.1:8777',{waitUntil:'networkidle'});
  await page.waitForFunction(()=>window.foxState?.().loaded,{timeout:60000});
  for(const variant of ['winefox','snowfox']){
    if(variant==='snowfox'){
      await page.locator('[data-variant="snowfox"]').click();
      await page.waitForFunction(()=>window.foxState().variant==='snowfox'&&window.foxState().loaded,{timeout:60000});
    }
    let state=await page.evaluate(()=>window.foxState());
    assert.equal(state.animations.length,46);assert.equal(await page.locator('#animation-list button').count(),46);
    assert.ok(!state.animations.some(n=>n==='ride'||n==='ride_pig'||/^(vehicle|tac|carryon)/.test(n)));
    assert.equal(state.durations.find(c=>c.name==='gui').seconds,18);
    const entries=[];
    await page.locator('#loop').uncheck();
    for(const name of state.animations){
      await page.selectOption('#animation-select',name);
      await page.locator('#pause').click();
      const duration=state.durations.find(c=>c.name===name).seconds;
      await page.locator('#timeline').evaluate((el,value)=>{el.value=value;el.dispatchEvent(new Event('input',{bubbles:true}));},duration/2);
      await page.selectOption('#expression-select','-1');
      const autoBefore=(await page.evaluate(()=>window.foxState())).faceScales;
      for(const mode of [-1,0,1,2,3,4,5,6]){
        await page.selectOption('#expression-select',String(mode));
        const face=await page.evaluate(()=>window.foxState());
        assert.equal(face.animation,name);assert.equal(face.leverVisible,name.startsWith('lever_'));
        assert.equal(face.expressionMeshes.length,7);assert.equal(face.faceScales.length,7);
        assert.ok(face.faceScales.every(b=>Number.isFinite(b.scale)));
        assert.ok(face.expressionMeshes.every(m=>Number.isFinite(m.mouth)));
        if(mode>=0){
          assert.equal(face.expressionMeshes.filter(m=>m.visible).length,1);
          assert.equal(face.expressionMeshes.find(m=>m.visible).mode,mode);
          assert.equal(face.faceScales.find(b=>b.name===`FaceMode_${mode}`).scale,1);
        } else {
          assert.ok(face.expressionMeshes.every(m=>m.visible));
          assert.ok(face.faceScales.some(b=>b.scale>0.01),`${variant}/${name}: ${JSON.stringify(face.faceScales)}`);
        }
      }
      await page.selectOption('#expression-select','-1');
      assert.deepEqual((await page.evaluate(()=>window.foxState())).faceScales,autoBefore,'Manual expression must restore exact automatic state while paused');
      entries.push({name,seconds:duration,states:8});
    }
    await page.selectOption('#expression-select','-1');
    await page.selectOption('#animation-select','gui');
    await page.locator('#timeline').evaluate(el=>{el.value=6;el.dispatchEvent(new Event('input',{bubbles:true}));});
    state=await page.evaluate(()=>window.foxState());
    assert.equal(state.faceScales.find(b=>b.scale>.5).name,'FaceMode_4');
    await page.screenshot({path:`qa/${variant}-gui.png`,fullPage:true});
    await page.selectOption('#animation-select','lever_left_to_right');
    await page.selectOption('#expression-select','2');
    await page.selectOption('#mouth-select','1');
    await page.locator('#timeline').evaluate(el=>{el.value=.333;el.dispatchEvent(new Event('input',{bubbles:true}));});
    assert.ok((await page.evaluate(()=>window.foxState())).expressionMeshes.every(m=>m.mouth===1));
    await page.screenshot({path:`qa/${variant}-lever.png`,fullPage:true});
    await page.selectOption('#mouth-select','-1');await page.selectOption('#expression-select','-1');
    await page.locator('#loop').check();
    await page.selectOption('#animation-select','lever_left_to_right');
    await page.waitForFunction(()=>window.foxState().animation==='lever_right_to_left',{timeout:10000});
    await page.selectOption('#animation-select','lever_right_to_left');
    await page.locator('#tour').click();
    await page.waitForFunction(()=>window.foxState().animation==='new_idle_1',{timeout:10000});
    await page.locator('#tour').click();assert.equal((await page.evaluate(()=>window.foxState())).tour,false);
    await page.selectOption('#animation-select','idle');
    await page.screenshot({path:`qa/${variant}-current.png`,fullPage:true});
    results.push({variant,animations:entries,guiAuto:true,manualMouth:true,leverAlternates:true,tour:true});
    console.log(`${variant}: 46 animations x 8 expressions passed`);
  }
  await page.setViewportSize({width:390,height:844});await page.waitForTimeout(200);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({path:'qa/current-mobile.png',fullPage:true});
  assert.deepEqual(errors,[]);
  await writeFile('qa/full-library-results.json',JSON.stringify({results,errors,mobile:true},null,2));
} finally {await browser.close();}
