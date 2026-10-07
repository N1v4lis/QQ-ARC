// 独立人设页定点检查；保存请求仅在测试浏览器中模拟，不写用户配置。
import assert from 'node:assert/strict';
import {withPage} from './cdp.mjs';
const url=process.argv[2]||'http://127.0.0.1:3210/';
const before=await(await fetch(new URL('/api/config',url))).json();
await withPage({url,width:1360,height:900},async page=>{
  await page.waitFor('!!window.qqaSkin && !!document.querySelector("#tabs .tab.active")',{timeout:15000});
  await page.eval('window.qqaSkin.set("minecraft");document.querySelector(\'.tab[data-tab="persona"]\').click()');
  await page.waitFor('!!document.querySelector("#view-persona #cfg-roletext")',{timeout:15000});
  const initial=await page.eval(`(()=>({
    active:document.querySelector('.tab.active').dataset.tab,
    order:document.querySelector('.tab[data-tab="persona"]').nextElementSibling?.dataset.tab,
    forms:document.querySelectorAll('#settings-form').length,
    foldCards:document.querySelectorAll('#view-persona .setcard').length,
    templateRows:document.querySelectorAll('#view-persona .persona-template').length,
    roleCharacters:document.querySelector('#cfg-roletext').value.length,
    questionMarks:(document.querySelector('#cfg-roletext').value.match(/\\?/g)||[]).length,
    icon:document.querySelector('.tab[data-tab="persona"] svg').dataset.mcIcon,
    sidebarSize:getComputedStyle(document.querySelector('.tab-tx')).fontSize,
    removedFromSettings:!document.querySelector('.settings-menu-item[data-section="persona"]')
  }))()`);
  assert.equal(initial.active,'persona');assert.equal(initial.order,'skills');assert.equal(initial.forms,1);
  assert.equal(initial.foldCards,0);assert(initial.templateRows>0);
  assert.equal(initial.roleCharacters,before.persona.roleText.length);assert.equal(initial.questionMarks,0);
  assert.equal(initial.icon,'persona');assert.equal(initial.sidebarSize,'14px');assert.equal(initial.removedFromSettings,true);
  await page.eval(`(()=>{
    window.__personaTestOriginalFetch=window.fetch;window.__personaTestPosts=[];
    window.fetch=async function(input,init){
      const requestUrl=typeof input==='string'?input:input.url;
      if(requestUrl.includes('/api/config')&&init?.method==='POST'){
        const patch=JSON.parse(init.body);window.__personaTestPosts.push(patch);
        const config=structuredClone(state.config);Object.assign(config.persona,patch.persona||{});
        return new Response(JSON.stringify({ok:true,config}),{status:200,headers:{'Content-Type':'application/json'}});
      }
      return window.__personaTestOriginalFetch.call(this,input,init);
    };
    window.__personaTestRole=document.querySelector('#cfg-roletext').value;
    const role=document.querySelector('#cfg-roletext');role.value+='\\n中文保存验证';role.dispatchEvent(new Event('input',{bubbles:true}));
    document.querySelector('.tab[data-tab="settings"]').click();
  })()`);
  await page.waitFor('window.__personaTestPosts.length>0 && !!document.querySelector("#view-settings #settings-form")',{timeout:10000});
  const saved=await page.eval('({unicode:window.__personaTestPosts[0].persona?.roleText.endsWith("中文保存验证"), keys:Object.keys(window.__personaTestPosts[0]),formCount:document.querySelectorAll("#settings-form").length})');
  assert.equal(saved.unicode,true);assert.equal(saved.formCount,1);assert(saved.keys.includes('persona'));
  await page.eval('window.fetch=window.__personaTestOriginalFetch;document.querySelector("#model-label").click()');
  await page.waitFor('!!document.querySelector("#view-persona #cfg-roletext")',{timeout:15000});
  await page.waitFor('document.querySelector("#cfg-roletext").value===window.__personaTestRole',{timeout:10000});
  await page.eval('document.querySelector("#cfg-persona-pick").click()');
  await page.waitFor('!!document.querySelector("#persona-list .mm-model")',{timeout:10000});
  const names=await page.eval('[...document.querySelectorAll("#persona-list .mm-model")].map(node=>node.textContent)');
  assert(names.length>0);assert(names.every(name=>!name.includes('???')));
  await page.eval('document.querySelector("#persona-cancel").click()');
  await page.eval(`(()=>{
    window.__personaTestPosts=[];
    window.fetch=async function(input,init){
      const requestUrl=typeof input==='string'?input:input.url;
      if(requestUrl.includes('/api/config')&&init?.method==='POST'){
        const patch=JSON.parse(init.body);window.__personaTestPosts.push(patch);
        const config=structuredClone(state.config);
        if(patch.persona)Object.assign(config.persona,patch.persona);
        if('personaUnified' in patch)config.personaUnified=patch.personaUnified;
        return new Response(JSON.stringify({ok:true,config}),{status:200,headers:{'Content-Type':'application/json'}});
      }
      return window.__personaTestOriginalFetch.call(this,input,init);
    };
    const search=document.querySelector('#persona-search');search.value='__no_matching_persona__';search.dispatchEvent(new Event('input',{bubbles:true}));
  })()`);
  assert.equal(await page.eval('document.querySelectorAll(".persona-template:not([hidden])").length'),0);
  await page.eval('document.querySelector("#persona-search").value="";document.querySelector("#persona-search").dispatchEvent(new Event("input",{bubbles:true}))');
  assert.equal(await page.eval('window.__personaTestPosts.length'),0,'搜索不写配置');
  await page.eval('document.querySelector(".persona-template").click()');
  await page.waitFor('window.__personaTestPosts.length>0',{timeout:5000});
  assert.equal(await page.eval('document.querySelector(".persona-template.active")?.getAttribute("aria-pressed")'),'true');
  assert.equal(await page.eval('window.__personaTestPosts.at(-1).persona.roleText===document.querySelector("#cfg-roletext").value'),true);
  await page.eval('document.querySelector("#cfg-persona-unified").click()');
  await page.waitFor('window.__personaTestPosts.some(p=>p.personaUnified===false)');
  await page.waitFor('getComputedStyle(document.querySelector("#persona-perchat-box")).display!=="none"');
  assert.equal(await page.eval('document.querySelectorAll("#view-persona .setcard").length'),0);
  assert.equal(await page.eval('document.querySelector("#new-persona-btn").disabled'),true);
  await page.eval('window.fetch=window.__personaTestOriginalFetch;window.qqaSkin.set("default");document.querySelector("#model-label").click()');
  await page.waitFor('document.querySelector("#cfg-roletext").value===window.__personaTestRole && document.querySelector("#cfg-persona-unified").checked');
  await page.screenshot('shots/final/persona-page-default.png');
  await page.eval('window.qqaSkin.set("minecraft")');
  await page.waitFor('!document.querySelector("#loading-overlay")',{timeout:15000});
  await page.screenshot('shots/final/persona-page.png');
  await page.send('Emulation.setDeviceMetricsOverride',{width:800,height:900,deviceScaleFactor:1,mobile:false});
  await page.eval('document.documentElement.dataset.nav="collapsed"');
  assert.equal(await page.eval('document.documentElement.scrollWidth>innerWidth'),false,'窄窗口无横向溢出');
  await page.screenshot('shots/final/persona-page-narrow.png');
  console.log(JSON.stringify({initial,saved,templates:names.length},null,2));
});
const after=await(await fetch(new URL('/api/config',url))).json();
assert.deepEqual(after,before,'检查不应写入用户真实配置');
console.log('✔ 独立人设路由/技能上方位置/14px导航/模板/切页中文保存/单表单/顶栏入口通过，真实配置未改');
