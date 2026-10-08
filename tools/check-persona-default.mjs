import assert from 'node:assert/strict';
import {withPage} from './cdp.mjs';
const url='http://127.0.0.1:3210/';const before=await(await fetch(url+'api/config')).json();
await withPage({url,width:1360,height:900},async page=>{
 await page.waitFor('!!state.config && !!document.querySelector(".tab.active")',{timeout:15000});
 await page.eval(`(()=>{const original=fetch;window.__defaultPosts=[];window.fetch=async(input,init)=>{const u=typeof input==='string'?input:input.url;const json=v=>new Response(JSON.stringify(v));if(u.includes('/api/config')){if(init?.method==='POST'){const patch=JSON.parse(init.body);__defaultPosts.push(patch);return json({ok:true,config:{...state.config,...patch}});}return json(state.config);}if(u.includes('/api/persona-usage'))return json({usageByTemplate:{},usage:[]});return original(input,init);};state.personaTarget='global';document.querySelector('.tab[data-tab=persona]').click();})()`);
 await page.waitFor('!!document.querySelector(".persona-template")');
 await page.eval(`state.personaTemplates={test:{name:'测试默认',text:'test text',customRules:'test rules',owner:'test-account',editable:true,index:0},xiaojingyu:{name:'小鲸鱼',text:'builtin text',builtin:true}};state.personaTarget='private:preserved';state.config.personaByChat ||= {};state.config.personaByChat['private:preserved']={roleText:'own text'};window.__oldIdentity={botName:state.config.persona.botName,participation:state.config.persona.participation};window.__oldAllow=JSON.stringify(state.config.allow);renderSettings();`);
 const setDefault=async id=>{
   await page.eval(`document.querySelector('[data-persona-left=templates]').click();document.querySelector('[data-persona-id="${id}"]').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,button:2,clientX:800,clientY:350}));document.querySelector('[data-template-action=default]').click();`);
   await page.waitFor(`state.config.persona.templateRef?.id===${JSON.stringify(id)} && !document.querySelector('.persona-context-menu') && !!document.querySelector('.persona-default')`);
 };
 await setDefault('test');
 assert.equal(await page.eval('state.config.persona.roleText'),'test text');assert.equal(await page.eval('state.config.persona.customRules'),'test rules');assert.equal(await page.eval('state.config.personaByChat["private:preserved"].roleText'),'own text');
 assert.equal(await page.eval('state.config.persona.botName===__oldIdentity.botName && state.config.persona.participation===__oldIdentity.participation'),true);
 assert.equal(await page.eval('JSON.stringify(state.config.allow)===__oldAllow'),true);
 assert.equal(await page.eval('document.querySelector(".persona-default [data-persona-id]").dataset.personaId'),'test');
 await setDefault('xiaojingyu');
 assert.equal(await page.eval('state.config.persona.roleText'),'builtin text');assert.equal(await page.eval('state.config.persona.systemPromptOverride'),'');
 assert.equal(await page.eval('document.querySelectorAll(".persona-default").length'),1);assert.equal(await page.eval('document.querySelector(".persona-default-badge").textContent'),'★ 默认');
 assert.equal(await page.eval('state.config.personaByChat["private:preserved"].roleText'),'own text');
 console.log('✔ 自定义/内置均可设默认，唯一特殊标记、正文规则即时生效、身份/独立人设/白名单保留；真实写入模拟。');
});
assert.deepEqual(await(await fetch(url+'api/config')).json(),before);
